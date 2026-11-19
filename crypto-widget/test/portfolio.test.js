'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { computePositions, normalizeSymbol, baseAsset, symbolsInUse } = require('../src/portfolio');

test('normalizeSymbol adds USDT and strips separators', () => {
  assert.equal(normalizeSymbol('btc'), 'BTCUSDT');
  assert.equal(normalizeSymbol(' eth/usdt '), 'ETHUSDT');
  assert.equal(normalizeSymbol('SOLUSDT'), 'SOLUSDT');
  assert.equal(normalizeSymbol(''), '');
  assert.equal(baseAsset('BTCUSDT'), 'BTC');
});

test('single buy: avg cost includes fee', () => {
  const { positions, totals } = computePositions(
    [{ id: '1', symbol: 'BTC', side: 'BUY', price: 100, qty: 2, fee: 4, time: 1 }],
    { BTCUSDT: 120 },
  );
  assert.equal(positions.length, 1);
  const p = positions[0];
  assert.equal(p.qty, 2);
  assert.equal(p.cost, 204);          // 2*100 + 4
  assert.equal(p.avgCost, 102);       // fee folded in
  assert.equal(p.value, 240);
  assert.equal(p.unrealized, 36);     // 2*(120-102)
  assert.equal(p.allocation, 100);
  assert.equal(totals.value, 240);
});

test('two buys average correctly', () => {
  const { positions } = computePositions([
    { id: '1', symbol: 'ETH', side: 'BUY', price: 100, qty: 1, fee: 0, time: 1 },
    { id: '2', symbol: 'ETH', side: 'BUY', price: 200, qty: 1, fee: 0, time: 2 },
  ], { ETHUSDT: 300 });
  const p = positions[0];
  assert.equal(p.qty, 2);
  assert.equal(p.avgCost, 150);
  assert.equal(p.unrealized, 300);
});

test('partial sell realises P&L and keeps remaining basis', () => {
  const { positions, totals } = computePositions([
    { id: '1', symbol: 'BTC', side: 'BUY', price: 100, qty: 2, fee: 0, time: 1 },
    { id: '2', symbol: 'BTC', side: 'SELL', price: 150, qty: 1, fee: 5, time: 2 },
  ], { BTCUSDT: 150 });
  const p = positions[0];
  assert.equal(p.qty, 1);
  assert.equal(p.avgCost, 100);
  assert.equal(p.realized, 45);       // 1*(150-100) - 5 fee
  assert.equal(p.unrealized, 50);     // 1*(150-100)
  assert.equal(totals.pnl, 95);
});

test('sell everything closes the position', () => {
  const { positions } = computePositions([
    { id: '1', symbol: 'SOL', side: 'BUY', price: 10, qty: 5, fee: 0, time: 1 },
    { id: '2', symbol: 'SOL', side: 'SELL', price: 20, qty: 5, fee: 0, time: 2 },
  ], { SOLUSDT: 20 });
  const p = positions[0];
  assert.equal(p.qty, 0);
  assert.equal(p.cost, 0);
  assert.equal(p.value, 0);
  assert.equal(p.realized, 50);
  assert.equal(p.allocation, 0);
});

test('overselling is clamped and warned, not silently wrong', () => {
  const { positions, warnings } = computePositions([
    { id: '1', symbol: 'BTC', side: 'BUY', price: 100, qty: 1, fee: 0, time: 1 },
    { id: '2', symbol: 'BTC', side: 'SELL', price: 200, qty: 5, fee: 0, time: 2 },
  ], { BTCUSDT: 200 });
  assert.equal(positions[0].qty, 0);
  assert.equal(positions[0].realized, 100); // only the 1 unit actually held
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /chỉ đang giữ/);
});

test('allocation percentages sum to 100', () => {
  const { positions } = computePositions([
    { id: '1', symbol: 'BTC', side: 'BUY', price: 100, qty: 1, fee: 0, time: 1 },
    { id: '2', symbol: 'ETH', side: 'BUY', price: 100, qty: 3, fee: 0, time: 2 },
  ], { BTCUSDT: 100, ETHUSDT: 100 });
  const sum = positions.reduce((s, p) => s + p.allocation, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `sum was ${sum}`);
  assert.equal(positions[0].symbol, 'ETHUSDT'); // sorted by value desc
});

test('missing price falls back to last trade price', () => {
  const { positions } = computePositions(
    [{ id: '1', symbol: 'DOGE', side: 'BUY', price: 0.5, qty: 100, fee: 0, time: 1 }],
    {},
  );
  assert.equal(positions[0].mark, 0.5);
  assert.equal(positions[0].hasPrice, false);
  assert.equal(positions[0].value, 50);
});

test('invalid rows are skipped with a warning', () => {
  const { positions, warnings } = computePositions([
    { id: '1', symbol: 'BTC', side: 'BUY', price: 100, qty: 0, fee: 0, time: 1 },
    { id: '2', symbol: 'BTC', side: 'BUY', price: 100, qty: 1, fee: 0, time: 2 },
  ], { BTCUSDT: 100 });
  assert.equal(positions[0].qty, 1);
  assert.equal(warnings.length, 1);
});

test('trades are applied in time order regardless of input order', () => {
  const { positions } = computePositions([
    { id: 'b', symbol: 'BTC', side: 'SELL', price: 200, qty: 1, fee: 0, time: 20 },
    { id: 'a', symbol: 'BTC', side: 'BUY', price: 100, qty: 1, fee: 0, time: 10 },
  ], { BTCUSDT: 200 });
  assert.equal(positions[0].realized, 100);
  assert.equal(positions[0].qty, 0);
});

test('symbolsInUse dedupes and normalises', () => {
  const s = symbolsInUse([
    { symbol: 'btc' }, { symbol: 'BTCUSDT' }, { symbol: 'eth' },
  ]);
  assert.deepEqual(s.sort(), ['BTCUSDT', 'ETHUSDT']);
});
