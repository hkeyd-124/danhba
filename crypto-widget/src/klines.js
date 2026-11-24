'use strict';
/**
 * Binance USDⓈ-M Futures candles (klines).
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 *
 * The widget used to draw its chart from prices it had seen itself, which meant
 * the shape was empty for the first few minutes after launch and only ever
 * covered the current session. Closing the app threw it away.
 *
 * `/fapi/v1/klines` answers the question the chart is actually asking — "what
 * did this do before I opened the window" — so the chart is there on the first
 * paint, and it covers a fixed window instead of however long the app happened
 * to be running.
 *
 * ---------------------------------------------------------------------------
 * Why it now keeps the whole candle
 *
 * The first version of this module reduced each row to its CLOSE and threw the
 * rest away, because the chart was a line and a line only needs one number per
 * period. The chart is a candlestick now, so the open, high and low are load
 * bearing: the body is open→close and the wick is high→low. The reduction that
 * used to happen here has moved to the renderer's geometry module, which is
 * where a decision about drawing belongs.
 *
 * ---------------------------------------------------------------------------
 * The timeframe is a user setting
 *
 * 5m / 15m / 1h / 4h / 1d, chosen in the settings sheet. The cache is keyed by
 * symbol AND interval: switching frames must not serve a 15m series to a chart
 * labelled 1h, and it must not throw away the series the user is about to come
 * back to. Keeping both costs a few kilobytes.
 *
 * ---------------------------------------------------------------------------
 * This is the same host as the price feed
 *
 * `fapi.binance.com` is the REST host the ticker fallback already uses, so the
 * app still talks to exactly one service. Nothing here is uploaded: the request
 * carries a symbol, an interval and a count, and the response is kept in memory
 * only.
 * ---------------------------------------------------------------------------
 */

const DEFAULT_BASE = 'https://fapi.binance.com/fapi/v1/klines';

/**
 * The frames the user can pick, in the order the settings sheet lists them.
 *
 * These strings are the exchange's own interval tokens — `5m`, `1h`, `1d` — and
 * are sent to the API verbatim. They are not translated, because a translated
 * one would be a 400.
 */
const INTERVALS = Object.freeze(['5m', '15m', '1h', '4h', '1d']);

/** 15m: a readable trend without being noise. See the note on the default. */
const DEFAULT_INTERVAL = '15m';

/**
 * 36 candles — the panel's own maximum.
 *
 * One number for every frame, deliberately. 36 × 5m is three hours, 36 × 1h is
 * a day and a half, 36 × 1d is over a month — and in every case it is a chart
 * the row can actually draw.
 *
 * The number is set by the WIDEST consumer, not the narrowest. The panel gives
 * the chart 88px, so 36 candles is a 2.4px slot: a ~1.4px body with a ~1px gap,
 * which still reads as a candle. The strip only draws 18 of them (it merges the
 * series down — see CANDLE_MAX_STRIP in app.js), so it is never short of data.
 *
 * Fetching 24 and drawing 36 would have been the bug: `downsample` only ever
 * merges, so the panel would have silently shown 24 candles while claiming the
 * full window. Asking for 48 would halve the body and turn the chart into a
 * hatched block.
 */
const DEFAULT_LIMIT = 36;

const INTERVAL_MS = Object.freeze({
  '5m': 5 * 60 * 1000,
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
});

/**
 * How long a fetched series is considered current.
 *
 * A tenth of the frame, clamped to [1 minute, 15 minutes]. The newest candle is
 * still forming, so a series is never "final" — but refetching every tick would
 * be 10 requests a second for no new information, and refetching a DAILY series
 * every minute would be 1440 requests a day per coin to redraw the same 24
 * candles.
 *
 *  5m -> 1 min (floor)      1h  -> 6 min
 * 15m -> 1.5 min            4h  -> 15 min (ceiling)
 *                           1d  -> 15 min (ceiling)
 */
const MIN_TTL_MS = 60 * 1000;
const MAX_TTL_MS = 15 * 60 * 1000;

/** Requests in flight at once. Binance allows far more; this is politeness. */
const MAX_CONCURRENT = 3;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Is this one of the frames we offer? Anything else falls back to the default. */
function isValidInterval(iv) {
  return INTERVALS.includes(iv);
}

/** Coerce anything into a frame we can request. */
function normalizeInterval(iv) {
  return isValidInterval(iv) ? iv : DEFAULT_INTERVAL;
}

/** The frame's length in ms, or null for an unknown token. */
function intervalMs(iv) {
  return INTERVAL_MS[normalizeInterval(iv)] || null;
}

/** The freshness window for a frame. */
function ttlFor(iv) {
  const ms = intervalMs(iv);
  if (!ms) return MIN_TTL_MS;
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.round(ms / 10)));
}

/**
 * Turn the raw kline rows into candles.
 *
 * Binance sends a positional array:
 *   [openTime, open, high, low, close, volume, closeTime, ...]
 * and the trailing fields have changed shape over the years, so only the first
 * five are read.
 *
 * A row that is not a usable candle is DROPPED rather than coerced: a `null`
 * close would become 0 and drag the whole chart to the floor, and a high below
 * its low would invert the body and draw a candle that says the opposite of
 * what the market did.
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
    if (t === null || o === null || h === null || l === null || c === null) continue;
    // A price of 0 is not a price, it is a missing field.
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
    if (h < l) continue;
    out.push({ t, o, h, l, c });
  }
  // Sorted by time so the chart always runs left-to-right, whatever order the
  // endpoint returned (it is ascending today, but the chart must not depend on
  // that promise).
  out.sort((a, b) => a.t - b.t);
  return out;
}

/**
 * Everything the renderer needs to label one series, in one record.
 *
 * `changePct` is measured across the whole window, not against the cost basis:
 * the chart answers "how did this move over the last N candles", which is a
 * different question from the position's P&L.
 *
 * @param {Array} candles
 * @param {string} [interval]
 * @returns {object|null} null when there is nothing to draw
 */
function summarize(candles, interval) {
  const list = Array.isArray(candles) ? candles : [];
  if (!list.length) return null;
  const first = list[0].c;
  const last = list[list.length - 1].c;
  const change = last - first;
  const changePct = first ? (change / first) * 100 : 0;
  return {
    candles: list,
    interval: normalizeInterval(interval),
    first,
    last,
    change,
    changePct,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}

/**
 * A small in-memory cache of candle series, one per symbol and frame.
 *
 * Deliberately NOT persisted. The series is a view of the market, not of the
 * user's data: it is stale the moment it is written, and a file on disk would
 * be a second thing to migrate. A cold start refetches, which is one request
 * per held coin.
 */
class KlineCache {
  constructor(opts = {}) {
    this.base = opts.base || DEFAULT_BASE;
    this.interval = normalizeInterval(opts.interval);
    this.limit = Number.isFinite(opts.limit) ? opts.limit : DEFAULT_LIMIT;
    this.fetchImpl = opts.fetch || globalThis.fetch;
    this.now = typeof opts.now === 'function' ? opts.now : () => Date.now();
    // Override wins (the tests use it); otherwise the frame decides.
    this._ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : null;
    /** "SYMBOL|interval" -> {candles, first, last, change, changePct, ...} */
    this.map = new Map();
    this.closed = false;
  }

  /** The freshness window in force, whether overridden or derived. */
  get ttlMs() {
    return this._ttlMs === null ? ttlFor(this.interval) : this._ttlMs;
  }

  /**
   * The cache key.
   *
   * The interval is part of it, so a 15m series can never be handed to a chart
   * labelled 1h. Symbols are upper-cased here because that is what the endpoint
   * expects and what every other module in the app speaks.
   */
  static key(symbol, interval) {
    return `${String(symbol || '').trim().toUpperCase()}|${normalizeInterval(interval)}`;
  }

  url(symbol) {
    const q = `symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(this.interval)}&limit=${this.limit}`;
    return `${this.base}?${q}`;
  }

  /** Is the stored series for this symbol, in this frame, still worth showing? */
  isFresh(symbol) {
    const e = this.map.get(KlineCache.key(symbol, this.interval));
    if (!e) return false;
    return this.now() - e.at < this.ttlMs;
  }

  get(symbol) {
    return this.map.get(KlineCache.key(symbol, this.interval)) || null;
  }

  /**
   * Switch frames.
   *
   * The old series are KEPT, not cleared: the user flipping 15m → 1h → 15m
   * should get the 15m chart back instantly rather than after a fresh round of
   * requests. Nothing is deleted here; `prune` is what reclaims memory, and it
   * only ever drops coins that are no longer held.
   *
   * @param {string} iv
   * @returns {boolean} true when the frame actually changed, so the caller knows
   *   whether it needs to refetch and repaint.
   */
  useInterval(iv) {
    const next = normalizeInterval(iv);
    if (next === this.interval) return false;
    this.interval = next;
    return true;
  }

  /**
   * The series for the ACTIVE frame, shaped for IPC.
   *
   * Only the active frame's entries are sent: the renderer draws one chart per
   * coin and has no use for the frames it is not showing, and shipping them all
   * would multiply the payload by five for nothing.
   */
  snapshot() {
    const out = {};
    const suffix = `|${this.interval}`;
    for (const [key, entry] of this.map) {
      if (!key.endsWith(suffix)) continue;
      out[key.slice(0, -suffix.length)] = entry;
    }
    return { interval: this.interval, series: out };
  }

  /**
   * Fetch whatever is missing or stale.
   *
   * Returns only the symbols that actually changed, so the caller can decide
   * whether a repaint is needed. A failure is silent by design: the previous
   * series stays in the cache, because blanking a working chart because one
   * refresh timed out is worse than showing a minute-old one.
   *
   * @param {string[]} symbols
   * @param {{force?: boolean}} [opts]
   * @returns {Promise<string[]>} symbols whose series changed
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
    const interval = this.interval;
    try {
      const res = await this.fetchImpl(this.url(symbol), {
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      /**
       * The frame may have changed while this request was in flight.
       *
       * A 5m request that lands after the user has switched to 1d would store
       * 5m candles under a key the renderer reads as 1d — a chart labelled "1d"
       * drawing five-minute candles. The response is dropped instead; the next
       * load for the new frame is already queued.
       */
      if (interval !== this.interval) return null;
      const sum = summarize(parseKlines(rows), interval);
      if (!sum) return null;
      const entry = { ...sum, at: this.now() };
      this.map.set(KlineCache.key(symbol, interval), entry);
      return symbol;
    } catch (_) {
      // Keep the old series. See the note on load().
      return null;
    }
  }

  /**
   * Drop series for coins that are no longer held.
   *
   * Without this, selling a coin left its candles in memory for the rest of the
   * session — small, but it is also the only way the cache can grow. Every
   * frame for that coin goes, not just the active one.
   */
  prune(symbols) {
    const keep = new Set((symbols || []).map((s) => String(s || '').trim().toUpperCase()));
    for (const key of [...this.map.keys()]) {
      const sym = key.slice(0, key.lastIndexOf('|'));
      if (!keep.has(sym)) this.map.delete(key);
    }
  }

  stop() {
    this.closed = true;
  }
}

module.exports = {
  KlineCache,
  parseKlines,
  summarize,
  isValidInterval,
  normalizeInterval,
  intervalMs,
  ttlFor,
  INTERVALS,
  INTERVAL_MS,
  DEFAULT_BASE,
  DEFAULT_INTERVAL,
  DEFAULT_LIMIT,
  MIN_TTL_MS,
  MAX_TTL_MS,
};
