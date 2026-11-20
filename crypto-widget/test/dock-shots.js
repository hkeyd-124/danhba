'use strict';
/**
 * Visual check for taskbar dock mode.
 *
 * Boots the real app, docks it, and captures the strip at each step so the
 * 44px-tall layout can actually be looked at — a size that tight is exactly
 * where text collides or gets clipped, and no assertion catches that.
 *
 * Run:  xvfb-run -a node test/dock-shots.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots-dock');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '96420.5' },
          { symbol: 'ETHUSDT', price: '3285.4' },
          { symbol: 'SOLUSDT', price: '172.35' },
        ]));
        return;
      }
      res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const clients = [];
    wss.on('connection', (ws) => clients.push(ws));
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        push(symbol, price) {
          const frame = JSON.stringify({
            stream: `${symbol.toLowerCase()}@markPrice@1s`,
            data: { e: 'markPriceUpdate', E: Date.now(), s: symbol, p: String(price) },
          });
          for (const c of clients) if (c.readyState === 1) c.send(frame);
        },
        close: () => new Promise((r) => { wss.close(); server.close(r); }),
      });
    });
  });
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (buf) => {
      const m = JSON.parse(buf.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); } }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch (_) { /* ignore */ } }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function findTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (_) { /* wait */ }
    await wait(500);
  }
  throw new Error('no devtools target');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-dock-'));
  const port = 9455;

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        CPW_TEST: '1',
        CPW_WS_BASE: `ws://127.0.0.1:${mock.port}/market/stream`,
        CPW_REST_BASE: `http://127.0.0.1:${mock.port}/fapi/v1/ticker/price`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stderr.on('data', () => {});

  let cdp;
  try {
    const t = await findTarget(port);
    cdp = new CDP(t.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await wait(1500);

    const seed = [
      { symbol: 'BTC', side: 'BUY', price: 88200, qty: 0.42, fee: 12, time: Date.now() - 86400000 * 12 },
      { symbol: 'ETH', side: 'BUY', price: 2950, qty: 4.2, fee: 8, time: Date.now() - 86400000 * 9 },
      { symbol: 'SOL', side: 'BUY', price: 198.4, qty: 25, fee: 3, time: Date.now() - 86400000 * 3 },
    ];
    for (const s of seed) await cdp.eval(`return window.cpw.saveTrade(${JSON.stringify(s)});`);
    mock.push('BTCUSDT', 96420.5);
    mock.push('ETHUSDT', 3285.4);
    mock.push('SOLUSDT', 172.35);
    await wait(1200);

    // 1. dock, collapsed — the state the user sees by default
    await cdp.eval(`await window.cpw.patchSettings({ dockToTaskbar: true }); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '01-dock-strip.png'));

    // 2. the strip with the auto-hiding bar revealed (top edge hover)
    await cdp.eval(`
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 3 }));
      return true;
    `);
    await wait(400);
    await cdp.shot(path.join(OUT, '02-dock-strip-titlebar.png'));
    await cdp.eval(`
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 40 }));
      return true;
    `);
    await wait(600);

    // 3. expanded
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '03-dock-expanded.png'));

    // 4. the appearance sheet, showing the new Position control
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(600);
    await cdp.shot(path.join(OUT, '04-dock-appearance.png'));
    await cdp.eval(`document.querySelector('#lookModal [data-close]').click(); return true;`);
    await wait(400);

    // 5. docked + "Chỉ chữ" — the strip must stay frameless
    await cdp.eval(`
      await window.cpw.patchSettings({ theme: 'bare' });
      await window.cpw.window('collapse');
      return true;
    `);
    await wait(900);
    await cdp.shot(path.join(OUT, '05-dock-bare-strip.png'));

    // 6. a long total, to prove nothing clips at 300px
    await cdp.eval(`await window.cpw.patchSettings({ theme: 'solid' }); return true;`);
    await cdp.eval(`
      await window.cpw.saveTrade({ symbol: 'BTC', side: 'BUY', price: 96400, qty: 9.5, fee: 40 });
      return true;
    `);
    await wait(1400);
    await cdp.shot(path.join(OUT, '06-dock-wide-value.png'));

    console.log('shots written to', OUT);
  } catch (err) {
    console.error('dock-shots failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    await wait(300);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
})();
