'use strict';
/**
 * Contrast audit for the "Chỉ chữ" (bare) style, read from the live DOM.
 *
 * Pixel sampling is unreliable here because the test wallpaper contains red
 * and green of its own. So instead we ask the browser what colour and what
 * stroke colour each element actually got, and compute the WCAG ratio between
 * them in Node. That ratio is what decides legibility: the stroke is painted
 * behind the glyph, so a high ratio means the glyph is separated from whatever
 * the desktop shows through.
 *
 * Run:  xvfb-run -a node test/contrast.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- colour maths
function srgbToLin(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function relLum({ r, g, b }) {
  return 0.2126 * srgbToLin(r) + 0.7152 * srgbToLin(g) + 0.0722 * srgbToLin(b);
}
function wcag(a, b) {
  const la = relLum(a);
  const lb = relLum(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Parse any CSS colour string the browser may hand back.
 * getComputedStyle returns `rgb(...)` for plain colours but
 * `color(srgb 0.81 0.81 0.81 / 0.98)` for color-mix() results, so both forms
 * have to be understood — otherwise every derived colour silently reads null.
 */
function parseColor(s) {
  if (!s) return null;
  const rgb = s.match(/rgba?\(([^)]+)\)/);
  if (rgb) {
    const p = rgb[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (p.length >= 3) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  const srgb = s.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/);
  if (srgb) {
    return {
      r: Number(srgb[1]) * 255,
      g: Number(srgb[2]) * 255,
      b: Number(srgb[3]) * 255,
      a: srgb[4] ? Number(srgb[4]) : 1,
    };
  }
  return null;
}

// ---------------------------------------------------------------- mock feed
function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([{ symbol: 'BTCUSDT', price: '67420.5' }]));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const clients = [];
    wss.on('connection', (ws) => clients.push(ws));
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      push(s, p) {
        const f = JSON.stringify({
          stream: `${s.toLowerCase()}@markPrice@1s`,
          data: { e: 'markPriceUpdate', E: Date.now(), s, p: String(p) },
        });
        for (const c of clients) if (c.readyState === 1) c.send(f);
      },
      close: () => new Promise((r) => { wss.close(); server.close(r); }),
    }));
  });
}

// ---------------------------------------------------------------- CDP
class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (b) => {
      const m = JSON.parse(b.toString());
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
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
  close() { try { this.ws.close(); } catch (_) { /* ignore */ } }
}

const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

async function findTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await getJson(`http://127.0.0.1:${port}/json/list`);
      const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch (_) { /* not up yet */ }
    await wait(500);
  }
  throw new Error('no devtools target');
}

// The probe runs in the page and returns raw strings; all maths happens here.
const PROBE = `
  const out = [];
  const probe = (sel, name) => {
    const el = document.querySelector(sel);
    if (!el) { out.push({ name, missing: true }); return; }
    const cs = getComputedStyle(el);
    out.push({
      name,
      color: cs.color,
      stroke: cs.webkitTextStrokeColor,
      strokeWidth: cs.webkitTextStrokeWidth,
    });
  };
  probe('#totalValue', 'hero total');
  probe('#totalPnl', 'P&L pill');
  probe('#totalPct', 'P&L percent');
  probe('.pos-sym', 'coin symbol');
  probe('.pos-sub', 'position sub');
  probe('.tab.is-active', 'active tab');
  probe('.tab:not(.is-active)', 'inactive tab');
  probe('#feedLabel', 'feed status');
  probe('#btnData', 'footer link');
  return out;
`;

(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-con-'));
  const port = 9777;
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
    await wait(1500);

    await cdp.eval(`return window.cpw.saveTrade({ symbol:'BTC', side:'BUY', price:58200, qty:0.35, fee:12, time: Date.now()-86400000 });`);
    await cdp.eval(`return window.cpw.saveTrade({ symbol:'ETH', side:'BUY', price:4000, qty:1, fee:5, time: Date.now()-86400000 });`);
    mock.push('BTCUSDT', 67420.5);
    mock.push('ETHUSDT', 3285.4);
    await wait(1200);

    const modes = [
      { label: 'white text', textColor: '#ffffff' },
      { label: 'dark text', textColor: '#1f2937' },
      { label: 'yellow text', textColor: '#ffd166' },
    ];

    let worst = { ratio: Infinity, name: '', mode: '' };
    let failures = 0;

    for (const m of modes) {
      await cdp.eval(`return window.cpw.patchSettings({ theme: 'bare', textColor: '${m.textColor}', halo: 70 });`);
      await wait(500);
      const rows = await cdp.eval(PROBE);

      console.log(`\n--- ${m.label} (${m.textColor}) ---`);
      for (const r of rows) {
        if (r.missing) { console.log(`  ${r.name.padEnd(16)} MISSING`); failures++; continue; }
        const fg = parseColor(r.color);
        const st = parseColor(r.stroke);
        if (!fg || !st) {
          console.log(`  ${r.name.padEnd(16)} UNPARSEABLE fg=${r.color} stroke=${r.stroke}`);
          failures++;
          continue;
        }
        const ratio = wcag(fg, st);
        const verdict = ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA-large' : 'LOW';
        if (ratio < 4.5) failures++;
        if (ratio < worst.ratio) worst = { ratio, name: r.name, mode: m.label };
        console.log(
          `  ${r.name.padEnd(16)} fg=${r.color.padEnd(34)} stroke=${r.stroke.padEnd(24)} `
          + `${ratio.toFixed(2).padStart(6)}:1  ${verdict}`,
        );
      }
    }

    console.log(`\nworst: ${worst.name} in "${worst.mode}" at ${worst.ratio.toFixed(2)}:1`);
    if (failures > 0) {
      console.log(`FAIL: ${failures} element(s) below WCAG AA (4.5:1)`);
      process.exitCode = 1;
    } else {
      console.log('PASS: every element meets WCAG AA (4.5:1) against its own outline');
    }
  } catch (e) {
    console.error('contrast audit failed:', e.message);
    process.exitCode = 1;
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    await wait(300);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  process.exit(process.exitCode || 0);
})();
