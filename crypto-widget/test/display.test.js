'use strict';
/**
 * Tests for the display record — "what is shown".
 *
 * The important property is that a settings file written by an OLDER version
 * (no `display` at all) must produce "everything on", because that is what
 * every earlier build drew. If that ever flips, an upgrade silently blanks the
 * widget for every existing user.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  DISPLAY_KEYS,
  DEFAULT_DISPLAY,
  normalizeDisplay,
  isVisible,
  visibleKeys,
  isEmptyPanel,
  isEmptyStrip,
  patchDisplay,
} = require('../src/display');

test('every key defaults to on', () => {
  const d = normalizeDisplay(undefined);
  for (const k of DISPLAY_KEYS) assert.equal(d[k], true, `${k} should default to true`);
});

test('a missing record means everything on, not everything off', () => {
  // This is the upgrade path: a v4 file has no `display` key at all.
  for (const raw of [undefined, null, {}, 'nonsense', 42]) {
    const d = normalizeDisplay(raw);
    assert.equal(visibleKeys(d).length, DISPLAY_KEYS.length, `raw=${JSON.stringify(raw)}`);
  }
});

test('only an explicit false turns something off', () => {
  assert.equal(normalizeDisplay({ total: false }).total, false);
  // Anything else is "leave it at the default", which is on. Reading a string
  // or a null as "off" would blank the widget for a hand-edited file.
  assert.equal(normalizeDisplay({ total: 0 }).total, true);
  assert.equal(normalizeDisplay({ total: null }).total, true);
  assert.equal(normalizeDisplay({ total: 'false' }).total, true);
});

test('unknown keys are dropped', () => {
  const d = normalizeDisplay({ total: false, somethingElse: false });
  assert.equal(d.somethingElse, undefined);
  assert.deepEqual(Object.keys(d).sort(), [...DISPLAY_KEYS].sort());
});

test('isVisible answers for a known key and refuses an unknown one', () => {
  const d = normalizeDisplay({ pnl: false });
  assert.equal(isVisible(d, 'pnl'), false);
  assert.equal(isVisible(d, 'total'), true);
  assert.equal(isVisible(d, 'notAThing'), false);
});

test('patchDisplay merges one key without dropping the rest', () => {
  const before = normalizeDisplay({ total: false, pnl: false });
  const after = patchDisplay(before, { pct: false });
  assert.equal(after.total, false, 'the earlier choice must survive');
  assert.equal(after.pnl, false);
  assert.equal(after.pct, false);
  assert.equal(after.list, true);
});

test('patchDisplay ignores junk values', () => {
  const before = normalizeDisplay({});
  const after = patchDisplay(before, { total: 'yes', pnl: 1, pct: null });
  assert.equal(after.total, true);
  assert.equal(after.pnl, true);
  assert.equal(after.pct, true);
});

test('an empty panel is detected, and the chart counts as content', () => {
  const allOff = normalizeDisplay({
    total: false, pnl: false, pct: false, positions: false, list: false, alloc: false,
  });
  assert.equal(isEmptyPanel(allOff, false), true);
  // The chart is its own switch, so a panel with only the chart is not empty.
  assert.equal(isEmptyPanel(allOff, true), false);
  // One number is enough to not be empty.
  assert.equal(isEmptyPanel({ ...allOff, total: true }, false), false);
});

test('an empty strip is detected', () => {
  assert.equal(isEmptyStrip(normalizeDisplay({})), false);
  assert.equal(isEmptyStrip(normalizeDisplay({
    stripTotal: false, stripPnl: false, stripPct: false,
  })), true);
  // The panel's switches must not affect the strip's emptiness.
  assert.equal(isEmptyStrip(normalizeDisplay({ total: false, pnl: false, pct: false })), false);
});

test('the strip and the panel are independent', () => {
  const d = normalizeDisplay({ list: false, stripPnl: false });
  assert.equal(d.list, false);
  assert.equal(d.stripPnl, false);
  // Turning the panel's P&L off must not touch the strip's.
  assert.equal(d.pnl, true);
  assert.equal(d.stripTotal, true);
});

test('DEFAULT_DISPLAY is frozen so a caller cannot mutate the shared default', () => {
  assert.equal(Object.isFrozen(DEFAULT_DISPLAY), true);
});
