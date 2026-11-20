'use strict';
/**
 * Unit tests for the chart geometry.
 *
 * These exist because the chart's hard cases are all invisible in a screenshot:
 * a flat series divides by zero, a single sample has no time span, and a
 * history older than the window would render as an empty box. Each of those is
 * asserted here directly instead of being eyeballed.
 */
const test = require('node:test');
const assert = require('node:assert');
const Chart = require('../renderer/chart.js');

const MIN = 60 * 1000;

test('toPoints filters to the visible window', () => {
  const now = 1_000_000_000;
  const history = [
    { t: now - 30 * MIN, v: 100 },
    { t: now - 10 * MIN, v: 200 },
    { t: now - 5 * MIN, v: 300 },
    { t: now - 1 * MIN, v: 400 },
  ];
  const pts = Chart.toPoints(history, { now, rangeMs: 15 * MIN });
  assert.equal(pts.length, 3, 'only the last 15 minutes');
  assert.deepEqual(pts.map((p) => p.v), [200, 300, 400]);
});

test('toPoints sorts an out-of-order history', () => {
  const now = 1_000_000_000;
  const history = [
    { t: now - 1 * MIN, v: 3 },
    { t: now - 3 * MIN, v: 1 },
    { t: now - 2 * MIN, v: 2 },
  ];
  const pts = Chart.toPoints(history, { now, rangeMs: 15 * MIN });
  assert.deepEqual(pts.map((p) => p.v), [1, 2, 3]);
});

test('toPoints drops malformed samples instead of throwing', () => {
  const now = 1_000_000_000;
  const history = [
    { t: now - 2 * MIN, v: 10 },
    null,
    { t: 'nope', v: 5 },
    { t: now - 1 * MIN, v: 'x' },
    { t: now - 1 * MIN, v: 20 },
  ];
  const pts = Chart.toPoints(history, { now, rangeMs: 15 * MIN });
  assert.deepEqual(pts.map((p) => p.v), [10, 20]);
});

test('toPoints falls back to the last samples when the history is stale', () => {
  // The app was closed for an hour: nothing is inside the window, but showing
  // an empty box would look broken.
  const now = 1_000_000_000;
  const history = [
    { t: now - 120 * MIN, v: 100 },
    { t: now - 90 * MIN, v: 150 },
  ];
  const pts = Chart.toPoints(history, { now, rangeMs: 15 * MIN });
  assert.equal(pts.length, 2, 'falls back to the last two points');
  assert.deepEqual(pts.map((p) => p.v), [100, 150]);
});

test('toPoints returns nothing for an empty history', () => {
  assert.deepEqual(Chart.toPoints([], { now: 1, rangeMs: MIN }), []);
  assert.deepEqual(Chart.toPoints(null, { now: 1, rangeMs: MIN }), []);
});

test('extent widens a flat series so it cannot divide by zero', () => {
  const e = Chart.extent([{ t: 1, v: 500 }, { t: 2, v: 500 }]);
  assert.equal(e.flat, true);
  assert.ok(e.max > e.min, 'a flat series still gets a non-zero span');
  assert.ok(e.min < 500 && e.max > 500, 'the value sits inside the band');
});

test('extent adds headroom to a real series', () => {
  const e = Chart.extent([{ t: 1, v: 100 }, { t: 2, v: 200 }]);
  assert.equal(e.flat, false);
  assert.ok(e.min < 100, 'min is padded below the data');
  assert.ok(e.max > 200, 'max is padded above the data');
});

test('project maps the highest value to the top of the box', () => {
  const pts = Chart.project(
    [{ t: 0, v: 100 }, { t: 1000, v: 200 }],
    { width: 100, height: 34, padX: 0, padY: 0 },
  );
  assert.equal(pts.length, 2);
  // Higher value -> smaller y (SVG y grows downward).
  assert.ok(pts[1].y < pts[0].y, 'the later, higher point is above the earlier one');
  assert.equal(pts[0].x, 0);
  assert.equal(pts[1].x, 100);
});

test('project keeps every point inside the box', () => {
  const pts = Chart.project(
    [{ t: 0, v: 1 }, { t: 500, v: 50 }, { t: 1000, v: 25 }],
    { width: 100, height: 34, padX: 2, padY: 3 },
  );
  for (const p of pts) {
    assert.ok(p.x >= 2 && p.x <= 98, `x in range: ${p.x}`);
    assert.ok(p.y >= 3 && p.y <= 31, `y in range: ${p.y}`);
  }
});

test('project duplicates a single point so a line can be drawn', () => {
  const pts = Chart.project([{ t: 5, v: 42 }], { width: 100, height: 34 });
  assert.equal(pts.length, 2, 'one sample becomes a flat two-point line');
  assert.equal(pts[0].y, pts[1].y, 'the line is flat');
  assert.ok(pts[1].x > pts[0].x, 'it spans the box');
});

test('project handles several points sharing one timestamp', () => {
  const pts = Chart.project(
    [{ t: 7, v: 10 }, { t: 7, v: 20 }, { t: 7, v: 30 }],
    { width: 100, height: 34 },
  );
  assert.equal(pts.length, 3);
  assert.ok(pts[0].x < pts[1].x && pts[1].x < pts[2].x, 'spread evenly instead of stacking');
});

test('linePath and areaPath produce valid SVG path data', () => {
  const pts = [{ x: 0, y: 10 }, { x: 50, y: 5 }, { x: 100, y: 20 }];
  assert.equal(Chart.linePath(pts), 'M0 10 L50 5 L100 20');
  const area = Chart.areaPath(pts, 34);
  assert.ok(area.startsWith('M0 10'), area);
  assert.ok(area.endsWith('Z'), 'the area is closed');
  assert.ok(area.includes('L100 34'), 'it drops to the baseline at the right edge');
});

test('linePath and areaPath return empty strings for no points', () => {
  assert.equal(Chart.linePath([]), '');
  assert.equal(Chart.areaPath([], 10), '');
  assert.equal(Chart.linePath(null), '');
});

test('build reports the direction and the change across the window', () => {
  const now = 1_000_000_000;
  const history = [
    { t: now - 4 * MIN, v: 1000 },
    { t: now - 2 * MIN, v: 1100 },
    { t: now - 1 * MIN, v: 1200 },
  ];
  const b = Chart.build(history, { now, rangeMs: 15 * MIN, box: { width: 100, height: 34 } });
  assert.equal(b.direction, 'up');
  assert.equal(b.change, 200);
  assert.equal(b.changePct, 20);
  assert.equal(b.empty, false);
  assert.equal(b.single, false);
  assert.ok(b.line.length > 0);
});

test('build reports a falling window as down', () => {
  const now = 1_000_000_000;
  const b = Chart.build(
    [{ t: now - 2 * MIN, v: 1000 }, { t: now - 1 * MIN, v: 900 }],
    { now, rangeMs: 15 * MIN, box: { width: 100, height: 34 } },
  );
  assert.equal(b.direction, 'down');
  assert.equal(b.change, -100);
  assert.equal(b.changePct, -10);
});

test('build flags a single sample instead of implying a trend', () => {
  const now = 1_000_000_000;
  const b = Chart.build([{ t: now - 1000, v: 500 }], { now, rangeMs: 15 * MIN });
  assert.equal(b.single, true);
  assert.equal(b.direction, 'flat');
  assert.equal(b.change, 0);
});

test('build flags an empty history', () => {
  const b = Chart.build([], { now: 1, rangeMs: MIN });
  assert.equal(b.empty, true);
  assert.equal(b.line, '');
  assert.equal(b.first, null);
});

test('build survives a flat series without NaN coordinates', () => {
  const now = 1_000_000_000;
  const b = Chart.build(
    [{ t: now - 2 * MIN, v: 500 }, { t: now - 1 * MIN, v: 500 }],
    { now, rangeMs: 15 * MIN, box: { width: 100, height: 34 } },
  );
  assert.equal(b.direction, 'flat');
  for (const p of b.projected) {
    assert.ok(Number.isFinite(p.x), `x finite: ${p.x}`);
    assert.ok(Number.isFinite(p.y), `y finite: ${p.y}`);
  }
  assert.ok(!b.line.includes('NaN'), b.line);
});
