'use strict';
/**
 * Store migration tests.
 *
 * The rule these protect: a data file written by an older version must keep
 * behaving exactly as it did. Adding the 'touch' alert kind must not silently
 * turn an existing "vượt lên trên" alert into something else, and must not
 * attach a tolerance to a kind that ignores it.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store, SCHEMA_VERSION } = require('../src/store');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-store-'));
  return path.join(dir, 'portfolio.json');
}

function loadWith(data) {
  const file = tmpFile();
  fs.writeFileSync(file, JSON.stringify(data), 'utf8');
  const store = new Store(file);
  store.load();
  return store;
}

test('schema version is 6', () => {
  assert.equal(SCHEMA_VERSION, 6);
});

test('a v5 file gets stripCoins: [], so the strip draws the summary alone', () => {
  // v5 had no per-coin rows. An empty list means "summary line only", which is
  // exactly what v5 drew — so an upgrade changes nothing until the user ticks
  // a coin.
  const store = loadWith({ version: 5, settings: { dockMode: 'taskbar' } });
  assert.deepEqual(store.settings.stripCoins, []);
});

test('stripCoins drops anything that is not a plausible ticker', () => {
  // The list is written by the renderer, so it is normalised on the way in:
  // a hand-edited file must not be able to put a nameless row in the strip.
  const store = loadWith({
    version: 6,
    settings: { stripCoins: ['eth', 'LDO', '', 'TOOLONGTICKER', 42, null, 'btc'] },
  });
  assert.deepEqual(store.settings.stripCoins, ['ETH', 'LDO', 'BTC']);
});

test('stripCoins is de-duplicated and capped', () => {
  // Two characters minimum: a one-letter ticker is not a coin, and the
  // normaliser rejects it (see the test above).
  const many = ['AA', 'BB', 'CC', 'DD', 'EE', 'FF', 'GG', 'HH', 'II', 'JJ', 'KK', 'LL'];
  const store = loadWith({ version: 6, settings: { stripCoins: [...many, 'AA'] } });
  assert.equal(store.settings.stripCoins.length, 8);
  assert.equal(new Set(store.settings.stripCoins).size, 8);
});

test('a v3 file gets stripWidth: null, so the strip keeps its old width', () => {
  // v3 had one width for both the panel and the strip. Leaving stripWidth null
  // makes the strip fall back to dockWidth — exactly what v3 drew — so an
  // existing install looks unchanged until the user drags the strip.
  const store = loadWith({ version: 3, settings: { dockMode: 'taskbar', dockWidth: 420 } });
  assert.equal(store.settings.stripWidth, null);
  assert.equal(store.settings.dockWidth, 420);
});

test('a saved stripWidth survives a reload', () => {
  const store = loadWith({ version: 4, settings: { dockMode: 'taskbar', stripWidth: 512 } });
  assert.equal(store.settings.stripWidth, 512);
});

test('a junk stripWidth is discarded rather than trusted', () => {
  assert.equal(loadWith({ version: 4, settings: { stripWidth: 'wide' } }).settings.stripWidth, null);
  assert.equal(loadWith({ version: 4, settings: { stripWidth: -5 } }).settings.stripWidth, null);
  assert.equal(loadWith({ version: 4, settings: { stripWidth: 0 } }).settings.stripWidth, null);
});

test('a v2 file keeps its above/below alerts untouched', () => {
  const store = loadWith({
    version: 2,
    alerts: [
      { id: 'a', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: true },
      { id: 'b', symbol: 'ETHUSDT', price: 2000, direction: 'below', enabled: true },
    ],
  });
  assert.equal(store.alerts.length, 2);
  assert.equal(store.alerts[0].direction, 'above');
  assert.equal(store.alerts[1].direction, 'below');
  assert.equal(store.alerts[0].tolerance, undefined, 'above must not gain a tolerance');
  assert.equal(store.alerts[1].tolerance, undefined, 'below must not gain a tolerance');
});

test('a v2 alert with no direction becomes above, as it always behaved', () => {
  const store = loadWith({ version: 2, alerts: [{ id: 'a', symbol: 'BTCUSDT', price: 100 }] });
  assert.equal(store.alerts[0].direction, 'above');
});

test('a touch alert keeps its tolerance', () => {
  const store = loadWith({
    version: 3,
    alerts: [{ id: 't', symbol: 'BTCUSDT', price: 100, direction: 'touch', tolerance: 0.5 }],
  });
  assert.equal(store.alerts[0].direction, 'touch');
  assert.equal(store.alerts[0].tolerance, 0.5);
});

test('a touch alert with a missing or bad tolerance gets the default', () => {
  const store = loadWith({
    version: 3,
    alerts: [
      { id: 't1', symbol: 'BTCUSDT', price: 100, direction: 'touch' },
      { id: 't2', symbol: 'BTCUSDT', price: 100, direction: 'touch', tolerance: 'abc' },
      { id: 't3', symbol: 'BTCUSDT', price: 100, direction: 'touch', tolerance: 999 },
    ],
  });
  assert.equal(store.alerts[0].tolerance, 0.1);
  assert.equal(store.alerts[1].tolerance, 0.1);
  assert.equal(store.alerts[2].tolerance, 50, 'clamped');
});

test('a zero tolerance survives the migration', () => {
  const store = loadWith({
    version: 3,
    alerts: [{ id: 't', symbol: 'BTCUSDT', price: 100, direction: 'touch', tolerance: 0 }],
  });
  assert.equal(store.alerts[0].tolerance, 0, '0 is a real value, not "missing"');
});

test('junk alert entries are dropped rather than crashing the app', () => {
  const store = loadWith({ version: 2, alerts: [null, 'nope', 42, { id: 'ok', symbol: 'BTCUSDT', price: 1 }] });
  assert.equal(store.alerts.length, 1);
  assert.equal(store.alerts[0].id, 'ok');
});

test('a corrupt file falls back to an empty state and keeps a copy', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ this is not json', 'utf8');
  const store = new Store(file);
  store.load();
  assert.deepEqual(store.alerts, []);
  const dir = path.dirname(file);
  const backups = fs.readdirSync(dir).filter((f) => f.includes('.corrupt-'));
  assert.equal(backups.length, 1, 'the user data must be preserved, not deleted');
});

test('settings from an older file survive the migration', () => {
  const store = loadWith({
    version: 2,
    settings: { theme: 'bare', textColor: '#ff0000', dockMode: 'taskbar', chart: false },
  });
  assert.equal(store.settings.theme, 'bare');
  assert.equal(store.settings.textColor, '#ff0000');
  assert.equal(store.settings.dockMode, 'taskbar');
  assert.equal(store.settings.chart, false);
});
