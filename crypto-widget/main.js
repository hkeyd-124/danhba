'use strict';
/**
 * Crypto Portfolio Widget — Electron main process.
 *
 * Security model (deliberate, and enforced here rather than promised):
 *   - The renderer has NO network access at all: no fetch, no WebSocket, and
 *     every navigation / window.open is blocked. Prices arrive over IPC.
 *   - Only this process opens a socket, and only to Binance Futures.
 *   - Data is written to one JSON file in the per-user app-data folder.
 *
 * Appearance model:
 *   - The window is created `transparent: true` once, and never recreated.
 *     Every background style (opaque, glass, see-through) is painted by CSS,
 *     so switching styles is instant and cannot lose state.
 *   - Because a transparent frameless window has no native resize border on
 *     Windows, resizing is implemented here: the renderer reports which edge
 *     the user grabbed, and this process follows the OS cursor.
 */
const { app, BrowserWindow, ipcMain, Notification, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Store } = require('./src/store');
const { PriceFeed } = require('./src/feed');
const { AlertEngine } = require('./src/alerts');
const { computePositions, normalizeSymbol, symbolsInUse } = require('./src/portfolio');

const IS_TEST = process.env.CPW_TEST === '1';
const EXPANDED = { width: 420, height: 660 };
const COLLAPSED = { width: 420, height: 108 };
/**
 * Docked ("on the taskbar") collapsed size.
 *
 * A Windows taskbar is ~48px tall, so a docked widget has to be a thin strip
 * to read as part of it. It sits flush against the taskbar's inner edge, in
 * the work area, so it never covers the taskbar's own buttons.
 */
const DOCK_COLLAPSED = { width: 300, height: 44 };
const MIN_WIDTH = 300;
const MIN_WIDTH_DOCKED = 200;
const MIN_HEIGHT_EXPANDED = 320;

let win = null;
let tray = null;
let store = null;
let feed = null;
let engine = null;
let prices = {};
let collapsed = false;
let quitting = false;

/**
 * Blur guard. Collapsing on blur is what makes the widget behave like a
 * taskbar flyout, but a blur also fires when a native dialog (confirm) or a
 * modal takes focus. The renderer raises this counter while one is open, and
 * blur is ignored while it is above zero.
 */
let blurGuard = 0;
let blurArmedAt = 0;

// resize session
let resizeTimer = null;
let resizeState = null;

// ---------------------------------------------------------------- single instance
if (!IS_TEST && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ---------------------------------------------------------------- helpers
function dataFile() {
  return path.join(app.getPath('userData'), 'portfolio.json');
}

function clampToScreen(bounds) {
  if (!bounds) return null;
  const displays = screen.getAllDisplays();
  const visible = displays.some((d) => {
    const a = d.workArea;
    return bounds.x < a.x + a.width - 40 && bounds.x + bounds.width > a.x + 40
      && bounds.y < a.y + a.height - 40 && bounds.y + bounds.height > a.y + 40;
  });
  return visible ? bounds : null;
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    width: EXPANDED.width,
    height: EXPANDED.height,
    x: workArea.x + workArea.width - EXPANDED.width - 24,
    y: workArea.y + 24,
  };
}

/**
 * Which edge of the screen the Windows taskbar is on.
 *
 * There is no API for this, but it is derivable: the taskbar is the strip of
 * the display that the work area excludes. Auto-hidden taskbars report a work
 * area equal to the full display, in which case we fall back to 'bottom' —
 * the Windows default, and the only place a docked strip still looks right.
 */
function taskbarEdge() {
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const a = d.workArea;
  if (a.y > b.y) return 'top';
  if (a.x > b.x) return 'left';
  if (a.x + a.width < b.x + b.width) return 'right';
  if (a.y + a.height < b.y + b.height) return 'bottom';
  return 'bottom';
}

/**
 * The rectangle a docked widget occupies: flush against the taskbar's inner
 * edge, inside the work area so the taskbar's own buttons stay clickable.
 *
 * The horizontal position is remembered (dockX) so the strip stays where the
 * user put it, and is clamped so it can never end up off-screen after a
 * resolution change.
 */
function dockRect(width, height, edge) {
  const { workArea: a } = screen.getPrimaryDisplay();
  const w = Math.min(Math.round(width), a.width);
  const h = Math.min(Math.round(height), a.height);

  let x = Number(store.settings.dockX);
  if (!Number.isFinite(x)) x = a.x + a.width - w - 12;
  x = Math.max(a.x, Math.min(x, a.x + a.width - w));

  let y;
  if (edge === 'top') y = a.y;
  else if (edge === 'bottom') y = a.y + a.height - h;
  else y = a.y + Math.max(0, Math.round((a.height - h) / 2));

  if (edge === 'left') x = a.x;
  if (edge === 'right') x = a.x + a.width - w;

  return { x: Math.round(x), y: Math.round(y), width: w, height: h };
}

function isDocked() {
  return store.settings.dockToTaskbar === true;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushState() {
  const { positions, totals, warnings } = computePositions(store.trades, prices);
  send('state', {
    trades: store.trades,
    alerts: store.alerts,
    settings: store.settings,
    positions,
    totals,
    warnings,
    prices,
    feedStatus: feed ? feed.status : 'idle',
    collapsed,
    docked: isDocked(),
  });
}

function refreshSymbols() {
  const syms = symbolsInUse(store.trades);
  if (feed) feed.setSymbols(syms);
  engine.setAlerts(store.alerts);
}

// ---------------------------------------------------------------- window
function createWindow() {
  const docked = isDocked();
  const saved = docked ? null : clampToScreen(store.settings.bounds);
  const b = saved || (docked
    ? dockRect(
      store.settings.collapsed ? DOCK_COLLAPSED.width : EXPANDED.width,
      store.settings.collapsed ? DOCK_COLLAPSED.height : (store.settings.expandedHeight || EXPANDED.height),
      taskbarEdge(),
    )
    : defaultBounds());

  win = new BrowserWindow({
    ...b,
    minWidth: MIN_WIDTH,
    minHeight: COLLAPSED.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: store.settings.alwaysOnTop !== false,
    skipTaskbar: false,
    show: false,
    title: 'Crypto Portfolio',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  if (store.settings.alwaysOnTop !== false) {
    win.setAlwaysOnTop(true, 'floating');
  }

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (store.settings.collapsed) setCollapsed(true, { silent: true });
    // A window that has just appeared can emit a blur before the user has
    // touched anything; ignore blur for a moment so it does not self-collapse.
    blurArmedAt = Date.now() + 500;
    pushState();
  });

  /**
   * Click-outside-to-collapse.
   *
   * This is what makes the docked widget behave like a taskbar flyout: it is
   * only expanded while it has the user's attention. It is scoped to dock mode
   * on purpose — a free-floating widget that folded itself away whenever the
   * user clicked another window would be a regression, not a feature.
   *
   * Guarded so a native dialog or an open modal does not fold it away
   * underneath the user.
   */
  win.on('blur', () => {
    if (!isDocked()) return;
    if (!store.settings.collapseOnBlur) return;
    if (blurGuard > 0) return;
    if (Date.now() < blurArmedAt) return;
    if (collapsed) return;
    setCollapsed(true);
  });

  // --- lock the renderer down: no navigation, no popups, no new web contents
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  win.on('close', (e) => {
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on('closed', () => { win = null; });

  const persistBounds = () => {
    if (!win || win.isDestroyed()) return;
    const { x, y, width, height } = win.getBounds();
    if (isDocked()) {
      // In dock mode the vertical position is derived from the taskbar, so
      // only the horizontal offset and the panel size are worth remembering.
      store.patchSettings({ dockX: x });
      if (!collapsed) store.patchSettings({ expandedHeight: height, dockWidth: width });
      return;
    }
    if (collapsed) return;
    store.patchSettings({ bounds: { x, y, width, height } });
  };
  win.on('moved', persistBounds);
  win.on('resized', persistBounds);
}

function setCollapsed(next, opts = {}) {
  if (!win || win.isDestroyed()) return;
  const wasCollapsed = collapsed;
  collapsed = !!next;
  const b = win.getBounds();

  if (collapsed && !wasCollapsed && !isDocked()) {
    // Remember the expanded height so expanding restores what the user chose.
    // In dock mode this must NOT run: the current height is the 44px strip,
    // and saving it would make the panel reopen as a 44px sliver.
    store.patchSettings({ expandedHeight: b.height });
  }

  if (isDocked()) {
    applyDockBounds();
  } else {
    const height = collapsed
      ? COLLAPSED.height
      : Math.max(MIN_HEIGHT_EXPANDED, store.settings.expandedHeight || EXPANDED.height);

    win.setMinimumSize(MIN_WIDTH, collapsed ? COLLAPSED.height : MIN_HEIGHT_EXPANDED);
    win.setBounds({ x: b.x, y: b.y, width: Math.max(MIN_WIDTH, b.width), height }, true);
  }

  if (!opts.silent) store.patchSettings({ collapsed });
  send('collapsed', collapsed);
  pushState();
}

/**
 * Place the window for dock mode.
 *
 * Collapsed: a thin strip flush against the taskbar's inner edge.
 * Expanded: the full widget, anchored to the same edge so it grows AWAY from
 * the taskbar (upward for a bottom taskbar) instead of covering it.
 *
 * The expanded width is the user's own resized width, remembered separately
 * from the strip's width so resizing the panel does not stretch the strip.
 */
function applyDockBounds() {
  if (!win || win.isDestroyed()) return;
  const edge = taskbarEdge();

  if (collapsed) {
    const r = dockRect(DOCK_COLLAPSED.width, DOCK_COLLAPSED.height, edge);
    win.setMinimumSize(MIN_WIDTH_DOCKED, DOCK_COLLAPSED.height);
    win.setBounds(r, true);
    return;
  }

  const { workArea: a } = screen.getPrimaryDisplay();
  const width = Math.max(MIN_WIDTH, Math.min(
    Number(store.settings.dockWidth) || EXPANDED.width,
    a.width,
  ));
  const height = Math.max(MIN_HEIGHT_EXPANDED, Math.min(
    Number(store.settings.expandedHeight) || EXPANDED.height,
    a.height,
  ));

  let x = Number(store.settings.dockX);
  if (!Number.isFinite(x)) x = a.x + a.width - width - 12;
  x = Math.max(a.x, Math.min(x, a.x + a.width - width));

  let y;
  if (edge === 'top') y = a.y;
  else if (edge === 'bottom') y = a.y + a.height - height;
  else y = a.y + Math.max(0, Math.round((a.height - height) / 2));

  win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT_EXPANDED);
  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height }, true);
}

// ---------------------------------------------------------------- resize
/**
 * A transparent frameless window has no native resize border on Windows, so
 * the renderer draws 8 invisible grab strips and tells us which one is held.
 * We then follow the OS cursor here — one timer, no IPC per mouse move.
 */
function applyResize() {
  if (!win || win.isDestroyed() || !resizeState) return;
  const cur = screen.getCursorScreenPoint();
  const dx = cur.x - resizeState.cursor.x;
  const dy = cur.y - resizeState.cursor.y;
  const s = resizeState.start;
  const edge = resizeState.edge;

  let x = s.x;
  let y = s.y;
  let width = s.width;
  let height = s.height;

  const minH = collapsed
    ? (isDocked() ? DOCK_COLLAPSED.height : COLLAPSED.height)
    : MIN_HEIGHT_EXPANDED;
  const minW = collapsed && isDocked() ? MIN_WIDTH_DOCKED : MIN_WIDTH;

  if (edge.includes('e')) width = s.width + dx;
  if (edge.includes('s')) height = s.height + dy;
  if (edge.includes('w')) { width = s.width - dx; x = s.x + dx; }
  if (edge.includes('n')) { height = s.height - dy; y = s.y + dy; }

  if (width < minW) {
    if (edge.includes('w')) x = s.x + s.width - minW;
    width = minW;
  }
  if (height < minH) {
    if (edge.includes('n')) y = s.y + s.height - minH;
    height = minH;
  }

  win.setBounds({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  });
}

function stopResize(persist) {
  if (resizeTimer) { clearInterval(resizeTimer); resizeTimer = null; }
  resizeState = null;
  if (persist && win && !win.isDestroyed() && !collapsed) {
    const { x, y, width, height } = win.getBounds();
    if (isDocked()) {
      store.patchSettings({ dockX: x, dockWidth: width, expandedHeight: height });
    } else {
      store.patchSettings({ bounds: { x, y, width, height } });
    }
  }
}

// ---------------------------------------------------------------- tray
function createTray() {
  const iconPath = path.join(__dirname, 'build', 'tray.png');
  let img = nativeImage.createFromPath(iconPath);
  if (img.isEmpty()) img = nativeImage.createEmpty();
  try {
    tray = new Tray(img);
  } catch (_) {
    tray = null;
    return;
  }
  tray.setToolTip('Crypto Portfolio');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Hiện / Ẩn', click: () => (win && win.isVisible() ? win.hide() : win && win.show()) },
    { label: 'Ghim trên thanh taskbar', type: 'checkbox', checked: isDocked(),
      click: (item) => setDockMode(item.checked) },
    { label: 'Luôn nổi trên cùng', type: 'checkbox', checked: store.settings.alwaysOnTop !== false,
      click: (item) => { store.patchSettings({ alwaysOnTop: item.checked }); if (win) win.setAlwaysOnTop(item.checked, 'floating'); pushState(); } },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
}

/**
 * Switch between the free-floating widget and the taskbar-docked strip.
 *
 * Docking is a placement mode, not a second window: the same window is moved
 * and resized, so no state, no socket and no scroll position is lost.
 */
function setDockMode(on) {
  if (!win || win.isDestroyed()) return;
  const next = !!on;
  if (next === isDocked()) return;

  if (next) {
    // Leaving free mode: remember where the floating widget was, so turning
    // docking off puts it back exactly there.
    if (!collapsed) {
      const b = win.getBounds();
      store.patchSettings({ bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    }
    store.patchSettings({ dockToTaskbar: true });
    // A docked widget is a taskbar strip: it starts collapsed, and it must be
    // on top or the taskbar itself would cover it.
    collapsed = true;
    store.patchSettings({ collapsed: true });
    win.setAlwaysOnTop(true, 'floating');
    applyDockBounds();
  } else {
    store.patchSettings({ dockToTaskbar: false });
    const saved = clampToScreen(store.settings.bounds) || defaultBounds();
    collapsed = false;
    store.patchSettings({ collapsed: false });
    win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT_EXPANDED);
    win.setBounds(saved, true);
  }

  send('collapsed', collapsed);
  pushState();
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Hiện / Ẩn', click: () => (win && win.isVisible() ? win.hide() : win && win.show()) },
    { label: 'Ghim trên thanh taskbar', type: 'checkbox', checked: isDocked(),
      click: (item) => setDockMode(item.checked) },
    { label: 'Luôn nổi trên cùng', type: 'checkbox', checked: store.settings.alwaysOnTop !== false,
      click: (item) => { store.patchSettings({ alwaysOnTop: item.checked }); if (win) win.setAlwaysOnTop(item.checked, 'floating'); pushState(); } },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ]));
}

// ---------------------------------------------------------------- notifications
function fireNotification(payload) {
  const base = payload.symbol.replace(/(USDT|USDC|BUSD)$/, '');
  const dirText = payload.direction === 'above' ? 'vượt lên trên' : 'giảm xuống dưới';
  const title = `⚡ ${base} ${dirText} ${fmt(payload.level)}`;
  const body = `Giá hiện tại: ${fmt(payload.price)} USDT${payload.note ? `\n${payload.note}` : ''}`;

  if (Notification.isSupported()) {
    const n = new Notification({
      title,
      body,
      silent: store.settings.sound === false,
      urgency: 'critical',
      timeoutType: 'never',
    });
    n.on('click', () => { if (win) { win.show(); win.focus(); } });
    n.show();
  }
  // Windows system beep as an extra audible cue (notification sound can be muted by Focus Assist).
  if (store.settings.sound !== false) {
    try { shell.beep(); } catch (_) { /* ignore */ }
  }
  send('alert-fired', payload);
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return v.toPrecision(4);
}

// ---------------------------------------------------------------- IPC
function registerIpc() {
  ipcMain.handle('get-state', () => {
    pushState();
    return true;
  });

  ipcMain.handle('save-trade', (_e, input) => {
    const t = input || {};
    const symbol = normalizeSymbol(t.symbol);
    if (!symbol) return { ok: false, error: 'Chưa nhập đồng coin.' };
    const price = Number(t.price);
    const qty = Number(t.qty);
    const fee = Number(t.fee || 0);
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Giá vào phải lớn hơn 0.' };
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: 'Số lượng phải lớn hơn 0.' };
    if (!Number.isFinite(fee) || fee < 0) return { ok: false, error: 'Phí không hợp lệ.' };

    const trade = {
      id: t.id || crypto.randomUUID(),
      symbol,
      side: String(t.side).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      price,
      qty,
      fee,
      time: Number(t.time) || Date.now(),
      note: String(t.note || '').slice(0, 200),
    };
    store.upsertTrade(trade);
    refreshSymbols();
    pushState();
    return { ok: true, trade };
  });

  ipcMain.handle('delete-trade', (_e, id) => {
    const ok = store.deleteTrade(id);
    refreshSymbols();
    pushState();
    return { ok };
  });

  ipcMain.handle('save-alert', (_e, input) => {
    const a = input || {};
    const symbol = normalizeSymbol(a.symbol);
    const price = Number(a.price);
    if (!symbol) return { ok: false, error: 'Chưa nhập đồng coin.' };
    if (!Number.isFinite(price) || price <= 0) return { ok: false, error: 'Ngưỡng giá phải lớn hơn 0.' };
    const alert = {
      id: a.id || crypto.randomUUID(),
      symbol,
      price,
      direction: a.direction === 'below' ? 'below' : 'above',
      note: String(a.note || '').slice(0, 120),
      enabled: a.enabled !== false,
      createdAt: a.createdAt || Date.now(),
    };
    store.upsertAlert(alert);
    engine.setAlerts(store.alerts);
    engine.resetCooldown(alert.id);
    pushState();
    return { ok: true, alert };
  });

  ipcMain.handle('delete-alert', (_e, id) => {
    const ok = store.deleteAlert(id);
    engine.setAlerts(store.alerts);
    pushState();
    return { ok };
  });

  ipcMain.handle('toggle-alert', (_e, { id, enabled }) => {
    const a = store.alerts.find((x) => x.id === id);
    if (!a) return { ok: false };
    store.upsertAlert({ ...a, enabled: !!enabled });
    engine.setAlerts(store.alerts);
    pushState();
    return { ok: true };
  });

  ipcMain.handle('test-alert', () => {
    fireNotification({ symbol: 'BTCUSDT', direction: 'above', level: 100000, price: 100123.45, note: 'Thông báo thử' });
    return { ok: true };
  });

  ipcMain.handle('patch-settings', (_e, patch) => {
    const p = patch || {};
    const allowed = {};
    if (typeof p.alwaysOnTop === 'boolean') {
      allowed.alwaysOnTop = p.alwaysOnTop;
      if (win) win.setAlwaysOnTop(p.alwaysOnTop, 'floating');
    }
    if (typeof p.sound === 'boolean') allowed.sound = p.sound;
    if (typeof p.theme === 'string') allowed.theme = p.theme;
    if (typeof p.textColor === 'string') allowed.textColor = p.textColor;
    if (typeof p.bgAlpha === 'number' && Number.isFinite(p.bgAlpha)) {
      allowed.bgAlpha = Math.min(1, Math.max(0, p.bgAlpha));
    }
    if (typeof p.halo === 'number' && Number.isFinite(p.halo)) {
      allowed.halo = Math.min(100, Math.max(0, Math.round(p.halo)));
    }
    if (typeof p.collapseOnBlur === 'boolean') allowed.collapseOnBlur = p.collapseOnBlur;
    if (typeof p.dockToTaskbar === 'boolean') {
      store.patchSettings(allowed);
      setDockMode(p.dockToTaskbar);
      return { ok: true, settings: store.settings };
    }
    store.patchSettings(allowed);
    pushState();
    return { ok: true, settings: store.settings };
  });

  /**
   * Blur guard, raised by the renderer while a modal or a native confirm is
   * open. Without it, opening a dialog would blur the window and fold the
   * widget away underneath the user.
   */
  ipcMain.handle('blur-guard', (_e, on) => {
    blurGuard = Math.max(0, blurGuard + (on ? 1 : -1));
    return { ok: true, guard: blurGuard };
  });

  /**
   * Test-only hook, registered ONLY when CPW_TEST=1.
   *
   * The sandbox has no window manager, so no OS focus change ever happens and
   * `win.on('blur')` cannot be exercised by clicking elsewhere. This lets the
   * test fire the exact same handler the OS would fire, so the collapse-
   * on-blur rules are actually covered instead of assumed.
   */
  if (IS_TEST) {
    ipcMain.handle('test-blur', () => {
      if (!win || win.isDestroyed()) return { ok: false };
      win.emit('blur');
      return { ok: true, collapsed, guard: blurGuard };
    });
  }

  ipcMain.handle('window', (_e, action) => {
    if (!win) return { ok: false };
    switch (action) {
      case 'collapse': setCollapsed(!collapsed); break;
      case 'expand': setCollapsed(false); break;
      case 'minimize': win.minimize(); break;
      case 'hide': win.hide(); break;
      case 'close': quitting = true; app.quit(); break;
      case 'pin': {
        const next = !win.isAlwaysOnTop();
        win.setAlwaysOnTop(next, 'floating');
        store.patchSettings({ alwaysOnTop: next });
        pushState();
        break;
      }
      case 'reset-size': {
        if (isDocked()) {
          store.patchSettings({ dockWidth: EXPANDED.width, expandedHeight: EXPANDED.height });
          applyDockBounds();
          break;
        }
        const b = win.getBounds();
        const height = collapsed ? COLLAPSED.height : EXPANDED.height;
        win.setBounds({ x: b.x, y: b.y, width: EXPANDED.width, height }, true);
        if (!collapsed) store.patchSettings({ bounds: { x: b.x, y: b.y, width: EXPANDED.width, height } });
        break;
      }
      case 'dock': setDockMode(!isDocked()); break;
      default: break;
    }
    return { ok: true, collapsed };
  });

  ipcMain.handle('resize-start', (_e, edge) => {
    if (!win || win.isDestroyed()) return { ok: false };
    stopResize(false);
    resizeState = {
      edge: String(edge || 'se'),
      start: win.getBounds(),
      cursor: screen.getCursorScreenPoint(),
    };
    resizeTimer = setInterval(applyResize, 16);
    return { ok: true };
  });

  ipcMain.handle('resize-end', () => {
    stopResize(true);
    return { ok: true };
  });

  ipcMain.handle('open-data-folder', () => {
    shell.showItemInFolder(dataFile());
    return { ok: true, path: dataFile() };
  });
}

// ---------------------------------------------------------------- boot
/**
 * The icons are generated from source (build/make-icons.js) rather than
 * committed as binaries. Regenerate them if they are missing, so a fresh
 * clone runs without any extra step.
 */
function ensureIcons() {
  const iconPath = path.join(__dirname, 'build', 'icon.png');
  const trayPath = path.join(__dirname, 'build', 'tray.png');
  if (fs.existsSync(iconPath) && fs.existsSync(trayPath)) return;
  try {
    require('./build/make-icons.js');
  } catch (err) {
    console.error('[main] could not generate icons:', err.message);
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('com.hkeyd.cryptoportfoliowidget');
  ensureIcons();

  store = new Store(dataFile());
  store.load();

  feed = new PriceFeed({
    wsBase: process.env.CPW_WS_BASE || undefined,
    restBase: process.env.CPW_REST_BASE || undefined,
  });
  engine = new AlertEngine();

  feed.on('price', ({ symbol, price }) => {
    prices[symbol] = price;
    engine.onPrice(symbol, price);
    send('prices', { symbol, price, prices });
  });
  feed.on('status', (s) => send('feed-status', s));
  feed.on('error', (err) => {
    if (process.env.CPW_DEBUG) console.error('[feed]', err.message);
  });
  engine.on('trigger', fireNotification);

  registerIpc();
  createWindow();
  createTray();
  refreshSymbols();
  feed.start();

  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('before-quit', () => {
  quitting = true;
  stopResize(false);
  if (store) store.flush();
  if (feed) feed.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Never let a stray unhandled rejection kill the widget.
process.on('uncaughtException', (err) => {
  console.error('[main] uncaught', err);
});
