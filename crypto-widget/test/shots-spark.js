'use strict';
/**
 * Visual check for the candle sparklines.
 *
 * Assertions can prove a path exists and sits between two elements; they cannot
 * show whether the line reads as a chart or as a smudge at 11px. This captures
 * the states and prints the measured numbers that back the claims.
 *
 *   1. the panel list, with a sparkline in every row
 *   2. the collapsed strip, with coin rows and their sparklines
 *   3. the same strip on the "Chỉ chữ" theme, where the line has no surface
 *   4. the settings sheet, showing the two new switches
 *
 * Run:  xvfb-run -a node test/shots-spark.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots-spark');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A deterministic series per symbol, shaped so the three directions are all
 * visible in one screenshot: BTC rising, ETH falling, SOL flat, LDO a dip and
 * recovery, SUI a steady climb.
 */
const SERIES = {
  BTCUSDT: [88000, 89500, 88900, 91200, 90400, 93100, 94800, 96420],
  ETHUSDT: [3600, 3550, 3580, 3420, 3390, 3310, 3340, 3285],
  SOLUSDT: [172.35, 172.35, 172.35, 172.35, 172.35, 172.35, 172.35, 172.35],
  LDOUSDT: [1.62, 1.55, 1.48, 1.51, 1.39, 1.33, 1.30, 1.284],
  SUIUSDT: [2.9, 3.02, 2.98, 3.15, 3.22, 3.31, 3.28, 3.412],
};

function klineRows(values) {
  const base = 1700000000000;
  return values.map((v, i) => [
    base + i * 900000,
    String(v), String(v), String(v), String(v), '10',
    base + i * 900000 + 899999, '0', 1, '0', '0', '0',
  ]);
}

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '96420.5' },
          { symbol: 'ETHUSDT', price: '3285.4' },
          { symbol: 'SOLUSDT', price: '172.35' },
          { symbol: 'LDOUSDT', price: '1.284' },
          { symbol: 'SUIUSDT', price: '3.412' },
        ]));
        return;
      }
      if (req.url.startsWith('/fapi/v1/klines')) {
        const m = /symbol=([A-Z0-9]+)/.exec(req.url);
        const values = SERIES[m ? m[1] : ''];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(values ? klineRows(values) : []));
        return;
      }
      res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const clients = [];
    wss.on('connection', (ws) => clients.push(ws));
    const sockets = new Set();
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
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
        close: () => new Promise((r) => {
          for (const s of sockets) s.destroy();
          wss.close();
          server.close(r);
        }),
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-spark-shot-'));
  const port = 9474;

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
        CPW_KLINES_BASE: `http://127.0.0.1:${mock.port}/fapi/v1/klines`,
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
      { symbol: 'LDO', side: 'BUY', price: 1.42, qty: 900, fee: 1, time: Date.now() - 86400000 * 2 },
      { symbol: 'SUI', side: 'BUY', price: 3.9, qty: 300, fee: 1, time: Date.now() - 86400000 * 1 },
    ];
    for (const s of seed) await cdp.eval(`return window.cpw.saveTrade(${JSON.stringify(s)});`);
    for (const [sym, px] of [['BTCUSDT', 96420.5], ['ETHUSDT', 3285.4], ['SOLUSDT', 172.35], ['LDOUSDT', 1.284], ['SUIUSDT', 3.412]]) {
      mock.push(sym, px);
    }
    await wait(3000);

    // ---- 1. the panel list, with a sparkline in every row
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '01-panel-sparklines.png'));

    const panel = await cdp.eval(`
      const rows = [...document.querySelectorAll('#posList .pos')];
      return rows.map((r) => {
        const svg = r.querySelector('.spark-pos');
        const b = svg ? svg.getBoundingClientRect() : null;
        const line = svg ? svg.querySelector('.spark-line') : null;
        return {
          sym: r.dataset.symbol,
          cls: svg ? svg.getAttribute('class') : null,
          w: b ? +b.width.toFixed(2) : null,
          h: b ? +b.height.toFixed(2) : null,
          stroke: line ? getComputedStyle(line).stroke : null,
          strokeW: line ? getComputedStyle(line).strokeWidth : null,
          d: line ? line.getAttribute('d').slice(0, 40) : null,
        };
      });
    `);
    console.log('panel rows:', JSON.stringify(panel, null, 1));

    // ---- 2. tick every coin, then look at the strip
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(600);
    await cdp.eval(`
      for (const b of ['BTC','ETH','SOL','LDO','SUI']) {
        const i = document.querySelector('input[data-strip-coin="' + b + '"]');
        if (i) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      return true;
    `);
    await wait(1200);
    await cdp.shot(path.join(OUT, '02-settings-switches.png'));

    await cdp.eval(`document.querySelector('#lookModal [data-close]').click(); return true;`);
    await wait(400);
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'taskbar' }); return true;`);
    await wait(1200);
    await cdp.shot(path.join(OUT, '03-strip-sparklines.png'));

    const strip = await cdp.eval(`
      const rows = [...document.querySelectorAll('#cvCoins .cv-coin')];
      const geo = rows.map((r) => {
        const b = r.getBoundingClientRect();
        const svg = r.querySelector('.spark-strip');
        const sb = svg ? svg.getBoundingClientRect() : null;
        const line = svg ? svg.querySelector('.spark-line') : null;
        return {
          sym: r.querySelector('.cv-coin-sym').textContent.trim(),
          rowH: +b.height.toFixed(2),
          sparkW: sb ? +sb.width.toFixed(2) : null,
          sparkH: sb ? +sb.height.toFixed(2) : null,
          stroke: line ? getComputedStyle(line).stroke : null,
          strokeW: line ? getComputedStyle(line).strokeWidth : null,
        };
      });
      const gaps = [];
      for (let i = 1; i < rows.length; i++) {
        const a = rows[i - 1].getBoundingClientRect();
        const c = rows[i].getBoundingClientRect();
        gaps.push(+(c.top - a.bottom).toFixed(2));
      }
      return {
        count: rows.length,
        geo,
        gaps,
        stripH: +document.querySelector('.collapsed-view').getBoundingClientRect().height.toFixed(2),
        overflow: (() => { const cv = document.querySelector('.collapsed-view'); return cv.scrollHeight > cv.clientHeight + 1; })(),
      };
    `);
    console.log('strip rows:', JSON.stringify(strip, null, 1));

    // ---- 3. the same strip on "Chỉ chữ", where the line has no surface
    await cdp.eval(`await window.cpw.patchSettings({ theme: 'bare' }); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '04-strip-bare.png'));

    const bare = await cdp.eval(`
      const line = document.querySelector('#cvCoins .spark-line');
      const cs = line ? getComputedStyle(line) : null;
      return {
        strokeW: cs ? cs.strokeWidth : null,
        filter: cs ? cs.filter : null,
        halo: getComputedStyle(document.getElementById('widget')).getPropertyValue('--halo-color').trim(),
      };
    `);
    console.log('bare theme:', JSON.stringify(bare));

    // ---- 4. the light theme, where the warning colour used to vanish
    await cdp.eval(`await window.cpw.patchSettings({ theme: 'light', dockMode: 'float' }); return true;`);
    await wait(700);
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '05-panel-light.png'));

    const light = await cdp.eval(`
      const w = document.getElementById('widget');
      const cs = getComputedStyle(w);
      const warn = document.querySelector('.warn');
      return {
        warnVar: cs.getPropertyValue('--warn').trim(),
        warnColor: warn ? getComputedStyle(warn).color : null,
        up: cs.getPropertyValue('--up').trim(),
        down: cs.getPropertyValue('--down').trim(),
      };
    `);
    console.log('light theme:', JSON.stringify(light));

    console.log('shots written to', OUT);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
})().catch((e) => { console.error(e); process.exit(1); });
