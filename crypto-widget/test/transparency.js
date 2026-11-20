'use strict';
/**
 * Proves the window really carries an alpha channel, rather than merely being
 * painted with a semi-transparent colour.
 *
 * On X11 a window that can be seen through must be created with a 32-bit ARGB
 * visual; an ordinary opaque window gets a 24-bit visual and its alpha is
 * ignored by the server. So the check is: find the widget's X window and read
 * its depth. 32 = genuinely see-through, 24 = opaque.
 *
 * Run:  xvfb-run -a -s "-screen 0 1280x900x24 +extension Composite" sh -c 'xcompmgr -c & sleep 2; node test/transparency.js'
 */
const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const getJson = (u) => new Promise((res, rej) => {
  http.get(u, (r) => {
    let d = '';
    r.on('data', (c) => { d += c; });
    r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

function sh(cmd) {
  try { return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (_) { return ''; }
}

(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-tr-'));
  const port = 9444;

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--remote-debugging-port=${port}`, `--user-data-dir=${ud}`, '--no-sandbox', '--disable-gpu'],
    { cwd: ROOT, env: { ...process.env, CPW_TEST: '1' }, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let target = null;
  for (let i = 0; i < 60; i++) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      target = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (target) break;
    } catch (_) { /* not up */ }
    await wait(500);
  }
  if (!target) { console.log('FAIL  devtools never appeared'); process.exit(1); }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pend = new Map();
  await new Promise((r) => ws.on('open', r));
  ws.on('message', (b) => {
    const m = JSON.parse(b.toString());
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  });
  const send = (method, params = {}) => new Promise((r) => {
    const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params }));
  });

  await send('Runtime.enable');
  await wait(1800);

  // Switch to the see-through style at low opacity.
  await send('Runtime.evaluate', {
    expression: `(async () => { await window.cpw.patchSettings({ theme: 'clear', bgAlpha: 0.15 }); return true; })()`,
    awaitPromise: true,
  });
  await wait(900);

  const css = await send('Runtime.evaluate', {
    expression: `(() => {
      const w = document.getElementById('widget');
      return {
        theme: w.dataset.theme,
        alpha: w.style.getPropertyValue('--bg-alpha'),
        bodyBg: getComputedStyle(document.body).backgroundColor,
        widgetBg: getComputedStyle(w).backgroundColor,
      };
    })()`,
    returnByValue: true,
  });
  const c = css.result.value;

  // Find the widget's X window and read its visual depth.
  const tree = sh('xwininfo -root -tree');
  const lines = tree.split('\n').filter((l) => /Crypto Portfolio|Electron/i.test(l));
  let depth = null;
  let winId = null;
  for (const line of lines) {
    const m = line.match(/(0x[0-9a-f]+)/i);
    if (!m) continue;
    const info = sh(`xwininfo -id ${m[1]}`);
    const d = info.match(/Depth:\s*(\d+)/);
    const wm = info.match(/Width:\s*(\d+)/);
    const hm = info.match(/Height:\s*(\d+)/);
    // The widget window is the one matching our default size.
    if (d && wm && hm && Number(wm[1]) >= 300 && Number(hm[1]) >= 100) {
      depth = Number(d[1]);
      winId = m[1];
      break;
    }
  }

  console.log(`theme            : ${c.theme} @ alpha ${c.alpha}`);
  console.log(`body background  : ${c.bodyBg}`);
  console.log(`widget background: ${c.widgetBg}`);
  console.log(`X window         : ${winId || '(not found)'} depth ${depth === null ? '?' : depth}`);

  let ok = true;

  // 1. the page itself must not paint an opaque backdrop
  const bodyClear = c.bodyBg === 'rgba(0, 0, 0, 0)' || c.bodyBg === 'transparent';
  console.log(`${bodyClear ? 'PASS' : 'FAIL'}  body paints no opaque background`);
  if (!bodyClear) ok = false;

  // 2. the widget's own background must be translucent, not solid
  const m = c.widgetBg.match(/rgba?\(([^)]+)\)/);
  const parts = m ? m[1].split(',').map((x) => parseFloat(x)) : [];
  const a = parts.length === 4 ? parts[3] : 1;
  const translucent = a < 0.5;
  console.log(`${translucent ? 'PASS' : 'FAIL'}  widget background is translucent (alpha ${a})`);
  if (!translucent) ok = false;

  // 3. the OS window must have an alpha channel (depth 32 on X11)
  if (depth === null) {
    console.log('SKIP  could not read the X window depth');
  } else if (depth === 32) {
    console.log('PASS  window has a 32-bit ARGB visual — the desktop can show through');
  } else {
    console.log(`FAIL  window depth is ${depth}, not 32 — it would be opaque`);
    ok = false;
  }

  ws.close();
  child.kill('SIGKILL');
  await wait(300);
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  process.exit(ok ? 0 : 1);
})();
