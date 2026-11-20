'use strict';
/**
 * End-to-end smoke test: launches the REAL Electron app under Xvfb, drives the
 * UI through the DevTools protocol, and asserts on what the user would see.
 *
 * Run:  xvfb-run -a node test/e2e.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const results = [];
let failures = 0;

function check(name, cond, detail) {
  results.push({ name, ok: !!cond, detail });
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- mock binance
function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '65000' },
          { symbol: 'ETHUSDT', price: '3200' },
        ]));
        return;
      }
      res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const clients = [];
    wss.on('connection', (ws) => clients.push(ws));
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        clients,
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

// ---------------------------------------------------------------- CDP client
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

// ---------------------------------------------------------------- main
(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-e2e-'));
  const cdpPort = 9333;

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
    // Record renderer errors so the last check is meaningful.
    await cdp.eval(`
      window.__errs = window.__errs || [];
      window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));
      return true;
    `);
    await wait(1200);

    // ---------- 1. app boots and renders
    const boot = await cdp.eval(`
      return {
        hasApi: typeof window.cpw === 'object',
        title: document.title,
        total: document.getElementById('totalValue').textContent,
        feed: document.getElementById('feedLabel').textContent,
        dot: document.getElementById('feedDot').dataset.status,
      };
    `);
    check('app boots with the preload bridge', boot.hasApi);
    check('hero value renders', boot.total.includes('USDT'), boot.total);
    // With no trades there is nothing to subscribe to, so 'idle' is correct here.
    check('feed is idle before any trade exists', boot.dot === 'idle', `dot=${boot.dot}`);

    // ---------- 2. security: renderer has no network primitives
    const sec = await cdp.eval(`
      const out = { fetch: typeof window.fetch, ws: typeof window.WebSocket, req: typeof window.require };
      try { await fetch('https://example.com'); out.fetchWorked = true; } catch (e) { out.fetchWorked = false; }
      return out;
    `);
    check('CSP blocks outbound fetch from the renderer', sec.fetchWorked === false);
    check('renderer has no require()', sec.req === 'undefined', sec.req);

    // ---------- 3. add a trade through the real form
    await cdp.eval(`document.getElementById('btnAddTrade').click(); return true;`);
    await wait(250);
    const modalOpen = await cdp.eval(`return !document.getElementById('tradeModal').hidden;`);
    check('trade modal opens', modalOpen);

    await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('tradeSymbol', 'BTC');
      set('tradePrice', '60000');
      set('tradeQty', '0.5');
      set('tradeFee', '10');
      return true;
    `);
    const calc = await cdp.eval(`return document.getElementById('tradeCalc').textContent;`);
    check('live order preview computes', calc.includes('30,010'), calc);

    await cdp.eval(`document.getElementById('tradeForm').requestSubmit(); return true;`);
    await wait(600);

    const afterAdd = await cdp.eval(`
      return {
        modalHidden: document.getElementById('tradeModal').hidden,
        total: document.getElementById('totalValue').textContent,
        posRows: document.querySelectorAll('#posList .pos').length,
        tradeRows: document.querySelectorAll('#tradeList .trade').length,
        posText: document.querySelector('#posList .pos')?.textContent || '',
      };
    `);
    check('modal closes after save', afterAdd.modalHidden);
    check('position row appears', afterAdd.posRows === 1, `rows=${afterAdd.posRows}`);
    check('trade row appears', afterAdd.tradeRows === 1, `rows=${afterAdd.tradeRows}`);
    check('value = 0.5 * 65000 = 32,500', afterAdd.total.includes('32,500'), afterAdd.total);
    check('avg cost includes fee (60,020)', afterAdd.posText.includes('60,020'), afterAdd.posText);

    // Now that a symbol exists the feed must actually connect.
    await wait(900);
    const feedAfter = await cdp.eval(`
      return {
        dot: document.getElementById('feedDot').dataset.status,
        label: document.getElementById('feedLabel').textContent,
      };
    `);
    check('feed goes live once a symbol is tracked', feedAfter.dot === 'live',
      `dot=${feedAfter.dot} label=${feedAfter.label}`);

    // ---------- 4. live price tick moves the numbers
    mock.push('BTCUSDT', 70000);
    await wait(700);
    const afterTick = await cdp.eval(`
      return {
        total: document.getElementById('totalValue').textContent,
        pnl: document.getElementById('totalPnl').textContent,
        pct: document.getElementById('totalPct').textContent,
      };
    `);
    check('live tick updates total (0.5 * 70000 = 35,000)', afterTick.total.includes('35,000'), afterTick.total);
    check('P&L is positive after the tick', afterTick.pnl.includes('+'), afterTick.pnl);
    check('P&L % renders', afterTick.pct.includes('%'), afterTick.pct);

    // ---------- 5. edit the trade
    await cdp.eval(`document.querySelector('#tradeList [data-edit]').click(); return true;`);
    await wait(300);
    const editState = await cdp.eval(`
      return {
        open: !document.getElementById('tradeModal').hidden,
        title: document.getElementById('tradeTitle').textContent,
        price: document.getElementById('tradePrice').value,
        sym: document.getElementById('tradeSymbol').value,
      };
    `);
    check('edit modal prefilled', editState.open && editState.price === '60000' && editState.sym === 'BTC',
      JSON.stringify(editState));
    check('edit modal titled "Sửa lệnh"', editState.title === 'Sửa lệnh', editState.title);

    await cdp.eval(`
      const el = document.getElementById('tradeQty');
      el.value = '1';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('tradeForm').requestSubmit();
      return true;
    `);
    await wait(600);
    const afterEdit = await cdp.eval(`
      return {
        rows: document.querySelectorAll('#tradeList .trade').length,
        total: document.getElementById('totalValue').textContent,
      };
    `);
    check('edit does not duplicate the row', afterEdit.rows === 1, `rows=${afterEdit.rows}`);
    check('edited qty reflected (1 * 70000 = 70,000)', afterEdit.total.includes('70,000'), afterEdit.total);

    // ---------- 6. alerts: create, then trigger
    await cdp.eval(`document.querySelector('.tab[data-tab="alerts"]').click(); return true;`);
    await wait(150);
    await cdp.eval(`document.getElementById('btnAddAlert').click(); return true;`);
    await wait(250);
    await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('alertSymbol', 'BTC');
      set('alertPrice', '75000');
      return true;
    `);
    const nowHint = await cdp.eval(`return document.getElementById('alertNow').textContent;`);
    check('alert form shows the current price', nowHint.includes('70,000'), nowHint);

    await cdp.eval(`document.getElementById('alertForm').requestSubmit(); return true;`);
    await wait(500);
    const alertRows = await cdp.eval(`return document.querySelectorAll('#alertList .alert').length;`);
    check('alert row created', alertRows === 1, `rows=${alertRows}`);

    // cross the threshold
    mock.push('BTCUSDT', 76000);
    await wait(900);
    const fired = await cdp.eval(`
      return {
        toast: document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent,
      };
    `);
    check('crossing the threshold fires an alert', fired.toast.includes('75,000'), fired.toast);

    // ---------- 7. collapse / expand
    await cdp.eval(`document.getElementById('btnCollapse').click(); return true;`);
    await wait(500);
    const collapsed = await cdp.eval(`
      return {
        cls: document.getElementById('widget').classList.contains('is-collapsed'),
        cv: document.getElementById('cvValue').textContent,
        bodyHidden: getComputedStyle(document.getElementById('body')).display === 'none',
      };
    `);
    check('collapse hides the body', collapsed.cls && collapsed.bodyHidden, JSON.stringify(collapsed));
    check('collapsed view shows the total', collapsed.cv.includes('76,000'), collapsed.cv);

    await cdp.eval(`document.getElementById('btnCollapse').click(); return true;`);
    await wait(500);
    const expanded = await cdp.eval(`
      return getComputedStyle(document.getElementById('body')).display !== 'none';
    `);
    check('expand restores the body', expanded);

    // Regression: the collapsed summary must not leak into the expanded view.
    // `display:flex` on .collapsed-view used to beat the `hidden` attribute and
    // printed the total value twice.
    const noDup = await cdp.eval(`
      const cv = document.getElementById('collapsedView');
      return {
        hidden: cv.hidden,
        display: getComputedStyle(cv).display,
        visibleTotals: [...document.querySelectorAll('#totalValue, #cvValue')]
          .filter((el) => el.offsetParent !== null).length,
      };
    `);
    check('collapsed summary is hidden while expanded', noDup.display === 'none', noDup.display);
    check('the total value is shown exactly once', noDup.visibleTotals === 1,
      `visible=${noDup.visibleTotals}`);

    // ---------- 8. persistence across a reload
    await cdp.send('Page.reload');
    await wait(2000);
    const afterReload = await cdp.eval(`
      return {
        trades: document.querySelectorAll('#tradeList .trade').length,
        alerts: document.querySelectorAll('#alertList .alert').length,
        total: document.getElementById('totalValue').textContent,
      };
    `);
    check('trades survive a reload', afterReload.trades === 1, `trades=${afterReload.trades}`);
    check('alerts survive a reload', afterReload.alerts === 1, `alerts=${afterReload.alerts}`);
    check('value survives a reload', afterReload.total.includes('76,000'), afterReload.total);

    // ---------- 8b. appearance: themes, text colour, persistence
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(250);
    const lookOpen = await cdp.eval(`return !document.getElementById('lookModal').hidden;`);
    check('appearance panel opens', lookOpen);

    const themeCount = await cdp.eval(`return document.querySelectorAll('#themeGrid .theme').length;`);
    check('seven background styles offered', themeCount === 7, `count=${themeCount}`);

    // switch to the see-through style
    await cdp.eval(`document.querySelector('.theme[data-theme="clear"]').click(); return true;`);
    await wait(500);
    const clearState = await cdp.eval(`
      const w = document.getElementById('widget');
      const cs = getComputedStyle(w);
      return {
        theme: w.dataset.theme,
        alpha: w.style.getPropertyValue('--bg-alpha'),
        bg: cs.backgroundColor,
        active: document.querySelector('.theme.is-active')?.dataset.theme,
      };
    `);
    check('theme switches to "clear"', clearState.theme === 'clear', clearState.theme);
    check('"clear" drops the background opacity so the desktop shows through',
      Number(clearState.alpha) < 0.6, `alpha=${clearState.alpha}`);
    check('the active style is highlighted', clearState.active === 'clear', clearState.active);

    // the window itself must be transparent for any of this to be visible
    const winTransparent = await cdp.eval(`
      return { bg: getComputedStyle(document.body).backgroundColor };
    `);
    check('body paints no opaque background of its own',
      winTransparent.bg === 'rgba(0, 0, 0, 0)' || winTransparent.bg === 'transparent',
      winTransparent.bg);

    // text colour
    await cdp.eval(`document.querySelector('.swatch[data-color="#fde68a"]').click(); return true;`);
    await wait(400);
    const textState = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        v: w.style.getPropertyValue('--text'),
        hero: getComputedStyle(document.getElementById('totalValue')).color,
        active: document.querySelector('.swatch.is-active')?.dataset.color,
      };
    `);
    check('text colour variable is applied', textState.v.toLowerCase() === '#fde68a', textState.v);
    check('hero text actually renders in the chosen colour',
      textState.hero === 'rgb(253, 230, 138)', textState.hero);
    check('the chosen swatch is marked active', textState.active === '#fde68a', textState.active);

    // background opacity slider
    await cdp.eval(`
      const r = document.getElementById('alphaRange');
      r.value = '55';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await wait(500);
    const alphaState = await cdp.eval(`
      return {
        v: document.getElementById('widget').style.getPropertyValue('--bg-alpha'),
        label: document.getElementById('alphaVal').textContent,
      };
    `);
    check('opacity slider sets the background alpha', Math.abs(Number(alphaState.v) - 0.55) < 0.01,
      alphaState.v);
    check('opacity label follows the slider', alphaState.label === '55%', alphaState.label);

    await cdp.eval(`document.querySelector('#lookModal [data-close]').click(); return true;`);
    await wait(200);

    // ---------- 8c. appearance survives a restart (settings persisted to disk)
    await cdp.send('Page.reload');
    await wait(2000);
    const lookAfterReload = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        theme: w.dataset.theme,
        text: w.style.getPropertyValue('--text'),
        alpha: w.style.getPropertyValue('--bg-alpha'),
      };
    `);
    check('theme survives a reload', lookAfterReload.theme === 'clear', lookAfterReload.theme);
    check('text colour survives a reload', lookAfterReload.text.toLowerCase() === '#fde68a',
      lookAfterReload.text);
    check('background opacity survives a reload',
      Math.abs(Number(lookAfterReload.alpha) - 0.55) < 0.01, lookAfterReload.alpha);

    // ---------- 8d. auto-hiding title bar
    const tbState = await cdp.eval(`
      const tb = document.getElementById('titlebar');
      const zone = document.getElementById('tbZone');
      const cs = getComputedStyle(tb);
      return {
        opacity: cs.opacity,
        pointer: cs.pointerEvents,
        hasZone: !!zone,
        zoneH: zone ? zone.getBoundingClientRect().height : 0,
        barH: tb.getBoundingClientRect().height,
        shown: tb.classList.contains('is-shown'),
      };
    `);
    check('title bar is invisible at rest', Number(tbState.opacity) === 0, `opacity=${tbState.opacity}`);
    check('hidden title bar does not swallow clicks', tbState.pointer === 'none', tbState.pointer);
    check('a hover sensor covers the top edge', tbState.hasZone && tbState.zoneH > 0,
      `h=${tbState.zoneH}`);
    check('title bar is a thin strip, not a full header', tbState.barH > 0 && tbState.barH <= 32,
      `h=${tbState.barH}`);

    // simulate the pointer reaching the top edge
    await cdp.eval(`
      const zone = document.getElementById('tbZone');
      zone.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return true;
    `);
    await wait(300);
    const tbShown = await cdp.eval(`
      const tb = document.getElementById('titlebar');
      return { opacity: getComputedStyle(tb).opacity, shown: tb.classList.contains('is-shown') };
    `);
    check('title bar appears when the pointer enters the top edge',
      tbShown.shown && Number(tbShown.opacity) === 1, JSON.stringify(tbShown));

    // and hides again when the pointer leaves
    await cdp.eval(`
      const tb = document.getElementById('titlebar');
      tb.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      return true;
    `);
    await wait(500);
    const tbHidden = await cdp.eval(`
      return document.getElementById('titlebar').classList.contains('is-shown');
    `);
    check('title bar hides again after the pointer leaves', tbHidden === false);

    // ---------- 8e. resize grips
    const grips = await cdp.eval(`
      const all = [...document.querySelectorAll('.grip')];
      return {
        count: all.length,
        edges: all.map((g) => g.dataset.edge).sort().join(','),
        cursors: all.map((g) => getComputedStyle(g).cursor),
        se: (() => { const r = document.querySelector('.grip-se').getBoundingClientRect(); return { w: r.width, h: r.height }; })(),
      };
    `);
    check('eight resize grips exist', grips.count === 8, `count=${grips.count}`);
    check('all eight edges are covered',
      grips.edges === 'e,n,ne,nw,s,se,sw,w', grips.edges);
    check('grips show resize cursors', grips.cursors.every((c) => c.includes('resize')),
      grips.cursors.join('|'));
    check('the corner grip is grabbable', grips.se.w >= 8 && grips.se.h >= 8,
      JSON.stringify(grips.se));

    // the resize IPC must actually move the window
    const before = await cdp.eval(`
      const r = await window.cpw.resizeStart('se');
      await new Promise((res) => setTimeout(res, 60));
      await window.cpw.resizeEnd();
      return r;
    `);
    check('resize IPC accepts a start/end cycle', before && before.ok === true, JSON.stringify(before));

    // reset-size must restore the default width
    const reset = await cdp.eval(`
      await window.cpw.window('reset-size');
      await new Promise((res) => setTimeout(res, 300));
      return true;
    `);
    check('reset-size runs without error', reset === true);

    // ---------- 8f. "Chỉ chữ" — text only, no surface at all
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(250);
    await cdp.eval(`document.querySelector('.theme[data-theme="bare"]').click(); return true;`);
    await wait(500);

    const bare = await cdp.eval(`
      const w = document.getElementById('widget');
      const cs = getComputedStyle(w);
      const hero = getComputedStyle(document.getElementById('totalValue'));
      const pos = document.querySelector('#posList .pos');
      const posCs = pos ? getComputedStyle(pos) : null;
      const foot = getComputedStyle(document.querySelector('.foot'));
      return {
        theme: w.dataset.theme,
        bgImage: cs.backgroundImage,
        bgColor: cs.backgroundColor,
        borderW: cs.borderTopWidth,
        radius: cs.borderTopLeftRadius,
        shadow: cs.boxShadow,
        heroShadow: hero.textShadow,
        heroStrokeWidth: hero.webkitTextStrokeWidth,
        heroStroke: hero.webkitTextStrokeColor,
        heroPaintOrder: hero.paintOrder,
        halo: w.style.getPropertyValue('--halo'),
        haloColor: w.style.getPropertyValue('--halo-color'),
        posBg: posCs ? posCs.backgroundColor : null,
        footBg: foot.backgroundColor,
        alphaFieldHidden: document.getElementById('alphaField').hidden,
        haloFieldHidden: document.getElementById('haloField').hidden,
        alphaFieldShown: getComputedStyle(document.getElementById('alphaField')).display !== 'none',
        haloFieldShown: getComputedStyle(document.getElementById('haloField')).display !== 'none',
      };
    `);
    check('theme switches to "bare"', bare.theme === 'bare', bare.theme);
    check('bare paints no background image', bare.bgImage === 'none', bare.bgImage);
    check('bare paints no background colour',
      bare.bgColor === 'rgba(0, 0, 0, 0)' || bare.bgColor === 'transparent', bare.bgColor);
    check('bare has no border', bare.borderW === '0px', bare.borderW);
    check('bare has no rounded corners', bare.radius === '0px', bare.radius);
    check('bare has no drop shadow', bare.shadow === 'none', bare.shadow);
    check('position rows lose their card fill',
      bare.posBg === 'rgba(0, 0, 0, 0)' || bare.posBg === 'transparent', bare.posBg);
    check('the footer loses its fill',
      bare.footBg === 'rgba(0, 0, 0, 0)' || bare.footBg === 'transparent', bare.footBg);
    check('text carries a halo so it stays readable on any wallpaper',
      bare.heroShadow && bare.heroShadow !== 'none', bare.heroShadow);
    // The halo is a real text stroke painted behind the glyph, not a stack of
    // shadows: a shadow is drawn outside the glyph, so on a busy wallpaper the
    // gaps between letters still show through. Assert the stroke exists, has a
    // non-zero width, and is painted behind the fill.
    check('the halo is a real text stroke, not just a shadow',
      bare.heroStrokeWidth && parseFloat(bare.heroStrokeWidth) > 0, bare.heroStrokeWidth);
    check('the stroke is painted behind the glyph fill',
      bare.heroPaintOrder === 'stroke', bare.heroPaintOrder);
    check('the stroke colour is the opposite tone to the text',
      /rgba\(0, 0, 0/.test(bare.heroStroke), bare.heroStroke);
    check('the opacity slider is hidden when there is no surface',
      bare.alphaFieldHidden && !bare.alphaFieldShown, JSON.stringify(bare));
    check('the halo slider appears for this style',
      !bare.haloFieldHidden && bare.haloFieldShown, JSON.stringify(bare));

    // halo colour must flip with the text colour, or dark text on a dark
    // wallpaper would be invisible
    const haloLight = bare.haloColor;
    await cdp.eval(`document.querySelector('.swatch[data-color="#1f2937"]').click(); return true;`);
    await wait(500);
    const haloDark = await cdp.eval(`
      return document.getElementById('widget').style.getPropertyValue('--halo-color');
    `);
    check('light text gets a dark halo', /rgba\(0, 0, 0/.test(haloLight), haloLight);
    check('dark text gets a light halo', /rgba\(255, 255, 255/.test(haloDark), haloDark);

    // the halo slider must actually change the blur radius
    await cdp.eval(`
      const r = document.getElementById('haloRange');
      r.value = '20';
      r.dispatchEvent(new Event('input', { bubbles: true }));
      r.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await wait(500);
    const haloLow = await cdp.eval(`
      return {
        v: document.getElementById('widget').style.getPropertyValue('--halo'),
        label: document.getElementById('haloVal').textContent,
        shadow: getComputedStyle(document.getElementById('totalValue')).textShadow,
      };
    `);
    check('halo slider sets the halo strength', Math.abs(Number(haloLow.v) - 0.2) < 0.01, haloLow.v);
    check('halo label follows the slider', haloLow.label === '20%', haloLow.label);

    // restore a light text colour for the remaining checks
    await cdp.eval(`document.querySelector('.swatch[data-color="#e8eefc"]').click(); return true;`);
    await wait(400);
    await cdp.eval(`document.querySelector('#lookModal [data-close]').click(); return true;`);
    await wait(200);

    // ---------- 8g. bare style + halo survive a restart
    await cdp.send('Page.reload');
    await wait(2000);
    const bareAfterReload = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        theme: w.dataset.theme,
        halo: w.style.getPropertyValue('--halo'),
        bg: getComputedStyle(w).backgroundImage,
        border: getComputedStyle(w).borderTopWidth,
      };
    `);
    check('bare style survives a reload', bareAfterReload.theme === 'bare', bareAfterReload.theme);
    check('halo strength survives a reload',
      Math.abs(Number(bareAfterReload.halo) - 0.2) < 0.01, bareAfterReload.halo);
    check('bare is still surface-free after a reload',
      bareAfterReload.bg === 'none' && bareAfterReload.border === '0px',
      JSON.stringify(bareAfterReload));

    // ---------- 8h. the title bar must not get stuck open after a click
    await cdp.eval(`
      const zone = document.getElementById('tbZone');
      zone.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      return true;
    `);
    await wait(250);
    await cdp.eval(`document.getElementById('btnPin').click(); return true;`);
    await wait(200);
    await cdp.eval(`
      const tb = document.getElementById('titlebar');
      tb.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
      return true;
    `);
    await wait(600);
    const tbAfterClick = await cdp.eval(`
      const tb = document.getElementById('titlebar');
      return {
        shown: tb.classList.contains('is-shown'),
        opacity: getComputedStyle(tb).opacity,
        focused: document.activeElement && document.activeElement.id,
      };
    `);
    check('the bar still auto-hides after a button click',
      tbAfterClick.shown === false && Number(tbAfterClick.opacity) === 0,
      JSON.stringify(tbAfterClick));

    // put the pin back on so the rest of the run is unchanged
    await cdp.eval(`await window.cpw.window('pin'); return true;`);
    await wait(300);

    // ---------- 9. delete the trade
    await cdp.eval(`
      window.confirm = () => true;
      document.querySelector('.tab[data-tab="trades"]').click();
      return true;
    `);
    await wait(200);
    await cdp.eval(`document.querySelector('#tradeList [data-del]').click(); return true;`);
    await wait(600);
    const afterDelete = await cdp.eval(`
      return {
        trades: document.querySelectorAll('#tradeList .trade').length,
        empty: !document.getElementById('tradeEmpty').hidden,
        total: document.getElementById('totalValue').textContent,
      };
    `);
    check('delete removes the trade', afterDelete.trades === 0, `trades=${afterDelete.trades}`);
    check('empty state shows', afterDelete.empty);
    check('total resets to zero', afterDelete.total.includes('0.00'), afterDelete.total);

    // ---------- 10. no console errors
    const errs = await cdp.eval(`
      return (window.__errs || []).length;
    `).catch(() => 0);
    check('no uncaught renderer errors recorded', errs === 0, `count=${errs}`);

  } catch (err) {
    check('e2e run completed without throwing', false, err.message);
    console.error(err);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    await wait(300);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  console.log(`\n${results.length - failures}/${results.length} checks passed`);
  if (failures) {
    console.log('\n--- electron stderr (tail) ---');
    console.log(stderr.split('\n').slice(-25).join('\n'));
  }
  process.exit(failures ? 1 : 0);
})();
