'use strict';
/**
 * Price-alert engine.
 *
 * Three rule kinds:
 *
 *   above  — fires when the price CROSSES the level going up.
 *   below  — fires when the price CROSSES the level going down.
 *   touch  — fires when the price REACHES the level, from either side. The
 *            direction of travel is irrelevant: a rise into the level and a
 *            fall into the level are the same event.
 *
 * `above`/`below` are edge-triggered: they fire on the crossing, not on every
 * tick beyond it, and re-arm only once the price is back on the other side.
 *
 * `touch` needs a tolerance band, because an exact equality test on a tick
 * stream would almost never be true — the price steps over the level rather
 * than landing on it. A touch therefore fires when either
 *
 *   (a) the price is within `tolerance` percent of the level, or
 *   (b) the tick swept across the band, i.e. the interval [prev, price]
 *       overlaps [level - tol, level + tol]. This is what catches a gap: the
 *       price can jump from 99 to 101 without ever printing 100, and that is
 *       still a touch.
 *
 * After a touch fires it stays disarmed until the price has moved clear of the
 * band (REARM_FACTOR x the tolerance, so a price jittering on the edge cannot
 * re-fire on every tick). That hysteresis is separate from the cooldown, which
 * still applies on top.
 */
const EventEmitter = require('events');

const DEFAULT_COOLDOWN_MS = 5 * 60 * 1000;

/** Default half-width of the "touch" band, in percent of the level. */
const DEFAULT_TOUCH_TOLERANCE_PCT = 0.1;

/** How far outside the band the price must go before a touch re-arms. */
const REARM_FACTOR = 3;

const DIRECTIONS = ['above', 'below', 'touch'];

function normalizeDirection(d) {
  return DIRECTIONS.includes(d) ? d : 'above';
}

function normalizeTolerance(t) {
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_TOUCH_TOLERANCE_PCT;
  return Math.min(50, n);
}

class AlertEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    // `??` not `||`: a cooldown of 0 is a legitimate value (fire on every cross).
    this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.alerts = [];
    this.lastPrice = new Map();
    this.lastFired = new Map();
    // Touch alerts that have fired and are waiting for the price to leave the
    // band. Absent from the set means armed.
    this.disarmed = new Set();
  }

  setAlerts(list) {
    this.alerts = Array.isArray(list) ? list : [];
  }

  /** Feed one tick. Emits 'trigger' for every alert that just fired. */
  onPrice(symbol, price) {
    const sym = String(symbol).toUpperCase();
    const prev = this.lastPrice.get(sym);
    this.lastPrice.set(sym, price);
    if (prev === price) return [];

    const fired = [];
    const now = Date.now();
    for (const a of this.alerts) {
      if (!a || a.enabled === false) continue;
      if (String(a.symbol).toUpperCase() !== sym) continue;
      const level = Number(a.price);
      if (!Number.isFinite(level) || level <= 0) continue;

      const dir = normalizeDirection(a.direction);

      if (dir === 'touch') {
        const tol = level * (normalizeTolerance(a.tolerance) / 100);
        const distance = Math.abs(price - level);

        // Re-arm once the price is well clear of the band.
        if (this.disarmed.has(a.id) && distance > tol * REARM_FACTOR) {
          this.disarmed.delete(a.id);
        }
        if (this.disarmed.has(a.id)) continue;

        const inBand = distance <= tol;
        // A first tick has no previous price, so there is no interval to sweep
        // and only the band test applies. That is deliberate: an alert created
        // while the price already sits on the level should say so once.
        const swept = prev !== undefined
          && Math.min(prev, price) <= level + tol
          && Math.max(prev, price) >= level - tol;

        if (!inBand && !swept) continue;

        const last = this.lastFired.get(a.id) || 0;
        if (now - last < this.cooldownMs) continue;

        this.lastFired.set(a.id, now);
        this.disarmed.add(a.id);
        const payload = {
          id: a.id,
          symbol: sym,
          direction: 'touch',
          level,
          price,
          prev: prev === undefined ? price : prev,
          at: now,
          note: a.note || '',
        };
        fired.push(payload);
        this.emit('trigger', payload);
        continue;
      }

      // above / below are crossings, so they need a previous price to cross from.
      if (prev === undefined) continue;

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

  /** Forget cooldowns and re-arm (used when the user edits an alert). */
  resetCooldown(id) {
    if (id) {
      this.lastFired.delete(id);
      this.disarmed.delete(id);
    } else {
      this.lastFired.clear();
      this.disarmed.clear();
    }
  }
}

module.exports = {
  AlertEngine,
  DEFAULT_COOLDOWN_MS,
  DEFAULT_TOUCH_TOLERANCE_PCT,
  DIRECTIONS,
  normalizeDirection,
  normalizeTolerance,
};
