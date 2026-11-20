'use strict';
/**
 * Measures the docked strip's real geometry.
 *
 * The visual check reported the text sitting low in the 44px strip. Rather
 * than guess at padding, this reads the actual bounding boxes so the fix is
 * based on numbers.
 *
 * Run:  xvfb-run -a node test/dock-measure.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ symbol: 'BTCUSDT', price: '96420.5' }]));
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
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-measure-'));
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

    await cdp.eval(`return window.cpw.saveTrade({ symbol: 'BTC', side: 'BUY', price: 88200, qty: 0.42, fee: 12 });`);
    mock.push('BTCUSDT', 96420.5);
    await wait(1000);
    await cdp.eval(`await window.cpw.patchSettings({ dockToTaskbar: true }); return true;`);
    await wait(900);

    const m = await cdp.eval(`
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), h: +b.height.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1) }; };
      const cv = document.getElementById('collapsedView');
      const val = document.getElementById('cvValue');
      const pnl = document.getElementById('cvPnl');
      const pct = document.getElementById('cvPct');
      const cs = getComputedStyle(cv);
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        strip: r(cv),
        value: r(val),
        pnl: r(pnl),
        pct: r(pct),
        padding: cs.padding,
        alignItems: cs.alignItems,
        valueLineHeight: getComputedStyle(val).lineHeight,
        valueFontSize: getComputedStyle(val).fontSize,
        valueMarginTop: getComputedStyle(val).marginTop,
        pnlLineHeight: getComputedStyle(pnl).lineHeight,
        pnlFontSize: getComputedStyle(pnl).fontSize,
        pctLineHeight: getComputedStyle(pct).lineHeight,
        pctFontSize: getComputedStyle(pct).fontSize,
        leftAlign: getComputedStyle(document.querySelector('.cv-left')).alignItems,
        rightAlign: getComputedStyle(document.querySelector('.cv-right')).alignItems,
      };
    `);
    console.log(JSON.stringify(m, null, 2));
  } catch (err) {
    console.error('measure failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    await wait(300);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
})();
