'use strict';
/**
 * Tests for the 'touch' alert kind — "cảnh báo giá đạt".
 *
 * The point of this kind is that DIRECTION DOES NOT MATTER: a rise into the
 * level and a fall into the level are the same event. Most of these tests exist
 * to pin that down, because the two older kinds are directional and it would be
 * easy to accidentally inherit their crossing logic.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  AlertEngine,
  DEFAULT_TOUCH_TOLERANCE_PCT,
  normalizeDirection,
  normalizeTolerance,
} = require('../src/alerts');

function makeEngine(alerts, opts = {}) {
  const engine = new AlertEngine({ cooldownMs: 0, ...opts });
  engine.setAlerts(alerts);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));
  return { engine, fired };
}

const touch = (over = {}) => ({
  id: 't1', symbol: 'BTCUSDT', price: 100, direction: 'touch', enabled: true, ...over,
});

// ---------------------------------------------------------------- direction

test('normalizeDirection accepts touch and falls back to above', () => {
  assert.equal(normalizeDirection('touch'), 'touch');
  assert.equal(normalizeDirection('above'), 'above');
  assert.equal(normalizeDirection('below'), 'below');
  assert.equal(normalizeDirection('nonsense'), 'above');
  assert.equal(normalizeDirection(undefined), 'above');
});

test('normalizeTolerance clamps and defaults', () => {
  assert.equal(normalizeTolerance(undefined), DEFAULT_TOUCH_TOLERANCE_PCT);
  assert.equal(normalizeTolerance('0.5'), 0.5);
  assert.equal(normalizeTolerance(0), 0, 'zero is a legitimate tolerance');
  assert.equal(normalizeTolerance(-1), DEFAULT_TOUCH_TOLERANCE_PCT);
  assert.equal(normalizeTolerance(999), 50, 'clamped to 50%');
  assert.equal(normalizeTolerance('abc'), DEFAULT_TOUCH_TOLERANCE_PCT);
});

// ---------------------------------------------------------------- the core

test('touch fires when the price RISES into the level', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);
  assert.equal(fired.length, 1, 'a rise to the level is a touch');
  assert.equal(fired[0].direction, 'touch');
  assert.equal(fired[0].level, 100);
});

test('touch fires when the price FALLS into the level', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('BTCUSDT', 110);
  engine.onPrice('BTCUSDT', 100);
  assert.equal(fired.length, 1, 'a fall to the level is the same event');
  assert.equal(fired[0].direction, 'touch');
});

test('touch fires on a GAP that jumps over the level without printing it', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('BTCUSDT', 99);
  engine.onPrice('BTCUSDT', 101);   // never prints 100
  assert.equal(fired.length, 1, 'the swept interval must count as a touch');
});

test('touch does NOT fire when the price stays clear of the band', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('BTCUSDT', 80);
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 95);
  assert.equal(fired.length, 0);
});

test('touch fires on the very first tick if the price already sits on the level', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('BTCUSDT', 100);
  assert.equal(fired.length, 1, 'an alert created on the level should say so once');
});

test('touch does not fire on a first tick far from the level', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('BTCUSDT', 50);
  assert.equal(fired.length, 0);
});

// ---------------------------------------------------------------- tolerance

test('tolerance widens the band in both directions', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 1 })]);   // ±1 => 99..101
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 99.5);
  assert.equal(fired.length, 1, 'inside the band counts');
});

test('a price just outside the band does not fire', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0.1 })]);  // ±0.1 => 99.9..100.1
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 99.5);
  assert.equal(fired.length, 0, '99.5 is outside a 0.1% band around 100');
});

test('zero tolerance still fires on an exact hit', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0 })]);
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);
  assert.equal(fired.length, 1);
});

// ---------------------------------------------------------------- hysteresis

test('touch does not re-fire while the price jitters inside the band', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0.5 })]);  // ±0.5 => 99.5..100.5
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);    // fire
  engine.onPrice('BTCUSDT', 100.2);
  engine.onPrice('BTCUSDT', 99.8);
  engine.onPrice('BTCUSDT', 100.1);
  assert.equal(fired.length, 1, 'jitter on the level must not spam');
});

test('touch re-arms once the price leaves the band by the rearm factor', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0.5 })]);  // band ±0.5, rearm at ±1.5
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);    // fire
  engine.onPrice('BTCUSDT', 101);    // 1.0 away: still disarmed (needs > 1.5)
  assert.equal(fired.length, 1, 'must stay disarmed just outside the band');
  engine.onPrice('BTCUSDT', 102);    // 2.0 away: re-armed
  engine.onPrice('BTCUSDT', 100);    // fire again
  assert.equal(fired.length, 2, 'a genuine second approach must fire');
});

test('touch re-arms downward too', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0.5 })]);
  engine.onPrice('BTCUSDT', 110);
  engine.onPrice('BTCUSDT', 100);    // fire
  engine.onPrice('BTCUSDT', 98);     // 2.0 below: re-armed
  engine.onPrice('BTCUSDT', 100);    // fire again
  assert.equal(fired.length, 2);
});

// ---------------------------------------------------------------- coexistence

test('touch and the directional kinds coexist on the same symbol', () => {
  const { engine, fired } = makeEngine([
    { id: 'up', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: true },
    { id: 'dn', symbol: 'BTCUSDT', price: 100, direction: 'below', enabled: true },
    { id: 'tc', symbol: 'BTCUSDT', price: 100, direction: 'touch', enabled: true },
  ]);
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);
  const ids = fired.map((f) => f.id).sort();
  assert.deepEqual(ids, ['tc', 'up'], 'a rise to 100 is an above-cross AND a touch, not a below-cross');
});

test('a disabled touch alert never fires', () => {
  const { engine, fired } = makeEngine([touch({ enabled: false })]);
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);
  assert.equal(fired.length, 0);
});

test('touch alerts ignore other symbols', () => {
  const { engine, fired } = makeEngine([touch()]);
  engine.onPrice('ETHUSDT', 100);
  assert.equal(fired.length, 0);
});

test('cooldown still applies on top of the touch hysteresis', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0.5 })], { cooldownMs: 60000 });
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);    // fire
  engine.onPrice('BTCUSDT', 110);    // re-armed
  engine.onPrice('BTCUSDT', 100);    // blocked by cooldown
  assert.equal(fired.length, 1);
});

test('resetCooldown re-arms a disarmed touch alert', () => {
  const { engine, fired } = makeEngine([touch({ tolerance: 0.5 })]);
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 100);    // fire, now disarmed
  engine.onPrice('BTCUSDT', 100.1);  // still disarmed
  assert.equal(fired.length, 1);
  engine.resetCooldown('t1');
  engine.onPrice('BTCUSDT', 100.2);
  assert.equal(fired.length, 2, 'editing the alert must let it fire again');
});

test('a touch payload carries prev, price, level and note', () => {
  const { engine, fired } = makeEngine([touch({ note: 'chốt lời' })]);
  engine.onPrice('BTCUSDT', 99);
  engine.onPrice('BTCUSDT', 100);
  assert.equal(fired[0].prev, 99);
  assert.equal(fired[0].price, 100);
  assert.equal(fired[0].level, 100);
  assert.equal(fired[0].note, 'chốt lời');
  assert.ok(Number.isFinite(fired[0].at));
});
