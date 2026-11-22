'use strict';
/**
 * Local-only persistence. Everything lives in one JSON file inside the OS
 * per-user app-data folder. Nothing is ever uploaded.
 */
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_DISPLAY, normalizeDisplay, normalizeStripCoins,
} = require('./display');
const { DEFAULT_INTERVAL, normalizeInterval } = require('./klines');

const SCHEMA_VERSION = 7;

/**
 * How many value samples the chart keeps.
 *
 * One sample every 5s, so 720 is an hour of history. The array is a plain
 * list of {t, v} pairs — a few kilobytes — and it is written with the same
 * debounced atomic writer as everything else, so it never becomes a second
 * source of truth or a second file.
 */
const HISTORY_MAX = 720;
const HISTORY_MIN_GAP_MS = 5000;

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    trades: [],
    alerts: [],
    // Portfolio value over time, for the chart. Local only, like everything else.
    history: [],
    settings: {
      alwaysOnTop: true,
      collapsed: false,
      sound: true,
      quote: 'USDT',
      bounds: null,
      // ---- appearance (all local, all persisted) ----
      theme: 'solid',
      textColor: '#e8eefc',
      bgAlpha: 1,
      // Halo strength (0-100) for the "bare" style, where there is no surface
      // behind the text and it has to stay legible on any wallpaper.
      halo: 70,
      expandedHeight: 660,
      // ---- placement ----
      // 'float'   : free-floating window
      // 'edge'    : thin strip flush against the taskbar's inner edge, inside
      //             the work area (never covers the taskbar's own buttons)
      // 'taskbar' : drawn INSIDE the taskbar's rectangle, over the taskbar
      dockMode: 'float',
      dockX: null,
      dockWidth: 420,
      // Width of the collapsed strip, kept SEPARATE from dockWidth.
      //
      // They used to be one number, which meant resizing the panel stretched
      // the strip and — worse — a strip dragged while collapsed was never
      // saved at all, so it snapped back on the next expand/collapse.
      // null = "never dragged": the strip falls back to dockWidth, which is
      // what every earlier version drew it at.
      stripWidth: null,
      // Click-outside-to-collapse. On by default: it is what makes the widget
      // behave like a taskbar flyout rather than a window that stays open.
      collapseOnBlur: true,
      // ---- window role ----
      // true  : a widget — no taskbar button, no Alt+Tab entry (skipTaskbar),
      //         and always above other windows.
      // false : an ordinary application window.
      widgetRole: true,
      // ---- chart ----
      chart: true,
      // Minutes of history the chart shows.
      chartRange: 15,
      // ---- per-coin candlestick chart ----
      // The frame the coin charts are drawn in: '5m' | '15m' | '1h' | '4h' | '1d'.
      // One setting for every coin, not one per coin: the charts sit in a list
      // and are read as a column, so two rows on different frames would be
      // comparing different windows without saying so.
      candleInterval: DEFAULT_INTERVAL,
      // ---- what is shown ----
      // One key per thing that can be ticked on or off in the settings sheet.
      // The shape and the defaults live in src/display.js; this is only the
      // stored copy. Everything defaults to on, which is what every earlier
      // version showed, so an upgrade changes nothing until the user unticks.
      display: { ...DEFAULT_DISPLAY },
      // Per-coin rows in the collapsed strip: the base symbols the user ticked,
      // e.g. ['LDO', 'ETH']. Empty means "the summary line only", which is
      // exactly what every earlier version drew — so an upgrade changes nothing
      // until the user ticks a coin.
      stripCoins: [],
    },
  };
}

class Store {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = emptyState();
    this._writeTimer = null;
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      this.state = this._migrate(parsed);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // Corrupt file: keep a copy so the user's data is never silently lost.
        try {
          fs.copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
        } catch (_) { /* ignore */ }
      }
      this.state = emptyState();
    }
    return this.state;
  }

  _migrate(parsed) {
    const base = emptyState();
    if (!parsed || typeof parsed !== 'object') return base;

    const settings = { ...base.settings, ...(parsed.settings || {}) };

    /**
     * v1 -> v2: `dockToTaskbar` (boolean) became `dockMode` (string).
     *
     * The old boolean only ever meant "the strip against the taskbar's inner
     * edge", which is now 'edge'. A file written by v1 has no dockMode, so the
     * boolean is the only signal — and it must be read before the default
     * 'float' overwrites it.
     */
    if (typeof parsed.settings?.dockMode !== 'string') {
      settings.dockMode = parsed.settings?.dockToTaskbar === true ? 'edge' : 'float';
    }
    if (!['float', 'edge', 'taskbar'].includes(settings.dockMode)) settings.dockMode = 'float';
    delete settings.dockToTaskbar;

    /**
     * v3 -> v4: the docked strip got its own width (`stripWidth`).
     *
     * A file written before this has no stripWidth, and must keep drawing the
     * strip at the width it always used — `dockWidth`. Leaving it null does
     * exactly that (see src/dock-size.js), so an existing install looks
     * unchanged until the user drags the strip for the first time. Writing
     * dockWidth into stripWidth here would be equivalent today but would
     * freeze the two together again on the next panel resize.
     */
    const sw = Number(settings.stripWidth);
    settings.stripWidth = Number.isFinite(sw) && sw > 0 ? Math.round(sw) : null;

    /**
     * v4 -> v5: the user can choose what is shown.
     *
     * A file written before this has no `display` at all. `normalizeDisplay`
     * turns that into "everything on", which is exactly what v4 drew — so an
     * existing install looks identical after the upgrade. It also drops keys
     * this version does not know, so a file from a future build cannot leave
     * the renderer asking about a toggle that no longer exists.
     */
    settings.display = normalizeDisplay(settings.display);

    /**
     * v5 -> v6: the strip can follow individual coins.
     *
     * A file written before this has no `stripCoins`, and `normalizeStripCoins`
     * turns that into an empty list — the strip draws the summary line alone,
     * which is what v5 drew. It also drops anything that is not a plausible
     * ticker, so a hand-edited file cannot put a nameless row in the strip.
     */
    settings.stripCoins = normalizeStripCoins(settings.stripCoins);

    /**
     * v6 -> v7: the coin chart became a candlestick with a selectable frame.
     *
     * A file written before this has no `candleInterval`. `normalizeInterval`
     * turns that into '15m', which is the frame the old line chart was built
     * from — so an existing install keeps the same window it was already
     * looking at, and only the drawing changes. An unknown token (a hand-edited
     * file, or a frame a future build added) also falls back here rather than
     * being sent to the exchange, where it would be a 400.
     */
    settings.candleInterval = normalizeInterval(settings.candleInterval);

    const history = Array.isArray(parsed.history)
      ? parsed.history
        .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
        .map((p) => ({ t: Number(p.t), v: Number(p.v) }))
        .slice(-HISTORY_MAX)
      : [];

    /**
     * v2 -> v3: alerts gained the 'touch' direction and a `tolerance`.
     *
     * An alert written by v2 has only 'above'/'below' and no tolerance. It must
     * keep behaving exactly as before, so the direction is passed through
     * untouched when it is one of the two old values, and a tolerance is only
     * attached to the new kind. Writing a tolerance onto an above/below alert
     * would be harmless but misleading — the engine ignores it there.
     */
    const alerts = (Array.isArray(parsed.alerts) ? parsed.alerts : [])
      .filter((a) => a && typeof a === 'object')
      .map((a) => {
        const direction = a.direction === 'below' || a.direction === 'touch' ? a.direction : 'above';
        const out = { ...a, direction };
        if (direction === 'touch') {
          const t = Number(a.tolerance);
          out.tolerance = Number.isFinite(t) && t >= 0 ? Math.min(50, t) : 0.1;
        } else {
          delete out.tolerance;
        }
        return out;
      });

    return {
      version: SCHEMA_VERSION,
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      alerts,
      history,
      settings,
    };
  }

  /** Atomic write: temp file + rename, so a crash can't truncate the data. */
  save() {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  saveDebounced(ms = 400) {
    if (this._writeTimer) clearTimeout(this._writeTimer);
    this._writeTimer = setTimeout(() => {
      this._writeTimer = null;
      try { this.save(); } catch (e) { console.error('[store] save failed', e); }
    }, ms);
  }

  flush() {
    if (this._writeTimer) {
      clearTimeout(this._writeTimer);
      this._writeTimer = null;
    }
    try { this.save(); } catch (e) { console.error('[store] flush failed', e); }
  }

  get trades() { return this.state.trades; }
  get alerts() { return this.state.alerts; }
  get settings() { return this.state.settings; }
  get history() { return this.state.history; }

  /**
   * Append one portfolio-value sample.
   *
   * Two guards, both deliberate: a minimum gap so a burst of ticks cannot fill
   * the buffer with near-identical points, and a hard cap so the file cannot
   * grow without bound over a long session.
   */
  pushHistory(t, v, opts = {}) {
    const value = Number(v);
    if (!Number.isFinite(value) || value <= 0) return false;
    const h = this.state.history;
    const last = h[h.length - 1];
    // `force` is for a discontinuous change (a trade was added or deleted):
    // the step must be recorded even if the last sample is a second old, or
    // the chart would interpolate straight across it and hide the jump.
    if (!opts.force && last && t - last.t < HISTORY_MIN_GAP_MS) return false;
    h.push({ t, v: value });
    if (h.length > HISTORY_MAX) h.splice(0, h.length - HISTORY_MAX);
    this.saveDebounced();
    return true;
  }

  upsertTrade(trade) {
    const idx = this.state.trades.findIndex((t) => t.id === trade.id);
    if (idx >= 0) this.state.trades[idx] = { ...this.state.trades[idx], ...trade };
    else this.state.trades.push(trade);
    this.saveDebounced();
    return trade;
  }

  deleteTrade(id) {
    const before = this.state.trades.length;
    this.state.trades = this.state.trades.filter((t) => t.id !== id);
    this.saveDebounced();
    return before !== this.state.trades.length;
  }

  upsertAlert(alert) {
    const idx = this.state.alerts.findIndex((a) => a.id === alert.id);
    if (idx >= 0) this.state.alerts[idx] = { ...this.state.alerts[idx], ...alert };
    else this.state.alerts.push(alert);
    this.saveDebounced();
    return alert;
  }

  deleteAlert(id) {
    const before = this.state.alerts.length;
    this.state.alerts = this.state.alerts.filter((a) => a.id !== id);
    this.saveDebounced();
    return before !== this.state.alerts.length;
  }

  patchSettings(patch) {
    const p = { ...(patch || {}) };
    // `display` is a nested record, so a shallow spread would replace the whole
    // thing and silently drop every key the caller did not mention. It is
    // merged through the same normaliser the loader uses, so a partial patch
    // and a hand-edited file behave identically.
    if (p.display !== undefined) {
      p.display = normalizeDisplay({ ...this.state.settings.display, ...(p.display || {}) });
    }
    // `stripCoins` is a list, so a partial patch must replace it wholesale —
    // there is no meaningful merge between two selections. It still goes
    // through the normaliser, so the renderer cannot store junk.
    if (p.stripCoins !== undefined) {
      p.stripCoins = normalizeStripCoins(p.stripCoins);
    }
    this.state.settings = { ...this.state.settings, ...p };
    this.saveDebounced();
    return this.state.settings;
  }
}

module.exports = { Store, emptyState, SCHEMA_VERSION, HISTORY_MAX };
