'use strict';
/**
 * Candlestick geometry.
 *
 * These are the arithmetic cases that are easy to get subtly wrong and
 * impossible to see in a screenshot: a flat series divides by zero, a doji has
 * a zero-height body, a one-candle series has no step, and a box that is too
 * narrow for every candle has to merge rather than truncate.
 *
 * `build()` takes rows in and returns numbers AND path strings out, so none of
 * this needs a browser.
 */
const test = require('node:test');
const assert = require('node:assert');
const { clean, extent, downsample, build } = require('../renderer/candles');

/** A usable candle. */
/** A deterministic OHLC series of `n` rows, for the geometry grid tests. */
function series(n) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    const o = 100 + Math.sin(i) * 2;
    const cl = o * 1.01;
    rows.push(c(i, o, Math.max(o, cl) * 1.01, Math.min(o, cl) * 0.99, cl));
  }
  return rows;
}

function c(t, o, h, l, cl) {
  return { t, o, h, l, c: cl };
}

test('clean keeps only rows that are actually candles', () => {
  const rows = [
    c(1, 10, 12, 9, 11),
    null,
    'nope',
    { t: 2, o: 10, h: 12, l: 9 },            // no close
    c(3, 10, 12, 9, 0),                      // a price of 0 is a missing field
    c(4, 10, 8, 9, 11),                      // high below low: inverted body
    c(5, 10, 12, 9, 11),
  ];
  const out = clean(rows);
  assert.deepEqual(out.map((x) => x.t), [1, 5]);
});

test('clean on a non-array is empty, not a throw', () => {
  assert.deepEqual(clean(null), []);
  assert.deepEqual(clean(undefined), []);
  assert.deepEqual(clean({ error: 'x' }), []);
});

test('extent takes the window from the wicks, not the closes', () => {
  // The closes span 10..11 but the wicks reach 5..20. A chart scaled to the
  // closes would clip both wicks.
  const { min, max } = extent([c(1, 10, 20, 5, 11), c(2, 11, 12, 10, 10)]);
  assert.ok(min < 5, 'the low wick must be inside the box');
  assert.ok(max > 20, 'the high wick must be inside the box');
});

test('extent widens a flat window instead of dividing by zero', () => {
  const { min, max, flat } = extent([c(1, 50, 50, 50, 50), c(2, 50, 50, 50, 50)]);
  assert.equal(flat, true);
  assert.ok(max > min, 'a flat series still needs a non-zero span');
  assert.ok(min < 50 && max > 50);
});

test('extent of nothing is a safe unit box', () => {
  assert.deepEqual(extent([]), { min: 0, max: 1, flat: true });
});

test('downsample merges buckets as a real OHLC roll-up', () => {
  const rows = [
    c(1, 10, 12, 9, 11),
    c(2, 11, 15, 10, 14),
    c(3, 14, 14, 8, 9),
    c(4, 9, 10, 7, 8),
  ];
  const out = downsample(rows, 2);
  assert.equal(out.length, 2);
  // First bucket: open of the first, close of the last, highest high, lowest low.
  assert.deepEqual(out[0], { t: 1, o: 10, c: 14, h: 15, l: 9 });
  assert.deepEqual(out[1], { t: 3, o: 14, c: 8, h: 14, l: 7 });
});

test('downsample leaves a series that already fits untouched', () => {
  const rows = [c(1, 10, 12, 9, 11), c(2, 11, 13, 10, 12)];
  assert.deepEqual(downsample(rows, 24), rows);
  assert.deepEqual(downsample(rows, 0), rows);
});

test('build of nothing is an empty result, not a broken path', () => {
  const r = build([], { width: 100, height: 40 });
  assert.equal(r.empty, true);
  assert.equal(r.count, 0);
  assert.equal(r.bodyPathUp, '');
  assert.equal(r.wickPathDown, '');
});

test('build lays every candle inside the box', () => {
  const rows = [c(1, 10, 12, 9, 11), c(2, 11, 13, 10, 12), c(3, 12, 12, 8, 9)];
  const r = build(rows, { width: 90, height: 40, padY: 2 });
  assert.equal(r.count, 3);
  for (const k of r.candles) {
    assert.ok(k.x >= 0 && k.x + k.w <= 90, `body ${k.i} inside the width`);
    assert.ok(k.bodyTop >= 0 && k.bodyTop + k.bodyH <= 40, `body ${k.i} inside the height`);
    assert.ok(k.wickTop >= 0 && k.wickBottom <= 40, `wick ${k.i} inside the height`);
    assert.ok(k.bodyH >= 1, 'a body is never thinner than 1px');
  }
});

test('build puts rising bodies in one path and falling in another', () => {
  const r = build([c(1, 10, 12, 9, 11), c(2, 11, 13, 10, 9)], { width: 40, height: 20 });
  assert.equal(r.candles[0].up, true);
  assert.equal(r.candles[1].up, false);
  assert.ok(r.bodyPathUp.length > 0);
  assert.ok(r.bodyPathDown.length > 0);
  assert.ok(r.wickPathUp.length > 0);
  assert.ok(r.wickPathDown.length > 0);
});

test('a doji counts as rising and still has a visible body', () => {
  // open === close is a real, common case (a quiet period). Rounding would give
  // it height 0 and the candle would vanish from the chart.
  const r = build([c(1, 10, 11, 9, 10)], { width: 20, height: 20 });
  assert.equal(r.candles[0].up, true);
  assert.ok(r.candles[0].bodyH >= 1);
});

test('build reports the change across the window', () => {
  const r = build([c(1, 100, 101, 99, 100), c(2, 100, 111, 99, 110)], { width: 40, height: 20 });
  assert.equal(r.first, 100);
  assert.equal(r.last, 110);
  assert.equal(r.change, 10);
  assert.equal(r.changePct, 10);
  assert.equal(r.direction, 'up');
});

test('build accepts w/h as well as width/height', () => {
  // The first caller passed w/h; the mismatch was silent and laid every candle
  // out inside a single unit, so the chart rendered as a 1px sliver.
  const rows = [c(1, 10, 12, 9, 11), c(2, 11, 13, 10, 12)];
  const a = build(rows, { width: 60, height: 30 });
  const b = build(rows, { w: 60, h: 30 });
  assert.deepEqual(b.candles.map((k) => k.x), a.candles.map((k) => k.x));
});

test('build merges the series when the box is too narrow for every candle', () => {
  const rows = [];
  for (let i = 0; i < 24; i += 1) rows.push(c(i, 10 + i, 12 + i, 9 + i, 11 + i));
  const r = build(rows, { width: 76, height: 11, maxCandles: 12 });
  assert.equal(r.count, 12, 'twelve candles, not the last twelve of twenty-four');
  // The first merged candle closes on the second row's close (11 + 1), so the
  // window still starts at the beginning of the series rather than at row 12.
  assert.equal(r.first, 12, 'the window still starts where it started');
  assert.equal(r.last, 34, 'and still ends where it ended');
});

test('a single candle has a step and does not divide by zero', () => {
  const r = build([c(1, 10, 12, 9, 11)], { width: 30, height: 20 });
  assert.equal(r.single, true);
  assert.equal(r.count, 1);
  assert.ok(Number.isFinite(r.candles[0].x));
  assert.ok(r.candles[0].w >= 1);
});

/**
 * No candle may leave the box, at any size or count.
 *
 * This is the regression guard for the bug the user reported as "candles spill
 * out of the token's frame". Two separate causes were found:
 *
 *   1. `candleHtml` built its viewBox from `CANDLE_BOX.w` / `.h` while the
 *      object declares `width` / `height`, so the attribute was literally
 *      "0 0 undefined undefined" and the browser fell back to a default box.
 *   2. `bodyX` was rounded without a clamp, so at the right edge a body could
 *      round one pixel past `width`.
 *
 * (1) is a renderer concern and is asserted in spark.e2e.js; (2) is geometry
 * and is asserted here, over a grid of boxes and series lengths rather than one
 * hand-picked case.
 */
test('no candle ever leaves the box, across sizes and series lengths', () => {
  const boxes = [[100, 30], [88, 16], [84, 11], [60, 16], [40, 11], [20, 8]];
  const counts = [1, 2, 3, 5, 12, 18, 24, 36, 60, 120];
  let checked = 0;
  for (const [width, height] of boxes) {
    for (const n of counts) {
      const rows = [];
      for (let i = 0; i < n; i += 1) {
        const o = 100 + Math.sin(i) * 2;
        const cl = o * 1.01;
        rows.push(c(i, o, Math.max(o, cl) * 1.01, Math.min(o, cl) * 0.99, cl));
      }
      const r = build(rows, { width, height, padY: 2, bodyRatio: 0.58, maxCandles: n });
      for (const k of r.candles) {
        checked += 1;
        assert.ok(k.x >= 0, `x >= 0 (${width}x${height}, n=${n})`);
        assert.ok(k.x + k.w <= width, `body right edge inside ${width} (n=${n})`);
        assert.ok(k.bodyTop >= 0, `body top >= 0 (${width}x${height}, n=${n})`);
        assert.ok(k.bodyTop + k.bodyH <= height, `body bottom inside ${height} (n=${n})`);
        assert.ok(k.wickTop >= 0, `wick top >= 0 (${width}x${height}, n=${n})`);
        assert.ok(k.wickBottom <= height, `wick bottom inside ${height} (n=${n})`);
      }
    }
  }
  assert.ok(checked > 1000, `the grid actually exercised the geometry (${checked} candles)`);
});

test('bodies keep a visible gap at the shipped candle counts', () => {
  // 36 in the panel and 18 in the strip are what app.js asks for. If a body
  // ever grows to touch its neighbour the chart reads as a solid block, which
  // is the "one jagged line" failure the strip was already fixed for once.
  const panel = build(series(36), { width: 88, height: 16, padY: 2, bodyRatio: 0.58, maxCandles: 36 });
  const strip = build(series(18), { width: 84, height: 11, padY: 2, bodyRatio: 0.58, maxCandles: 18 });
  for (const [name, r] of [['panel', panel], ['strip', strip]]) {
    let minGap = Infinity;
    for (let i = 1; i < r.candles.length; i += 1) {
      const gap = r.candles[i].x - (r.candles[i - 1].x + r.candles[i - 1].w);
      if (gap < minGap) minGap = gap;
    }
    assert.ok(minGap >= 1, `${name}: at least 1px between bodies (got ${minGap})`);
  }
});
