'use strict';
/**
 * Candlestick geometry — pure, no DOM.
 *
 * ---------------------------------------------------------------------------
 * Why this replaced the line sparkline
 *
 * The row used to carry a line built from candle CLOSES: one value per period,
 * joined up. That answers "which way did it drift" and nothing else — it throws
 * away the open, the high and the low, which is three quarters of what the
 * exchange actually published.
 *
 * A candlestick keeps all four. The body is open->close, the wick is high->low,
 * and the colour says which way the period closed. In the same gap, at the same
 * size, it carries strictly more information than the line did.
 *
 * ---------------------------------------------------------------------------
 * Why the geometry is a separate module
 *
 * Same reason chart.js is: this is arithmetic that is easy to get subtly wrong
 * — a flat series divides by zero, a doji has a zero-height body, a one-candle
 * series has no step — and it is testable without a browser. `build()` takes
 * rows in and returns numbers AND path strings out; the renderer only wraps
 * them in an <svg>.
 *
 * ---------------------------------------------------------------------------
 * Why bodies are one path and wicks another
 *
 * A chart of 20 candles is 40 shapes if each body and each wick is its own
 * element, and the widget draws two charts per held coin. Forty elements times
 * fourteen rows is 560 nodes rebuilt on every price tick.
 *
 * So every rising body goes into ONE path and every falling body into another,
 * and the same for the wicks: four paths per chart, however many candles. The
 * bodies are filled and scale with the box; the wicks are stroked with
 * `non-scaling-stroke` so they stay 1px instead of thickening with the box.
 *
 * Loaded as a plain <script> in the renderer and as CommonJS in the tests,
 * hence the UMD wrapper.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Candles = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const round = (n) => Math.round(n * 100) / 100;

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /**
   * Keep only rows that are actually candles.
   *
   * A row is usable when all four prices are finite and positive and the high
   * is not below the low. Anything else is a truncated response or a filler row
   * from the endpoint, and coercing it would put a candle at price 0 and drag
   * the whole chart down to the floor.
   */
  function clean(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const out = [];
    for (const r of list) {
      if (!r || typeof r !== 'object') continue;
      const o = num(r.o);
      const h = num(r.h);
      const l = num(r.l);
      const c = num(r.c);
      if (o === null || h === null || l === null || c === null) continue;
      if (o <= 0 || h <= 0 || l <= 0 || c <= 0) continue;
      if (h < l) continue;
      out.push({ t: num(r.t), o, h, l, c });
    }
    return out;
  }

  /**
   * The vertical extent of the WINDOW, taken from the wicks.
   *
   * From high and low, not from the closes: a wick that runs past the top of
   * the box would be clipped, and a chart that silently truncates its own
   * extremes is lying about the range.
   *
   * A flat window (every candle identical, e.g. a stablecoin or a market that
   * has not traded) would give min === max and divide by zero, so it is widened
   * to a synthetic band — the same guard the line sparkline needed.
   */
  function extent(rows) {
    const list = clean(rows);
    if (!list.length) return { min: 0, max: 1, flat: true };
    let min = Infinity;
    let max = -Infinity;
    for (const c of list) {
      if (c.l < min) min = c.l;
      if (c.h > max) max = c.h;
    }
    if (max - min < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.01, 1e-9);
      return { min: min - pad, max: max + pad, flat: true };
    }
    const pad = (max - min) * 0.06;
    return { min: min - pad, max: max + pad, flat: false };
  }

  /**
   * Merge a series down to at most `max` candles, keeping the OHLC shape.
   *
   * ---------------------------------------------------------------------------
   * Why this exists
   *
   * The panel gives the chart 60px and the strip 76px, but the strip row is
   * only 11px tall. Drawn at 24 candles, the strip's slot is 3.2px: measured in
   * a real browser at 4x, the bodies and wicks blur into a single jagged line —
   * there is no room for a body AND a gap AND a wick in 3px.
   *
   * Fewer, wider candles fix it. Twelve candles in 76px is a 6.3px slot, so the
   * body is ~4px with a ~2px gap and the wick is still a visible hairline.
   *
   * ---------------------------------------------------------------------------
   * Why it MERGES rather than truncates
   *
   * Taking the last 12 of 24 rows would silently halve the window and leave the
   * chart labelled "15m" showing two hours. Merging keeps the whole window and
   * makes each candle an honest aggregate of the ones it replaces:
   *
   *   open  = the first open in the bucket   (where the period started)
   *   close = the last close in the bucket   (where it ended)
   *   high  = the highest high in the bucket
   *   low   = the lowest low in the bucket
   *
   * That is the standard OHLC roll-up: the merged candle is exactly the candle
   * the exchange would have published for that longer period. A chart of 12
   * merged 15m candles over four hours is a true 30m chart of the same four
   * hours, so the shape the user sees is the real shape, not a sample of it.
   *
   * @param {Array} rows   candles, oldest first
   * @param {number} max   the most candles that will fit
   * @returns {Array}      at most `max` candles, or the input when it already fits
   */
  function downsample(rows, max) {
    const list = clean(rows);
    const cap = Math.floor(num(max) || 0);
    if (!cap || cap < 1 || list.length <= cap) return list;
    // One bucket per output candle, sized so every row lands in one.
    const size = Math.ceil(list.length / cap);
    const out = [];
    for (let i = 0; i < list.length; i += size) {
      const bucket = list.slice(i, i + size);
      let high = -Infinity;
      let low = Infinity;
      for (const b of bucket) {
        if (b.h > high) high = b.h;
        if (b.l < low) low = b.l;
      }
      out.push({
        t: bucket[0].t,
        o: bucket[0].o,
        c: bucket[bucket.length - 1].c,
        h: high,
        l: low,
      });
    }
    return out;
  }

  /**
   * Lay the candles out in a pixel box.
   *
   * The box is `width` x `height` with `padY` of air at the top and bottom, and
   * `bodyRatio` of each candle's slot given to the body (the rest is the gap).
   *
   * @param {Array} rows  candles, oldest first
   * @param {{width:number, height:number, padY?:number, bodyRatio?:number,
   *          maxCandles?:number}} box
   *        `maxCandles` merges the series down when the box is too narrow to
   *        draw every candle legibly. See `downsample`.
   * @returns {object}
   */
  function build(rows, box) {
    const b = box && typeof box === 'object' ? box : {};
    const list = clean(rows).length && b.maxCandles
      ? downsample(rows, b.maxCandles)
      : clean(rows);
    /**
     * Both key shapes are accepted.
     *
     * `width`/`height` is the documented form and what chart.js uses. `w`/`h`
     * is accepted too because the first caller here passed those, and the
     * mismatch was silent: `num(undefined)` fell through to 1, every candle was
     * laid out inside a single unit, and the chart rendered as a 1px sliver
     * with perfectly well-formed paths. A caller that gets the name wrong
     * should get a chart, not an invisible one.
     */
    const w = Math.max(1, num(b.width) || num(b.w) || 1);
    const h = Math.max(1, num(b.height) || num(b.h) || 1);

    const rawPad = num(b.padY);
    const padY = rawPad === null ? 0 : Math.max(0, Math.min(h / 2 - 0.5, rawPad));
    const innerH = Math.max(1, h - padY * 2);

    const rawRatio = num(b.bodyRatio);
    const bodyRatio = rawRatio === null ? 0.68 : Math.max(0.2, Math.min(0.95, rawRatio));

    const empty = {
      candles: [],
      bodyPathUp: '',
      bodyPathDown: '',
      wickPathUp: '',
      wickPathDown: '',
      count: 0,
      first: null,
      last: null,
      change: 0,
      changePct: 0,
      direction: 'flat',
      empty: true,
      single: false,
      min: 0,
      max: 0,
    };
    if (!list.length) return empty;

    const { min, max } = extent(list);
    const span = (max - min) || 1;
    const n = list.length;

    /**
     * The slot is `width / n`, not `width / (n - 1)`.
     *
     * The line sparkline divided by `n - 1` because a line connects POINTS and
     * both ends had to sit on an edge. Candles occupy WIDTH, so the last one
     * would hang off the right edge if the step were any larger than this.
     */
    const step = w / n;
    const bodyW = Math.max(1, round(step * bodyRatio));

    /** Price -> y, clamped to the box so rounding can never draw outside it. */
    const yOf = (p) => {
      const t = (p - min) / span;
      return Math.max(0, Math.min(h, padY + (1 - t) * innerH));
    };

    const candles = [];
    const upBody = [];
    const downBody = [];
    const upWick = [];
    const downWick = [];

    list.forEach((c, i) => {
      // "Up" is close at or above open, so a doji (open === close) counts as
      // rising — the same convention the exchange's own charts use.
      const up = c.c >= c.o;

      const cx = round(i * step + step / 2);
      const bodyX = round(i * step + (step - bodyW) / 2);
      const wickTop = round(yOf(c.h));
      const wickBottom = round(yOf(c.l));
      const bodyTop = round(yOf(Math.max(c.o, c.c)));

      /**
       * A body is never thinner than 1px.
       *
       * open === close is a real and common case (a quiet period). Rounding
       * would give it height 0, and a zero-height rectangle paints nothing —
       * the candle would vanish from the chart. One pixel reads as "this
       * period opened and closed at the same price", which is exactly what it
       * means.
       */
      const bodyH = Math.max(1, round(yOf(Math.min(c.o, c.c)) - bodyTop));

      candles.push({
        i, cx, x: bodyX, w: bodyW, bodyTop, bodyH,
        wickTop, wickBottom, up,
        o: c.o, h: c.h, l: c.l, c: c.c, t: c.t,
      });

      // Rectangle as a relative subpath: right, down, left, close.
      const bp = `M${bodyX} ${bodyTop}h${bodyW}v${bodyH}h-${bodyW}Z`;
      // The wick is a single vertical segment through the body's centre.
      const wp = `M${cx} ${wickTop}V${wickBottom}`;

      if (up) {
        upBody.push(bp);
        upWick.push(wp);
      } else {
        downBody.push(bp);
        downWick.push(wp);
      }
    });

    const first = list[0].c;
    const last = list[n - 1].c;
    const change = last - first;
    const changePct = first ? (change / first) * 100 : 0;

    return {
      candles,
      bodyPathUp: upBody.join(''),
      bodyPathDown: downBody.join(''),
      wickPathUp: upWick.join(''),
      wickPathDown: downWick.join(''),
      count: n,
      first,
      last,
      change,
      changePct,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
      empty: false,
      single: n === 1,
      min,
      max,
    };
  }

  return { clean, extent, downsample, build };
}));
