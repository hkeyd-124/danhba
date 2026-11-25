'use strict';
/**
 * Demo futures: the formulas a trader acts on.
 *
 * The liquidation price is the one number here that can cost someone money if
 * it is wrong, so it is checked against Binance's own published formula rather
 * than against whatever this module happens to produce.
 */
const test = require('node:test');
const assert = require('node:assert');

const F = require('../src/futures');

test('liquidation: long at 10x sits 9.6% below entry', () => {
  // 1/10 - 0.004 = 0.096
  const liq = F.liquidationPrice(100, 'LONG', 10);
  assert.ok(Math.abs(liq - 90.4) < 1e-9, `expected 90.4, got ${liq}`);
});

test('liquidation: short at 10x sits 9.6% above entry', () => {
  const liq = F.liquidationPrice(100, 'SHORT', 10);
  assert.ok(Math.abs(liq - 109.6) < 1e-9, `expected 109.6, got ${liq}`);
});

test('liquidation: 1x long is 99.6% below entry, not at zero', () => {
  // At 1x the whole notional is the margin, so the position can lose almost
  // all of it before dying: 1/1 - 0.004 = 0.996. A naive `entry * (1 - 1/lev)`
  // would return 0 here and the UI would print "liq 0.00".
  const liq = F.liquidationPrice(100, 'LONG', 1);
  assert.ok(Math.abs(liq - 0.4) < 1e-9, `expected 0.4, got ${liq}`);
});

test('liquidation: 125x long is 0.4% below entry', () => {
  const liq = F.liquidationPrice(100, 'LONG', 125);
  assert.ok(Math.abs(liq - 99.6) < 1e-9, `expected 99.6, got ${liq}`);
});

test('liquidation: refuses inputs that cannot produce a price', () => {
  assert.strictEqual(F.liquidationPrice(0, 'LONG', 10), 0);
  assert.strictEqual(F.liquidationPrice(-5, 'LONG', 10), 0);
  assert.strictEqual(F.liquidationPrice(100, 'LONG', 0), 0);
  assert.strictEqual(F.liquidationPrice(100, 'LONG', NaN), 0);
});

test('side: anything that is not long/buy is short', () => {
  assert.strictEqual(F.normalizeSide('long'), 'LONG');
  assert.strictEqual(F.normalizeSide('BUY'), 'LONG');
  assert.strictEqual(F.normalizeSide('short'), 'SHORT');
  assert.strictEqual(F.normalizeSide('SELL'), 'SHORT');
  assert.strictEqual(F.normalizeSide(undefined), 'SHORT');
});

test('build: qty follows from margin x leverage, not from the user', () => {
  const r = F.buildPosition({ side: 'LONG', leverage: 10, margin: 500, entry: 100 }, 'BTCUSDT');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.position.notional, 5000);
  assert.strictEqual(r.position.qty, 50);
  assert.strictEqual(r.position.entryFee, 2.5);
});

test('build: rejects each bad field with its own message', () => {
  const base = { side: 'LONG', leverage: 10, margin: 500, entry: 100 };
  assert.match(F.buildPosition({ ...base, entry: 0 }, 'BTCUSDT').error, /Giá vào/);
  assert.match(F.buildPosition({ ...base, margin: 0 }, 'BTCUSDT').error, /Ký quỹ/);
  assert.match(F.buildPosition({ ...base, leverage: 0 }, 'BTCUSDT').error, /Đòn bẩy/);
  assert.match(F.buildPosition({ ...base, leverage: 200 }, 'BTCUSDT').error, /Đòn bẩy/);
  assert.match(F.buildPosition(base, '').error, /đồng coin/);
});

test('build: leverage is rounded, so 10.4 and 10 behave the same', () => {
  const a = F.buildPosition({ side: 'LONG', leverage: 10.4, margin: 100, entry: 50 }, 'ETHUSDT');
  const b = F.buildPosition({ side: 'LONG', leverage: 10, margin: 100, entry: 50 }, 'ETHUSDT');
  assert.strictEqual(a.position.leverage, 10);
  assert.strictEqual(a.position.qty, b.position.qty);
});

test('mark: long PnL is net of both fees', () => {
  const { position } = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT',
  );
  // notional 1000, qty 10. Mark 110 -> gross +100.
  // entry fee 0.5, exit fee 110*10*0.0005 = 0.55 -> net 98.95
  const m = F.markPosition(position, 110);
  assert.ok(Math.abs(m.gross - 100) < 1e-9, `gross ${m.gross}`);
  assert.ok(Math.abs(m.pnl - 98.95) < 1e-9, `pnl ${m.pnl}`);
  assert.ok(Math.abs(m.roe - 98.95) < 1e-9, `roe ${m.roe}`);
});

test('mark: short PnL is positive when price falls', () => {
  const { position } = F.buildPosition(
    { side: 'SHORT', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT',
  );
  const m = F.markPosition(position, 90);
  assert.ok(m.gross > 0, `gross ${m.gross}`);
  assert.ok(m.pnl > 0, `pnl ${m.pnl}`);
});

test('mark: no price falls back to entry and reports hasPrice false', () => {
  const { position } = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT',
  );
  const m = F.markPosition(position, 0);
  assert.strictEqual(m.hasPrice, false);
  assert.strictEqual(m.mark, 100);
  // Only the entry fee is lost, because nothing was closed.
  assert.ok(Math.abs(m.pnl + 0.5) < 1e-9, `pnl ${m.pnl}`);
});

test('mark: liquidation is detected on the right side of the price', () => {
  const long = F.buildPosition({ side: 'LONG', leverage: 50, margin: 100, entry: 100 }, 'BTCUSDT').position;
  const short = F.buildPosition({ side: 'SHORT', leverage: 50, margin: 100, entry: 100 }, 'BTCUSDT').position;
  // 50x long liquidates at 100 * (1 - 0.02 + 0.004) = 98.4
  assert.strictEqual(F.markPosition(long, 99).liquidated, false);
  assert.strictEqual(F.markPosition(long, 98).liquidated, true);
  // A long must NOT be liquidated by a price ABOVE entry.
  assert.strictEqual(F.markPosition(long, 200).liquidated, false);
  // 50x short liquidates at 101.6
  assert.strictEqual(F.markPosition(short, 101).liquidated, false);
  assert.strictEqual(F.markPosition(short, 102).liquidated, true);
  assert.strictEqual(F.markPosition(short, 50).liquidated, false);
});

test('mark: liq distance is signed and shrinks as price approaches', () => {
  const p = F.buildPosition({ side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT').position;
  const far = F.markPosition(p, 100);
  const near = F.markPosition(p, 92);
  assert.ok(far.liqDistancePct > 0);
  assert.ok(near.liqDistancePct > 0);
  assert.ok(near.liqDistancePct < far.liqDistancePct);
});

test('compute: totals add up and equity is margin plus PnL', () => {
  const a = F.buildPosition({ side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT').position;
  const b = F.buildPosition({ side: 'SHORT', leverage: 5, margin: 200, entry: 50 }, 'ETHUSDT').position;
  const { positions, totals } = F.computeFutures([a, b], { BTCUSDT: 110, ETHUSDT: 50 });
  assert.strictEqual(positions.length, 2);
  assert.strictEqual(totals.margin, 300);
  assert.strictEqual(totals.notional, 1000 + 1000);
  assert.ok(Math.abs(totals.equity - (300 + totals.pnl)) < 1e-9);
  assert.strictEqual(totals.atRisk, 0);
});

test('compute: nearest is the position closest to liquidation, either side', () => {
  const safe = F.buildPosition({ side: 'LONG', leverage: 2, margin: 100, entry: 100 }, 'BTCUSDT').position;
  const risky = F.buildPosition({ side: 'SHORT', leverage: 50, margin: 100, entry: 100 }, 'ETHUSDT').position;
  const { totals } = F.computeFutures([safe, risky], { BTCUSDT: 100, ETHUSDT: 101 });
  assert.strictEqual(totals.nearest.symbol, 'ETHUSDT');
});

test('compute: an empty book has no nearest and no rows', () => {
  const { positions, totals } = F.computeFutures([], {});
  assert.strictEqual(positions.length, 0);
  assert.strictEqual(totals.nearest, null);
  assert.deepStrictEqual(F.stripRows(totals, {}), []);
});

test('strip rows: two independent pins', () => {
  const p = F.buildPosition({ side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT').position;
  const { totals } = F.computeFutures([p], { BTCUSDT: 105 });

  const both = F.stripRows(totals, { pnl: true, liq: true });
  assert.strictEqual(both.length, 2);
  assert.strictEqual(both[0].kind, 'pnl');
  assert.strictEqual(both[1].kind, 'liq');

  const onlyPnl = F.stripRows(totals, { pnl: true, liq: false });
  assert.strictEqual(onlyPnl.length, 1);
  assert.strictEqual(onlyPnl[0].kind, 'pnl');

  const onlyLiq = F.stripRows(totals, { pnl: false, liq: true });
  assert.strictEqual(onlyLiq.length, 1);
  assert.strictEqual(onlyLiq[0].kind, 'liq');
});

test('strip rows: tone follows the sign of the PnL', () => {
  const p = F.buildPosition({ side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT').position;
  const up = F.computeFutures([p], { BTCUSDT: 110 }).totals;
  const down = F.computeFutures([p], { BTCUSDT: 90 }).totals;
  assert.strictEqual(F.stripRows(up, {})[0].tone, 'up');
  assert.strictEqual(F.stripRows(down, {})[0].tone, 'down');
});

test('strip rows: a position near liquidation is toned down even if PnL is flat', () => {
  const p = F.buildPosition({ side: 'LONG', leverage: 50, margin: 100, entry: 100 }, 'BTCUSDT').position;
  // 50x long liquidates at 98.4; mark 99 is 0.6% away.
  const { totals } = F.computeFutures([p], { BTCUSDT: 99 });
  const liqRow = F.stripRows(totals, { pnl: false, liq: true })[0];
  assert.strictEqual(liqRow.tone, 'down');
});
