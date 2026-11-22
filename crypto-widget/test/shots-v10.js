'use strict';
/**
 * Visual check for v10: the three things this round is about.
 *
 *   1. the settings sheet's per-coin tick list, with real logos in it
 *   2. the collapsed strip with LDO ticked — a row of its own, tight spacing
 *   3. the text-colour picker and its contrast readout
 *
 * Assertions cannot see "the icons look blurry" or "the rows are too far
 * apart", so this captures the states and prints the measured numbers that
 * back the claims.
 *
 * Run:  xvfb-run -a node test/shots-v10.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocketServer, WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'shots-v10');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function startMock() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '96420.5' },
          { symbol: 'ETHUSDT', price: '3285.4' },
          { symbol: 'SOLUSDT', price: '172.35' },
          { symbol: 'LDOUSDT', price: '1.284' },
          { symbol: 'SUIUSDT', price: '3.412' },
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
  async shot(file) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
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

async function findTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const p = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (p) return p;
    } catch (_) { /* wait */ }
    await wait(500);
  }
  throw new Error('no devtools target');
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mock = await startMock();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-v10-'));
  const port = 9470;

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
    await cdp.send('Page.enable');
    await wait(1500);

    const seed = [
      { symbol: 'BTC', side: 'BUY', price: 88200, qty: 0.42, fee: 12, time: Date.now() - 86400000 * 12 },
      { symbol: 'ETH', side: 'BUY', price: 2950, qty: 4.2, fee: 8, time: Date.now() - 86400000 * 9 },
      { symbol: 'SOL', side: 'BUY', price: 198.4, qty: 25, fee: 3, time: Date.now() - 86400000 * 3 },
      { symbol: 'LDO', side: 'BUY', price: 1.42, qty: 900, fee: 1, time: Date.now() - 86400000 * 2 },
      { symbol: 'SUI', side: 'BUY', price: 3.9, qty: 300, fee: 1, time: Date.now() - 86400000 * 1 },
    ];
    for (const s of seed) await cdp.eval(`return window.cpw.saveTrade(${JSON.stringify(s)});`);
    mock.push('BTCUSDT', 96420.5);
    mock.push('ETHUSDT', 3285.4);
    mock.push('SOLUSDT', 172.35);
    mock.push('LDOUSDT', 1.284);
    mock.push('SUIUSDT', 3.412);
    await wait(1200);

    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'taskbar' }); return true;`);
    await wait(900);

    // ---- 1. the settings sheet, with the per-coin tick list
    // Floating + expanded: the sheet is a modal inside the window, and in
    // taskbar mode the window is only 44px tall, so the sheet would be clipped
    // to a sliver. The sheet's own layout is what this shot is for.
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'float' }); return true;`);
    await wait(600);
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(900);
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(700);
    await cdp.shot(path.join(OUT, '01-settings-sheet.png'));

    const sheet = await cdp.eval(`
      const box = document.getElementById('stripCoins');
      const labels = [...box.querySelectorAll('label.check')].map(l => l.textContent.trim());
      const imgs = [...box.querySelectorAll('img')].length;
      const r = box.getBoundingClientRect();
      return { labels, imgs, visible: !box.hidden && r.height > 0, hint: document.getElementById('stripCoinsHint').textContent };
    `);
    console.log('tick list:', JSON.stringify(sheet));

    // ---- 2. tick LDO and SUI, then look at the strip
    await cdp.eval(`
      for (const b of ['LDO','SUI']) {
        const i = document.querySelector('input[data-strip-coin="' + b + '"]');
        if (i) { i.checked = true; i.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      return true;
    `);
    await wait(1200);
    await cdp.eval(`document.querySelector('#lookModal [data-close]').click(); return true;`);
    await wait(500);
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'taskbar' }); return true;`);
    await wait(900);
    await cdp.shot(path.join(OUT, '02-strip-with-coins.png'));

    const strip = await cdp.eval(`
      const rows = [...document.querySelectorAll('.cv-coin')];
      const box = document.getElementById('cvCoins');
      const geo = rows.map(r => {
        const b = r.getBoundingClientRect();
        const img = r.querySelector('img');
        const ib = img ? img.getBoundingClientRect() : null;
        return {
          sym: r.querySelector('.cv-coin-sym').textContent,
          top: +b.top.toFixed(2), h: +b.height.toFixed(2),
          img: ib ? { w: +ib.width.toFixed(2), h: +ib.height.toFixed(2), src: img.src.slice(0, 30) } : null,
        };
      });
      const gaps = [];
      for (let i = 1; i < geo.length; i++) gaps.push(+(geo[i].top - (geo[i-1].top + geo[i-1].h)).toFixed(2));
      return { count: rows.length, hidden: box.hidden, geo, gaps,
               stripH: +document.querySelector('.collapsed-view').getBoundingClientRect().height.toFixed(2) };
    `);
    console.log('strip rows:', JSON.stringify(strip, null, 1));

    // ---- 3. the text-colour picker and its readout
    await cdp.eval(`await window.cpw.patchSettings({ dockMode: 'float' }); return true;`);
    await wait(600);
    await cdp.eval(`await window.cpw.window('expand'); return true;`);
    await wait(800);
    await cdp.eval(`document.getElementById('btnLook').click(); return true;`);
    await wait(600);
    await cdp.eval(`
      const inp = document.getElementById('colorPick');
      inp.value = '#ffd166';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    `);
    await wait(900);
    await cdp.shot(path.join(OUT, '03-text-colour.png'));

    const colour = await cdp.eval(`
      const chip = document.getElementById('contrastChip');
      const hint = document.getElementById('contrastHint');
      const cs = getComputedStyle(document.getElementById('widget'));
      return {
        chip: chip.textContent, level: chip.dataset.level, hint: hint.textContent,
        text: cs.getPropertyValue('--text').trim(),
        muted: cs.getPropertyValue('--muted').trim(),
        stored: (window.__cpwState && window.__cpwState.settings && window.__cpwState.settings.textColor) || null,
      };
    `);
    console.log('text colour:', JSON.stringify(colour));

    // ---- 4. the same colour on the light theme, where it used to fail
    await cdp.eval(`await window.cpw.patchSettings({ theme: 'light' }); return true;`);
    await wait(800);
    await cdp.shot(path.join(OUT, '04-text-colour-light.png'));
    const light = await cdp.eval(`
      const chip = document.getElementById('contrastChip');
      return { chip: chip.textContent, level: chip.dataset.level, hint: document.getElementById('contrastHint').textContent };
    `);
    console.log('light theme:', JSON.stringify(light));

    console.log('shots written to', OUT);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
    await mock.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
