'use strict';
/**
 * Focused end-to-end test for the window role.
 *
 * The main suite (test/e2e.js) covers the widget's UI. This one covers the
 * single property that makes it a widget rather than an app window: it must
 * take no taskbar slot, stay above other windows, and be switchable at
 * runtime — the bug being that Windows treated it as an ordinary application
 * and pushed it behind whatever the user opened next.
 *
 * Run:  xvfb-run -a node test/window-role.e2e.js
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { WebSocket } = require('ws');

const ROOT = path.join(__dirname, '..');
const results = [];
let failures = 0;

function check(name, cond, detail) {
  results.push({ name, ok: !!cond });
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? `  → ${detail}` : ''}`);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
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
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-role-'));
  const cdpPort = 9334;

  const child = spawn(
    path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron'),
    [ROOT, `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${userData}`, '--no-sandbox', '--disable-gpu'],
    {
      cwd: ROOT,
      // No mock feed: the role does not depend on prices, and the app simply
      // stays 'idle' when it cannot reach Binance.
      env: { ...process.env, CPW_TEST: '1' },
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
    await wait(1500);

    // ---------- 1. the window is a widget, not an app window
    const roleState = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return {
        skipTaskbar: g.skipTaskbar,
        alwaysOnTop: g.alwaysOnTop,
        widgetRole: g.widgetRole,
        visible: g.visible,
      };
    `);
    check('a widget takes no taskbar slot', roleState.skipTaskbar === true,
      JSON.stringify(roleState));
    check('a widget is always on top', roleState.alwaysOnTop === true,
      JSON.stringify(roleState));
    check('the widget role is on by default', roleState.widgetRole === true,
      JSON.stringify(roleState));
    check('the widget is visible', roleState.visible === true, JSON.stringify(roleState));

    // ---------- 2. the control reflects the stored setting
    const roleUi = await cdp.eval(`
      const btns = [...document.querySelectorAll('#roleSeg .seg-btn')];
      return {
        count: btns.length,
        active: btns.filter((b) => b.classList.contains('is-active')).map((b) => b.dataset.role),
      };
    `);
    check('the role control offers both roles', roleUi.count === 2, JSON.stringify(roleUi));
    check('the role control shows "widget" as active',
      roleUi.active.length === 1 && roleUi.active[0] === '1', JSON.stringify(roleUi));

    // ---------- 3. switching applies immediately (no restart)
    const roleSwitch = await cdp.eval(`
      const res = await window.cpw.patchSettings({ widgetRole: false });
      return { ok: res.ok, applied: res.applied, stored: res.settings.widgetRole };
    `);
    check('switching to app window is saved', roleSwitch.stored === false,
      JSON.stringify(roleSwitch));
    check('switching the role applies immediately', roleSwitch.applied === true,
      JSON.stringify(roleSwitch));

    // The applied value must actually reach the window, not just the store.
    const afterSwitch = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { skipTaskbar: g.skipTaskbar, widgetRole: g.widgetRole };
    `);
    check('an app window takes a taskbar slot again', afterSwitch.skipTaskbar === false,
      JSON.stringify(afterSwitch));

    // ---------- 4. it survives a reload
    //
    // Read it back from the UI, not from getState(): that IPC handler returns
    // `true` (it only pushes a fresh state event), so `s.settings` is
    // undefined. The active button is the real evidence anyway.
    await cdp.eval(`location.reload(); return true;`);
    await wait(1800);
    const roleAfterReload = await cdp.eval(`
      const btns = [...document.querySelectorAll('#roleSeg .seg-btn')];
      return {
        active: btns.filter((b) => b.classList.contains('is-active')).map((b) => b.dataset.role),
      };
    `);
    check('the role setting survives a reload',
      roleAfterReload.active.length === 1 && roleAfterReload.active[0] === '0',
      JSON.stringify(roleAfterReload));

    // ---------- 5. and switching back restores the widget role
    await cdp.eval(`await window.cpw.patchSettings({ widgetRole: true }); return true;`);
    await wait(500);
    const backToWidget = await cdp.eval(`
      const g = await window.cpw.testGeometry();
      return { skipTaskbar: g.skipTaskbar, widgetRole: g.widgetRole };
    `);
    check('switching back restores the widget role',
      backToWidget.skipTaskbar === true && backToWidget.widgetRole === true,
      JSON.stringify(backToWidget));

    // ---------- 6. the environment fingerprint is stable and non-empty
    //
    // This is what the 2s watcher compares to notice a taskbar resize, an edge
    // change, a resolution/DPI change or an explorer.exe restart. If it were
    // empty or changed on every call, the watcher would either never fire or
    // fire constantly.
    const envA = await cdp.eval(`const g = await window.cpw.testGeometry(); return g.envKey;`);
    await wait(600);
    const envB = await cdp.eval(`const g = await window.cpw.testGeometry(); return g.envKey;`);
    check('the environment fingerprint is populated',
      typeof envA === 'string' && envA.split(':').length >= 12, String(envA));
    check('the environment fingerprint is stable when nothing changes',
      envA === envB, `${envA} vs ${envB}`);

  } catch (err) {
    check('role e2e run completed without throwing', false, err.message);
    console.error(err);
  } finally {
    if (cdp) cdp.close();
    child.kill('SIGKILL');
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
