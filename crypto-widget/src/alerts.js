'use strict';
/**
 * Price-alert engine.
 *
 * Rules are edge-triggered: an alert fires when the price CROSSES the level,
 * not on every tick above it. After firing it re-arms only once the price has
 * moved back to the other side (or after a cooldown), so a price hovering at
 * the threshold can't spam the user with notifications.
 */
const EventEmitter = require('events');

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

class AlertEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    // `??` not `||`: a cooldown of 0 is a legitimate value (fire on every cross).
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.alerts = [];
    this.lastPrice = new Map();
    this.lastFired = new Map();
  }

  setAlerts(list) {
    this.alerts = Array.isArray(list) ? list : [];
  }

  /** Feed one tick. Emits 'trigger' for every alert that just crossed. */
  onPrice(symbol, price) {
    const sym = String(symbol).toUpperCase();
    const prev = this.lastPrice.get(sym);
    this.lastPrice.set(sym, price);
    if (prev === undefined || prev === price) return [];

    const fired = [];
    const now = Date.now();
    for (const a of this.alerts) {
      if (!a || a.enabled === false) continue;
      if (String(a.symbol).toUpperCase() !== sym) continue;
      const level = Number(a.price);
      if (!Number.isFinite(level) || level <= 0) continue;

      const dir = a.direction === 'below' ? 'below' : 'above';
      const crossed = dir === 'above'
        ? prev < level && price >= level
        : prev > level && price <= level;
      if (!crossed) continue;

      const last = this.lastFired.get(a.id) || 0;
      if (now - last < this.cooldownMs) continue;

      this.lastFired.set(a.id, now);
      const payload = {
        id: a.id,
        symbol: sym,
        direction: dir,
        level,
        price,
        prev,
        at: now,
        note: a.note || '',
      };
      fired.push(payload);
      this.emit('trigger', payload);
    }
    return fired;
  }

  /** Forget cooldowns (used when the user edits an alert). */
  resetCooldown(id) {
    if (id) this.lastFired.delete(id);
    else this.lastFired.clear();
  }
}

module.exports = { AlertEngine, DEFAULT_COOLDOWN_MS };
