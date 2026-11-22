'use strict';
/**
 * Binance USDⓈ-M Futures candles (klines).
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * The widget used to draw its sparkline from prices it had seen itself, which
 * meant the line was empty for the first few minutes after launch and only
 * ever covered the current session. Closing the app threw the shape away.
 *
 * `/fapi/v1/klines` answers the question the chart is actually asking — "what
 * did this do before I opened the window" — so the line is there on the first
 * paint, and it covers a fixed window instead of however long the app happened
 * to be running.
 *
 * ---------------------------------------------------------------------------
 * This is the same host as the price feed
 *
 * `fapi.binance.com` is the REST host the ticker fallback already uses, so the
 * app still talks to exactly one service. Nothing here is uploaded: the
 * request carries a symbol and a candle count, and the response is kept in
 * memory only.
 * ---------------------------------------------------------------------------
 */

const DEFAULT_BASE = 'https://fapi.binance.com/fapi/v1/klines';

/**
 * 15m x 48 = 12 hours.
 *
 * Chosen to match the panel chart's default 15-minute window in *shape* while
 * covering enough time that the line has a readable trend rather than noise.
 * A 1m series over 48 candles is 48 minutes of jitter; 15m over 48 is half a
 * day, which is what a "how is this coin doing" glance is asking about.
 */
const DEFAULT_INTERVAL = '15m';
const DEFAULT_LIMIT = 48;

/**
 * How long a fetched series is considered current.
 *
 * The newest candle is still forming, so a series is never "final" — but
 * refetching every tick would be 10 requests a second for no new information.
 * 60s is one candle period's worth of freshness at a fraction of the cost.
 */
const DEFAULT_TTL_MS = 60 * 1000;

/** Requests in flight at once. Binance allows far more; this is politeness. */
const MAX_CONCURRENT = 3;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Turn the raw kline rows into candles.
 *
 * Binance sends a positional array:
 *   [openTime, open, high, low, close, volume, closeTime, ...]
 * and the trailing fields have changed shape over the years, so only the first
 * five are read. Anything that is not a usable candle is dropped rather than
 * coerced: a `null` close would become 0 and drag the whole line to the floor.
 *
 * @param {Array} rows
 * @returns {Array<{t:number,o:number,h:number,l:number,c:number}>}
 */
function parseKlines(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length < 5) continue;
    const t = num(r[0]);
    const o = num(r[1]);
    const h = num(r[2]);
    const l = num(r[3]);
    const c = num(r[4]);
    // A close of 0 is not a price, it is a missing field.
    if (t === null || c === null || c <= 0) continue;
    out.push({ t, o, h, l, c });
  }
  // Sorted by time so the line always runs left-to-right, whatever order the
  // endpoint returned (it is ascending today, but the chart must not depend on
  // that promise).
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** The close of each candle — the series the sparkline draws. */
function closesOf(candles) {
  const list = Array.isArray(candles) ? candles : [];
  const out = [];
  for (const c of list) {
    if (c && Number.isFinite(c.c) && c.c > 0) out.push(c.c);
  }
  return out;
}

/**
 * Everything the renderer needs about one series, in one record.
 *
 * `changePct` is measured across the whole window, not against the cost basis:
 * the sparkline answers "how did this move in the last 12 hours", which is a
 * different question from the position's P&L.
 *
 * @param {number[]} values
 * @returns {object|null} null when there is nothing to draw
 */
function summarize(values) {
  const list = (Array.isArray(values) ? values : [])
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!list.length) return null;
  const first = list[0];
  const last = list[list.length - 1];
  const change = last - first;
  const changePct = first ? (change / first) * 100 : 0;
  return {
    values: list,
    first,
    last,
    change,
    changePct,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}

/**
 * A small in-memory cache of candle series, one per symbol.
 *
 * Deliberately NOT persisted. The series is a view of the market, not of the
 * user's data: it is stale the moment it is written, and a file on disk would
 * be a second thing to migrate. A cold start refetches, which is one request
 * per held coin.
 */
class KlineCache {
  constructor(opts = {}) {
    this.base = opts.base || DEFAULT_BASE;
    this.interval = opts.interval || DEFAULT_INTERVAL;
    this.limit = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_LIMIT;
    this.ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : DEFAULT_TTL_MS;
    this.fetchImpl = opts.fetch || globalThis.fetch;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    /** symbol -> {values, first, last, change, changePct, direction, at} */
    this.map = new Map();
    this.closed = false;
  }

  url(symbol) {
    const q = `symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(this.interval)}&limit=${this.limit}`;
    return `${this.base}?${q}`;
  }

  /** Is the stored series for this symbol still worth showing? */
  isFresh(symbol) {
    const e = this.map.get(symbol);
    if (!e) return false;
    return this.now() - e.at < this.ttlMs;
  }

  get(symbol) {
    return this.map.get(symbol) || null;
  }

  /** The whole cache, shaped for IPC. */
  snapshot() {
    return Object.fromEntries(this.map);
  }

  /**
   * Fetch whatever is missing or stale.
   *
   * Returns only the entries that actually changed, so the caller can decide
   * whether a repaint is needed. A failure is silent by design: the previous
   * series stays in the cache, because blanking a working chart because one
   * refresh timed out is worse than showing a minute-old line.
   *
   * @param {string[]} symbols
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<Array<{symbol:string}>>}
   */
  async load(symbols, opts = {}) {
    if (this.closed) return [];
    const list = [...new Set((symbols || [])
      .map((s) => String(s || '').trim().toUpperCase())
      .filter(Boolean))];
    const todo = list.filter((s) => opts.force || !this.isFresh(s));
    if (!todo.length) return [];

    const changed = [];
    for (let i = 0; i < todo.length; i += MAX_CONCURRENT) {
      const batch = todo.slice(i, i + MAX_CONCURRENT);
      const settled = await Promise.all(batch.map((s) => this._one(s)));
      for (const r of settled) if (r) changed.push(r);
    }
    return changed;
  }

  async _one(symbol) {
    if (this.closed) return null;
    try {
      const res = await this.fetchImpl(this.url(symbol), {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      const sum = summarize(closesOf(parseKlines(rows)));
      if (!sum) return null;
      const entry = { ...sum, at: this.now() };
      this.map.set(symbol, entry);
      return { symbol, ...entry };
    } catch (_) {
      // Keep the old series. See the note on load().
      return null;
    }
  }

  /**
   * Drop series for coins that are no longer held.
   *
   * Without this, selling a coin left its candles in memory for the rest of
   * the session — small, but it is also the only way the cache can grow.
   */
  prune(symbols) {
    const keep = new Set((symbols || []).map((s) => String(s || '').trim().toUpperCase()));
    for (const key of [...this.map.keys()]) {
      if (!keep.has(key)) this.map.delete(key);
    }
  }

  stop() {
    this.closed = true;
  }
}

module.exports = {
  KlineCache,
  parseKlines,
  closesOf,
  summarize,
  DEFAULT_BASE,
  DEFAULT_INTERVAL,
  DEFAULT_LIMIT,
  DEFAULT_TTL_MS,
};
