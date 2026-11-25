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
 *
 * Placement model — three modes, one window:
 *   'float'   free-floating panel.
 *   'edge'    thin strip flush against the taskbar's INNER edge, inside the
 *             work area, so the taskbar's own buttons stay clickable.
 *   'taskbar' the strip is drawn INSIDE the taskbar's rectangle, in the same
 *             row as the taskbar icons.
 *
 *   Windows has no public API to embed a foreign window into the taskbar:
 *   the taskbar is a window owned by explorer.exe, and there is no supported
 *   way to make another process's window a child of it. So 'taskbar' is an
 *   overlay placed exactly over the taskbar's rectangle, at the taskbar's
 *   height, raised above it in z-order. It looks and behaves like a taskbar
 *   element; it is not one. The limits that follow from that are documented
 *   in README.md and surfaced in the UI.
 */
const { app, BrowserWindow, ipcMain, Notification, shell, Tray, Menu, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { Store } = require('./src/store');
const { PriceFeed } = require('./src/feed');
const { AlertEngine } = require('./src/alerts');
const { computePositions, normalizeSymbol, symbolsInUse } = require('./src/portfolio');
const role = require('./src/window-role');
const dockSize = require('./src/dock-size');
const display = require('./src/display');
const { badgeFor, glyphColor } = require('./src/coin-icon');
const textColor = require('./src/text-color');
const { KlineCache } = require('./src/klines');
const futures = require('./src/futures');

const IS_TEST = process.env.CPW_TEST === '1';
const EXPANDED = { width: 420, height: 660 };
const COLLAPSED = { width: 420, height: 108 };

/**
 * Docked strip size.
 *
 * A Windows taskbar is ~48px tall, so a docked widget has to be a thin strip
 * to read as part of it. The height is clamped to the real taskbar height at
 * placement time, so a 40px taskbar does not get a 44px strip hanging out of
 * it.
 */
const DOCK_COLLAPSED = { width: 300, height: 44 };
const MIN_WIDTH = 300;
const MIN_WIDTH_DOCKED = 200;
const MIN_HEIGHT_EXPANDED = 320;

/** Placement modes. 'float' is the only one that is not docked. */
const DOCK_MODES = ['float', 'edge', 'taskbar'];

/**
 * How often the environment is re-checked.
 *
 * Windows gives no event for "the taskbar moved", "the taskbar was resized",
 * "explorer.exe restarted" or "the DPI changed on this monitor". The only
 * reliable way to follow the taskbar is to re-measure it and compare. 2s is
 * fast enough that a taskbar resize looks instant and slow enough to cost
 * nothing (it is one arithmetic pass over the display metrics).
 */
const ENV_POLL_MS = 2000;

/**
 * How often the portfolio value is sampled for the chart.
 *
 * 5s with a 4s minimum gap: fast enough that the chart is alive within a few
 * seconds of opening the app, slow enough that 720 samples cover an hour
 * without the file growing.
 */
const HISTORY_INTERVAL_MS = 5000;

let win = null;
let tray = null;
let store = null;
let feed = null;
let engine = null;
let prices = {};
let collapsed = false;
let quitting = false;
let historyTimer = null;
let klines = null;
let klineTimer = null;

/**
 * Blur guard. Collapsing on blur is what makes the widget behave like a
 * taskbar flyout, but a blur also fires when a native dialog (confirm) or a
 * modal takes focus. The renderer raises this counter while one is open, and
 * blur is ignored while it is above zero.
 */
let blurGuard = 0;
let blurArmedAt = 0;

/**
 * True when the USER hid the widget (tray menu, or the window's own hide
 * action). The environment watcher must not undo that, but it must undo a hide
 * that Windows performed on its own.
 */
let userHidden = false;

/**
 * True once the window has painted for the first time.
 *
 * The environment watcher re-shows a window that Windows hid, but it must not
 * do that before the first paint: `showInactive()` on a window that has not
 * finished loading shows an empty rectangle.
 */
let windowReady = false;

/**
 * The last value passed to setSkipTaskbar.
 *
 * Electron has no `isSkipTaskbar()` getter, so the applied value is tracked
 * here. Without it the test hook could only report `null` and the assertion
 * that a widget takes no taskbar slot would be untestable.
 */
let skipTaskbarApplied = null;

// environment watcher
let envTimer = null;
let lastEnvKey = '';

/**
 * When the last placement was applied by us rather than by the user.
 *
 * `moved` fires for our own `setBounds` calls too, so without this the
 * placement code would immediately persist its own derived position as if the
 * user had dragged the strip there — turning a derived anchor into a fixed
 * one, and pinning the widget to a stale x after a resolution change.
 */
let boundsAppliedAt = 0;

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
 * The taskbar's own rectangle, in screen coordinates.
 *
 * It is the part of the display that the work area excludes. When the taskbar
 * is auto-hidden the work area equals the display and there is nothing to
 * measure, so a nominal 48px strip at the bottom edge is assumed — the same
 * fallback `taskbarEdge()` uses, and the only place an overlay can sit without
 * covering anything.
 */
function taskbarRect() {
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const a = d.workArea;
  const edge = taskbarEdge();

  if (edge === 'bottom') {
    const h = b.y + b.height - (a.y + a.height);
    return h >= 24
      ? { x: b.x, y: a.y + a.height, width: b.width, height: h, edge }
      : { x: b.x, y: b.y + b.height - 48, width: b.width, height: 48, edge };
  }
  if (edge === 'top') {
    const h = a.y - b.y;
    return h >= 24
      ? { x: b.x, y: b.y, width: b.width, height: h, edge }
      : { x: b.x, y: b.y, width: b.width, height: 48, edge };
  }
  if (edge === 'left') {
    const w = a.x - b.x;
    return { x: b.x, y: b.y, width: w >= 24 ? w : 48, height: b.height, edge };
  }
  const w = b.x + b.width - (a.x + a.width);
  return { x: a.x + a.width, y: b.y, width: w >= 24 ? w : 48, height: b.height, edge };
}

/**
 * The rectangle a docked widget occupies in 'edge' mode: flush against the
 * taskbar's inner edge, inside the work area so the taskbar's own buttons stay
 * clickable.
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

/**
 * The strip rectangle for 'taskbar' mode: inside the taskbar's own rectangle,
 * vertically centred in it, at the taskbar's height.
 *
 * Only a horizontal taskbar (top or bottom) can host a horizontal strip. A
 * vertical taskbar is ~48px WIDE, so a 300px strip cannot fit in it at all;
 * in that case the caller falls back to 'edge' placement rather than drawing
 * something that covers half the screen.
 */
function taskbarStripRect() {
  const tb = taskbarRect();
  const horizontal = tb.edge === 'bottom' || tb.edge === 'top';
  if (!horizontal) return null;

  /**
   * The strip grows downward when the user ticks coins.
   *
   * The summary line is one 13px line; each ticked coin adds another. The
   * height is capped by the taskbar's own rectangle, because the strip is an
   * overlay INSIDE it — a strip taller than the taskbar would hang out over
   * the desktop and stop reading as part of the taskbar.
   *
   * `stripHeightFor` does the arithmetic and the clamping; this only supplies
   * the limit. With no coins ticked it returns the 44px every earlier version
   * used, so an existing install is unchanged.
   */
  const rows = display.stripCoinRows(computePositions(store.trades, prices).positions,
    store.settings.stripCoins).length;
  const limit = Math.max(display.STRIP_MIN_H, tb.height - 4);
  const h = display.stripHeightFor(rows, limit);

  // The strip has its OWN width setting. Reading `dockWidth` here is what made
  // a dragged strip snap back: the panel's width is a different number, and
  // resizing the panel would silently resize the strip too.
  const w = Math.min(dockSize.stripWidth(store.settings), tb.width);

  let x = Number(store.settings.dockX);
  if (!Number.isFinite(x)) x = tb.x + tb.width - w - 12;
  x = Math.max(tb.x, Math.min(x, tb.x + tb.width - w));

  const y = tb.y + Math.round((tb.height - h) / 2);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
}

/**
 * The expanded panel, anchored to the taskbar edge so it grows away from it.
 *
 * The anchor is the TASKBAR's rectangle, not the work area. They are the same
 * when the taskbar is visible, but they are NOT when it is auto-hidden: the
 * work area then equals the whole display, so anchoring to it put the panel's
 * bottom edge at the screen bottom — on top of the taskbar, which is exactly
 * what this mode exists to avoid. The e2e test caught that (panel bottom 1024,
 * taskbar top 976).
 */
function dockPanelRect() {
  const { workArea: a } = screen.getPrimaryDisplay();
  const tb = taskbarRect();
  const edge = tb.edge;
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
  if (edge === 'top') y = tb.y + tb.height;
  else if (edge === 'bottom') y = tb.y - height;
  else y = a.y + Math.max(0, Math.round((a.height - height) / 2));

  // Never let the panel run off the top of the screen on a short display.
  y = Math.max(a.y, y);

  return { x: Math.round(x), y: Math.round(y), width, height };
}

function dockMode() {
  const m = store.settings.dockMode;
  return DOCK_MODES.includes(m) ? m : 'float';
}

function isDocked() {
  return dockMode() !== 'float';
}

function isInTaskbar() {
  return dockMode() === 'taskbar';
}

/**
 * Where the window should be, for the current mode and collapsed state.
 *
 * 'taskbar' degrades to 'edge' on a vertical taskbar: there is physically no
 * room for a horizontal strip inside a 48px-wide column.
 */
function placementBounds() {
  const mode = dockMode();
  if (mode === 'float') return clampToScreen(store.settings.bounds) || defaultBounds();

  if (mode === 'taskbar' && !collapsed) return dockPanelRect();
  if (mode === 'taskbar' && collapsed) {
    const r = taskbarStripRect();
    if (r) return r;
  }
  return collapsed
    ? dockRect(DOCK_COLLAPSED.width, stripHeight(), taskbarEdge())
    : dockPanelRect();
}

/**
 * The collapsed strip's height, for the current selection.
 *
 * In 'edge' mode the strip is not confined to the taskbar, so the only limit
 * is the work area — a strip with eight coins ticked is allowed to be tall.
 * In 'taskbar' mode `taskbarStripRect` clamps it to the taskbar's own height
 * instead, because there it is an overlay inside that rectangle.
 */
function stripHeight() {
  const positions = computePositions(store.trades, prices).positions;
  const rows = display.stripCoinRows(positions, store.settings.stripCoins).length;
  /**
   * Futures rows count toward the strip's height.
   *
   * They are drawn in the same column as the coin rows, so a strip sized for
   * the coins alone would clip them. The count comes from the same
   * `stripRows` call the renderer paints, so the box and its contents cannot
   * disagree.
   */
  const fut = futures.computeFutures(store.futures, prices);
  const futRows = futures.stripRows(fut.totals, {
    pnl: store.settings.futPinPnl,
    liq: store.settings.futPinLiq,
  }).length;
  const { workArea: a } = screen.getPrimaryDisplay();
  return display.stripHeightFor(rows + futRows, a.height);
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function pushState() {
  const { positions, totals, warnings } = computePositions(store.trades, prices);

  /**
   * Coin badges are computed here, not in the renderer.
   *
   * The renderer is sandboxed and has no `require`, so it cannot reach
   * src/coin-icon.js. Sending the badge with each position keeps the colour
   * table in one place and means the renderer only has to paint what it is
   * given — no second copy of the brand colours to drift out of sync.
   */
  const badges = {};
  for (const p of positions) {
    const b = badgeFor(p.symbol);
    badges[p.symbol] = { ...b, ink: glyphColor(b.color) };
  }

  /**
   * The strip's coin rows are resolved HERE, once.
   *
   * `src/display.js` owns the rule (which ticked coins get a row, in what
   * order, capped at STRIP_MAX_ROWS) and the window height is derived from the
   * same call. The renderer used to re-implement that rule to decide what to
   * paint, which meant two copies of it: the height could be computed for
   * three rows while the renderer drew two, and nothing would report the
   * mismatch. Sending the resolved rows removes the second copy.
   */
  const stripRows = display.stripCoinRows(positions, store.settings.stripCoins);

  /**
   * Demo futures, marked to the same prices as the spot book.
   *
   * Computed here for the same reason the badges are: the renderer is
   * sandboxed and cannot `require` src/futures.js, and the liquidation price is
   * a number the user acts on — it must come from one function, not from a
   * second copy in the renderer that could drift.
   */
  const fut = futures.computeFutures(store.futures, prices);
  const futRows = futures.stripRows(fut.totals, {
    pnl: store.settings.futPinPnl,
    liq: store.settings.futPinLiq,
  });

  /**
   * The derived text tones travel with the state.
   *
   * They depend on the text colour AND the theme, and the theme can change
   * without the colour changing, so the renderer cannot cache them. Computing
   * them here also means the settings sheet's contrast readout and the painted
   * colours come from the same function.
   */
  const theme = store.settings.theme || 'solid';
  const chosen = store.settings.textColor || textColor.DEFAULT_TEXT;
  const halo = textColor.haloFor(chosen);
  const tones = {
    text: textColor.normalizeHex(chosen) || textColor.DEFAULT_TEXT,
    muted: textColor.mutedFor(chosen, theme, halo),
    faint: textColor.faintFor(chosen, theme, halo),
    halo,
    judge: textColor.judge(chosen, theme, store.settings.bgAlpha),
  };

  send('state', {
    trades: store.trades,
    alerts: store.alerts,
    settings: store.settings,
    positions,
    stripRows,
    totals,
    warnings,
    prices,
    badges,
    tones,
    history: store.history,
    futures: fut.positions,
    futuresTotals: fut.totals,
    futuresRows: futRows,
    klines: klines ? klines.snapshot() : {},
    feedStatus: feed ? feed.status : 'idle',
    collapsed,
    docked: isDocked(),
    dockMode: dockMode(),
  });
}

function refreshSymbols() {
  const syms = symbolsInUse(store.trades);
  /**
   * Futures symbols are priced too.
   *
   * A demo position on a coin the spot portfolio does not hold would otherwise
   * have no mark price at all, and its PnL would sit at zero forever. Merged
   * into the same list rather than a second feed: one subscription, one
   * outbound connection, which is the security promise this app makes.
   */
  for (const f of store.futures) {
    if (f && f.symbol && !syms.includes(f.symbol)) syms.push(f.symbol);
  }
  if (feed) feed.setSymbols(syms);
  engine.setAlerts(store.alerts);
  // Candles follow the same symbol list as the price feed: one definition of
  // "the coins this portfolio cares about", so the two can never disagree.
  if (klines) {
    klines.prune(syms);
    loadKlines(syms);
  }
}

/**
 * Fetch candle history for the given symbols and push it to the renderer.
 *
 * Called on start, whenever the symbol list changes, and on a slow timer. The
 * cache decides what is actually stale, so calling this often is cheap: a
 * fresh series is not refetched.
 *
 * Failures are swallowed on purpose. A missing chart is a cosmetic gap;
 * an unhandled rejection here would take down the whole widget.
 */
async function loadKlines(symbols, opts = {}) {
  if (!klines) return;
  try {
    const changed = await klines.load(symbols, opts);
    if (changed.length) send('klines', klines.snapshot());
  } catch (err) {
    if (process.env.CPW_DEBUG) console.error('[klines]', err.message);
  }
}

/**
 * Refresh candles on a slow timer.
 *
 * 60s, matching the cache TTL: the newest candle is still forming, so anything
 * faster would re-request the same data. This is the only periodic outbound
 * request besides the price feed, and it goes to the same host.
 */
function startKlineRefresher() {
  clearInterval(klineTimer);
  klineTimer = setInterval(() => {
    if (store) loadKlines(symbolsInUse(store.trades));
  }, 60 * 1000);
}

/**
 * Sample the portfolio value for the chart.
 *
 * The value is recomputed here rather than taken from the renderer, so the
 * history is the main process's own view of the portfolio and cannot drift
 * from what the numbers show.
 */
function sampleHistory(force) {
  if (!store) return;
  const { totals } = computePositions(store.trades, prices);
  if (!(totals.value > 0)) return;
  const added = force
    ? store.pushHistory(Date.now(), totals.value, { force: true })
    : store.pushHistory(Date.now(), totals.value);
  if (added) send('history', store.history);
}

function startHistorySampler() {
  clearInterval(historyTimer);
  historyTimer = setInterval(() => sampleHistory(false), HISTORY_INTERVAL_MS);
}

// ---------------------------------------------------------------- window
function createWindow() {
  const b = placementBounds();

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
    skipTaskbar: role.skipTaskbar(store.settings.widgetRole !== false, isDocked()),
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

  applyTopLevel();

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    windowReady = true;
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

  /**
   * Persist a user move.
   *
   * `moved` also fires for our own `setBounds` calls, so a placement we just
   * applied must not be written back as if the user had chosen it: that would
   * turn a derived anchor into a fixed one. `boundsAppliedAt` is stamped by
   * every placement, and anything within 400ms of it is ours.
   */
  win.on('moved', () => {
    if (!win || win.isDestroyed()) return;
    if (Date.now() - boundsAppliedAt <= 400) return;
    const patch = dockSize.movePatchFor({ docked: isDocked(), collapsed, ...win.getBounds() });
    if (patch) store.patchSettings(patch);
  });

  /**
   * Persist a user resize.
   *
   * This is the handler that was missing the docked-strip case: it used to
   * bail out whenever the window was collapsed, so dragging the taskbar strip
   * saved nothing and the next expand/collapse re-derived the old width.
   * `sizePatchFor` now decides per case, including "docked and collapsed".
   */
  win.on('resized', () => {
    if (!win || win.isDestroyed()) return;
    if (Date.now() - boundsAppliedAt <= 400) return;
    const patch = dockSize.sizePatchFor({ docked: isDocked(), collapsed, ...win.getBounds() });
    if (patch) store.patchSettings(patch);
  });
}

/**
 * Apply the window's role: is it a widget, or an ordinary window?
 *
 * Three separate things make a window behave like a taskbar widget rather than
 * an app, and all three are needed:
 *
 *   1. No taskbar button and no Alt+Tab entry -> `setSkipTaskbar(true)`. This
 *      is the mechanism that actually works on Windows; see the long note at
 *      the top of src/window-role.js for why `type: 'toolbar'` is not.
 *   2. Never covered by another window -> always-on-top at the 'screen-saver'
 *      level, the only level above the taskbar.
 *   3. Never hidden by Windows on its own -> the environment watcher re-shows
 *      it (see reassertWidgetRole), while respecting a hide the user asked for.
 *
 * `alwaysOnTop` is the user's own switch and is respected: turning it off is a
 * deliberate choice to let other windows cover the widget.
 */
function applyWidgetRole() {
  if (!win || win.isDestroyed()) return;

  const widget = store.settings.widgetRole !== false;
  const on = store.settings.alwaysOnTop !== false;

  // A docked widget must never take a taskbar slot, whatever the user chose:
  // it is drawn over the taskbar, so a button for it would be nonsense.
  win.setSkipTaskbar(role.skipTaskbar(widget, isDocked()));
  skipTaskbarApplied = role.skipTaskbar(widget, isDocked());

  if (!on) { win.setAlwaysOnTop(false); return; }

  // 'screen-saver' is the highest level Electron exposes, and the only one
  // that sits above the taskbar itself. 'floating' is enough for a free panel
  // that is not trying to live on the taskbar.
  win.setAlwaysOnTop(true, role.topLevel(widget, isInTaskbar()), 1);
}

/** Backwards-compatible alias: the old name is used in several call sites. */
function applyTopLevel() {
  applyWidgetRole();
}

/**
 * A stable fingerprint of everything the widget's placement depends on.
 *
 * Comparing this each poll is what makes the widget follow the taskbar: a
 * resize, an edge change, a resolution change, a DPI change and an
 * explorer.exe restart all show up here as a different string.
 */
function environmentKey() {
  const tb = taskbarRect();
  const d = screen.getPrimaryDisplay();
  return [
    tb.x, tb.y, tb.width, tb.height, tb.edge,
    d.bounds.width, d.bounds.height, d.scaleFactor,
    d.workArea.x, d.workArea.y, d.workArea.width, d.workArea.height,
  ].join(':');
}

/**
 * Re-assert the widget's z-order.
 *
 * Windows silently drops the topmost flag in several situations that a widget
 * has to survive: explorer.exe restarting (the taskbar is recreated), a
 * fullscreen app taking over, a UAC prompt, a display mode change. There is no
 * event for any of them, so the flag is simply re-applied on every poll. It is
 * a cheap call and it is idempotent.
 */
function reassertWidgetRole() {
  if (!win || win.isDestroyed()) return;
  if (store.settings.widgetRole === false) return;
  if (store.settings.alwaysOnTop === false) return;

  win.setAlwaysOnTop(true, 'screen-saver', 1);
  if (isDocked()) win.setSkipTaskbar(true);

  // If Windows hid the window (rather than the user hiding it from the tray),
  // bring it back. `userHidden` is what separates the two, and `windowReady`
  // stops this from showing an empty rectangle before the first paint.
  if (role.shouldReshow({
    ready: windowReady,
    visible: win.isVisible(),
    userHidden,
    widgetRole: store.settings.widgetRole !== false,
  })) {
    win.showInactive();
  }
}

/**
 * Follow the taskbar.
 *
 * Two triggers, because neither alone is enough:
 *   - `screen` events fire for resolution / DPI / monitor changes, and are
 *     immediate.
 *   - the poll catches what has no event at all: the taskbar being resized,
 *     moved to another edge, or explorer.exe restarting.
 */
function watchEnvironment() {
  const onDisplayChange = () => {
    if (!win || win.isDestroyed()) return;
    lastEnvKey = environmentKey();
    if (isDocked()) applyDockBounds();
    else if (!collapsed) {
      const b = clampToScreen(win.getBounds());
      if (b) win.setBounds(b, true);
    }
    reassertWidgetRole();
  };

  screen.on('display-metrics-changed', onDisplayChange);
  screen.on('display-added', onDisplayChange);
  screen.on('display-removed', onDisplayChange);

  clearInterval(envTimer);
  envTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const key = environmentKey();
    if (key !== lastEnvKey) {
      lastEnvKey = key;
      if (isDocked()) applyDockBounds();
    }
    reassertWidgetRole();
  }, ENV_POLL_MS);
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
 * Collapsed: a thin strip — inside the taskbar's rectangle in 'taskbar' mode,
 * or flush against its inner edge in 'edge' mode.
 * Expanded: the full widget, anchored to the same edge so it grows AWAY from
 * the taskbar (upward for a bottom taskbar) instead of covering it.
 *
 * The expanded width is the user's own resized width, remembered separately
 * from the strip's width so resizing the panel does not stretch the strip.
 */
function applyDockBounds() {
  if (!win || win.isDestroyed()) return;

  if (collapsed) {
    const r = placementBounds();
    win.setMinimumSize(MIN_WIDTH_DOCKED, r.height);
    boundsAppliedAt = Date.now();
    win.setBounds(r, true);
    return;
  }

  const r = dockPanelRect();
  win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT_EXPANDED);
  boundsAppliedAt = Date.now();
  win.setBounds(r, true);
}

// ---------------------------------------------------------------- resize
/**
 * A transparent frameless window has no native resize border on Windows, so
 * the renderer draws 8 invisible grab strips and tells us which one is held.
 * We then follow the OS cursor here — one timer, no IPC per mouse move.
 */
function applyResize(cursorOverride) {
  if (!win || win.isDestroyed() || !resizeState) return;
  const cur = cursorOverride || screen.getCursorScreenPoint();
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
  const minW = collapsed && isDocked() ? dockSize.MIN_STRIP_WIDTH : MIN_WIDTH;

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

  /**
   * In 'taskbar' mode the collapsed strip is a fixed-height row inside the
   * taskbar: its height and vertical position are derived, not dragged. Only
   * the horizontal extent is the user's to change, so a vertical drag cannot
   * pull the strip out of the taskbar.
   */
  if (isInTaskbar() && collapsed) {
    const r = taskbarStripRect();
    if (r) { y = r.y; height = r.height; }
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
  if (!persist || !win || win.isDestroyed()) return;

  // The authoritative save. `resized` also fires during the drag, but the
  // final rectangle is only known here, and a drag that ends on a sub-pixel
  // boundary must still be remembered exactly as the user left it.
  const patch = dockSize.sizePatchFor({ docked: isDocked(), collapsed, ...win.getBounds() });
  if (patch) store.patchSettings(patch);
}

// ---------------------------------------------------------------- tray
function trayTemplate() {
  return [
    { label: 'Hiện / Ẩn', click: () => {
      if (!win) return;
      if (win.isVisible()) { userHidden = true; win.hide(); }
      else { userHidden = false; win.show(); }
    } },
    { type: 'separator' },
    { label: 'Vị trí', enabled: false },
    { label: 'Cửa sổ nổi', type: 'radio', checked: dockMode() === 'float',
      click: () => setDockMode('float') },
    { label: 'Sát thanh taskbar', type: 'radio', checked: dockMode() === 'edge',
      click: () => setDockMode('edge') },
    { label: 'Trong thanh taskbar', type: 'radio', checked: dockMode() === 'taskbar',
      click: () => setDockMode('taskbar') },
    { type: 'separator' },
    { label: 'Luôn nổi trên cùng', type: 'checkbox', checked: store.settings.alwaysOnTop !== false,
      click: (item) => {
        store.patchSettings({ alwaysOnTop: item.checked });
        applyTopLevel();
        pushState();
      } },
    { type: 'separator' },
    { label: 'Thoát', click: () => { quitting = true; app.quit(); } },
  ];
}

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
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
  tray.on('click', () => { if (win) { win.isVisible() ? win.hide() : win.show(); } });
}

function refreshTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(trayTemplate()));
}

/**
 * Switch placement mode.
 *
 * Placement is a property of the SAME window, not a second window: it is moved
 * and resized, so no state, no socket and no scroll position is lost.
 */
function setDockMode(mode) {
  if (!win || win.isDestroyed()) return;
  const next = DOCK_MODES.includes(mode) ? mode : 'float';
  if (next === dockMode()) return;

  if (next === 'float') {
    store.patchSettings({ dockMode: 'float' });
    const saved = clampToScreen(store.settings.bounds) || defaultBounds();
    collapsed = false;
    store.patchSettings({ collapsed: false });
    win.setSkipTaskbar(store.settings.widgetRole !== false);
    applyTopLevel();
    win.setMinimumSize(MIN_WIDTH, MIN_HEIGHT_EXPANDED);
    win.setBounds(saved, true);
  } else {
    // Leaving free mode: remember where the floating widget was, so going back
    // to 'float' puts it exactly there.
    if (dockMode() === 'float' && !collapsed) {
      const b = win.getBounds();
      store.patchSettings({ bounds: { x: b.x, y: b.y, width: b.width, height: b.height } });
    }
    store.patchSettings({ dockMode: next });
    // A docked widget is a taskbar strip: it starts collapsed, and it must be
    // on top or the taskbar itself would cover it.
    collapsed = true;
    store.patchSettings({ collapsed: true });
    win.setSkipTaskbar(true);
    applyTopLevel();
    applyDockBounds();
  }

  send('collapsed', collapsed);
  pushState();
  refreshTrayMenu();
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
    // A trade changes the portfolio value discontinuously; record it so the
    // chart shows the step instead of interpolating across it.
    sampleHistory(true);
    pushState();
    return { ok: true, trade };
  });

  ipcMain.handle('delete-trade', (_e, id) => {
    const ok = store.deleteTrade(id);
    refreshSymbols();
    sampleHistory(true);
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
      // 'touch' must survive the save. It used to be coerced to 'above' here,
      // which silently turned every "chạm mốc" alert into a one-directional
      // one: the renderer offered the kind, the engine understood it, and the
      // IPC boundary threw it away. The e2e suite caught it.
      direction: a.direction === 'below' || a.direction === 'touch' ? a.direction : 'above',
      note: String(a.note || '').slice(0, 120),
      enabled: a.enabled !== false,
      createdAt: a.createdAt || Date.now(),
    };
    // A tolerance only means anything for 'touch'; attaching one to an
    // above/below alert would be dead data that reads as if it did something.
    if (alert.direction === 'touch') {
      const t = Number(a.tolerance);
      alert.tolerance = Number.isFinite(t) && t >= 0 ? Math.min(50, t) : 0.1;
    }
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

  /**
   * Open a demo futures position.
   *
   * Nothing leaves the machine: no order, no API key, no account. The row is
   * written to the same local JSON file as the trades, and every number on it
   * is derived from the live mark price the feed already fetches.
   *
   * `qty` is NOT taken from the input — `buildPosition` derives it from margin
   * and leverage, so a position can never claim a size its margin cannot back.
   */
  ipcMain.handle('save-future', (_e, input) => {
    const f = input || {};
    const symbol = normalizeSymbol(f.symbol);
    const built = futures.buildPosition(f, symbol);
    if (!built.ok) return { ok: false, error: built.error };

    const pos = {
      ...built.position,
      id: typeof f.id === 'string' && f.id ? f.id : crypto.randomUUID(),
    };
    store.upsertFuture(pos);
    // A new symbol may need a price it was not subscribed to yet.
    refreshSymbols();
    pushState();
    return { ok: true, position: pos };
  });

  ipcMain.handle('delete-future', (_e, id) => {
    const ok = store.deleteFuture(id);
    refreshSymbols();
    pushState();
    return { ok };
  });

  /**
   * Pin switches for the strip.
   *
   * Separate from `patch-settings` because they change the strip's HEIGHT, and
   * a docked strip has to be re-placed immediately or the new row is drawn into
   * a box that is still the old size and gets clipped.
   */
  ipcMain.handle('pin-futures', (_e, pins) => {
    const p = pins || {};
    const patch = {};
    if (typeof p.pnl === 'boolean') patch.futPinPnl = p.pnl;
    if (typeof p.liq === 'boolean') patch.futPinLiq = p.liq;
    store.patchSettings(patch);
    if (isDocked() && collapsed) applyDockBounds();
    pushState();
    return { ok: true, settings: store.settings };
  });

  ipcMain.handle('patch-settings', (_e, patch) => {
    const p = patch || {};
    const allowed = {};
    if (typeof p.alwaysOnTop === 'boolean') {
      allowed.alwaysOnTop = p.alwaysOnTop;
      store.patchSettings(allowed);
      applyTopLevel();
      pushState();
      return { ok: true, settings: store.settings };
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
    if (typeof p.widgetRole === 'boolean') {
      allowed.widgetRole = p.widgetRole;
      store.patchSettings(allowed);
      // Applied immediately: setSkipTaskbar and the z-order level are both
      // runtime calls. A restart is only a fallback for the Alt+Tab list, which
      // the shell may keep until the window is re-registered.
      applyWidgetRole();
      pushState();
      return { ok: true, settings: store.settings, applied: true };
    }
    if (typeof p.chart === 'boolean') allowed.chart = p.chart;
    if (typeof p.chartRange === 'number' && Number.isFinite(p.chartRange)) {
      allowed.chartRange = Math.min(60, Math.max(5, Math.round(p.chartRange)));
    }
    /**
     * The candlestick frame.
     *
     * Handled before the generic merge because it has a side effect: the cache
     * has to switch frames and refetch, and the renderer has to be told. The
     * store normalises the token, so an unknown one can never reach the
     * exchange as a 400.
     */
    if (typeof p.candleInterval === 'string') {
      store.patchSettings({ candleInterval: p.candleInterval });
      const iv = store.settings.candleInterval;
      if (klines && klines.useInterval(iv)) {
        // Force: the new frame has no series yet, and `load` would otherwise
        // consider a stale entry for this symbol fresh and skip it.
        loadKlines(symbolsInUse(store.trades), { force: true });
      }
      pushState();
      return { ok: true, settings: store.settings, interval: iv };
    }
    /**
     * What is shown. The renderer sends one key at a time (a checkbox click),
     * so the patch is merged into the stored record rather than replacing it —
     * `store.patchSettings` does that merge through `normalizeDisplay`, which
     * also drops keys this build does not know.
     */
    if (p.display && typeof p.display === 'object') {
      allowed.display = p.display;
    }
    /**
     * Which coins the strip follows.
     *
     * Ticking a coin changes the strip's HEIGHT, so the window has to be
     * re-placed immediately — otherwise the new row would be drawn into a
     * 44px box and clipped until the next placement happened to run. The
     * store normalises the list, so junk from the renderer cannot get in.
     */
    if (p.stripCoins !== undefined) {
      allowed.stripCoins = p.stripCoins;
    }
    if (typeof p.dockMode === 'string') {
      store.patchSettings(allowed);
      setDockMode(p.dockMode);
      return { ok: true, settings: store.settings };
    }
    store.patchSettings(allowed);
    if (p.stripCoins !== undefined && isDocked() && collapsed) applyDockBounds();
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
    // Test-only: drive the REAL resize path with a synthetic cursor.
    //
    // The e2e suite runs under Xvfb, where there is no pointer to move and no
    // xdotool to move it with, so a drag could only be faked by calling
    // setBounds directly — which would skip applyResize, the clamping, and the
    // persistence entirely, i.e. exactly the code under test. This runs the
    // same function the 16ms timer runs, with the cursor supplied.
    ipcMain.handle('test-resize', (_e, { edge, dx, dy }) => {
      if (!win || win.isDestroyed()) return { ok: false };
      stopResize(false);
      const start = win.getBounds();
      resizeState = {
        edge: String(edge || 'e'),
        start,
        cursor: { x: start.x, y: start.y },
      };
      applyResize({ x: start.x + Number(dx || 0), y: start.y + Number(dy || 0) });
      const after = win.getBounds();
      stopResize(true);
      return { ok: true, before: start, after };
    });

    // Test-only: report the real window geometry, so placement can be asserted
    // against the taskbar rectangle instead of guessed from CSS.
    ipcMain.handle('test-geometry', () => {
      if (!win || win.isDestroyed()) return { ok: false };
      return {
        ok: true,
        bounds: win.getBounds(),
        taskbar: taskbarRect(),
        mode: dockMode(),
        collapsed,
        alwaysOnTop: win.isAlwaysOnTop(),
        skipTaskbar: skipTaskbarApplied,
        visible: win.isVisible(),
        widgetRole: store.settings.widgetRole !== false,
        envKey: environmentKey(),
        // The persisted settings, so a test can assert what was SAVED rather
        // than only what the window currently looks like. `get-state` returns
        // true and pushes the state over an event, which is not readable from
        // an evaluate() call.
        settings: {
          dockMode: store.settings.dockMode,
          dockX: store.settings.dockX,
          dockWidth: store.settings.dockWidth,
          stripWidth: store.settings.stripWidth,
          expandedHeight: store.settings.expandedHeight,
          display: store.settings.display,
        },
      };
    });
  }

  ipcMain.handle('window', (_e, action) => {
    if (!win) return { ok: false };
    switch (action) {
      case 'collapse': setCollapsed(!collapsed); break;
      case 'expand': setCollapsed(false); break;
      case 'minimize': win.minimize(); break;
      case 'hide': userHidden = true; win.hide(); break;
      case 'close': quitting = true; app.quit(); break;
      case 'pin': {
        const next = !win.isAlwaysOnTop();
        store.patchSettings({ alwaysOnTop: next });
        applyTopLevel();
        pushState();
        break;
      }
      case 'reset-size': {
        if (isDocked()) {
          // Reset BOTH sizes: the panel and the strip are separate settings
          // now, and a reset that only touched one would leave the other at
          // whatever the user had dragged it to.
          store.patchSettings({
            dockWidth: EXPANDED.width,
            expandedHeight: EXPANDED.height,
            stripWidth: dockSize.DEFAULT_STRIP_WIDTH,
          });
          applyDockBounds();
          break;
        }
        const b = win.getBounds();
        const height = collapsed ? COLLAPSED.height : EXPANDED.height;
        win.setBounds({ x: b.x, y: b.y, width: EXPANDED.width, height }, true);
        if (!collapsed) store.patchSettings({ bounds: { x: b.x, y: b.y, width: EXPANDED.width, height } });
        break;
      }
      case 'dock': setDockMode(dockMode() === 'float' ? 'edge' : 'float'); break;
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
  klines = new KlineCache({
    base: process.env.CPW_KLINES_BASE || undefined,
    // The frame the user last chose. Read from the store, not hard-coded, so a
    // restart comes back on the same frame instead of resetting to 15m.
    interval: store.settings.candleInterval,
  });

  feed.on('price', ({ symbol, price }) => {
    prices[symbol] = price;
    engine.onPrice(symbol, price);
    /**
     * The futures book is re-marked on every tick, not only on `pushState`.
     *
     * A demo position's whole point is watching its PnL and its distance to
     * liquidation move. Sending only the spot prices would leave both frozen
     * between state pushes — which happen on a user action, not on a tick — so
     * the numbers would be stale exactly when they matter most.
     *
     * Marked here, in the main process, so the liquidation formula still has
     * exactly one implementation.
     */
    const fut = futures.computeFutures(store.futures, prices);
    send('prices', {
      symbol,
      price,
      prices,
      futures: fut.positions,
      futuresTotals: fut.totals,
      futuresRows: futures.stripRows(fut.totals, {
        pnl: store.settings.futPinPnl,
        liq: store.settings.futPinLiq,
      }),
    });
  });
  feed.on('status', (s) => send('feed-status', s));
  feed.on('error', (err) => {
    if (process.env.CPW_DEBUG) console.error('[feed]', err.message);
  });
  engine.on('trigger', fireNotification);

  registerIpc();
  createWindow();
  createTray();
  watchEnvironment();
  refreshSymbols();
  feed.start();
  startHistorySampler();
  startKlineRefresher();

  app.on('activate', () => { if (!win) createWindow(); });
});

app.on('before-quit', () => {
  quitting = true;
  stopResize(false);
  clearInterval(historyTimer);
  clearInterval(envTimer);
  clearInterval(klineTimer);
  if (klines) klines.stop();
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
