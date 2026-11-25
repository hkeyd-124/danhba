'use strict';
/**
 * End-to-end test for the demo futures tab.
 *
 * Runs the REAL Electron app under Xvfb and drives it through the DevTools
 * protocol, with a local stand-in for Binance. What is asserted is what the
 * user would see: the form has the three fields the model needs, a saved
 * position comes back with its margin mode, quantity and margin intact, the
 * liquidation price is on the correct side of the entry, PnL moves when the
 * price ticks, and the two pins put rows in the collapsed strip.
 *
 * The unit tests already prove the arithmetic. This file proves the wiring:
 * that `marginMode` survives the trip renderer -> IPC -> store -> state ->
 * DOM, which is exactly where the previous version lost it.
 *
 * Run:  xvfb-run -a node test/futures.e2e.js
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
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  \u2192 ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Prices the mock serves, and the ones the test moves to prove PnL is live. */
const PRICES = { BTCUSDT: 100, ETHUSDT: 100 };

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(
          Object.entries(PRICES).map(([symbol, price]) => ({ symbol, price: String(price) })),
        ));
        return;
      }
      if (req.url.startsWith('/fapi/v1/klines')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([]));
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
        /** Push a mark price to every connected renderer. */
        push(symbol, price) {
          const msg = JSON.stringify({ stream: `${symbol.toLowerCase()}@markPrice@1s`, data: { s: symbol, p: String(price) } });
          for (const c of clients) { try { c.send(msg); } catch (_) { /* ignore */ } }
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-fut-e2e-'));
  const cdpPort = 9351;

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
    await wait(1500);

    // ---------- 1. the tab and the form exist
    const tab = await cdp.eval(`
      const t = document.querySelector('.tab[data-tab="futures"]');
      if (t) t.click();
      return {
        hasTab: !!t,
        panelActive: document.getElementById('panel-futures').classList.contains('is-active'),
        hasAdd: !!document.getElementById('btnAddFuture'),
        hasBanner: !!document.querySelector('#panel-futures .fut-note'),
      };
    `);
    check('the Future tab exists and opens', tab.hasTab && tab.panelActive, JSON.stringify(tab));
    check('the panel has an add button', tab.hasAdd);
    check('the demo banner is present', tab.hasBanner);

    // ---------- 2. the form has mode / qty / margin
    await cdp.eval(`document.getElementById('btnAddFuture').click(); return true;`);
    await wait(400);
    const form = await cdp.eval(`
      const modes = [...document.querySelectorAll('#futureMode .seg-btn')].map((b) => b.dataset.mode);
      return {
        open: !document.getElementById('futureModal').hidden,
        modes,
        hasQty: !!document.getElementById('futureQty'),
        hasMargin: !!document.getElementById('futureMargin'),
        hasEntry: !!document.getElementById('futureEntry'),
        hasLev: !!document.getElementById('futureLeverage'),
        hasHint: !!document.getElementById('futureMarginHint'),
        hasCalc: !!document.getElementById('futureCalc'),
        activeMode: (document.querySelector('#futureMode .seg-btn.is-active') || {}).dataset?.mode,
      };
    `);
    check('the sheet opens', form.open);
    check('it offers both margin modes', JSON.stringify(form.modes) === '["isolated","cross"]', JSON.stringify(form.modes));
    check('isolate is the default', form.activeMode === 'isolated', String(form.activeMode));
    check('it has a quantity field', form.hasQty);
    check('it has a per-position margin field', form.hasMargin);
    check('it has entry and leverage fields', form.hasEntry && form.hasLev);
    check('it has a margin hint and a live preview', form.hasHint && form.hasCalc);

    // ---------- 3. the live preview reacts to typing
    const preview = await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('futureQty', '10');
      set('futureLeverage', '10');
      set('futureEntry', '100');
      set('futureMargin', '100');
      await new Promise((r) => setTimeout(r, 120));
      return {
        calc: document.getElementById('futureCalc').textContent,
        hint: document.getElementById('futureMarginHint').textContent,
      };
    `);
    check('the preview states the minimum margin', /Tối thiểu 100\.00/.test(preview.hint), preview.hint);
    check('the preview states a liquidation price', /thanh lý/.test(preview.calc), preview.calc);
    // 10 units at 100, 100 margin, MMR 0.004 -> buffer 96 -> liq 90.4
    check('the preview liquidation is 90.4 for a 10x long', /90\.4/.test(preview.calc), preview.calc);

    // ---------- 4. a margin below the requirement is refused
    const refused = await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('futureMargin', '50');
      await new Promise((r) => setTimeout(r, 120));
      return document.getElementById('futureCalc').textContent;
    `);
    check('a margin below the minimum is called out', /thấp hơn mức tối thiểu/.test(refused), refused);

    // ---------- 5. save an ISOLATED long
    const saved = await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('futureSymbol', 'BTC');
      set('futureQty', '10');
      set('futureLeverage', '10');
      set('futureEntry', '100');
      set('futureMargin', '100');
      document.getElementById('futureForm').requestSubmit();
      await new Promise((r) => setTimeout(r, 700));
      return {
        closed: document.getElementById('futureModal').hidden,
        err: document.getElementById('futureError').hidden ? null : document.getElementById('futureError').textContent,
        cards: document.querySelectorAll('#futureList .fut').length,
      };
    `);
    check('the sheet closes on save', saved.closed, JSON.stringify(saved));
    check('no error was shown', saved.err === null, String(saved.err));
    check('one position card appears', saved.cards === 1, `got ${saved.cards}`);

    const iso = await cdp.eval(`
      const c = document.querySelector('#futureList .fut');
      return {
        text: c.textContent.replace(/\\s+/g, ' ').trim(),
        mode: (c.querySelector('.fut-mode') || {}).textContent,
        isCross: (c.querySelector('.fut-mode') || {}).classList?.contains('is-cross'),
        lev: (c.querySelector('.fut-lev') || {}).textContent,
        pnl: (c.querySelector('.fut-pnl') || {}).textContent,
        liq: (c.querySelector('.fut-liq') || {}).textContent.replace(/\\s+/g, ' ').trim(),
      };
    `);
    check('the card is badged ISOLATE', iso.mode === 'ISOLATE', String(iso.mode));
    check('the ISOLATE badge is not tinted as cross', iso.isCross === false, String(iso.isCross));
    check('the card shows the leverage', /10x/.test(iso.lev || ''), String(iso.lev));
    check('the card shows the quantity', /KL 10/.test(iso.text), iso.text);
    check('the card shows the margin', /Ký quỹ 100/.test(iso.text), iso.text);
    check('the card shows the entry price', /Vào 100/.test(iso.text), iso.text);
    check('the card shows a liquidation price', /Thanh lý 90\.4/.test(iso.liq), iso.liq);

    // ---------- 6. save a CROSS short
    await cdp.eval(`document.getElementById('btnAddFuture').click(); return true;`);
    await wait(400);
    const crossSaved = await cdp.eval(`
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      document.querySelector('#futureSide .seg-btn[data-side="SHORT"]').click();
      document.querySelector('#futureMode .seg-btn[data-mode="cross"]').click();
      await new Promise((r) => setTimeout(r, 100));
      const hint = document.getElementById('futureModeHint').textContent;
      set('futureSymbol', 'ETH');
      set('futureQty', '10');
      set('futureLeverage', '10');
      set('futureEntry', '100');
      set('futureMargin', '100');
      document.getElementById('futureForm').requestSubmit();
      await new Promise((r) => setTimeout(r, 700));
      return {
        hint,
        cards: document.querySelectorAll('#futureList .fut').length,
        err: document.getElementById('futureError').hidden ? null : document.getElementById('futureError').textContent,
      };
    `);
    check('the cross hint explains the shared pool', /pool/.test(crossSaved.hint), crossSaved.hint);
    check('the cross position saves', crossSaved.cards === 2, JSON.stringify(crossSaved));

    const cross = await cdp.eval(`
      const cards = [...document.querySelectorAll('#futureList .fut')];
      const c = cards.find((x) => /ETH/.test(x.textContent));
      return {
        mode: (c.querySelector('.fut-mode') || {}).textContent,
        isCross: (c.querySelector('.fut-mode') || {}).classList?.contains('is-cross'),
        text: c.textContent.replace(/\\s+/g, ' ').trim(),
        liq: (c.querySelector('.fut-liq') || {}).textContent.replace(/\\s+/g, ' ').trim(),
      };
    `);
    check('the cross card is badged CROSS', cross.mode === 'CROSS', String(cross.mode));
    check('the CROSS badge is tinted', cross.isCross === true, String(cross.isCross));
    check('the cross card says the price follows the pool', /theo pool cross/.test(cross.liq), cross.liq);
    check('the cross short liquidates ABOVE entry', /Thanh lý 1[0-9][0-9]/.test(cross.liq), cross.liq);

    // ---------- 7. PnL moves on a price tick
    const before = await cdp.eval(`
      const c = [...document.querySelectorAll('#futureList .fut')].find((x) => /BTC/.test(x.textContent));
      return (c.querySelector('.fut-pnl') || {}).textContent;
    `);
    mock.push('BTCUSDT', 110);
    await wait(1200);
    const after = await cdp.eval(`
      const c = [...document.querySelectorAll('#futureList .fut')].find((x) => /BTC/.test(x.textContent));
      return {
        pnl: (c.querySelector('.fut-pnl') || {}).textContent,
        mark: c.textContent.replace(/\\s+/g, ' ').trim(),
      };
    `);
    check('the PnL changes when the price ticks', before !== after.pnl, `${before} -> ${after.pnl}`);
    check('the mark price follows the tick', /Mark 110/.test(after.mark), after.mark);
    check('a 10% rise on a 10x long is a large positive PnL', /\+/.test(after.pnl), after.pnl);

    // ---------- 8. the pins put rows in the collapsed strip
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(900);
    const strip = await cdp.eval(`
      const box = document.getElementById('cvFutures');
      const rows = [...box.querySelectorAll('.cv-fut')];
      return {
        hidden: box.hidden,
        count: rows.length,
        kinds: rows.map((r) => r.dataset.kind),
        texts: rows.map((r) => r.textContent.replace(/\\s+/g, ' ').trim()),
        heights: rows.map((r) => r.getBoundingClientRect().height),
      };
    `);
    check('the strip shows futures rows', strip.hidden === false && strip.count === 2, JSON.stringify(strip));
    check('one row is the PnL, one is the liquidation',
      JSON.stringify(strip.kinds) === '["pnl","liq"]', JSON.stringify(strip.kinds));
    check('the PnL row is tagged FUT', /FUT/.test(strip.texts[0] || ''), String(strip.texts[0]));
    check('the liquidation row names a coin', /BTC|ETH/.test(strip.texts[1] || ''), String(strip.texts[1]));
    check('both rows are 13px tall', strip.heights.every((h) => Math.abs(h - 13) < 1.5),
      JSON.stringify(strip.heights));

    // ---------- 9. the pins are independent
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(900);
    await cdp.eval(`
      const t = document.querySelector('.tab[data-tab="futures"]');
      if (t) t.click();
      document.getElementById('btnPinPnl').click();
      return true;
    `);
    await wait(500);
    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(800);
    const onlyLiq = await cdp.eval(`
      return [...document.querySelectorAll('#cvFutures .cv-fut')].map((r) => r.dataset.kind);
    `);
    check('turning the PnL pin off leaves only the liquidation row',
      JSON.stringify(onlyLiq) === '["liq"]', JSON.stringify(onlyLiq));

    // ---------- 10. everything survives a reload
    await cdp.send('Page.reload');
    await wait(3500);
    const reloaded = await cdp.eval(`
      const cards = [...document.querySelectorAll('#futureList .fut')];
      return {
        cards: cards.length,
        modes: cards.map((c) => (c.querySelector('.fut-mode') || {}).textContent),
        qty: cards.map((c) => /KL 10/.test(c.textContent)),
        strip: [...document.querySelectorAll('#cvFutures .cv-fut')].map((r) => r.dataset.kind),
      };
    `);
    check('both positions are back after a reload', reloaded.cards === 2, JSON.stringify(reloaded));
    check('the margin modes survived the reload',
      JSON.stringify(reloaded.modes.sort()) === '["CROSS","ISOLATE"]', JSON.stringify(reloaded.modes));
    check('the quantities survived the reload', reloaded.qty.every(Boolean), JSON.stringify(reloaded.qty));
    check('the pin choice survived the reload',
      JSON.stringify(reloaded.strip) === '["liq"]', JSON.stringify(reloaded.strip));

    // ---------- 11. no renderer errors
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
