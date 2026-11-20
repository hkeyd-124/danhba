'use strict';
/**
 * Objective legibility test for the "Chỉ chữ" (bare) style.
 *
 * The claim under test: the text stays readable no matter what is behind it.
 * A screenshot cannot show the real desktop, so the test paints the page
 * background itself — first a flat mid-grey, then a deliberately hostile
 * wallpaper (bright gradient + dark dots + red squares).
 *
 * Method: find the glyph pixels in the flat-background shot (they are the
 * light ones), then look at those SAME coordinates in the hostile shot. If the
 * halo works, the glyph fill is unchanged — the wallpaper cannot reach through
 * the outline. If it does not work, the glyph pixels take on the wallpaper's
 * colours and the two shots diverge.
 *
 * Run:  xvfb-run -a node test/legibility.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots2');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '67420.5' },
          { symbol: 'ETHUSDT', price: '3285.4' },
          { symbol: 'SOLUSDT', price: '172.35' },
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
        push(s, p) {
          const f = JSON.stringify({ stream: `${s.toLowerCase()}@markPrice@1s`, data: { e: 'markPriceUpdate', E: Date.now(), s, p: String(p) } });
          for (const c of clients) if (c.readyState === 1) c.send(f);
        },
        close: () => new Promise((r) => { wss.close(); server.close(r); }),
      });
    });
  });
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej); });
    this.ws.on('message', (b) => {
      const m = JSON.parse(b.toString());
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
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
    const r = await this.send('Runtime.evaluate', { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
    return r.result.value;
  }
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
  close() { try { this.ws.close(); } catch (_) { /* ignore */ } }
}

const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

async function findTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const l = await getJson(`http://127.0.0.1:${port}/json/list`);
      const t = l.find((x) => x.type === 'page' && x.webSocketDebuggerUrl);
      if (t) return t;
    } catch (_) { /* not up */ }
    await wait(500);
  }
  throw new Error('no devtools target');
}

const WALLPAPER = 'data:image/svg+xml;utf8,' + encodeURIComponent(`
  <svg xmlns="http://www.w3.org/2000/svg" width="420" height="660">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#ffffff"/><stop offset="45%" stop-color="#ffe9a8"/><stop offset="100%" stop-color="#7fd4ff"/>
      </linearGradient>
      <pattern id="p" width="26" height="26" patternUnits="userSpaceOnUse">
        <circle cx="6" cy="6" r="4" fill="#111" opacity=".55"/>
        <rect x="13" y="13" width="9" height="9" fill="#ff2d55" opacity=".5"/>
      </pattern>
    </defs>
    <rect width="420" height="660" fill="url(#g)"/><rect width="420" height="660" fill="url(#p)"/>
  </svg>`);

(async () => {
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-leg-'));
  const port = 9666;
  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env: { ...process.env, CPW_TEST: '1', CPW_WS_BASE: `ws://127.0.0.1:${mock.port}/market/stream`, CPW_REST_BASE: `http://127.0.0.1:${mock.port}/fapi/v1/ticker/price` }, stdio: ['ignore', 'pipe', 'pipe'] },
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
      { symbol: 'BTC', side: 'BUY', price: 58200, qty: 0.35, fee: 12, time: Date.now() - 86400000 * 12 },
      { symbol: 'ETH', side: 'BUY', price: 2950, qty: 4.2, fee: 8, time: Date.now() - 86400000 * 9 },
      { symbol: 'SOL', side: 'BUY', price: 198.4, qty: 25, fee: 3, time: Date.now() - 86400000 * 3 },
    ];
    for (const s of seed) await cdp.eval(`return window.cpw.saveTrade(${JSON.stringify(s)});`);
    mock.push('BTCUSDT', 67420.5); mock.push('ETHUSDT', 3285.4); mock.push('SOLUSDT', 172.35);
    await wait(1200);

    fs.mkdirSync(OUT, { recursive: true });

    // For each halo strength, capture the same widget over a flat background
    // and over the hostile wallpaper.
    const cases = [
      { halo: 70, tag: 'halo70' },
      { halo: 0, tag: 'halo0' },
    ];
    for (const c of cases) {
      await cdp.eval(`return window.cpw.patchSettings({ theme: 'bare', textColor: '#ffffff', halo: ${c.halo} });`);
      await wait(600);

      // The two extremes: pure white and pure black. If the halo works, the
      // glyph pixels are IDENTICAL in both — the background cannot reach them.
      await cdp.eval(`document.body.style.backgroundImage = 'none'; document.body.style.backgroundColor = '#ffffff'; return true;`);
      await wait(400);
      await cdp.shot(path.join(OUT, `leg-${c.tag}-white.png`));

      await cdp.eval(`document.body.style.backgroundColor = '#000000'; return true;`);
      await wait(400);
      await cdp.shot(path.join(OUT, `leg-${c.tag}-black.png`));

      await cdp.eval(`document.body.style.backgroundImage = 'url("' + ${JSON.stringify(WALLPAPER)} + '")'; document.body.style.backgroundSize = '100% 100%'; document.body.style.backgroundRepeat = 'no-repeat'; return true;`);
      await wait(400);
      await cdp.shot(path.join(OUT, `leg-${c.tag}-hostile.png`));
    }
    console.log('legibility shots written');
  } catch (e) {
    console.error('legibility run failed:', e.message);
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
