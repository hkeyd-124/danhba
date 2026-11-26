'use strict';
/**
 * Measures the coin row in both places, on the real renderer.
 *
 * The three things this run has to prove are all geometric, so none of them can
 * be settled by reading the source:
 *
 *   1. the strip row carries a PnL figure, and it sits between the chart and
 *      the market price;
 *   2. the chart is centred in the gap, not pinned to the ticker;
 *   3. the detail row shows the ticker even with icons on.
 *
 * It loads the real index.html, stubs the preload bridge, pushes one state
 * payload and reads back getBoundingClientRect for every child of every row.
 *
 * Run:  xvfb-run -a node test/measure-row.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots-row');
const CHROME = process.env.CHROME_BIN || '/root/.agent-browser/browsers/chrome-157.0.8103.50/chrome';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const SERIES = {
  BTCUSDT: [88000, 89500, 88900, 91200, 90400, 93100, 94800, 96420],
  ETHUSDT: [3600, 3550, 3580, 3420, 3390, 3310, 3340, 3285],
  LDOUSDT: [1.62, 1.55, 1.48, 1.51, 1.39, 1.33, 1.30, 1.284],
};

/**
 * Candles in the shape the renderer actually consumes.
 *
 * `Candles.build` reads `{t,o,h,l,c}` objects, not the raw Binance arrays —
 * `src/klines.js` converts them before they reach the renderer. The first
 * version of this harness fed raw arrays, so every candle was dropped by
 * `clean()` and the chart silently rendered nothing while the PnL beside it
 * looked perfect.
 */
function klineRows(values) {
  const base = 1700000000000;
  return values.map((v, i) => {
    const prev = i === 0 ? v : values[i - 1];
    return {
      t: base + i * 900000,
      o: prev,
      h: Math.max(prev, v) * 1.004,
      l: Math.min(prev, v) * 0.996,
      c: v,
    };
  });
}

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = req.url.split('?')[0];
      const file = path.join(ROOT, 'renderer', url === '/' ? 'index.html' : url);
      if (!file.startsWith(path.join(ROOT, 'renderer')) || !fs.existsSync(file)) {
        res.writeHead(404); res.end(); return;
      }
      const ext = path.extname(file);
      const type = ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'text/html';
      res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` });
      res.end(fs.readFileSync(file));
    });
    server.listen(0, '127.0.0.1', () => resolve({ port: server.address().port, close: () => server.close() }));
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
  async shot(file, clip) {
    const r = await this.send('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, ...(clip ? { clip } : {}),
    });
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

/**
 * The stub bridge.
 *
 * `onState` keeps the callback so the harness can push a payload at will, and
 * every other channel is a no-op that returns a resolved promise — the renderer
 * must not care that nothing is listening.
 */
const STUB = `
window.__stateCb = null;
window.__klinesCb = null;
const noop = () => Promise.resolve();
window.cpw = {
  getState: () => Promise.resolve(),
  saveTrade: noop, deleteTrade: noop, saveAlert: noop, deleteAlert: noop,
  toggleAlert: noop, testAlert: noop, saveFuture: noop, deleteFuture: noop,
  pinFutures: noop, patchSettings: noop, window: noop, blurGuard: noop,
  testBlur: noop, testGeometry: noop, testResize: noop,
  resizeStart: noop, resizeEnd: noop, openDataFolder: noop,
  // A LIST, not a single slot: app.js and futures-ui.js both subscribe, and
  // keeping only the last one meant the harness pushed state into the futures
  // panel while the portfolio list stayed empty.
  onState: (cb) => { (window.__stateCbs = window.__stateCbs || []).push(cb); },
  onPrices: () => {}, onHistory: () => {},
  onKlines: (cb) => { window.__klinesCb = cb; },
  onFeedStatus: () => {}, onCollapsed: () => {}, onAlertFired: () => {},
};
`;

const POSITIONS = [
  { symbol: 'BTCUSDT', base: 'BTC', qty: 0.0125, avgCost: 91000, mark: 96420.5, hasPrice: true, value: 1205.26, unrealized: 67.76, pnlPct: 5.96, allocation: 41.5 },
  { symbol: 'ETHUSDT', base: 'ETH', qty: 0.42, avgCost: 3500, mark: 3285.4, hasPrice: true, value: 1379.87, unrealized: -90.13, pnlPct: -6.13, allocation: 47.5 },
  { symbol: 'LDOUSDT', base: 'LDO', qty: 250, avgCost: 1.65, mark: 1.284, hasPrice: true, value: 321.0, unrealized: -91.5, pnlPct: -22.18, allocation: 11.0 },
];

const STATE = {
  positions: POSITIONS,
  totals: { value: 2906.13, cost: 3020.52, pnl: -114.39, pnlPct: -3.79 },
  warnings: [],
  prices: { BTCUSDT: 96420.5, ETHUSDT: 3285.4, LDOUSDT: 1.284 },
  badges: {},
  tones: null,
  history: [],
  klines: {
    interval: '1h',
    series: Object.fromEntries(Object.entries(SERIES).map(([s, v]) => [s, { candles: klineRows(v) }])),
  },
  feedStatus: 'live',
  collapsed: false,
  docked: true,
  dockMode: 'taskbar',
  stripRows: POSITIONS,
  settings: {
    display: { icons: true, spark: true, stripSpark: true, list: true, alloc: true },
    theme: 'dark',
    stripCoins: ['BTC', 'ETH', 'LDO'],
    stripWidth: 300,
  },
  futures: [],
  futuresPins: {},
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const site = await serve();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-row-'));
  const chrome = spawn(CHROME, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--window-size=420,760', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    const t = setTimeout(() => reject(new Error('chrome did not start')), 20000);
    chrome.stderr.on('data', (d) => {
      buf += d.toString();
      const m = /ws:\/\/[^\s]+/.exec(buf);
      if (m) { clearTimeout(t); resolve(m[0]); }
    });
  });

  /**
   * Talk to the PAGE target directly.
   *
   * The first version attached to the browser endpoint and routed every call
   * through a flattened `sessionId`; `Page.enable` then came back "wasn't
   * found", because the browser-level endpoint has no Page domain. Asking
   * /json/list for the page's own websocket avoids sessions entirely.
   */
  const port = /:([0-9]+)\//.exec(wsUrl)[1];
  let pageWs = null;
  for (let i = 0; i < 40 && !pageWs; i += 1) {
    const list = await getJson(`http://127.0.0.1:${port}/json/list`).catch(() => []);
    const t = list.find((x) => x.type === 'page');
    if (t) pageWs = t.webSocketDebuggerUrl;
    else await wait(250);
  }
  if (!pageWs) throw new Error('no page target');

  const browser = new CDP(pageWs);
  await browser.ready;

  await browser.send('Page.enable');
  await browser.send('Runtime.enable');
  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(String(e.message) + ' @ ' + (e.filename||'') + ':' + (e.lineno||0)));
      window.addEventListener('unhandledrejection', (e) => window.__errors.push('rejection: ' + String(e.reason)));
      ${STUB}`,
  });
  await browser.send('Page.navigate', { url: `http://127.0.0.1:${site.port}/` });
  await wait(1200);

  const errors = await browser.eval(`
    return {
      errs: (window.__errors || []).slice(0, 8),
      hasCpw: !!window.cpw,
      hasCandles: !!window.Candles,
      stateSubs: (window.__stateCbs || []).length,
      bodyLen: document.body.innerHTML.length,
      cvCoins: !!document.getElementById('cvCoins'),
      posList: !!document.getElementById('posList'),
    };
  `).catch((e) => ({ evalError: e.message }));

  // push the state
  const pushed = await browser.eval(`
    const cbs = window.__stateCbs || [];
    if (!cbs.length) throw new Error('renderer never subscribed to state');
    try {
      for (const cb of cbs) cb(${JSON.stringify(STATE)});
      return { ok: true };
    } catch (e) {
      return { ok: false, err: String(e && e.stack || e) };
    }
  `);
  console.log('PUSH', JSON.stringify(pushed, null, 2));
  await wait(400);

  const dbg = await browser.eval(`
    return {
      stripRows: (window.state && window.state.stripRows || []).length,
      positions: (window.state && window.state.positions || []).length,
      cvHtml: (document.getElementById('cvCoins').innerHTML || '').slice(0, 200),
      cvHidden: document.getElementById('cvCoins').hidden,
      posHtml: (document.getElementById('posList').innerHTML || '').slice(0, 200),
    };
  `).catch((e) => ({ evalError: e.message }));
  console.log('DBG', JSON.stringify(dbg, null, 2));

  const strip = await browser.eval(`
    const rows = [...document.querySelectorAll('#cvCoins .cv-coin')];
    return rows.map((r) => {
      const box = r.getBoundingClientRect();
      const kids = [...r.children].map((k) => {
        const b = k.getBoundingClientRect();
        return {
          cls: k.className.baseVal !== undefined ? k.className.baseVal : k.className,
          tag: k.tagName.toLowerCase(),
          text: (k.textContent || '').trim(),
          left: +b.left.toFixed(1), right: +b.right.toFixed(1),
          w: +b.width.toFixed(1), h: +b.height.toFixed(1),
        };
      });
      return { sym: r.dataset.symbol, left: +box.left.toFixed(1), right: +box.right.toFixed(1), w: +box.width.toFixed(1), kids };
    });
  `);

  /**
   * Clip to the widget's own box.
   *
   * The full-viewport shot came back as a flat dark rectangle: the widget is
   * laid out by main.js in the real app, and in this harness it sits below the
   * viewport with only its background inside it. Measuring the DOM was still
   * correct — the picture was not. Clipping to `getBoundingClientRect` of
   * `.widget` puts the camera where the widget actually is.
   */
  const panelClip = await browser.eval(`
    const r = document.querySelector('.widget').getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 2 };
  `);
  await browser.shot(path.join(OUT, 'panel.png'), panelClip);

  const panel = await browser.eval(`
    const rows = [...document.querySelectorAll('#posList .pos')];
    return rows.map((r) => {
      const top = r.querySelector('.pos-top');
      const kids = [...top.children].map((k) => {
        const b = k.getBoundingClientRect();
        return {
          cls: k.className.baseVal !== undefined ? k.className.baseVal : k.className,
          tag: k.tagName.toLowerCase(),
          text: (k.textContent || '').trim(),
          left: +b.left.toFixed(1), right: +b.right.toFixed(1), w: +b.width.toFixed(1),
        };
      });
      return { sym: r.dataset.symbol, kids };
    });
  `);

  // collapse to the strip and shoot that too
  /**
   * Collapse for real.
   *
   * Adding `.is-collapsed` alone is not enough: `#collapsedView` carries a
   * `hidden` attribute that app.js clears from `state.collapsed`, and
   * `.collapsed-view[hidden] { display: none }` beats the class rule. Without
   * clearing it the strip measured 0x0 — which is exactly how the blank
   * screenshot was produced.
   */
  await browser.eval(`
    document.querySelector('.widget').classList.add('is-collapsed');
    document.getElementById('collapsedView').hidden = false;
    return true;
  `);
  await wait(300);
  // Clip to the coin rows themselves. `.widget` in the collapsed state is the
  // summary strip, and the coin rows hang below its box — clipping to the
  // widget put the camera above them and produced a flat rectangle.
  const stripClip = await browser.eval(`
    const cv = document.getElementById('cvCoins');
    const w = document.querySelector('.widget');
    const a = cv.getBoundingClientRect();
    const b = w.getBoundingClientRect();
    const x = Math.min(a.x, b.x) - 6;
    const y = Math.min(a.y, b.y) - 6;
    return {
      x, y,
      width: Math.max(a.width, b.width) + 12,
      height: Math.max(a.bottom, b.bottom) - y + 6,
      scale: 2,
    };
  `);
  await browser.shot(path.join(OUT, 'strip.png'), stripClip);

  // The narrow end, where the ROI column is dropped. A picture is the only way
  // to see whether the price is left truncated by an ellipsis at 200px.
  for (const w of [200, 240]) {
    // eslint-disable-next-line no-await-in-loop
    const clip = await browser.eval(`
      document.querySelector('.widget').style.width = ${w} + 'px';
      const cv = document.getElementById('cvCoins');
      const a = cv.getBoundingClientRect();
      return { x: a.x - 6, y: a.y - 6, width: a.width + 12, height: a.height + 12, scale: 3 };
    `);
    // eslint-disable-next-line no-await-in-loop
    await browser.shot(path.join(OUT, `strip-${w}.png`), clip);
  }

  const box = await browser.eval(`
    const cv = document.getElementById('cvCoins');
    const w = document.querySelector('.widget');
    const r = cv.getBoundingClientRect();
    const rw = w.getBoundingClientRect();
    const cs = getComputedStyle(w);
    return {
      cv: { x: r.x, y: r.y, w: r.width, h: r.height, bottom: r.bottom },
      widget: { x: rw.x, y: rw.y, w: rw.width, h: rw.height, bottom: rw.bottom },
      docH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      taskbar: w.classList.contains('is-taskbar'),
      docked: w.classList.contains('is-docked'),
      collapsed: w.classList.contains('is-collapsed'),
      opacity: cs.opacity,
      visibility: cs.visibility,
      transform: cs.transform,
      overflowParent: (() => { let e = w.parentElement; while (e && e !== document.body) { const s = getComputedStyle(e); if (s.overflow !== 'visible') return e.className + '/' + s.overflow; e = e.parentElement; } return null; })(),
    };
  `).catch((e) => ({ err: e.message }));
  /**
   * Measure the row at every width the strip can take.
   *
   * One eval for all five widths, not five evals: the per-width version kept
   * failing inside the CDP round trip with an error that pointed at the Node
   * call site rather than the browser, and a single expression is both easier
   * to read and impossible to get out of sync with itself.
   *
   * The WIDGET is resized, not `#cvCoins`: the narrow-width rules are a
   * container query on `.widget.is-docked`, so setting the inner element's
   * width left the query at its original size and the rules never fired.
   */
  const fit = await browser.eval(`
    const widget = document.querySelector('.widget');
    const cv = document.getElementById('cvCoins');
    const out = [];
    for (const w of [200, 240, 300, 380, 476]) {
      widget.style.width = w + 'px';
      const row = cv.querySelector('.cv-coin');
      const rb = row.getBoundingClientRect();
      /**
       * Hidden children are dropped before measuring.
       *
       * display:none gives a rect of all zeros, so the narrow-width ROI
       * column landed at x=0 and "last.right - row.right" came back as -188 at
       * 200px — which reads as "fits easily" but was really "the element I
       * measured is invisible". Filtering by width makes the number mean what
       * it says.
       */
      const kids = [...row.children].map((k) => {
        const b = k.getBoundingClientRect();
        const cls = typeof k.className === 'string' ? k.className : k.className.baseVal;
        return { cls, l: +b.left.toFixed(1), r: +b.right.toFixed(1), w: +b.width.toFixed(1) };
      }).filter((k) => k.w > 0);
      const last = kids[kids.length - 1];
      const chart = kids.find((k) => k.cls.indexOf('cd-strip') >= 0);
      const name = kids.find((k) => k.cls.indexOf('cv-coin-sym') >= 0);
      const pnl = kids.find((k) => k.cls.indexOf('cv-coin-pnl') >= 0);
      out.push({
        width: w,
        rowW: +rb.width.toFixed(1),
        overflow: +(last.r - rb.right).toFixed(1),
        chartW: chart ? chart.w : 0,
        gapL: chart && name ? +(chart.l - name.r).toFixed(1) : null,
        gapR: chart && pnl ? +(pnl.l - chart.r).toFixed(1) : null,
        cols: kids.length,
      });
    }
    widget.style.width = '';
    return out;
  `);
  console.log('FIT', JSON.stringify(fit, null, 2));
  console.log('BOX', JSON.stringify(box, null, 2));
  console.log(JSON.stringify({ strip, panel, errors }, null, 2));

  browser.close();
  chrome.kill();
  site.close();
}

main().catch((e) => { console.error("FAILED:", e.stack); process.exit(1); });
