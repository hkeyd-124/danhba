'use strict';
/**
 * Visual check for the dragged taskbar strip (v9).
 *
 * The bug was that a dragged strip width was not remembered. The fix is
 * asserted in e2e, but a width is also a LAYOUT question: at 540px the strip
 * has a lot of empty space, and at 200px the total and the P&L pill have to
 * still fit. Neither is visible to an assertion, so this captures the strip at
 * three widths and at the minimum.
 *
 * Run:  xvfb-run -a node test/shots-v9.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots-v9');
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-v9-'));
  const port = 9466;

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

    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'taskbar' }); return true;`);
    await wait(1000);

    // 1. the default strip
    await cdp.shot(path.join(OUT, '01-strip-default.png'));

    // 2. dragged wider — the state the bug used to lose
    await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: 240, dy: 0 });`);
    await wait(500);
    await cdp.shot(path.join(OUT, '02-strip-dragged-wide.png'));

    // 3. expand, then collapse — the strip must come back at the dragged width
    await cdp.eval(`document.getElementById('collapsedView').click(); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '03-panel-expanded.png'));
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '04-strip-restored.png'));

    // 4. dragged to the minimum — the tightest the layout has to survive
    await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: -600, dy: 0 });`);
    await wait(500);
    await cdp.shot(path.join(OUT, '05-strip-minimum.png'));

    // 5. "Chỉ chữ" at the dragged width — no surface, so the halo must carry it
    await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: 240, dy: 0 });`);
    await wait(300);
    await cdp.eval(`await window.cpw.patchSettings({ theme: 'bare' }); return true;`);
    await wait(700);
    await cdp.shot(path.join(OUT, '06-strip-bare.png'));

    const geo = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { bounds: g.bounds, taskbar: g.taskbar, settings: g.settings };
    `);
    console.log('geometry:', JSON.stringify(geo));
    console.log('shots written to', OUT);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
