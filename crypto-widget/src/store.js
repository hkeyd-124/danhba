'use strict';
/**
 * Local-only persistence. Everything lives in one JSON file inside the OS
 * per-user app-data folder. Nothing is ever uploaded.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 2;

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
      // Click-outside-to-collapse. On by default: it is what makes the widget
      // behave like a taskbar flyout rather than a window that stays open.
      collapseOnBlur: true,
      // ---- chart ----
      chart: true,
      // Minutes of history the chart shows.
      chartRange: 15,
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

    const history = Array.isArray(parsed.history)
      ? parsed.history
        .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
        .map((p) => ({ t: Number(p.t), v: Number(p.v) }))
        .slice(-HISTORY_MAX)
      : [];

    return {
      version: SCHEMA_VERSION,
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
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
    this.state.settings = { ...this.state.settings, ...patch };
    this.saveDebounced();
    return this.state.settings;
  }
}

module.exports = { Store, emptyState, SCHEMA_VERSION, HISTORY_MAX };
