'use strict';
/**
 * Sparkline geometry.
 *
 * These are the cases that actually break a line, not a happy path:
 *   - one value (no span, no line)
 *   - a flat series (min === max, divide by zero)
 *   - a missing series (empty box)
 *   - a value of 0 (a missing price, not a price of zero)
 *   - the box being stretched (the path must stay inside it)
 */
const test = require('node:test');
const assert = require('node:assert');
const Spark = require('../renderer/sparkline');

const BOX = { width: 100, height: 30, padY: 3 };

test('clean keeps only usable prices', () => {
  assert.deepEqual(Spark.clean([1, 0, null, undefined, '2', NaN, -3, 4]), [1, 2, 4]);
  assert.deepEqual(Spark.clean(null), []);
  assert.deepEqual(Spark.clean('nope'), []);
});

test('extent widens a flat series so it cannot divide by zero', () => {
  const e = Spark.extent([50, 50, 50]);
  assert.equal(e.flat, true);
  assert.ok(e.max > e.min, 'a flat series still has a non-zero span');
});

test('extent adds headroom to a real series', () => {
  const e = Spark.extent([10, 20]);
  assert.ok(e.min < 10);
  assert.ok(e.max > 20);
  assert.equal(e.flat, false);
});

test('project maps the series across the full width', () => {
  const pts = Spark.project([10, 20, 30], BOX);
  assert.equal(pts.length, 3);
  assert.equal(pts[0].x, 0, 'first point at the left edge');
  assert.equal(pts[2].x, 100, 'last point at the right edge');
  // Higher value -> smaller y (SVG y grows downward).
  assert.ok(pts[0].y > pts[2].y, 'the rising series goes up the box');
});

test('project keeps every point inside the box', () => {
  const pts = Spark.project([1, 100, 2, 99, 3], BOX);
  for (const p of pts) {
    assert.ok(p.x >= 0 && p.x <= 100, `x ${p.x} inside 0..100`);
    assert.ok(p.y >= 0 && p.y <= 30, `y ${p.y} inside 0..30`);
  }
});

test('a single value becomes a flat line, not an empty box', () => {
  const b = Spark.build([42], BOX);
  assert.equal(b.single, true);
  assert.equal(b.empty, false);
  assert.equal(b.projected.length, 2, 'the point is duplicated at the right edge');
  assert.equal(b.projected[0].x, 0);
  assert.equal(b.projected[1].x, 100);
  assert.equal(b.projected[0].y, b.projected[1].y, 'both ends at the same height');
});

test('an empty series is empty, and produces no path', () => {
  const b = Spark.build([], BOX);
  assert.equal(b.empty, true);
  assert.equal(b.line, '');
  assert.equal(b.area, '');
});

test('a series of zeros is empty, not a line at the floor', () => {
  const b = Spark.build([0, 0, 0], BOX);
  assert.equal(b.empty, true, 'a price of 0 is a missing price');
});

test('direction follows the first-to-last change', () => {
  assert.equal(Spark.build([1, 2, 3], BOX).direction, 'up');
  assert.equal(Spark.build([3, 2, 1], BOX).direction, 'down');
  assert.equal(Spark.build([2, 2, 2], BOX).direction, 'flat');
});

test('changePct is measured across the window', () => {
  const b = Spark.build([100, 150], BOX);
  assert.equal(b.change, 50);
  assert.equal(b.changePct, 50);
});

test('the line path is a valid M/L sequence with one point per value', () => {
  const b = Spark.build([1, 2, 3, 4], BOX);
  assert.match(b.line, /^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+){3}$/);
  assert.equal((b.line.match(/L/g) || []).length, 3);
});

test('the area path closes back to the baseline', () => {
  const b = Spark.build([1, 2, 3], BOX);
  assert.match(b.area, /Z$/);
  assert.ok(b.area.startsWith(b.line), 'the area starts with the line itself');
});

test('a stretched box still produces a path inside it', () => {
  const wide = Spark.build([1, 5, 2], { width: 300, height: 11, padY: 1 });
  for (const p of wide.projected) {
    assert.ok(p.x >= 0 && p.x <= 300);
    assert.ok(p.y >= 0 && p.y <= 11);
  }
});

test('a degenerate box does not produce NaN', () => {
  const b = Spark.build([1, 2], { width: 0, height: 0 });
  assert.ok(!/NaN/.test(b.line), `path must not contain NaN: ${b.line}`);
});
