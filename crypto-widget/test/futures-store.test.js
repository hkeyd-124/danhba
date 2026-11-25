'use strict';
/**
 * v7 -> v8 -> v9: demo futures.
 *
 * The migration has to do three things and none is optional: an old file must
 * come back with an empty book (not `undefined`, which would crash the first
 * `computeFutures`), a stored row must be re-derived rather than trusted,
 * because `qty` / `notional` / `entryFee` are all functions of the other
 * fields, and a v8 row — which has no `qty` and no `marginMode` — must come
 * back as exactly the position it described.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Store, SCHEMA_VERSION } = require('../src/store');

function loadWith(obj) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-fut-'));
  const file = path.join(dir, 'data.json');
  fs.writeFileSync(file, JSON.stringify(obj), 'utf8');
  const store = new Store(file);
  store.load();
  return store;
}

test('a v7 file gets an empty futures book, not undefined', () => {
  const store = loadWith({ version: 7, trades: [], alerts: [], settings: {} });
  assert.deepEqual(store.futures, []);
  assert.equal(store.state.version, SCHEMA_VERSION);
});

test('a v7 file gets both pin switches on', () => {
  const store = loadWith({ version: 7, settings: {} });
  assert.equal(store.settings.futPinPnl, true);
  assert.equal(store.settings.futPinLiq, true);
});

test('a stored position is re-derived, so qty cannot disagree with margin', () => {
  // A hand-edited row claiming 999 units on a 100 USDT / 10x position at 100.
  // 999 units at 100 needs 9990 USDT of margin at 10x, so the row is refused
  // outright rather than silently resized into something the user never typed.
  const store = loadWith({
    version: 8,
    futures: [{
      id: 'f1', symbol: 'BTCUSDT', side: 'LONG', leverage: 10,
      margin: 100, entry: 100, qty: 999, notional: 99900, entryFee: 0,
    }],
  });
  assert.equal(store.futures.length, 0, 'an unbacked row must be dropped');
});

test('a v8 row with no qty is upgraded to the position it described', () => {
  const store = loadWith({
    version: 8,
    futures: [{
      id: 'f1', symbol: 'BTCUSDT', side: 'LONG', leverage: 10,
      margin: 100, entry: 100,
    }],
  });
  assert.equal(store.futures.length, 1);
  assert.equal(store.futures[0].qty, 10, 'qty derived from margin x leverage');
  assert.equal(store.futures[0].marginMode, 'isolated', 'v8 was isolated-only');
  assert.equal(store.futures[0].margin, 100);
});

test('a cross row survives a reload with its mode intact', () => {
  const store = loadWith({
    version: 9,
    futures: [{
      id: 'f1', symbol: 'ETHUSDT', side: 'SHORT', leverage: 5,
      margin: 200, entry: 50, qty: 20, marginMode: 'cross',
    }],
  });
  assert.equal(store.futures.length, 1);
  assert.equal(store.futures[0].marginMode, 'cross');
  assert.equal(store.futures[0].qty, 20);
});

test('a position that no longer validates is dropped, not repaired', () => {
  const store = loadWith({
    version: 8,
    futures: [
      { id: 'ok', symbol: 'BTCUSDT', side: 'LONG', leverage: 10, margin: 100, entry: 100 },
      { id: 'bad', symbol: 'ETHUSDT', side: 'LONG', leverage: 0, margin: 100, entry: 100 },
      { id: 'nomargin', symbol: 'SOLUSDT', side: 'LONG', leverage: 10, margin: 0, entry: 100 },
    ],
  });
  assert.deepEqual(store.futures.map((f) => f.id), ['ok']);
});

test('a position with no id is dropped: it could never be closed', () => {
  const store = loadWith({
    version: 8,
    futures: [{ symbol: 'BTCUSDT', side: 'LONG', leverage: 10, margin: 100, entry: 100 }],
  });
  assert.deepEqual(store.futures, []);
});

test('upsertFuture adds then updates in place', () => {
  const store = loadWith({ version: 8 });
  store.upsertFuture({ id: 'a', symbol: 'BTCUSDT', margin: 100 });
  store.upsertFuture({ id: 'a', symbol: 'BTCUSDT', margin: 200 });
  assert.equal(store.futures.length, 1);
  assert.equal(store.futures[0].margin, 200);
});

test('deleteFuture reports whether anything was removed', () => {
  const store = loadWith({ version: 8 });
  store.upsertFuture({ id: 'a', symbol: 'BTCUSDT', margin: 100 });
  assert.equal(store.deleteFuture('a'), true);
  assert.equal(store.deleteFuture('a'), false);
  assert.deepEqual(store.futures, []);
});
