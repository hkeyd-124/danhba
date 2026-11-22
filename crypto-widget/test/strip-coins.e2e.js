'use strict';
/**
 * End-to-end test for the per-coin strip rows and the real coin logos.
 *
 * Runs the REAL Electron app under Xvfb and drives it through the DevTools
 * protocol, so what is asserted is what the user would see — not a mock of it.
 *
 * Run:  xvfb-run -a node test/strip-coins.e2e.js
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
      res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const clients = [];
    wss.on('connection', (ws) => clients.push(ws));
    server.listen(0, '127.0.0.1', () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => { wss.close(); server.close(r); }),
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-strip-'));
  const cdpPort = 9337;

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
    await cdp.eval(`
      window.__errs = window.__errs || [];
      window.addEventListener('error', (e) => window.__errs.push(String(e.message)));
      window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason)));
      return true;
    `);
    await wait(1200);

    // ---------- 1. the strip starts with no coin rows
    const before = await cdp.eval(`
      const box = document.getElementById('cvCoins');
      return {
        exists: !!box,
        hidden: box ? box.hidden : null,
        rows: box ? box.querySelectorAll('.cv-coin').length : -1,
        sumWrapped: !!document.querySelector('.cv-sum'),
      };
    `);
    check('the coin-row container exists', before.exists);
    check('it is hidden when nothing is ticked', before.hidden === true, `hidden=${before.hidden}`);
    check('the summary line is wrapped in .cv-sum', before.sumWrapped);

    // ---------- 2. add three trades through the real form
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

    const afterTrades = await cdp.eval(`
      return {
        positions: document.querySelectorAll('#posList .pos').length,
        total: document.getElementById('totalValue').textContent,
      };
    `);
    check('three positions render in the panel', afterTrades.positions === 3, `got ${afterTrades.positions}`);

    // ---------- 3. real logos, not letter badges
    const logos = await cdp.eval(`
      const imgs = [...document.querySelectorAll('#posList .coin-img')];
      return {
        count: imgs.length,
        srcs: imgs.map((i) => i.getAttribute('src')),
        loaded: imgs.map((i) => i.complete && i.naturalWidth > 0),
        letterBadges: document.querySelectorAll('#posList .coin:not(.coin-img)').length,
      };
    `);
    check('the panel draws real logo images', logos.count === 3, `got ${logos.count}`);
    check('every logo actually loaded', logos.loaded.every(Boolean), JSON.stringify(logos.loaded));
    // Data URIs, not paths: the renderer is sandboxed and cannot read the disk,
    // and the page's CSP allows `img-src 'self' data:` and nothing else. A data
    // URI is also the only form that provably cannot point off the machine.
    check('the logos are inline data URIs', logos.srcs.every((s) => s && s.startsWith('data:image/')), JSON.stringify(logos.srcs.map((s) => String(s).slice(0, 24))));
    check('no letter badge is left for a coin that has a logo', logos.letterBadges === 0, `got ${logos.letterBadges}`);

    // ---------- 4. the settings sheet lists the held coins
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(300);
    const sheet = await cdp.eval(`
      const box = document.getElementById('stripCoins');
      const inputs = [...box.querySelectorAll('input[data-strip-coin]')];
      return {
        count: inputs.length,
        symbols: inputs.map((i) => i.dataset.stripCoin),
        checked: inputs.filter((i) => i.checked).length,
      };
    `);
    check('the sheet offers one tick per held coin', sheet.count === 3, `got ${sheet.count}`);
    check('the tick list names the held coins', ['ETH', 'LDO', 'SOL'].every((s) => sheet.symbols.includes(s)), JSON.stringify(sheet.symbols));
    check('nothing is ticked by default', sheet.checked === 0, `got ${sheet.checked}`);

    // ---------- 5. tick LDO and ETH
    await cdp.eval(`
      const box = document.getElementById('stripCoins');
      for (const sym of ['LDO', 'ETH']) {
        const i = box.querySelector('input[data-strip-coin="' + sym + '"]');
        i.checked = true;
        i.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return true;
    `);
    await wait(600);

    const ticked = await cdp.eval(`
      const box = document.getElementById('cvCoins');
      const rows = [...box.querySelectorAll('.cv-coin')];
      return {
        hidden: box.hidden,
        count: rows.length,
        syms: rows.map((r) => r.querySelector('.cv-coin-sym').textContent.trim()),
        prices: rows.map((r) => r.querySelector('.cv-coin-price').textContent.trim()),
        pcts: rows.map((r) => r.querySelector('.cv-coin-pct').textContent.trim()),
        hasLogo: rows.map((r) => !!r.querySelector('.coin-img')),
        logoLoaded: rows.map((r) => { const i = r.querySelector('.coin-img'); return i ? (i.complete && i.naturalWidth > 0) : false; }),
      };
    `);
    check('the strip shows the ticked rows', ticked.hidden === false && ticked.count === 2, `hidden=${ticked.hidden} count=${ticked.count}`);
    check('the rows are in the order they were ticked', JSON.stringify(ticked.syms) === JSON.stringify(['LDO', 'ETH']), JSON.stringify(ticked.syms));
    check('each row carries a price', ticked.prices.every((p) => p && p !== '—'), JSON.stringify(ticked.prices));
    check('each row carries a percentage', ticked.pcts.every((p) => p.includes('%')), JSON.stringify(ticked.pcts));
    check('each row carries a real logo', ticked.hasLogo.every(Boolean), JSON.stringify(ticked.hasLogo));
    check('the row logos actually loaded', ticked.logoLoaded.every(Boolean), JSON.stringify(ticked.logoLoaded));

    // ---------- 6. the strip's window grew to fit the rows
    const geom = await cdp.eval(`
      const cv = document.getElementById('collapsedView');
      const box = document.getElementById('cvCoins');
      const rows = [...box.querySelectorAll('.cv-coin')];
      const sum = document.querySelector('.cv-sum');
      const r = (el) => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, h: b.height }; };
      return {
        view: r(cv),
        sum: r(sum),
        rows: rows.map(r),
        rowGap: rows.length > 1 ? rows[1].getBoundingClientRect().top - rows[0].getBoundingClientRect().bottom : null,
        overflow: cv.scrollHeight > cv.clientHeight + 1,
      };
    `);
    check('the rows sit below the summary line', geom.rows[0].top >= geom.sum.bottom - 1, `sum.bottom=${geom.sum.bottom} row.top=${geom.rows[0].top}`);
    check('the rows do not overlap each other', geom.rowGap !== null && geom.rowGap >= 0, `gap=${geom.rowGap}`);
    check('the strip does not overflow its own box', geom.overflow === false, `scrollHeight > clientHeight`);

    // ---------- 7. the selection survives a reload
    await cdp.send('Page.reload');
    await wait(2500);
    const afterReload = await cdp.eval(`
      const box = document.getElementById('cvCoins');
      const rows = [...box.querySelectorAll('.cv-coin')];
      return {
        count: rows.length,
        syms: rows.map((r) => r.querySelector('.cv-coin-sym').textContent.trim()),
      };
    `);
    check('the ticked coins survive a reload', afterReload.count === 2, `got ${afterReload.count}`);
    check('and they keep their order', JSON.stringify(afterReload.syms) === JSON.stringify(['LDO', 'ETH']), JSON.stringify(afterReload.syms));

    // ---------- 8. unticking removes the row
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(300);
    await cdp.eval(`
      const i = document.querySelector('#stripCoins input[data-strip-coin="LDO"]');
      i.checked = false;
      i.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await wait(500);
    const unticked = await cdp.eval(`
      const box = document.getElementById('cvCoins');
      return {
        count: box.querySelectorAll('.cv-coin').length,
        syms: [...box.querySelectorAll('.cv-coin-sym')].map((e) => e.textContent.trim()),
      };
    `);
    check('unticking removes exactly that row', unticked.count === 1 && unticked.syms[0] === 'ETH', JSON.stringify(unticked.syms));

    // ---------- 9. the contrast readout is honest on a see-through theme
    const contrast = await cdp.eval(`
      const out = {};
      const pick = (theme, alpha) => {
        const t = document.querySelector('.theme[data-theme="' + theme + '"]');
        t.click();
        return new Promise((r) => setTimeout(r, 250));
      };
      await pick('clear');
      const a = document.getElementById('alphaRange');
      a.value = '35';
      a.dispatchEvent(new Event('input', { bubbles: true }));
      a.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      out.lowAlpha = {
        chip: document.getElementById('contrastChip').textContent.trim(),
        hint: document.getElementById('contrastHint').textContent.trim(),
      };
      a.value = '100';
      a.dispatchEvent(new Event('input', { bubbles: true }));
      a.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 500));
      out.fullAlpha = {
        chip: document.getElementById('contrastChip').textContent.trim(),
        hint: document.getElementById('contrastHint').textContent.trim(),
      };
      return out;
    `);
    check('a see-through theme at 35% says it cannot measure', contrast.lowAlpha.chip === 'nền trong suốt', contrast.lowAlpha.chip);
    check('and the hint explains why', /35%/.test(contrast.lowAlpha.hint), contrast.lowAlpha.hint);
    check('at full opacity it measures again', /:1$/.test(contrast.fullAlpha.chip), contrast.fullAlpha.chip);

    // ---------- 10. no renderer errors
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
