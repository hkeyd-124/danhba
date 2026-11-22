'use strict';
/**
 * Candle fetching: parsing, summarising, caching, and the failure paths.
 *
 * The network is a local stand-in, so these run offline and deterministically.
 * What is being checked is the behaviour that matters in the app:
 *   - a real Binance row shape becomes candles
 *   - junk rows are dropped, not coerced to 0
 *   - a series is fetched once and then served from cache
 *   - a failed refresh keeps the previous series instead of blanking it
 *   - the URL is the documented endpoint with the documented parameters
 */
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const {
  KlineCache, parseKlines, closesOf, summarize,
  DEFAULT_INTERVAL, DEFAULT_LIMIT,
} = require('../src/klines');

/** A Binance-shaped kline row: [openTime, o, h, l, c, v, closeTime, ...]. */
function row(t, o, h, l, c, v = '1') {
  return [t, String(o), String(h), String(l), String(c), v, t + 899999, '0', 1, '0', '0', '0'];
}

function mockServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    /**
     * Keep-alive sockets have to be destroyed explicitly.
     *
     * `server.close()` only stops accepting NEW connections; it waits for the
     * existing ones to go idle. Node's fetch keeps its sockets alive, so the
     * close callback never fired and the test file hung instead of failing.
     * Tracking the sockets and destroying them on close is what makes the
     * teardown deterministic.
     */
    const sockets = new Set();
    server.on('connection', (s) => {
      sockets.add(s);
      s.on('close', () => sockets.delete(s));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        base: `http://127.0.0.1:${port}/fapi/v1/klines`,
        close: () => new Promise((r) => {
          for (const s of sockets) s.destroy();
          server.close(r);
        }),
      });
    });
  });
}

test('parseKlines reads the positional Binance row', () => {
  const rows = [row(1000, 10, 12, 9, 11), row(2000, 11, 13, 10, 12)];
  const out = parseKlines(rows);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { t: 1000, o: 10, h: 12, l: 9, c: 11 });
  assert.equal(out[1].c, 12);
});

test('parseKlines drops junk instead of coercing it to zero', () => {
  const rows = [
    row(1000, 10, 12, 9, 11),
    null,
    'nope',
    [1, 2],                       // too short
    row(2000, 10, 12, 9, 0),      // close of 0 is a missing field
    row(3000, 10, 12, 9, 'abc'),  // not a number
    row(4000, 10, 12, 9, 13),
  ];
  const out = parseKlines(rows);
  assert.deepEqual(out.map((c) => c.c), [11, 13], 'only the two usable candles survive');
});

test('parseKlines sorts by time so the line always runs left to right', () => {
  const out = parseKlines([row(3000, 1, 1, 1, 3), row(1000, 1, 1, 1, 1), row(2000, 1, 1, 1, 2)]);
  assert.deepEqual(out.map((c) => c.t), [1000, 2000, 3000]);
});

test('parseKlines on a non-array is empty, not a throw', () => {
  assert.deepEqual(parseKlines(null), []);
  assert.deepEqual(parseKlines(undefined), []);
  assert.deepEqual(parseKlines({ error: 'x' }), []);
});

test('closesOf keeps only usable closes', () => {
  const candles = [{ c: 5 }, { c: 0 }, { c: null }, { c: 7 }, {}];
  assert.deepEqual(closesOf(candles), [5, 7]);
});

test('summarize measures the change across the whole window', () => {
  const s = summarize([100, 110, 120]);
  assert.equal(s.first, 100);
  assert.equal(s.last, 120);
  assert.equal(s.change, 20);
  assert.equal(s.changePct, 20);
  assert.equal(s.direction, 'up');
});

test('summarize is null when there is nothing to draw', () => {
  assert.equal(summarize([]), null);
  assert.equal(summarize([0, 0]), null);
  assert.equal(summarize(null), null);
});

test('summarize calls a flat series flat, not up', () => {
  const s = summarize([50, 50, 50]);
  assert.equal(s.direction, 'flat');
  assert.equal(s.change, 0);
});

test('the request is the documented endpoint with the documented parameters', async () => {
  let seen = null;
  const mock = await mockServer((req, res) => {
    seen = req.url;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([row(1000, 10, 12, 9, 11), row(2000, 11, 13, 10, 12)]));
  });
  const cache = new KlineCache({ base: mock.base });
  await cache.load(['BTCUSDT']);

  assert.match(seen, /^\/fapi\/v1\/klines\?/);
  assert.match(seen, /symbol=BTCUSDT/);
  assert.match(seen, new RegExp(`interval=${DEFAULT_INTERVAL}`));
  assert.match(seen, new RegExp(`limit=${DEFAULT_LIMIT}`));
  await mock.close();
});

test('a series is fetched once, then served from the cache', async () => {
  let hits = 0;
  const mock = await mockServer((req, res) => {
    hits += 1;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([row(1000, 10, 12, 9, 11), row(2000, 11, 13, 10, 12)]));
  });
  const cache = new KlineCache({ base: mock.base });
  await cache.load(['BTCUSDT']);
  await cache.load(['BTCUSDT']);
  await cache.load(['BTCUSDT']);
  assert.equal(hits, 1, 'three loads, one request');

  // Past the TTL it refetches.
  const later = new KlineCache({ base: mock.base, now: () => Date.now() + 10 * 60 * 1000 });
  await later.load(['BTCUSDT']);
  assert.equal(hits, 2);
  await mock.close();
});

test('a failed refresh keeps the previous series instead of blanking it', async () => {
  let fail = false;
  const mock = await mockServer((req, res) => {
    if (fail) { res.writeHead(500); res.end('boom'); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([row(1000, 10, 12, 9, 11), row(2000, 11, 13, 10, 12)]));
  });
  const cache = new KlineCache({ base: mock.base, ttlMs: 0 });
  await cache.load(['BTCUSDT']);
  const before = cache.get('BTCUSDT');
  assert.ok(before, 'first load stored a series');

  fail = true;
  const changed = await cache.load(['BTCUSDT'], { force: true });
  assert.deepEqual(changed, [], 'a failed refresh reports no change');
  assert.deepEqual(cache.get('BTCUSDT'), before, 'the old series is still there');
  await mock.close();
});

test('a network error is swallowed, not thrown at the caller', async () => {
  const cache = new KlineCache({
    base: 'http://127.0.0.1:1/fapi/v1/klines',
    fetch: () => Promise.reject(new Error('ECONNREFUSED')),
  });
  const changed = await cache.load(['BTCUSDT']);
  assert.deepEqual(changed, []);
  assert.equal(cache.get('BTCUSDT'), null);
});

test('prune drops coins that are no longer held', async () => {
  const mock = await mockServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([row(1000, 10, 12, 9, 11), row(2000, 11, 13, 10, 12)]));
  });
  const cache = new KlineCache({ base: mock.base });
  await cache.load(['BTCUSDT', 'ETHUSDT']);
  assert.deepEqual(Object.keys(cache.snapshot()).sort(), ['BTCUSDT', 'ETHUSDT']);

  cache.prune(['BTCUSDT']);
  assert.deepEqual(Object.keys(cache.snapshot()), ['BTCUSDT']);
  await mock.close();
});

test('symbols are normalised and de-duplicated before fetching', async () => {
  const seen = [];
  const mock = await mockServer((req, res) => {
    seen.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([row(1000, 10, 12, 9, 11), row(2000, 11, 13, 10, 12)]));
  });
  const cache = new KlineCache({ base: mock.base });
  try {
    await cache.load(['btcusdt', 'BTCUSDT', ' ethusdt ']);
    assert.equal(seen.length, 2, 'two distinct symbols, two requests');
    assert.ok(seen.some((u) => u.includes('symbol=BTCUSDT')));
    assert.ok(seen.some((u) => u.includes('symbol=ETHUSDT')));
    // A symbol with stray whitespace must not reach the URL as %20ETHUSDT%20.
    assert.ok(!seen.some((u) => u.includes('%20')), 'no whitespace in any request');
  } finally {
    await mock.close();
  }
});

test('stop() makes further loads a no-op', async () => {
  let hits = 0;
  const mock = await mockServer((req, res) => {
    hits += 1;
    res.writeHead(200); res.end('[]');
  });
  const cache = new KlineCache({ base: mock.base });
  cache.stop();
  const changed = await cache.load(['BTCUSDT']);
  assert.deepEqual(changed, []);
  assert.equal(hits, 0);
  await mock.close();
});
