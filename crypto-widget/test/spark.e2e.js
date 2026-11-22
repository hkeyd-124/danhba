'use strict';
/**
 * End-to-end test for the coin sparklines.
 *
 * Runs the REAL Electron app under Xvfb and drives it through the DevTools
 * protocol, with a local stand-in for Binance that serves BOTH the ticker and
 * `/fapi/v1/klines`. What is asserted is what the user would see.
 *
 * The point of this file is the thing the unit tests cannot prove: that the
 * candle series actually reaches the DOM, in BOTH surfaces, in the right place
 * in the row, and that the two switches control them independently.
 *
 * Run:  xvfb-run -a node test/spark.e2e.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function check(name, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * A deterministic candle series per symbol.
 *
 * Rising for ETH, falling for LDO, flat for SOL — so the direction class can be
 * asserted against a known shape instead of "whatever the market did".
 */
const SERIES = {
  ETHUSDT: [3000, 3020, 3010, 3060, 3100, 3080, 3150, 3200],
  LDOUSDT: [2.4, 2.35, 2.3, 2.32, 2.2, 2.1, 2.05, 1.85],
  SOLUSDT: [150, 150, 150, 150, 150, 150, 150, 150],
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
          { symbol: 'ETHUSDT', price: '3200' },
          { symbol: 'LDOUSDT', price: '1.85' },
          { symbol: 'SOLUSDT', price: '150' },
        ]));
        return;
      }
      if (req.url.startsWith('/fapi/v1/klines')) {
        const m = /symbol=([A-Z0-9]+)/.exec(req.url);
        const sym = m ? m[1] : '';
        const values = SERIES[sym];
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
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
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
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.on('open', res);
      this.ws.on('error', rej);
    });
    this.ws.on('message', (buf) => {
      const msg = JSON.parse(buf.toString());
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 20000);
    });
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expr} })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    }
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

async function findTarget(port, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch (_) { /* not up yet */ }
    await wait(500);
  }
  throw new Error('DevTools target never appeared');
}

(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-spark-'));
  const cdpPort = 9341;

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
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

  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  child.stdout.on('data', () => {});

  let cdp;
  try {
    const target = await findTarget(cdpPort);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.eval(`
      window.__errs = window.__errs || [];
      window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));
      return true;
    `);
    await wait(1200);

    // ---------- 1. add three trades through the real form
    const addTrade = async (symbol, qty, price) => {
      await cdp.eval(`document.getElementById('btnAddTrade').click(); return true;`);
      await wait(200);
      await cdp.eval(`
        document.getElementById('tradeSymbol').value = ${JSON.stringify(symbol)};
        document.getElementById('tradeQty').value = ${JSON.stringify(String(qty))};
        document.getElementById('tradePrice').value = ${JSON.stringify(String(price))};
        document.getElementById('tradeForm').requestSubmit();
        return true;
      `);
      await wait(400);
    };
    await addTrade('ETHUSDT', 1, 3000);
    await addTrade('LDOUSDT', 1000, 2);
    await addTrade('SOLUSDT', 2, 140);

    // The candle fetch is async; give it room to land.
    await wait(2500);

    // ---------- 2. the panel rows carry a sparkline
    const panel = await cdp.eval(`
      const rows = [...document.querySelectorAll('#posList .pos')];
      return rows.map((r) => {
        const svg = r.querySelector('.spark-pos');
        const line = svg ? svg.querySelector('.spark-line') : null;
        const area = svg ? svg.querySelector('.spark-area') : null;
        return {
          sym: r.dataset.symbol,
          hasSvg: !!svg,
          cls: svg ? svg.getAttribute('class') : null,
          d: line ? line.getAttribute('d') : null,
          areaD: area ? area.getAttribute('d') : null,
          fill: area ? area.getAttribute('fill') : null,
          viewBox: svg ? svg.getAttribute('viewBox') : null,
          par: svg ? svg.getAttribute('preserveAspectRatio') : null,
        };
      });
    `);
    check('every panel row has a sparkline', panel.length === 3 && panel.every((p) => p.hasSvg),
      JSON.stringify(panel.map((p) => [p.sym, p.hasSvg])));
    check('the sparkline draws a real path', panel.every((p) => p.d && p.d.startsWith('M') && p.d.includes('L')),
      JSON.stringify(panel.map((p) => p.d)));
    check('the path contains no NaN', panel.every((p) => p.d && !/NaN/.test(p.d)),
      JSON.stringify(panel.map((p) => p.d)));
    check('the sparkline has a filled area', panel.every((p) => p.areaD && p.areaD.endsWith('Z')),
      JSON.stringify(panel.map((p) => p.areaD)));
    check('the viewBox is fixed and stretched', panel.every((p) => p.viewBox === '0 0 100 30' && p.par === 'none'),
      JSON.stringify(panel.map((p) => [p.viewBox, p.par])));

    // ---------- 3. direction follows the mocked series
    const dirOf = (sym) => {
      const p = panel.find((x) => x.sym === sym);
      return p ? p.cls : null;
    };
    check('a rising series is marked up', /is-up/.test(dirOf('ETHUSDT') || ''), dirOf('ETHUSDT'));
    check('a falling series is marked down', /is-down/.test(dirOf('LDOUSDT') || ''), dirOf('LDOUSDT'));
    check('a flat series is marked flat', /is-flat/.test(dirOf('SOLUSDT') || ''), dirOf('SOLUSDT'));
    check('the up series fills with the up gradient',
      panel.find((p) => p.sym === 'ETHUSDT').fill === 'url(#sparkUp)',
      panel.find((p) => p.sym === 'ETHUSDT').fill);
    check('the down series fills with the down gradient',
      panel.find((p) => p.sym === 'LDOUSDT').fill === 'url(#sparkDown)',
      panel.find((p) => p.sym === 'LDOUSDT').fill);

    // ---------- 4. the sparkline sits BETWEEN the name and the price
    const order = await cdp.eval(`
      const row = document.querySelector('#posList .pos');
      const top = row.querySelector('.pos-top');
      const kids = [...top.children];
      const iName = kids.findIndex((k) => k.classList.contains('coin') || k.classList.contains('pos-sym'));
      const iSpark = kids.findIndex((k) => k.classList.contains('spark-pos'));
      const iQty = kids.findIndex((k) => k.classList.contains('pos-qty'));
      const r = (el) => el.getBoundingClientRect();
      return {
        iName, iSpark, iQty,
        nameRight: r(kids[iName]).right,
        sparkLeft: r(kids[iSpark]).left,
        sparkRight: r(kids[iSpark]).right,
        qtyLeft: r(kids[iQty]).left,
        sparkW: r(kids[iSpark]).width,
        sparkH: r(kids[iSpark]).height,
      };
    `);
    check('the sparkline comes after the name', order.iSpark > order.iName, JSON.stringify(order));
    check('the sparkline comes before the quantity/price', order.iSpark < order.iQty, JSON.stringify(order));
    check('it does not overlap the name', order.sparkLeft >= order.nameRight - 1,
      `name.right=${order.nameRight} spark.left=${order.sparkLeft}`);
    check('it does not overlap the price', order.sparkRight <= order.qtyLeft + 1,
      `spark.right=${order.sparkRight} qty.left=${order.qtyLeft}`);
    check('it has a real width', order.sparkW > 10, `w=${order.sparkW}`);
    check('it is 16px tall in the panel', Math.abs(order.sparkH - 16) < 1.5, `h=${order.sparkH}`);

    // ---------- 5. the strip rows carry a sparkline too
    /**
     * Tick the coins while the panel is still open (the settings sheet lives
     * there), THEN collapse.
     *
     * `#collapsedView` is `hidden` while the panel is open, so every box in it
     * measures 0x0 — which is exactly what the first run of this test reported
     * (`[0,0]`). The rows were in the DOM and correct; the surface was not on
     * screen. Collapsing before measuring is what makes the numbers mean
     * something.
     */
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(300);
    await cdp.eval(`
      const box = document.getElementById('stripCoins');
      for (const sym of ['LDO', 'ETH']) {
        const i = box.querySelector('input[data-strip-coin="' + sym + '"]');
        i.checked = true;
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    `);
    await wait(800);
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(900);

    const strip = await cdp.eval(`
      const rows = [...document.querySelectorAll('#cvCoins .cv-coin')];
      return rows.map((r) => {
        const svg = r.querySelector('.spark-strip');
        const line = svg ? svg.querySelector('.spark-line') : null;
        const kids = [...r.children];
        const iSym = kids.findIndex((k) => k.classList.contains('cv-coin-sym'));
        const iSpark = kids.findIndex((k) => k.classList.contains('spark-strip'));
        const iPrice = kids.findIndex((k) => k.classList.contains('cv-coin-price'));
        const b = (el) => el.getBoundingClientRect();
        return {
          sym: r.dataset.symbol,
          hasSvg: !!svg,
          d: line ? line.getAttribute('d') : null,
          cls: svg ? svg.getAttribute('class') : null,
          iSym, iSpark, iPrice,
          symRight: iSym >= 0 ? b(kids[iSym]).right : null,
          sparkLeft: iSpark >= 0 ? b(kids[iSpark]).left : null,
          sparkRight: iSpark >= 0 ? b(kids[iSpark]).right : null,
          priceLeft: iPrice >= 0 ? b(kids[iPrice]).left : null,
          h: iSpark >= 0 ? b(kids[iSpark]).height : null,
          w: iSpark >= 0 ? b(kids[iSpark]).width : null,
        };
      });
    `);
    check('every strip row has a sparkline', strip.length === 2 && strip.every((s) => s.hasSvg),
      JSON.stringify(strip.map((s) => [s.sym, s.hasSvg])));
    check('the strip sparkline draws a real path', strip.every((s) => s.d && s.d.startsWith('M')),
      JSON.stringify(strip.map((s) => s.d)));
    check('the strip path contains no NaN', strip.every((s) => s.d && !/NaN/.test(s.d)),
      JSON.stringify(strip.map((s) => s.d)));
    check('in the strip it sits between the ticker and the price',
      strip.every((s) => s.iSpark > s.iSym && s.iSpark < s.iPrice),
      JSON.stringify(strip.map((s) => [s.iSym, s.iSpark, s.iPrice])));
    check('in the strip it does not overlap the ticker',
      strip.every((s) => s.sparkLeft >= s.symRight - 1),
      JSON.stringify(strip.map((s) => [s.symRight, s.sparkLeft])));
    check('in the strip it does not overlap the price',
      strip.every((s) => s.sparkRight <= s.priceLeft + 1),
      JSON.stringify(strip.map((s) => [s.sparkRight, s.priceLeft])));
    check('the strip sparkline is 11px tall', strip.every((s) => Math.abs(s.h - 11) < 1.5),
      JSON.stringify(strip.map((s) => s.h)));
    check('the strip sparkline has a usable width', strip.every((s) => s.w > 8),
      JSON.stringify(strip.map((s) => s.w)));

    // ---------- 6. the two switches are independent
    /**
     * The switches live in the settings sheet, which is inside the panel — so
     * the panel has to be open again. The strip rows stay in the DOM while it
     * is open (they are only `hidden`), so counting them still works.
     */
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(900);
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(300);
    await cdp.eval(`
      const i = document.querySelector('input[data-display="stripSpark"]');
      i.checked = false;
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await wait(600);
    const stripOff = await cdp.eval(`
      return {
        strip: document.querySelectorAll('#cvCoins .spark-strip').length,
        panel: document.querySelectorAll('#posList .spark-pos').length,
      };
    `);
    check('turning the strip sparkline off removes it from the strip', stripOff.strip === 0, `got ${stripOff.strip}`);
    check('and leaves the panel sparkline alone', stripOff.panel === 3, `got ${stripOff.panel}`);

    await cdp.eval(`
      const i = document.querySelector('input[data-display="spark"]');
      i.checked = false;
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await wait(600);
    const bothOff = await cdp.eval(`
      return {
        strip: document.querySelectorAll('#cvCoins .spark-strip').length,
        panel: document.querySelectorAll('#posList .spark-pos').length,
      };
    `);
    check('turning the panel sparkline off removes it from the panel', bothOff.panel === 0, `got ${bothOff.panel}`);

    // ---------- 7. both come back, and the choice survives a reload
    await cdp.eval(`
      for (const key of ['spark', 'stripSpark']) {
        const i = document.querySelector('input[data-display="' + key + '"]');
        i.checked = true;
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    `);
    await wait(600);
    const back = await cdp.eval(`
      return {
        strip: document.querySelectorAll('#cvCoins .spark-strip').length,
        panel: document.querySelectorAll('#posList .spark-pos').length,
      };
    `);
    check('both sparklines come back on', back.strip === 2 && back.panel === 3,
      JSON.stringify(back));

    await cdp.send('Page.reload');
    await wait(3500);
    const afterReload = await cdp.eval(`
      return {
        strip: document.querySelectorAll('#cvCoins .spark-strip').length,
        panel: document.querySelectorAll('#posList .spark-pos').length,
        stripPath: (document.querySelector('#cvCoins .spark-line') || {}).getAttribute
          ? document.querySelector('#cvCoins .spark-line').getAttribute('d') : null,
      };
    `);
    check('the sparklines are back after a reload', afterReload.strip === 2 && afterReload.panel === 3,
      JSON.stringify(afterReload));
    check('and they are drawn from candles, not from an empty series',
      !!afterReload.stripPath && afterReload.stripPath.startsWith('M'),
      String(afterReload.stripPath));

    // ---------- 8. no renderer errors
    const errs = await cdp.eval(`return window.__errs || [];`);
    check('no renderer errors', errs.length === 0, JSON.stringify(errs));
  } catch (e) {
    failures++;
    console.log(`FAIL  harness: ${e.message}`);
    if (stderr) console.log(stderr.slice(-2000));
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
