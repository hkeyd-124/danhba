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
  const base = { side: 'LONG', leverage: 10, margin: 500, entry: 100, qty: 50 };
  assert.match(F.buildPosition({ ...base, entry: 0 }, 'BTCUSDT').error, /Giá vào/);
  assert.match(F.buildPosition({ ...base, qty: 0, margin: 0 }, 'BTCUSDT').error, /Khối lượng/);
  assert.match(F.buildPosition({ ...base, leverage: 0 }, 'BTCUSDT').error, /Đòn bẩy/);
  assert.match(F.buildPosition({ ...base, leverage: 200 }, 'BTCUSDT').error, /Đòn bẩy/);
  assert.match(F.buildPosition(base, '').error, /đồng coin/);
});

test('build: a margin below the requirement is refused, not rounded up', () => {
  // 50 units at 100 = 5000 notional; at 10x that needs 500 USDT.
  const r = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 50 }, 'BTCUSDT',
  );
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /Ký quỹ tối thiểu 500\.00/);
});

test('build: extra margin is allowed and lowers the effective leverage', () => {
  const r = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 1000, entry: 100, qty: 50 }, 'BTCUSDT',
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.position.requiredMargin, 500);
  assert.strictEqual(r.position.margin, 1000);
  assert.strictEqual(r.position.effectiveLeverage, 5);
});

test('build: an omitted margin defaults to the requirement', () => {
  const r = F.buildPosition(
    { side: 'LONG', leverage: 10, entry: 100, qty: 50 }, 'BTCUSDT',
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.position.margin, 500);
  assert.strictEqual(r.position.effectiveLeverage, 10);
});

test('build: a v8 row with no qty derives it from margin and leverage', () => {
  // Exactly what a row written before quantity existed looks like.
  const r = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100 }, 'BTCUSDT',
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.position.qty, 10);
  assert.strictEqual(r.position.marginMode, 'isolated');
});

test('margin mode: anything that is not cross is isolated', () => {
  assert.strictEqual(F.normalizeMarginMode('cross'), 'cross');
  assert.strictEqual(F.normalizeMarginMode('CROSS'), 'cross');
  assert.strictEqual(F.normalizeMarginMode('isolated'), 'isolated');
  assert.strictEqual(F.normalizeMarginMode(undefined), 'isolated');
  assert.strictEqual(F.normalizeMarginMode('nonsense'), 'isolated');
});

test('isolated liquidation: extra margin pushes the price further away', () => {
  const bare = F.isolatedLiquidation(100, 'LONG', 10, 100);
  const extra = F.isolatedLiquidation(100, 'LONG', 10, 200);
  // 10 units at 100 = 1000 notional, MMR 0.004 -> 4 USDT maintenance.
  // bare:  (100 - 4) / 10 = 9.6 below -> 90.4
  // extra: (200 - 4) / 10 = 19.6 below -> 80.4
  assert.ok(Math.abs(bare - 90.4) < 1e-9, `bare ${bare}`);
  assert.ok(Math.abs(extra - 80.4) < 1e-9, `extra ${extra}`);
  assert.ok(extra < bare, 'more margin must liquidate later for a long');
});

test('isolated liquidation: agrees with the leverage-only formula at the requirement', () => {
  for (const lev of [1, 3, 10, 25, 50, 125]) {
    const qty = 1;
    const entry = 100;
    const required = (qty * entry) / lev;
    const a = F.liquidationPrice(entry, 'LONG', lev);
    const b = F.isolatedLiquidation(entry, 'LONG', qty, required);
    assert.ok(Math.abs(a - b) < 1e-9, `${lev}x: ${a} vs ${b}`);
  }
});

test('cross liquidation: a lone cross position dies at the same place as isolated', () => {
  const p = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10, marginMode: 'cross' },
    'BTCUSDT',
  ).position;
  const { positions } = F.computeFutures([p], { BTCUSDT: 100 });
  const isolated = F.isolatedLiquidation(100, 'LONG', 10, 100);
  /**
   * Not exactly equal, and the gap is real: the cross pool's equity is
   * margin + PnL, and PnL has BOTH fees taken out of it (entry and the
   * hypothetical exit). The isolated formula works from the posted margin and
   * ignores fees entirely. So cross liquidates a hair EARLIER — 0.1 USDT here,
   * which is the 1.0 USDT of fees divided by 10 units. Asserting exact
   * equality would be asserting that fees do not exist.
   */
  const feeEffect = 1.0 / 10;
  assert.ok(Math.abs(positions[0].liq - (isolated + feeEffect)) < 1e-6,
    `cross ${positions[0].liq} vs isolated ${isolated} + fee ${feeEffect}`);
  assert.ok(positions[0].liq > isolated, 'cross must not be safer than isolated');
});

test('cross liquidation: a second position in the pool moves the first one', () => {
  const a = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10, marginMode: 'cross' },
    'BTCUSDT',
  ).position;
  const b = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10, marginMode: 'cross' },
    'ETHUSDT',
  ).position;

  const alone = F.computeFutures([a], { BTCUSDT: 100 }).positions[0].liq;
  const together = F.computeFutures([a, b], { BTCUSDT: 100, ETHUSDT: 100 }).positions[0].liq;

  // Two identical positions share one pool, so the account survives a move
  // roughly twice as large: the liquidation price sits further from the mark.
  assert.ok(together < alone, `together ${together} should be below alone ${alone}`);
});

test('cross liquidation: an isolated position is unaffected by the cross pool', () => {
  const iso = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10 },
    'BTCUSDT',
  ).position;
  const cross = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10, marginMode: 'cross' },
    'ETHUSDT',
  ).position;

  const alone = F.computeFutures([iso], { BTCUSDT: 100 }).positions[0].liq;
  const withCross = F.computeFutures([iso, cross], { BTCUSDT: 100, ETHUSDT: 100 })
    .positions[0].liq;
  assert.strictEqual(alone, withCross);
});

test('cross liquidation: the whole pool is reported liquidated together', () => {
  const a = F.buildPosition(
    { side: 'LONG', leverage: 50, margin: 100, entry: 100, qty: 50, marginMode: 'cross' },
    'BTCUSDT',
  ).position;
  const b = F.buildPosition(
    { side: 'LONG', leverage: 50, margin: 100, entry: 100, qty: 50, marginMode: 'cross' },
    'ETHUSDT',
  ).position;
  // 50x: 5000 notional each, 100 margin each. A 2% drop loses 100 on each.
  const { positions, totals } = F.computeFutures([a, b], { BTCUSDT: 97, ETHUSDT: 97 });
  assert.strictEqual(positions[0].liquidated, true);
  assert.strictEqual(positions[1].liquidated, true);
  assert.strictEqual(totals.atRisk, 2);
});

test('compute: totals count the two margin modes separately', () => {
  const iso = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10 }, 'BTCUSDT',
  ).position;
  const cross = F.buildPosition(
    { side: 'LONG', leverage: 10, margin: 100, entry: 100, qty: 10, marginMode: 'cross' },
    'ETHUSDT',
  ).position;
  const { totals } = F.computeFutures([iso, cross], { BTCUSDT: 100, ETHUSDT: 100 });
  assert.strictEqual(totals.crossCount, 1);
  assert.strictEqual(totals.isolatedCount, 1);
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
