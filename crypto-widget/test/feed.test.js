'use strict';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { WebSocketServer } = require('ws');
const { PriceFeed } = require('../src/feed');
const { AlertEngine } = require('../src/alerts');

/** Spin up a local stand-in for Binance: one WS + one REST endpoint. */
function mockBinance() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/fapi/v1/ticker/price')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([
          { symbol: 'BTCUSDT', price: '111.5' },
          { symbol: 'ETHUSDT', price: '2222.0' },
          { symbol: 'OTHERUSDT', price: '9.9' },
        ]));
        return;
      }
      res.writeHead(404); res.end();
    });
    const wss = new WebSocketServer({ server, path: '/market/stream' });
    const sockets = [];
    wss.on('connection', (ws, req) => {
      sockets.push({ ws, url: req.url });
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({
        port,
        sockets,
        wsBase: `ws://127.0.0.1:${port}/market/stream`,
        restBase: `http://127.0.0.1:${port}/fapi/v1/ticker/price`,
        close: () => new Promise((r) => { wss.close(); server.close(r); }),
      });
    });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('feed subscribes on the /market path with markPrice@1s streams', async () => {
  const mock = await mockBinance();
  const feed = new PriceFeed({ wsBase: mock.wsBase, restBase: mock.restBase });
  feed.setSymbols(['BTCUSDT', 'ETHUSDT']);
  feed.start();
  await wait(300);

  assert.equal(mock.sockets.length, 1, 'expected one socket');
  const url = mock.sockets[0].url;
  assert.match(url, /^\/market\/stream\?streams=/);
  assert.match(url, /btcusdt@markPrice@1s/);
  assert.match(url, /ethusdt@markPrice@1s/);

  feed.stop();
  await mock.close();
});

test('feed emits prices from markPriceUpdate payloads', async () => {
  const mock = await mockBinance();
  const feed = new PriceFeed({ wsBase: mock.wsBase, restBase: mock.restBase });
  const seen = [];
  feed.on('price', (p) => seen.push(p));
  feed.setSymbols(['BTCUSDT']);
  feed.start();
  await wait(250);

  mock.sockets[0].ws.send(JSON.stringify({
    stream: 'btcusdt@markPrice@1s',
    data: { e: 'markPriceUpdate', E: 1, s: 'BTCUSDT', p: '65000.10', i: '64999', P: '64999', r: '0.0001', T: 2 },
  }));
  await wait(200);

  assert.ok(seen.length >= 1, 'no price emitted');
  const btc = seen.filter((x) => x.symbol === 'BTCUSDT').pop();
  assert.equal(btc.price, 65000.1);
  assert.equal(feed.snapshot().BTCUSDT, 65000.1);

  feed.stop();
  await mock.close();
});

test('feed ignores malformed and zero prices', async () => {
  const mock = await mockBinance();
  const feed = new PriceFeed({ wsBase: mock.wsBase, restBase: mock.restBase });
  const seen = [];
  feed.on('price', (p) => seen.push(p));
  feed.setSymbols(['BTCUSDT']);
  feed.start();
  await wait(250);

  // The REST fallback legitimately seeds a price; clear it so we only judge
  // what the malformed socket frames did.
  seen.length = 0;

  const ws = mock.sockets[0].ws;
  ws.send('not json at all');
  ws.send(JSON.stringify({ data: { s: 'BTCUSDT', p: '0' } }));
  ws.send(JSON.stringify({ data: { s: 'BTCUSDT', p: 'abc' } }));
  await wait(200);

  assert.equal(seen.filter((x) => x.symbol === 'BTCUSDT').length, 0);

  feed.stop();
  await mock.close();
});

test('REST fallback fills prices when the socket is silent', async () => {
  const mock = await mockBinance();
  const feed = new PriceFeed({ wsBase: mock.wsBase, restBase: mock.restBase });
  feed.setSymbols(['BTCUSDT', 'ETHUSDT']);
  feed.start();
  await wait(600);

  const snap = feed.snapshot();
  assert.equal(snap.BTCUSDT, 111.5);
  assert.equal(snap.ETHUSDT, 2222);
  assert.equal(snap.OTHERUSDT, undefined, 'must not store symbols we do not track');

  feed.stop();
  await mock.close();
});

test('changing symbols reconnects with the new stream list', async () => {
  const mock = await mockBinance();
  const feed = new PriceFeed({ wsBase: mock.wsBase, restBase: mock.restBase });
  feed.setSymbols(['BTCUSDT']);
  feed.start();
  await wait(250);
  assert.equal(mock.sockets.length, 1);

  feed.setSymbols(['BTCUSDT', 'SOLUSDT']);
  await wait(350);
  assert.ok(mock.sockets.length >= 2, 'expected a reconnect');
  assert.match(mock.sockets[mock.sockets.length - 1].url, /solusdt@markPrice@1s/);

  feed.stop();
  await mock.close();
});

// ---------------------------------------------------------------- alerts
test('alert fires only when the level is crossed', () => {
  const engine = new AlertEngine({ cooldownMs: 0 });
  engine.setAlerts([{ id: 'a1', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: true }]);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));

  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 95);
  assert.equal(fired.length, 0, 'must not fire below the level');

  engine.onPrice('BTCUSDT', 101);
  assert.equal(fired.length, 1, 'must fire on the crossing tick');
  assert.equal(fired[0].level, 100);
  assert.equal(fired[0].price, 101);

  engine.onPrice('BTCUSDT', 105);
  engine.onPrice('BTCUSDT', 110);
  assert.equal(fired.length, 1, 'must not re-fire while staying above');
});

test('alert re-arms after price returns to the other side', () => {
  const engine = new AlertEngine({ cooldownMs: 0 });
  engine.setAlerts([{ id: 'a1', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: true }]);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));

  engine.onPrice('BTCUSDT', 99);
  engine.onPrice('BTCUSDT', 101);   // fire
  engine.onPrice('BTCUSDT', 98);    // back below
  engine.onPrice('BTCUSDT', 102);   // fire again
  assert.equal(fired.length, 2);
});

test('below-direction alert fires on a downward cross', () => {
  const engine = new AlertEngine({ cooldownMs: 0 });
  engine.setAlerts([{ id: 'a1', symbol: 'ETHUSDT', price: 2000, direction: 'below', enabled: true }]);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));

  engine.onPrice('ETHUSDT', 2100);
  engine.onPrice('ETHUSDT', 1999);
  assert.equal(fired.length, 1);
  assert.equal(fired[0].direction, 'below');
});

test('disabled alerts never fire', () => {
  const engine = new AlertEngine({ cooldownMs: 0 });
  engine.setAlerts([{ id: 'a1', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: false }]);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));
  engine.onPrice('BTCUSDT', 90);
  engine.onPrice('BTCUSDT', 110);
  assert.equal(fired.length, 0);
});

test('cooldown suppresses a rapid re-cross', () => {
  const engine = new AlertEngine({ cooldownMs: 60000 });
  engine.setAlerts([{ id: 'a1', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: true }]);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));
  engine.onPrice('BTCUSDT', 99);
  engine.onPrice('BTCUSDT', 101);
  engine.onPrice('BTCUSDT', 99);
  engine.onPrice('BTCUSDT', 101);
  assert.equal(fired.length, 1, 'cooldown should block the second cross');
});

test('alerts for other symbols are ignored', () => {
  const engine = new AlertEngine({ cooldownMs: 0 });
  engine.setAlerts([{ id: 'a1', symbol: 'BTCUSDT', price: 100, direction: 'above', enabled: true }]);
  const fired = [];
  engine.on('trigger', (p) => fired.push(p));
  engine.onPrice('ETHUSDT', 50);
  engine.onPrice('ETHUSDT', 500);
  assert.equal(fired.length, 0);
});
