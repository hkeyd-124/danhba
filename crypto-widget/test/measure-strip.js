'use strict';
/**
 * Measure the docked strip's real geometry.
 *
 * The vision model reported the strip's text as "shoved toward the top with an
 * empty void at the bottom" and the P&L as sitting 1-2px above the total. Both
 * are the kind of claim that is easy to make from a 300x44 crop and easy to
 * settle with numbers, so this measures the actual boxes instead of guessing.
 *
 * Run:  xvfb-run -a -s "-screen 0 1280x900x24" node test/measure-strip.js
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
        res.end(JSON.stringify([{ symbol: 'BTCUSDT', price: '67420.5' }]));
        return;
      }
      res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const clients = [];
    wss.on('connection', (ws) => clients.push(ws));
    server.listen(0, '127.0.0.1', () => resolve({
      port: server.address().port,
      push(s, p) {
        const f = JSON.stringify({ stream: `${s.toLowerCase()}@markPrice@1s`, data: { e: 'markPriceUpdate', E: Date.now(), s, p: String(p) } });
        for (const c of clients) if (c.readyState === 1) c.send(f);
      },
      close: () => new Promise((r) => { wss.close(); server.close(r); }),
    }));
  });
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (b) => {
      const m = JSON.parse(b.toString());
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id);
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout')); } }, 20000);
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${e} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch (_) { /* ignore */ } }
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => { d += c; }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-meas-'));
  const port = 9477;
  const child = spawn(path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env: { ...process.env, CPW_TEST: '1', CPW_WS_BASE: `ws://127.0.0.1:${mock.port}/market/stream`, CPW_REST_BASE: `http://127.0.0.1:${mock.port}/fapi/v1/ticker/price` }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stderr.on('data', () => {});

  let cdp;
  try {
    let target = null;
    for (let i = 0; i < 60 && !target; i++) {
      try { target = (await getJson(`http://127.0.0.1:${port}/json/list`)).find((t) => t.type === 'page'); } catch (_) { /* wait */ }
      if (!target) await wait(500);
    }
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send('Runtime.enable');
    await wait(1500);

    await cdp.eval(`return window.cpw.saveTrade({ symbol: 'BTC', side: 'BUY', price: 58200, qty: 0.35, fee: 12 });`);
    await cdp.eval(`return window.cpw.saveTrade({ symbol: 'ETH', side: 'BUY', price: 2950, qty: 4.2, fee: 8 });`);
    mock.push('BTCUSDT', 67420.5);
    await wait(1200);

    for (const mode of ['edge', 'taskbar']) {
      await cdp.eval(`await window.cpw.patchSettings({ dockMode: '${mode}' }); return true;`);
      await wait(900);
      const m = await cdp.eval(`
        const r = (el) => { const b = el.getBoundingClientRect(); return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), h: +b.height.toFixed(2), w: +b.width.toFixed(2) }; };
        const strip = document.getElementById('collapsedView');
        const val = document.getElementById('cvValue');
        const pnl = document.getElementById('cvPnl');
        const pct = document.getElementById('cvPct');
        const right = document.querySelector('.cv-right');
        const cs = getComputedStyle(strip);
        return {
          win: { w: window.outerWidth, h: window.outerHeight },
          strip: r(strip),
          val: r(val),
          pnl: r(pnl),
          pct: r(pct),
          right: r(right),
          padTop: cs.paddingTop, padBottom: cs.paddingBottom, padLeft: cs.paddingLeft, padRight: cs.paddingRight,
          align: cs.alignItems,
          valFont: getComputedStyle(val).fontSize,
          pnlFont: getComputedStyle(pnl).fontSize,
          valText: val.textContent,
          pnlText: pnl.textContent,
        };
      `);
      console.log(`\n===== ${mode} =====`);
      console.log(JSON.stringify(m, null, 2));
      const mid = (m.strip.top + m.strip.bottom) / 2;
      console.log(`strip centre y = ${mid.toFixed(2)}`);
      console.log(`value centre y = ${((m.val.top + m.val.bottom) / 2).toFixed(2)}  (delta ${(((m.val.top + m.val.bottom) / 2) - mid).toFixed(2)})`);
      console.log(`pnl   centre y = ${((m.pnl.top + m.pnl.bottom) / 2).toFixed(2)}  (delta ${(((m.pnl.top + m.pnl.bottom) / 2) - mid).toFixed(2)})`);
      console.log(`value bottom vs pnl bottom: ${(m.val.bottom - m.pnl.bottom).toFixed(2)}`);
      console.log(`left pad ${m.val.left - m.strip.left}  right pad ${m.strip.right - m.pct.right}`);
    }
  } catch (e) {
    console.error('measure failed:', e.message);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
    await wait(300);
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }
  process.exit(0);
})();
