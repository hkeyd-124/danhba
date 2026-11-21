'use strict';
/**
 * Measure the taskbar strip's real layout at several widths.
 *
 * The visual check flagged two things that an assertion cannot settle: whether
 * the text is vertically centred, and whether the P&L is truncated at the
 * minimum width. Both are measured here from the DOM's own rectangles, because
 * a vision model's "looks 2px low" is not evidence.
 *
 * Run:  xvfb-run -a node test/measure-v9.js
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

const MEASURE = `
  const strip = document.getElementById('collapsedView');
  const sr = strip.getBoundingClientRect();
  const val = document.getElementById('cvValue');
  const pnl = document.getElementById('cvPnl');
  const pct = document.getElementById('cvPct');
  const vr = val.getBoundingClientRect();
  const pr = pnl.getBoundingClientRect();
  const cr = pct.getBoundingClientRect();
  const cs = getComputedStyle(strip);
  const padL = parseFloat(cs.paddingLeft);
  const padR = parseFloat(cs.paddingRight);
  return {
    strip: { w: Math.round(sr.width), h: Math.round(sr.height) },
    // vertical: the text's own box centre vs the strip's centre
    valueCentre: +(vr.top + vr.height / 2 - sr.top).toFixed(2),
    pnlCentre: +(pr.top + pr.height / 2 - sr.top).toFixed(2),
    stripCentre: +(sr.height / 2).toFixed(2),
    // horizontal: real padding on each side, measured from the text boxes
    leftGap: +(vr.left - sr.left).toFixed(2),
    rightGap: +(sr.right - cr.right).toFixed(2),
    cssPadL: padL,
    cssPadR: padR,
    // truncation: scrollWidth > clientWidth means the text is being cut
    pnlTruncated: pnl.scrollWidth > pnl.clientWidth + 1,
    pctTruncated: pct.scrollWidth > pct.clientWidth + 1,
    valTruncated: val.scrollWidth > val.clientWidth + 1,
    pnlText: pnl.textContent,
    pctText: pct.textContent,
    valText: val.textContent,
    // the gap between the two right-hand numbers
    pnlPctGap: +(cr.left - pr.right).toFixed(2),
  };
`;

(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-m9-'));
  const port = 9477;

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

    for (const width of [200, 240, 258, 259, 260, 300, 540]) {
      // `patchSettings` alone does NOT re-place the window — placement happens
      // on a collapse toggle or a resize. And `window('collapse')` is a TOGGLE,
      // so calling it in a loop alternates expanded/collapsed and every other
      // measurement reads a hidden strip (w=0). Both were wrong in the first
      // version of this script; the numbers it printed were meaningless.
      //
      // So: force collapsed explicitly, then drive the real resize path to the
      // exact width under test.
      await cdp.eval(`
        const g = await window.cpw.testGeometry();
        if (!g.collapsed) await window.cpw.window('collapse');
        return true;
      `);
      await wait(400);
      const cur = await cdp.eval(`
        const g = await window.cpw.testGeometry();
        return g.bounds.width;
      `);
      await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: ${width} - ${cur}, dy: 0 });`);
      await wait(500);
      const m = await cdp.eval(MEASURE);
      console.log(`\n--- stripWidth ${width} (actual ${m.strip.w}) ---`);
      console.log(JSON.stringify(m, null, 2));
    }
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
