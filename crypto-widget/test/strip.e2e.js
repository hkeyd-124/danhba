'use strict';
/**
 * End-to-end test for the docked strip's width.
 *
 * Kept as its own file rather than appended to test/e2e.js: it needs a
 * different setup (taskbar mode from the start) and it is the regression suite
 * for one specific bug, so it should be runnable on its own:
 *
 *     xvfb-run -a node test/strip.e2e.js
 *
 * The bug: dragging the taskbar strip changed the window but saved nothing, so
 * expanding and collapsing again snapped the strip back to its old width.
 *
 * These assertions drive the REAL resize path (applyResize + stopResize) via
 * the test-only `test-resize` hook. Xvfb has no pointer and the sandbox has no
 * xdotool, so a drag could otherwise only be faked with setBounds — which would
 * skip the clamping and the persistence, i.e. exactly the code under test.
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
          { symbol: 'BTCUSDT', price: '96420.5' },
          { symbol: 'ETHUSDT', price: '3285.4' },
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
  throw new Error('no devtools target');
}

(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-strip-'));
  const port = 9488;

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
    const target = await findTarget(port);
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await wait(1500);

    // A portfolio, so the strip has a total and a P&L to lay out.
    const seed = [
      { symbol: 'BTC', side: 'BUY', price: 88200, qty: 0.42, fee: 12, time: Date.now() - 86400000 * 12 },
      { symbol: 'ETH', side: 'BUY', price: 2950, qty: 4.2, fee: 8, time: Date.now() - 86400000 * 9 },
    ];
    for (const s of seed) await cdp.eval(`return window.cpw.saveTrade(${JSON.stringify(s)});`);
    mock.push('BTCUSDT', 96420.5);
    mock.push('ETHUSDT', 3285.4);
    await wait(1200);

    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'taskbar' }); return true;`);
    await wait(1000);

    // ---------- the strip starts collapsed, inside the taskbar
    const start = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { bounds: g.bounds, taskbar: g.taskbar, collapsed: g.collapsed, mode: g.mode };
    `);
    check('the strip starts collapsed in taskbar mode', start.collapsed, JSON.stringify(start));
    check('the strip sits inside the taskbar rectangle',
      start.bounds.y >= start.taskbar.y - 1
      && start.bounds.y + start.bounds.height <= start.taskbar.y + start.taskbar.height + 1,
      JSON.stringify(start));

    // ---------- drag the east edge wider
    const drag = await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: 120, dy: 0 });`);
    check('dragging the east edge widens the strip',
      drag.after.width === drag.before.width + 120,
      `before=${drag.before.width} after=${drag.after.width}`);

    const afterDrag = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { bounds: g.bounds, taskbar: g.taskbar, stripWidth: g.settings.stripWidth, dockWidth: g.settings.dockWidth };
    `);
    check('the dragged width is SAVED to settings',
      afterDrag.stripWidth === drag.after.width,
      `stripWidth=${afterDrag.stripWidth} window=${drag.after.width}`);
    check('dragging the strip does not change the panel width',
      afterDrag.dockWidth !== drag.after.width,
      `dockWidth=${afterDrag.dockWidth} strip=${drag.after.width}`);
    check('the widened strip is still inside the taskbar',
      afterDrag.bounds.y >= afterDrag.taskbar.y - 1
      && afterDrag.bounds.y + afterDrag.bounds.height <= afterDrag.taskbar.y + afterDrag.taskbar.height + 1,
      JSON.stringify(afterDrag));

    // ---------- expand, then collapse: the exact round trip from the report
    await cdp.eval(`document.getElementById('collapsedView').click(); return true;`);
    await wait(900);
    const expanded = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { collapsed: g.collapsed, width: g.bounds.width };
    `);
    check('the panel opens at the panel width, not the strip width',
      !expanded.collapsed && expanded.width !== drag.after.width,
      JSON.stringify(expanded));

    await cdp.eval(`await window.cpw.window('collapse'); return true;`);
    await wait(900);
    const restored = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { collapsed: g.collapsed, width: g.bounds.width, bounds: g.bounds, taskbar: g.taskbar };
    `);
    check('collapsing restores the DRAGGED width, not the original',
      restored.collapsed && restored.width === drag.after.width,
      `expected ${drag.after.width}, got ${restored.width}`);
    check('the restored strip is still inside the taskbar',
      restored.bounds.y >= restored.taskbar.y - 1
      && restored.bounds.y + restored.bounds.height <= restored.taskbar.y + restored.taskbar.height + 1,
      JSON.stringify(restored));

    // ---------- and it must survive a restart, not just a re-render
    await cdp.send('Page.reload');
    await wait(2200);
    const afterReload = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { collapsed: g.collapsed, width: g.bounds.width };
    `);
    check('the dragged width survives a reload',
      afterReload.collapsed && afterReload.width === drag.after.width,
      `expected ${drag.after.width}, got ${afterReload.width}`);

    // ---------- the minimum, and the narrow layout
    const tooNarrow = await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: -600, dy: 0 });`);
    check('the strip cannot be dragged below the readable minimum',
      tooNarrow.after.width >= 200, `width=${tooNarrow.after.width}`);

    const narrow = await cdp.eval(`
      const pnl = document.getElementById('cvPnl');
      const pct = document.getElementById('cvPct');
      const val = document.getElementById('cvValue');
      return {
        width: document.getElementById('widget').getBoundingClientRect().width,
        pnlShown: getComputedStyle(pnl).display !== 'none',
        pnlTruncated: pnl.scrollWidth > pnl.clientWidth + 1,
        pctTruncated: pct.scrollWidth > pct.clientWidth + 1,
        valTruncated: val.scrollWidth > val.clientWidth + 1,
        pctText: pct.textContent,
      };
    `);
    check('the narrow strip drops the absolute P&L', !narrow.pnlShown, JSON.stringify(narrow));
    check('the narrow strip keeps the percentage', narrow.pctText.includes('%'), narrow.pctText);
    check('nothing is truncated in the narrow strip',
      !narrow.pnlTruncated && !narrow.pctTruncated && !narrow.valTruncated,
      JSON.stringify(narrow));

    // ---------- wide again: the absolute figure comes back
    await cdp.eval(`return await window.cpw.testResize({ edge: 'e', dx: 300, dy: 0 });`);
    await wait(500);
    const wide = await cdp.eval(`
      const pnl = document.getElementById('cvPnl');
      return {
        width: document.getElementById('widget').getBoundingClientRect().width,
        pnlShown: getComputedStyle(pnl).display !== 'none',
        pnlTruncated: pnl.scrollWidth > pnl.clientWidth + 1,
      };
    `);
    check('a wide strip shows the absolute P&L again', wide.pnlShown, JSON.stringify(wide));
    check('the wide strip does not truncate the P&L', !wide.pnlTruncated, JSON.stringify(wide));

    // ---------- centring and padding, measured from the DOM
    const layout = await cdp.eval(`
      const strip = document.getElementById('collapsedView');
      const sr = strip.getBoundingClientRect();
      const val = document.getElementById('cvValue').getBoundingClientRect();
      const pct = document.getElementById('cvPct').getBoundingClientRect();
      return {
        stripCentre: +(sr.height / 2).toFixed(2),
        valueCentre: +(val.top + val.height / 2 - sr.top).toFixed(2),
        leftGap: +(val.left - sr.left).toFixed(2),
        rightGap: +(sr.right - pct.right).toFixed(2),
      };
    `);
    check('the strip text is vertically centred',
      Math.abs(layout.valueCentre - layout.stripCentre) <= 1, JSON.stringify(layout));
    check('the strip padding is symmetric',
      Math.abs(layout.leftGap - layout.rightGap) <= 1, JSON.stringify(layout));

    // ---------- reset-size restores BOTH sizes
    await cdp.eval(`await window.cpw.window('reset-size'); return true;`);
    await wait(700);
    const reset = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { stripWidth: g.settings.stripWidth, dockWidth: g.settings.dockWidth, width: g.bounds.width };
    `);
    check('reset-size restores the strip width too',
      reset.stripWidth === 300 && reset.width === 300, JSON.stringify(reset));

    // ---------- a vertical taskbar cannot host the strip
    // (asserted in the unit tests for placement; here we only confirm the app
    // does not crash when the mode is set and the taskbar is horizontal)
    check('the app is still alive after the whole sequence',
      (await cdp.eval(`return !!document.getElementById('widget');`)) === true);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
  }

  console.log(`\n${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
