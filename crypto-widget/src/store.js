'use strict';
/**
 * Local-only persistence. Everything lives in one JSON file inside the OS
 * per-user app-data folder. Nothing is ever uploaded.
 */
const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function emptyState() {
  return {
    version: SCHEMA_VERSION,
    trades: [],
    alerts: [],
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
      expandedHeight: 660,
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
    return {
      version: SCHEMA_VERSION,
      trades: Array.isArray(parsed.trades) ? parsed.trades : [],
      alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
      settings: { ...base.settings, ...(parsed.settings || {}) },
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

module.exports = { Store, emptyState, SCHEMA_VERSION };
