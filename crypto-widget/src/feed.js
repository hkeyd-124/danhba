'use strict';
/**
 * Binance USDⓈ-M Futures price feed.
 *
 * This is the ONLY outbound network connection the app makes.
 *   - WebSocket: wss://fstream.binance.com/market/stream?streams=btcusdt@markPrice@1s/...
 *     (markPrice lives on the /market routed path — an unrouted connection
 *      silently receives nothing, per Binance's 2026 routing change.)
 *   - REST fallback: https://fapi.binance.com/fapi/v1/ticker/price
 *
 * Endpoints are injectable so the test suite can point them at a local mock.
 */
const EventEmitter = require('events');

const DEFAULT_WS = 'wss://fstream.binance.com/market/stream';
const DEFAULT_REST = 'https://fapi.binance.com/fapi/v1/ticker/price';

class PriceFeed extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.wsBase = opts.wsBase || DEFAULT_WS;
    this.restBase = opts.restBase || DEFAULT_REST;
    this.WebSocketImpl = opts.WebSocket || require('ws');
    this.fetchImpl = opts.fetch || globalThis.fetch;
    this.symbols = new Set();
    this.prices = new Map();
    this.ws = null;
    this.status = 'idle'; // idle | connecting | live | reconnecting | offline
    this.attempt = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.restTimer = null;
    this.closed = false;
    this.started = false;
    this.lastMessageAt = 0;
  }

  setSymbols(list) {
    const next = new Set((list || []).map((s) => String(s).toUpperCase()).filter(Boolean));
    const same = next.size === this.symbols.size && [...next].every((s) => this.symbols.has(s));
    this.symbols = next;
    // Only reconnect if we are already running; before start() there is
    // nothing to restart, and connecting here would open a duplicate socket.
    if (!same && this.started) this._restart();
  }

  start() {
    this.closed = false;
    this.started = true;
    this._connect();
    this._startRestPoll();
  }

  stop() {
    this.closed = true;
    this.started = false;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.pingTimer);
    clearInterval(this.restTimer);
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.terminate(); } catch (_) { /* ignore */ }
      this.ws = null;
    }
    this._setStatus('idle');
  }

  _restart() {
    if (this.closed) return;
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.terminate(); } catch (_) { /* ignore */ }
      this.ws = null;
    }
    clearTimeout(this.reconnectTimer);
    this._connect();
    this._fetchRest();
  }

  _setStatus(s) {
    if (this.status === s) return;
    this.status = s;
    this.emit('status', s);
  }

  _streamUrl() {
    const streams = [...this.symbols].map((s) => `${s.toLowerCase()}@markPrice@1s`);
    if (!streams.length) return null;
    return `${this.wsBase}?streams=${streams.join('/')}`;
  }

  _connect() {
    if (this.closed) return;
    const url = this._streamUrl();
    if (!url) { this._setStatus('idle'); return; }

    this._setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting');
    let ws;
    try {
      ws = new this.WebSocketImpl(url, { handshakeTimeout: 15000 });
    } catch (err) {
      this.emit('error', err);
      this._scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this._setStatus('live');
      this.emit('open');
      // Binance drops idle connections; a client ping keeps it warm.
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        try { ws.ping(); } catch (_) { /* ignore */ }
      }, 3 * 60 * 1000);
    });

    ws.on('message', (buf) => {
      this.lastMessageAt = Date.now();
      let msg;
      try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
      const data = msg && msg.data ? msg.data : msg;
      if (!data) return;
      // markPriceUpdate: {e,s,p,...}   miniTicker: {e,s,c,...}
      const symbol = data.s;
      const price = parseFloat(data.p !== undefined ? data.p : data.c);
      if (symbol && Number.isFinite(price) && price > 0) this._apply(symbol, price);
    });

    ws.on('error', (err) => {
      this.emit('error', err);
    });

    ws.on('close', () => {
      clearInterval(this.pingTimer);
      if (this.closed) return;
      this._setStatus('reconnecting');
      this._scheduleReconnect();
    });
  }

  _scheduleReconnect() {
    if (this.closed) return;
    this.attempt += 1;
    const delay = Math.min(30000, 1000 * Math.pow(1.7, Math.min(this.attempt, 6)));
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this._connect(), delay);
  }

  _apply(symbol, price) {
    const prev = this.prices.get(symbol);
    if (prev === price) return;
    this.prices.set(symbol, price);
    this.emit('price', { symbol, price, prev: prev === undefined ? null : prev, at: Date.now() });
  }

  _startRestPoll() {
    clearInterval(this.restTimer);
    this._fetchRest();
    // Safety net: if the socket is down, REST keeps the widget usable.
    this.restTimer = setInterval(() => {
      if (this.status !== 'live') this._fetchRest();
    }, 20000);
  }

  async _fetchRest() {
    if (this.closed || !this.symbols.size) return;
    try {
      const res = await this.fetchImpl(this.restBase, { signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      if (!Array.isArray(rows)) return;
      for (const row of rows) {
        if (!this.symbols.has(row.symbol)) continue;
        const price = parseFloat(row.price);
        if (Number.isFinite(price) && price > 0) this._apply(row.symbol, price);
      }
      if (this.status !== 'live') this._setStatus('offline');
    } catch (err) {
      this.emit('error', err);
      if (this.status !== 'live') this._setStatus('offline');
    }
  }

  snapshot() {
    return Object.fromEntries(this.prices);
  }
}

module.exports = { PriceFeed, DEFAULT_WS, DEFAULT_REST };
