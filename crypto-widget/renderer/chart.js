'use strict';
/**
 * Portfolio value chart — pure geometry, no DOM.
 *
 * Kept free of DOM access on purpose: every function here is a plain
 * input -> output transform, so the maths (range filtering, scaling, flat
 * series, single point, empty history) is unit-tested directly instead of
 * being inferred from a screenshot.
 *
 * Loaded as a plain <script> in the renderer and as a CommonJS module in the
 * tests, hence the small UMD wrapper.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Chart = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  /**
   * Filter history to the visible window.
   *
   * `rangeMs` is a duration, not a timestamp, so the chart always shows "the
   * last N minutes" rather than a fixed window that goes stale.
   */
  function toPoints(history, opts = {}) {
    const list = Array.isArray(history) ? history : [];
    const now = Number.isFinite(opts.now) ? opts.now : Date.now();
    const rangeMs = Number.isFinite(opts.rangeMs) && opts.rangeMs > 0 ? opts.rangeMs : 15 * 60 * 1000;

    const clean = list
      .filter((p) => p && Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.v)))
      .map((p) => ({ t: Number(p.t), v: Number(p.v) }))
      .sort((a, b) => a.t - b.t);

    const cutoff = now - rangeMs;
    const inRange = clean.filter((p) => p.t >= cutoff);

    /**
     * If the whole history is older than the window (the app was closed for a
     * while), showing nothing would look broken. Fall back to the last two
     * points so the chart still says something true: "this is the last data
     * we have".
     */
    if (inRange.length < 2 && clean.length >= 2) return clean.slice(-2);
    return inRange;
  }

  /**
   * Vertical extent, with a little headroom.
   *
   * A flat series (every value identical) would give min === max and divide by
   * zero, so it is widened to a synthetic band around the value. That is the
   * case that actually happens: a portfolio with no open position, or a market
   * that has not ticked.
   */
  function extent(points) {
    if (!points.length) return { min: 0, max: 1, flat: true };
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.v < min) min = p.v;
      if (p.v > max) max = p.v;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, flat: true };
    if (max - min < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.01, 0.5);
      return { min: min - pad, max: max + pad, flat: true };
    }
    const pad = (max - min) * 0.12;
    return { min: min - pad, max: max + pad, flat: false };
  }

  /**
   * Map points into a pixel box.
   *
   * A single point cannot define a line, so it is duplicated at the right edge:
   * the chart then draws a flat line at that value, which reads as "one sample
   * so far" instead of an empty box.
   */
  function project(points, box) {
    const w = Math.max(1, Number(box.width) || 1);
    const h = Math.max(1, Number(box.height) || 1);
    const padX = Number.isFinite(box.padX) ? box.padX : 0;
    const padY = Number.isFinite(box.padY) ? box.padY : 0;
    const innerW = Math.max(1, w - padX * 2);
    const innerH = Math.max(1, h - padY * 2);

    if (!points.length) return [];

    const { min, max } = extent(points);
    const span = max - min || 1;

    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const tSpan = t1 - t0;

    const out = points.map((p, i) => {
      // A single point (or several sharing one timestamp) has no time span;
      // spread them evenly so the line is still drawable.
      //
      // A LONE point is placed at the LEFT edge, not the right: the duplicate
      // added below goes to the right edge, and putting the original there too
      // would make both ends the same x — a zero-width line, which is exactly
      // what the unit test caught.
      const x = tSpan > 0
        ? padX + ((p.t - t0) / tSpan) * innerW
        : padX + (points.length === 1 ? 0 : (i / (points.length - 1)) * innerW);
      const y = padY + (1 - (p.v - min) / span) * innerH;
      return { x: round(x), y: round(y), t: p.t, v: p.v };
    });

    if (out.length === 1) out.push({ ...out[0], x: round(padX + innerW) });
    return out;
  }

  function round(n) {
    return Math.round(n * 100) / 100;
  }

  function linePath(pts) {
    if (!pts || !pts.length) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  }

  /** The line, closed down to the baseline, for the gradient fill. */
  function areaPath(pts, baseY) {
    if (!pts || !pts.length) return '';
    const y = Number.isFinite(baseY) ? baseY : pts[pts.length - 1].y;
    const first = pts[0];
    const last = pts[pts.length - 1];
    return `${linePath(pts)} L${last.x} ${round(y)} L${first.x} ${round(y)} Z`;
  }

  /**
   * Everything the renderer needs, in one call.
   *
   * `change` is measured against the FIRST point in the window, not against
   * the cost basis: the chart answers "how has the value moved in this window",
   * which is a different question from P&L.
   */
  function build(history, opts = {}) {
    const points = toPoints(history, opts);
    const box = opts.box || { width: 100, height: 30 };
    const pts = project(points, box);

    const first = points.length ? points[0].v : null;
    const last = points.length ? points[points.length - 1].v : null;
    const change = first !== null && last !== null ? last - first : 0;
    const changePct = first ? (change / first) * 100 : 0;

    return {
      points,
      projected: pts,
      line: linePath(pts),
      area: areaPath(pts, (Number(box.height) || 1) - (Number(box.padY) || 0)),
      first,
      last,
      change,
      changePct,
      empty: points.length === 0,
      // A single sample is not a trend; the UI says so instead of implying one.
      single: points.length === 1,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    };
  }

  return { toPoints, extent, project, linePath, areaPath, build, clamp };
}));
