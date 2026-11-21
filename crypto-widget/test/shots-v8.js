'use strict';
/**
 * Screenshot harness for the "cảnh báo giá đạt" (touch) alert.
 *
 * The assertions in e2e.js prove the behaviour; these shots exist to judge the
 * one thing they cannot — whether the three-way segment still fits and reads
 * well, and whether the tolerance field looks like part of the form rather than
 * something bolted on.
 *
 * Run:  xvfb-run -a node test/shots-v8.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots-v8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '67420.5' },
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
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`timeout ${method}`)); }
      }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-shots8-'));
  const port = 9457;

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
      { symbol: 'BTC', side: 'BUY', price: 58200, qty: 0.35, fee: 12, time: Date.now() - 86400000 * 12 },
      { symbol: 'ETH', side: 'BUY', price: 2950, qty: 4.2, fee: 8, time: Date.now() - 86400000 * 9 },
      { symbol: 'SOL', side: 'BUY', price: 198.4, qty: 25, fee: 3, time: Date.now() - 86400000 * 3 },
    ];
    for (const s of seed) await cdp.eval(`return window.cpw.saveTrade(${JSON.stringify(s)});`);

    // One of each kind, so the list shows all three side by side.
    await cdp.eval(`return window.cpw.saveAlert({ symbol: 'BTC', price: 70000, direction: 'above', note: 'Chốt lời 1 phần' });`);
    await cdp.eval(`return window.cpw.saveAlert({ symbol: 'ETH', price: 3000, direction: 'below', note: 'Cắt lỗ' });`);
    await cdp.eval(`return window.cpw.saveAlert({ symbol: 'SOL', price: 180, direction: 'touch', tolerance: 0.5, note: 'Vùng chốt lời' });`);

    mock.push('BTCUSDT', 67420.5);
    mock.push('ETHUSDT', 3285.4);
    mock.push('SOLUSDT', 172.35);
    await wait(1200);

    // ---- the alert list with all three kinds
    await cdp.eval(`document.querySelector('.tab[data-tab="alerts"]').click(); return true;`);
    await wait(500);
    await cdp.shot(path.join(OUT, '01-alert-list.png'));

    // ---- the form, default (above): tolerance must be absent
    await cdp.eval(`document.getElementById('btnAddAlert').click(); return true;`);
    await wait(500);
    await cdp.shot(path.join(OUT, '02-form-above.png'));

    // ---- the form on "Chạm mốc": tolerance appears
    await cdp.eval(`document.querySelector('#alertDir .seg-btn[data-dir="touch"]').click(); return true;`);
    await wait(300);
    await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('alertSymbol', 'SOL');
      set('alertPrice', '180');
      set('alertTolerance', '0.5');
      return true;
    `);
    await wait(300);
    await cdp.shot(path.join(OUT, '03-form-touch.png'));

    // ---- the same form in the "Chỉ chữ" style, over a busy wallpaper
    await cdp.eval(`document.querySelector('#alertModal [data-close]').click(); return true;`);
    await wait(300);
    await cdp.eval(`await window.cpw.patchSettings({ theme: 'bare', halo: 70 }); return true;`);
    await wait(600);
    await cdp.eval(`
      document.body.style.background =
        'linear-gradient(135deg,#ffffff 0%,#ffe9a8 30%,#8fd3ff 60%,#1b2a4a 100%)';
      return true;
    `);
    await wait(300);
    await cdp.eval(`document.getElementById('btnAddAlert').click(); return true;`);
    await wait(400);
    await cdp.eval(`document.querySelector('#alertDir .seg-btn[data-dir="touch"]').click(); return true;`);
    await wait(300);
    await cdp.shot(path.join(OUT, '04-form-touch-bare.png'));

    // ---- measure the segment: three labels must fit without clipping
    const seg = await cdp.eval(`
      const btns = [...document.querySelectorAll('#alertDir .seg-btn')];
      const box = document.getElementById('alertDir').getBoundingClientRect();
      return {
        boxW: Math.round(box.width),
        btns: btns.map((b) => {
          const r = b.getBoundingClientRect();
          return {
            label: b.textContent.trim(),
            w: Math.round(r.width),
            scrollW: b.scrollWidth,
            clipped: b.scrollWidth > Math.ceil(r.width) + 1,
          };
        }),
      };
    `);
    console.log('SEGMENT', JSON.stringify(seg, null, 2));

    const tol = await cdp.eval(`
      const f = document.getElementById('alertTolField');
      const r = f.getBoundingClientRect();
      const inp = document.getElementById('alertTolerance').getBoundingClientRect();
      return {
        hidden: f.hidden,
        h: Math.round(r.height),
        inputW: Math.round(inp.width),
        hint: f.querySelector('.hint').textContent.trim(),
      };
    `);
    console.log('TOLERANCE', JSON.stringify(tol, null, 2));

    console.log('shots written to', OUT);
  } catch (e) {
    console.error('shot run failed:', e.message);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    await wait(300);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  process.exit(0);
})();
