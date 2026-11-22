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

/* ==========================================================================
 * Per-coin rows in the strip
 * ========================================================================== */

const {
  normalizeStripCoins,
  stripCoinRows,
  stripRowsThatFit,
  stripHeightFor,
  STRIP_ROW_H,
  STRIP_BASE_H,
  STRIP_MAX_ROWS,
  STRIP_MAX_SELECTED,
} = require('../src/display');

test('normalizeStripCoins accepts an array and an object form', () => {
  assert.deepEqual(normalizeStripCoins(['ldo', 'ETH']), ['LDO', 'ETH']);
  // The object form is what a hand-edited file or an older shape may hold.
  assert.deepEqual(normalizeStripCoins({ LDO: true, ETH: false, SOL: true }), ['LDO', 'SOL']);
  assert.deepEqual(normalizeStripCoins(null), []);
  assert.deepEqual(normalizeStripCoins(undefined), []);
  assert.deepEqual(normalizeStripCoins('LDO'), []);
});

test('normalizeStripCoins keeps the ticked order and drops duplicates', () => {
  // Order matters: the rows appear in the strip in the order they were ticked,
  // not in portfolio order, so a price move cannot reshuffle the strip.
  assert.deepEqual(normalizeStripCoins(['SOL', 'LDO', 'SOL']), ['SOL', 'LDO']);
});

test('normalizeStripCoins caps the selection', () => {
  const many = Array.from({ length: 20 }, (_, i) => `C${i}`);
  assert.equal(normalizeStripCoins(many).length, STRIP_MAX_SELECTED);
});

test('stripCoinRows draws only held coins, in the ticked order', () => {
  const positions = [
    { base: 'ETH', symbol: 'ETHUSDT', qty: 1 },
    { base: 'LDO', symbol: 'LDOUSDT', qty: 4300 },
    { base: 'GONE', symbol: 'GONEUSDT', qty: 0 },
  ];
  const rows = stripCoinRows(positions, ['LDO', 'ETH']);
  assert.deepEqual(rows.map((r) => r.base), ['LDO', 'ETH']);
});

test('stripCoinRows skips a selected coin that is no longer held', () => {
  // After selling out, a row reading "0.00" is noise. The selection is kept,
  // so buying back in brings the row straight back.
  const positions = [{ base: 'ETH', symbol: 'ETHUSDT', qty: 1 }];
  assert.deepEqual(stripCoinRows(positions, ['ETH', 'SOLD']).map((r) => r.base), ['ETH']);
});

test('stripCoinRows with nothing selected draws nothing', () => {
  const positions = [{ base: 'ETH', symbol: 'ETHUSDT', qty: 1 }];
  assert.deepEqual(stripCoinRows(positions, []), []);
  assert.deepEqual(stripCoinRows(positions, null), []);
});

test('stripCoinRows tolerates junk instead of throwing', () => {
  assert.deepEqual(stripCoinRows(null, ['ETH']), []);
  assert.deepEqual(stripCoinRows([null, undefined, {}], ['ETH']), []);
});

test('stripRowsThatFit divides the leftover height into 13px lines', () => {
  // A 48px taskbar leaves 44px: one summary line, then two coin rows.
  assert.equal(stripRowsThatFit(44), 2);
  // Unconstrained (edge mode) allows the full cap.
  assert.equal(stripRowsThatFit(Infinity), STRIP_MAX_ROWS);
  // Too short for even one row.
  assert.equal(stripRowsThatFit(STRIP_ROW_H), 0);
  assert.equal(stripRowsThatFit(0), 0);
});

test('stripHeightFor with no coins is the height every earlier version used', () => {
  // This is the upgrade-safety property: an install that has never ticked a
  // coin must get exactly the 44px strip it always had.
  assert.equal(stripHeightFor(0, 44), STRIP_BASE_H);
  assert.equal(stripHeightFor(0, Infinity), STRIP_BASE_H);
});

test('stripHeightFor grows by one line per coin and clamps to the limit', () => {
  assert.equal(stripHeightFor(1, Infinity), 2 * STRIP_ROW_H + 4);
  assert.equal(stripHeightFor(2, Infinity), 3 * STRIP_ROW_H + 4);
  // Clamped: a 44px taskbar cannot host eight rows.
  assert.equal(stripHeightFor(8, 44), 44);
  // Never below the floor.
  assert.equal(stripHeightFor(0, 10), 28);
});
