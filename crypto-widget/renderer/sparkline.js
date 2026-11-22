'use strict';
/**
 * Sparkline geometry — pure, no DOM.
 *
 * ---------------------------------------------------------------------------
 * Why a second geometry module next to chart.js
 *
 * chart.js draws the portfolio value over TIME: its x axis is a timestamp and
 * it filters to a rolling window. A coin sparkline is a different thing — the
 * x axis is just "candle 1..N", the series is already the window the user
 * asked for, and the box is 40x14 instead of 100x34.
 *
 * Forcing both through one function meant either the sparkline inherited a
 * time filter it does not want, or chart.js grew a mode flag. Two small pure
 * functions are cheaper to read and each is tested on its own.
 *
 * Loaded as a plain <script> in the renderer and as CommonJS in the tests,
 * hence the UMD wrapper.
 * ---------------------------------------------------------------------------
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Spark = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const round = (n) => Math.round(n * 100) / 100;

  /** Keep only usable numbers. A 0 or a null is a missing price, not a value. */
  function clean(values) {
    const list = Array.isArray(values) ? values : [];
    const out = [];
    for (const v of list) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) out.push(n);
    }
    return out;
  }

  /**
   * Vertical extent with headroom.
   *
   * A flat series (every candle closed at the same price) would give
   * min === max and divide by zero, so it is widened to a synthetic band. That
   * is a real case: a stablecoin, or a coin that has not traded in the window.
   */
  function extent(values) {
    const list = clean(values);
    if (!list.length) return { min: 0, max: 1, flat: true };
    let min = Infinity;
    let max = -Infinity;
    for (const v of list) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 1e-9) {
      const pad = Math.max(Math.abs(max) * 0.01, 1e-9);
      return { min: min - pad, max: max + pad, flat: true };
    }
    const pad = (max - min) * 0.1;
    return { min: min - pad, max: max + pad, flat: false };
  }

  /**
   * Map values into a pixel box.
   *
   * A single value cannot define a line, so it is duplicated at the right edge:
   * the sparkline then draws a flat line at that price, which reads as "one
   * sample" instead of an empty box.
   */
  function project(values, box) {
    const list = clean(values);
    if (!list.length) return [];
    const w = Math.max(1, Number(box && box.width) || 1);
    const h = Math.max(1, Number(box && box.height) || 1);
    const padY = Number.isFinite(box && box.padY) ? box.padY : 0;
    const innerH = Math.max(1, h - padY * 2);

    const { min, max } = extent(list);
    const span = max - min || 1;
    const step = list.length > 1 ? w / (list.length - 1) : 0;

    const out = list.map((v, i) => ({
      x: round(list.length > 1 ? i * step : 0),
      y: round(padY + (1 - (v - min) / span) * innerH),
      v,
    }));

    if (out.length === 1) out.push({ ...out[0], x: round(w) });
    return out;
  }

  function linePath(pts) {
    if (!pts || !pts.length) return '';
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ');
  }

  /** The line closed down to the baseline, for the gradient fill. */
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
   * @param {number[]} values  closes, oldest first
   * @param {{width:number,height:number,padY?:number}} box
   */
  function build(values, box) {
    const list = clean(values);
    const b = box || { width: 40, height: 14 };
    const pts = project(list, b);
    const first = list.length ? list[0] : null;
    const last = list.length ? list[list.length - 1] : null;
    const change = first !== null && last !== null ? last - first : 0;
    const changePct = first ? (change / first) * 100 : 0;
    const height = Math.max(1, Number(b.height) || 1);
    const padY = Number.isFinite(b.padY) ? b.padY : 0;

    return {
      values: list,
      projected: pts,
      line: linePath(pts),
      area: areaPath(pts, height - padY),
      first,
      last,
      change,
      changePct,
      empty: list.length === 0,
      single: list.length === 1,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    };
  }

  return { clean, extent, project, linePath, areaPath, build };
}));
