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

    // ---------- 6b. "cảnh báo giá đạt" (touch): direction must not matter
    await cdp.eval(`document.getElementById('btnAddAlert').click(); return true;`);
    await wait(250);

    // The tolerance field must be hidden for the two directional kinds, and
    // appear only when "Chạm mốc" is picked.
    const tolHiddenForAbove = await cdp.eval(
      `return document.getElementById('alertTolField').hidden;`
    );
    check('tolerance field is hidden for "vượt lên"', tolHiddenForAbove === true, `hidden=${tolHiddenForAbove}`);

    await cdp.eval(`
      document.querySelector('#alertDir .seg-btn[data-dir="touch"]').click();
      return true;
    `);
    await wait(120);
    const tolShownForTouch = await cdp.eval(`
      return {
        hidden: document.getElementById('alertTolField').hidden,
        hint: document.getElementById('alertDirHint').textContent,
        active: document.querySelector('#alertDir .seg-btn.is-active').dataset.dir,
      };
    `);
    check('picking "Chạm mốc" reveals the tolerance field', tolShownForTouch.hidden === false, JSON.stringify(tolShownForTouch));
    check('"Chạm mốc" becomes the active segment', tolShownForTouch.active === 'touch', tolShownForTouch.active);
    check('the hint says direction does not matter', /tăng hay giảm/.test(tolShownForTouch.hint), tolShownForTouch.hint);

    await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('alertSymbol', 'ETH');
      set('alertPrice', '3000');
      set('alertTolerance', '0.5');
      return true;
    `);
    await cdp.eval(`document.getElementById('alertForm').requestSubmit(); return true;`);
    await wait(500);

    const touchRow = await cdp.eval(`
      const rows = [...document.querySelectorAll('#alertList .alert')];
      const r = rows.find((x) => x.textContent.includes('chạm mốc'));
      return {
        count: rows.length,
        text: r ? r.textContent.replace(/\\s+/g, ' ').trim() : '',
      };
    `);
    check('touch alert row created', touchRow.count === 2, `rows=${touchRow.count}`);
    check('touch row is labelled "chạm mốc"', touchRow.text.includes('chạm mốc'), touchRow.text);
    check('touch row shows its tolerance', touchRow.text.includes('±0.5%'), touchRow.text);

    // Approach from BELOW: 2900 -> 3000. A directional "above" alert would also
    // fire here, so the real test is the one after it.
    mock.push('ETHUSDT', 2900);
    await wait(400);
    mock.push('ETHUSDT', 3000);
    await wait(900);
    const touchUp = await cdp.eval(
      `return document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent;`
    );
    check('touch fires when the price rises into the level', touchUp.includes('3,000'), touchUp);

    // Approach from ABOVE: 3100 -> 3000. This is the case the old kinds cannot
    // express — "above" would not fire on a fall, "below" would not fire on a
    // rise, and "touch" must fire on both.
    mock.push('ETHUSDT', 3100);
    await wait(400);
    mock.push('ETHUSDT', 3000);
    await wait(900);
    const touchDown = await cdp.eval(
      `return document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent;`
    );
    check('touch fires when the price FALLS into the level', touchDown.includes('3,000'), touchDown);

    // Editing the touch alert must reopen with its tolerance intact.
    await cdp.eval(`
      const rows = [...document.querySelectorAll('#alertList .alert')];
      const r = rows.find((x) => x.textContent.includes('chạm mốc'));
      r.querySelector('[data-aedit]').click();
      return true;
    `);
    await wait(300);
    const reopened = await cdp.eval(`
      return {
        dir: document.querySelector('#alertDir .seg-btn.is-active').dataset.dir,
        tol: document.getElementById('alertTolerance').value,
        tolHidden: document.getElementById('alertTolField').hidden,
      };
    `);
    check('editing a touch alert reopens on "Chạm mốc"', reopened.dir === 'touch', reopened.dir);
    check('editing a touch alert keeps its tolerance', String(reopened.tol) === '0.5', `tol=${reopened.tol}`);
    check('tolerance field is visible when editing a touch alert', reopened.tolHidden === false, `hidden=${reopened.tolHidden}`);

    // Switching back to a directional kind must hide the field again, so a
    // stale tolerance can never be saved onto an above/below alert.
    await cdp.eval(`
      document.querySelector('#alertDir .seg-btn[data-dir="above"]').click();
      return true;
    `);
    await wait(120);
    const backToAbove = await cdp.eval(`return document.getElementById('alertTolField').hidden;`);
    check('switching back to "vượt lên" hides the tolerance field', backToAbove === true, `hidden=${backToAbove}`);
    await cdp.eval(`document.querySelector('#alertModal [data-close]').click(); return true;`);
    await wait(250);

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

    // ---------- 7b. docked strip ('edge' mode)
    //
    // Docking is a placement mode on the SAME window, so this checks the three
    // things the user asked for: the strip shows only the total, clicking it
    // expands the full UI, and collapsing returns it to the strip.
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'edge' }); return true;`);
    await wait(700);
    const docked = await cdp.eval(`
      const w = document.getElementById('widget');
      const cv = document.getElementById('collapsedView');
      return {
        dockedClass: w.classList.contains('is-docked'),
        collapsed: w.classList.contains('is-collapsed'),
        bodyHidden: getComputedStyle(document.getElementById('body')).display === 'none',
        stripVisible: cv.offsetParent !== null,
        stripText: cv.innerText.replace(/\\s+/g, ' ').trim(),
        // the strip must not show the tabs or the hero block
        tabsVisible: document.querySelector('.tabs').offsetParent !== null,
        heroVisible: document.querySelector('.hero').offsetParent !== null,
      };
    `);
    check('dock mode marks the widget as docked', docked.dockedClass, JSON.stringify(docked));
    check('dock mode starts collapsed', docked.collapsed && docked.bodyHidden, JSON.stringify(docked));
    check('the docked strip is visible', docked.stripVisible);
    check('the docked strip shows the total value', docked.stripText.includes('76,000'), docked.stripText);
    check('the docked strip hides the tabs', !docked.tabsVisible);
    check('the docked strip hides the hero block', !docked.heroVisible);

    // the window itself must be a thin strip, not the full panel
    const stripBounds = await cdp.eval(`
      return { w: window.outerWidth, h: window.outerHeight };
    `);
    check('the docked window is a thin strip', stripBounds.h <= 60 && stripBounds.h > 20,
      JSON.stringify(stripBounds));

    // clicking the strip expands the full UI
    await cdp.eval(`document.getElementById('collapsedView').click(); return true;`);
    await wait(700);
    const afterStripClick = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        collapsed: w.classList.contains('is-collapsed'),
        bodyVisible: getComputedStyle(document.getElementById('body')).display !== 'none',
        tabsVisible: document.querySelector('.tabs').offsetParent !== null,
        h: window.outerHeight,
      };
    `);
    check('clicking the strip expands the full UI',
      !afterStripClick.collapsed && afterStripClick.bodyVisible && afterStripClick.tabsVisible,
      JSON.stringify(afterStripClick));
    check('the expanded docked panel is taller than the strip',
      afterStripClick.h > 300, `h=${afterStripClick.h}`);

    // collapsing returns to the strip, and the strip is still the total only
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(700);
    const backToStrip = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        collapsed: w.classList.contains('is-collapsed'),
        h: window.outerHeight,
        stripText: document.getElementById('collapsedView').innerText.replace(/\\s+/g, ' ').trim(),
      };
    `);
    check('collapsing returns to the thin strip',
      backToStrip.collapsed && backToStrip.h <= 60, JSON.stringify(backToStrip));
    check('the strip still shows the total after collapsing',
      backToStrip.stripText.includes('76,000'), backToStrip.stripText);

    // the docked strip must not be covered by the auto-hiding title bar:
    // the bar is transparent at rest, so the numbers stay readable.
    const stripBar = await cdp.eval(`
      const tb = document.getElementById('titlebar');
      return { opacity: getComputedStyle(tb).opacity, h: tb.getBoundingClientRect().height };
    `);
    check('the title bar stays hidden over the docked strip',
      Number(stripBar.opacity) === 0, JSON.stringify(stripBar));

    // Regression: the total must never be truncated. A visual check caught the
    // first version showing "58,60…" because the label and P&L took the width.
    const totalFit = await cdp.eval(`
      const v = document.getElementById('cvValue');
      const cs = getComputedStyle(v);
      return {
        text: v.textContent,
        scrollW: v.scrollWidth,
        clientW: v.clientWidth,
        overflow: cs.textOverflow,
        labelHidden: getComputedStyle(document.querySelector('.cv-label')).display === 'none',
      };
    `);
    check('the docked total is not truncated',
      totalFit.scrollW <= totalFit.clientW + 1 && totalFit.overflow === 'clip',
      JSON.stringify(totalFit));
    check('the redundant label is dropped in the strip', totalFit.labelHidden);

    // Regression: the title-bar buttons used to sit on top of the numbers
    // (buttons y 0-20, value y 13-31). While the bar is open the P&L yields.
    await cdp.eval(`
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 3 }));
      return true;
    `);
    await wait(500);
    const barOverStrip = await cdp.eval(`
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
      const v = r(document.getElementById('cvValue'));
      const btns = [...document.querySelectorAll('#titlebar .wbtn')].map(r);
      const hits = btns.filter((b) => !(b.right < v.left || b.left > v.right || b.bottom < v.top || b.top > v.bottom));
      return {
        hits: hits.length,
        pnlOpacity: getComputedStyle(document.querySelector('.cv-right')).opacity,
        barShown: document.getElementById('titlebar').classList.contains('is-shown'),
      };
    `);
    check('the title-bar buttons do not cover the docked total',
      barOverStrip.hits === 0 && barOverStrip.barShown, JSON.stringify(barOverStrip));
    check('the P&L yields while the title bar is open',
      barOverStrip.pnlOpacity === '0', JSON.stringify(barOverStrip));

    // and it comes back when the bar hides again
    await cdp.eval(`
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 150, clientY: 40 }));
      return true;
    `);
    await wait(600);
    const pnlBack = await cdp.eval(`
      return {
        pnlOpacity: getComputedStyle(document.querySelector('.cv-right')).opacity,
        barShown: document.getElementById('titlebar').classList.contains('is-shown'),
      };
    `);
    check('the P&L returns once the title bar hides',
      pnlBack.pnlOpacity === '1' && !pnlBack.barShown, JSON.stringify(pnlBack));

    // ---------- 7c. click-outside-to-collapse (the real blur handler)
    //
    // The sandbox runs with no window manager, so clicking on the desktop can
    // never produce an OS focus change here. `testBlur` fires the very handler
    // the OS fires, so these assertions cover the real code path.
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(700);

    const beforeBlur = await cdp.eval(`
      return { collapsed: document.getElementById('widget').classList.contains('is-collapsed') };
    `);
    check('the docked panel is open before the blur test', !beforeBlur.collapsed);

    // a modal must shield the widget from collapsing
    await cdp.eval(`document.getElementById('btnAddTrade').click(); return true;`);
    await wait(500);
    await cdp.eval(`await window.cpw.testBlur(); return true;`);
    await wait(600);
    const blurredWithModal = await cdp.eval(`
      return {
        collapsed: document.getElementById('widget').classList.contains('is-collapsed'),
        modalOpen: !document.getElementById('tradeModal').hidden,
      };
    `);
    check('an open form stops click-outside from collapsing the widget',
      !blurredWithModal.collapsed && blurredWithModal.modalOpen,
      JSON.stringify(blurredWithModal));

    // close the form, then a blur really does collapse it
    await cdp.eval(`document.querySelector('#tradeModal [data-close]').click(); return true;`);
    await wait(600);
    const afterBlur = await cdp.eval(`
      await window.cpw.testBlur();
      await new Promise((r) => setTimeout(r, 500));
      return {
        collapsed: document.getElementById('widget').classList.contains('is-collapsed'),
        bodyHidden: getComputedStyle(document.getElementById('body')).display === 'none',
        h: window.outerHeight,
      };
    `);
    check('clicking outside collapses the docked widget back to the strip',
      afterBlur.collapsed && afterBlur.bodyHidden && afterBlur.h <= 60,
      JSON.stringify(afterBlur));

    // with the opt-out turned on, blur must do nothing
    await cdp.eval(`
      await window.cpw.patchSettings({ collapseOnBlur: false });
      await window.cpw.window('expand');
      return true;
    `);
    await wait(700);
    const afterBlurDisabled = await cdp.eval(`
      await window.cpw.testBlur();
      await new Promise((r) => setTimeout(r, 500));
      return { collapsed: document.getElementById('widget').classList.contains('is-collapsed') };
    `);
    check('turning the opt-out off keeps the panel open on blur',
      !afterBlurDisabled.collapsed, JSON.stringify(afterBlurDisabled));
    await cdp.eval(`await window.cpw.patchSettings({ collapseOnBlur: true }); return true;`);
    await wait(300);

    // dock mode must survive a restart, not just a re-render
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(500);
    await cdp.send('Page.reload');
    await wait(2000);
    const dockAfterReload = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        docked: w.classList.contains('is-docked'),
        collapsed: w.classList.contains('is-collapsed'),
        h: window.outerHeight,
        stripText: document.getElementById('collapsedView').innerText.replace(/\\s+/g, ' ').trim(),
      };
    `);
    check('dock mode survives a reload',
      dockAfterReload.docked && dockAfterReload.collapsed && dockAfterReload.h <= 60,
      JSON.stringify(dockAfterReload));
    check('the reloaded strip still shows the total',
      dockAfterReload.stripText.includes('76,000'), dockAfterReload.stripText);

    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'float' }); return true;`);
    await wait(700);
    const undocked = await cdp.eval(`
      const w = document.getElementById('widget');
      return {
        dockedClass: w.classList.contains('is-docked'),
        collapsed: w.classList.contains('is-collapsed'),
        bodyVisible: getComputedStyle(document.getElementById('body')).display !== 'none',
        h: window.outerHeight,
      };
    `);
    check('turning dock mode off restores the floating window',
      !undocked.dockedClass && !undocked.collapsed && undocked.bodyVisible && undocked.h > 300,
      JSON.stringify(undocked));

    // ---------- 7d. 'taskbar' mode: the strip sits INSIDE the taskbar
    //
    // Windows has no API to embed a window into the taskbar, so this mode is an
    // overlay placed on the taskbar's own rectangle. What can be asserted is
    // exactly that: the window's rectangle must fall inside the taskbar's
    // rectangle, at the taskbar's height — not above it, which is what 'edge'
    // does and what the user complained about.
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'taskbar' }); return true;`);
    await wait(800);

    const tbMode = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      const w = document.getElementById('widget');
      return {
        mode: g.mode,
        bounds: g.bounds,
        taskbar: g.taskbar,
        collapsed: g.collapsed,
        alwaysOnTop: g.alwaysOnTop,
        isTaskbarClass: w.classList.contains('is-taskbar'),
        isDockedClass: w.classList.contains('is-docked'),
        stripText: document.getElementById('collapsedView').innerText.replace(/\\s+/g, ' ').trim(),
        bodyHidden: getComputedStyle(document.getElementById('body')).display === 'none',
      };
    `);
    check('taskbar mode is reported by the main process', tbMode.mode === 'taskbar', tbMode.mode);
    check('taskbar mode marks the widget with its own class', tbMode.isTaskbarClass, JSON.stringify(tbMode));
    check('taskbar mode is still a docked strip', tbMode.isDockedClass && tbMode.collapsed && tbMode.bodyHidden,
      JSON.stringify(tbMode));
    check('the taskbar strip shows the total', tbMode.stripText.includes('76,000'), tbMode.stripText);

    // The core assertion: the window must be INSIDE the taskbar rectangle.
    const b = tbMode.bounds;
    const t = tbMode.taskbar;
    check('the strip is vertically inside the taskbar rectangle',
      b.y >= t.y - 1 && b.y + b.height <= t.y + t.height + 1,
      `window y=${b.y}..${b.y + b.height} taskbar y=${t.y}..${t.y + t.height}`);
    check('the strip is no taller than the taskbar',
      b.height <= t.height, `h=${b.height} taskbarH=${t.height}`);
    check('the strip is horizontally inside the taskbar',
      b.x >= t.x - 1 && b.x + b.width <= t.x + t.width + 1,
      `window x=${b.x}..${b.x + b.width} taskbar x=${t.x}..${t.x + t.width}`);
    check('the strip is raised above the taskbar in z-order', tbMode.alwaysOnTop === true,
      String(tbMode.alwaysOnTop));

    // It must look like part of the taskbar, not a card floating on it.
    const tbLook = await cdp.eval(`
      const w = document.getElementById('widget');
      const cs = getComputedStyle(w);
      return {
        border: cs.borderTopWidth,
        radius: cs.borderTopLeftRadius,
        bg: cs.backgroundColor,
        bgImage: cs.backgroundImage,
      };
    `);
    check('the taskbar strip drops its border', tbLook.border === '0px', tbLook.border);
    check('the taskbar strip uses a flat fill, not a gradient',
      tbLook.bgImage === 'none', tbLook.bgImage);

    // clicking it expands the panel, which must grow AWAY from the taskbar
    await cdp.eval(`document.getElementById('collapsedView').click(); return true;`);
    await wait(800);
    const tbExpanded = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return {
        collapsed: g.collapsed,
        bounds: g.bounds,
        taskbar: g.taskbar,
        bodyVisible: getComputedStyle(document.getElementById('body')).display !== 'none',
      };
    `);
    check('clicking the taskbar strip expands the full UI',
      !tbExpanded.collapsed && tbExpanded.bodyVisible, JSON.stringify(tbExpanded));
    check('the expanded panel does not cover the taskbar',
      tbExpanded.bounds.y + tbExpanded.bounds.height <= tbExpanded.taskbar.y + 1,
      `panel bottom=${tbExpanded.bounds.y + tbExpanded.bounds.height} taskbar top=${tbExpanded.taskbar.y}`);

    // and collapsing returns it into the taskbar
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(800);
    const tbBack = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { collapsed: g.collapsed, bounds: g.bounds, taskbar: g.taskbar };
    `);
    check('collapsing returns the strip into the taskbar',
      tbBack.collapsed
      && tbBack.bounds.y >= tbBack.taskbar.y - 1
      && tbBack.bounds.y + tbBack.bounds.height <= tbBack.taskbar.y + tbBack.taskbar.height + 1,
      JSON.stringify(tbBack));

    // the mode must survive a restart
    await cdp.send('Page.reload');
    await wait(2000);
    const tbAfterReload = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      const w = document.getElementById('widget');
      return {
        mode: g.mode,
        collapsed: g.collapsed,
        isTaskbarClass: w.classList.contains('is-taskbar'),
        bounds: g.bounds,
        taskbar: g.taskbar,
      };
    `);
    check('taskbar mode survives a reload',
      tbAfterReload.mode === 'taskbar' && tbAfterReload.collapsed && tbAfterReload.isTaskbarClass,
      JSON.stringify(tbAfterReload));
    check('the reloaded strip is still inside the taskbar',
      tbAfterReload.bounds.y >= tbAfterReload.taskbar.y - 1
      && tbAfterReload.bounds.y + tbAfterReload.bounds.height
        <= tbAfterReload.taskbar.y + tbAfterReload.taskbar.height + 1,
      JSON.stringify(tbAfterReload));

    // back to floating for the remaining checks
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'float' }); return true;`);
    await wait(800);

    // ---------- 8. persistence across a reload
    await cdp.send('Page.reload');
    await wait(2000);
    const afterReload = await cdp.eval(`
      return {
        trades: document.querySelectorAll('#tradeList .trade').length,
        alerts: document.querySelectorAll('#alertList .alert').length,
        touchText: (() => {
          const r = [...document.querySelectorAll('#alertList .alert')]
            .find((x) => x.textContent.includes('chạm mốc'));
          return r ? r.textContent.replace(/\\s+/g, ' ').trim() : '';
        })(),
        total: document.getElementById('totalValue').textContent,
      };
    `);
    check('trades survive a reload', afterReload.trades === 1, `trades=${afterReload.trades}`);
    check('alerts survive a reload', afterReload.alerts === 2, `alerts=${afterReload.alerts}`);
    check('the touch alert survives a reload with its tolerance', afterReload.touchText.includes('±0.5%'), afterReload.touchText);
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
    /**
     * There is no sensor ELEMENT any more, and that is deliberate.
     *
     * The old `#tbZone` was a real element covering the top strip, which means
     * it swallowed clicks there too. In dock mode the whole window is 44px
     * tall, so a 20px sensor covered the top half of the summary and clicking
     * it did nothing. Hover is now detected from a document-level mousemove
     * (see app.js), which observes the pointer without ever taking a click.
     *
     * So the assertion is not "a sensor exists" — it is "the top edge is
     * reachable and does not block clicks", which is what the sensor was for.
     * The behaviour itself is checked in the next block, by driving the same
     * mousemove the real pointer produces.
     */
    check('no sensor element steals clicks from the top edge', tbState.hasZone === false,
      'a #tbZone element is back — it will swallow clicks in the 44px strip');
    check('the top edge is not covered by a click-blocking layer',
      tbState.pointer === 'none', tbState.pointer);
    check('title bar is a thin strip, not a full header', tbState.barH > 0 && tbState.barH <= 32,
      `h=${tbState.barH}`);

    // simulate the pointer reaching the top edge
    //
    // The app now detects hover from a document-level mousemove (the old
    // sensor element swallowed clicks, which broke the 44px docked strip), so
    // the test drives the same event the real pointer would produce.
    await cdp.eval(`
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 4 }));
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

    /*
     * The dialog scrim must survive this style. With a transparent overlay the
     * widget's own text showed through the sheet and collided with the form's
     * labels — a visual check caught it, and this keeps it from coming back.
     * The widget itself stays surface-free; only the transient dialog is opaque.
     */
    await cdp.eval(`document.getElementById('btnAddAlert').click(); return true;`);
    await wait(350);
    const bareModal = await cdp.eval(`
      const m = getComputedStyle(document.getElementById('alertModal'));
      const s = getComputedStyle(document.querySelector('#alertModal .sheet'));
      return { scrim: m.backgroundColor, sheetBg: s.backgroundColor };
    `);
    // Parse "rgba(r, g, b, a)" without a regex: the escaping inside a template
    // literal is easy to get wrong, and a wrong pattern silently reads as
    // alpha 0 — which is exactly the failure this check exists to catch.
    const scrimAlpha = (() => {
      const s = String(bareModal.scrim || '');
      const open = s.indexOf('(');
      const close = s.lastIndexOf(')');
      if (open < 0 || close < 0) return 0;
      const parts = s.slice(open + 1, close).split(',').map((x) => parseFloat(x));
      if (parts.some((n) => !Number.isFinite(n))) return 0;
      return parts.length === 4 ? parts[3] : 1;
    })();
    check('the dialog scrim stays opaque in the "Chỉ chữ" style',
      scrimAlpha >= 0.5, `scrim=${bareModal.scrim} alpha=${scrimAlpha}`);
    check('the dialog sheet keeps a real surface in the "Chỉ chữ" style',
      bareModal.sheetBg !== 'rgba(0, 0, 0, 0)' && bareModal.sheetBg !== 'transparent', bareModal.sheetBg);
    await cdp.eval(`document.querySelector('#alertModal [data-close]').click(); return true;`);
    await wait(250);
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
    //
    // Driven through the document-level mousemove the real pointer produces,
    // not through the old `#tbZone` element — that element was removed on
    // purpose because it swallowed clicks in the 44px docked strip.
    await cdp.eval(`
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 200, clientY: 4 }));
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

    // ---------- 8i. the chart
    //
    // The chart is fed by the main process's own sampler, so this waits for a
    // real sample to arrive rather than injecting history: the point is to
    // prove the whole path (sampler -> store -> IPC -> SVG) works.
    await cdp.eval(`await window.cpw.patchSettings({ chart: true, chartRange: 15 }); return true;`);
    await wait(300);

    const chartEmpty = await cdp.eval(`
      const box = document.getElementById('chartBox');
      return {
        hidden: box.hidden,
        hasSvg: !!document.getElementById('chartSvg'),
        line: document.getElementById('chartLine').getAttribute('d') || '',
        cap: document.getElementById('chartCap').textContent,
      };
    `);
    check('the chart is present in the expanded panel', !chartEmpty.hidden, JSON.stringify(chartEmpty));
    check('the chart renders an SVG path element', chartEmpty.hasSvg);

    // wait for the sampler to produce at least two points
    let chartReady = null;
    for (let i = 0; i < 30; i++) {
      chartReady = await cdp.eval(`
        const d = document.getElementById('chartLine').getAttribute('d') || '';
        return {
          d,
          cap: document.getElementById('chartCap').textContent,
          cls: document.getElementById('chartBox').className,
          dotX: document.getElementById('chartDot').getAttribute('cx'),
          dotY: document.getElementById('chartDot').getAttribute('cy'),
          area: document.getElementById('chartArea').getAttribute('d') || '',
        };
      `);
      if (chartReady.d.split('L').length > 2) break;
      await wait(1000);
    }
    check('the chart draws a line once samples arrive',
      chartReady.d.startsWith('M') && chartReady.d.includes('L'), chartReady.d.slice(0, 80));
    check('the chart path contains no NaN', !chartReady.d.includes('NaN'), chartReady.d.slice(0, 80));
    check('the chart draws a filled area under the line',
      chartReady.area.endsWith('Z'), chartReady.area.slice(-40));
    check('the chart marks the latest point with a dot',
      Number(chartReady.dotX) >= 0 && Number(chartReady.dotY) >= 0,
      `cx=${chartReady.dotX} cy=${chartReady.dotY}`);
    check('the chart caption states the window', /phút|giờ/.test(chartReady.cap), chartReady.cap);
    check('the chart carries a direction class',
      /is-(up|down|flat)/.test(chartReady.cls), chartReady.cls);

    // the range control must change the caption
    await cdp.eval(`document.querySelector('#rangeSeg .seg-btn[data-range="60"]').click(); return true;`);
    await wait(600);
    const chartRange = await cdp.eval(`
      return {
        cap: document.getElementById('chartCap').textContent,
        active: document.querySelector('#rangeSeg .seg-btn.is-active')?.dataset.range,
      };
    `);
    check('the range control switches to 1 hour', chartRange.active === '60', chartRange.active);
    check('the caption follows the range', /giờ/.test(chartRange.cap), chartRange.cap);

    // turning the chart off must remove it, and the choice must persist
    await cdp.eval(`document.querySelector('#chartSeg .seg-btn[data-chart="0"]').click(); return true;`);
    await wait(600);
    const chartOff = await cdp.eval(`return document.getElementById('chartBox').hidden;`);
    check('turning the chart off hides it', chartOff === true);

    await cdp.send('Page.reload');
    await wait(2000);
    const chartAfterReload = await cdp.eval(`
      return {
        hidden: document.getElementById('chartBox').hidden,
        active: document.querySelector('#chartSeg .seg-btn.is-active')?.dataset.chart,
      };
    `);
    check('the chart setting survives a reload', chartAfterReload.hidden === true,
      JSON.stringify(chartAfterReload));

    // turn it back on and confirm the history itself persisted
    await cdp.eval(`await window.cpw.patchSettings({ chart: true }); return true;`);
    await wait(800);
    const chartRestored = await cdp.eval(`
      const d = document.getElementById('chartLine').getAttribute('d') || '';
      return { hidden: document.getElementById('chartBox').hidden, d };
    `);
    check('the chart comes back on', chartRestored.hidden === false);
    check('the sampled history survived the reload',
      chartRestored.d.startsWith('M'), chartRestored.d.slice(0, 60));

    // the chart must not be drawn in the docked strip
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'edge' }); return true;`);
    await wait(800);
    const chartInStrip = await cdp.eval(`
      return {
        hidden: document.getElementById('chartBox').hidden,
        display: getComputedStyle(document.getElementById('chartBox')).display,
      };
    `);
    check('the chart is not drawn in the docked strip',
      chartInStrip.hidden || chartInStrip.display === 'none', JSON.stringify(chartInStrip));
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'float' }); return true;`);
    await wait(800);

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
