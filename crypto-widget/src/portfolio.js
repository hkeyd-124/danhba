'use strict';
/**
 * Pure portfolio math. No I/O, no Electron — fully unit-testable.
 *
 * Cost-basis method: weighted average cost (the method Binance itself shows
 * for spot/futures positions). Fees are folded into the cost basis on buys and
 * subtracted from realised P&L on sells, which is what a trader expects.
 */

const EPS = 1e-12;

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Normalise a user-entered symbol: "btc" -> "BTCUSDT", "ethusdt" -> "ETHUSDT". */
function normalizeSymbol(raw) {
  let s = String(raw || '').trim().toUpperCase().replace(/[\s/_-]/g, '');
  if (!s) return '';
  if (!s.endsWith('USDT') && !s.endsWith('USDC') && !s.endsWith('BUSD')) s += 'USDT';
  return s;
}

/** "BTCUSDT" -> "BTC" (display name). */
function baseAsset(symbol) {
  return String(symbol || '').replace(/(USDT|USDC|BUSD)$/, '') || String(symbol || '');
}

function sortTrades(trades) {
  return [...trades].sort((a, b) => {
    const ta = num(a.time), tb = num(b.time);
    if (ta !== tb) return ta - tb;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * Build per-symbol positions from a flat trade list.
 * @param {Array} trades  [{id, symbol, side, price, qty, fee, time}]
 * @param {Object} prices {BTCUSDT: 65000}
 * @returns {{positions: Array, totals: Object, warnings: Array}}
 */
function computePositions(trades, prices = {}) {
  const warnings = [];
  const bySymbol = new Map();

  for (const t of sortTrades(trades)) {
    const symbol = normalizeSymbol(t.symbol);
    if (!symbol) continue;
    const price = num(t.price);
    const qty = num(t.qty);
    const fee = num(t.fee);
    if (qty <= 0) {
      warnings.push({ symbol, id: t.id, message: 'Số lượng phải lớn hơn 0 — lệnh bị bỏ qua.' });
      continue;
    }
    if (price < 0) {
      warnings.push({ symbol, id: t.id, message: 'Giá vào không hợp lệ — lệnh bị bỏ qua.' });
      continue;
    }

    let p = bySymbol.get(symbol);
    if (!p) {
      p = { symbol, qty: 0, cost: 0, realized: 0, buyQty: 0, sellQty: 0, lastPrice: 0, tradeCount: 0 };
      bySymbol.set(symbol, p);
    }
    p.tradeCount += 1;
    p.lastPrice = price;

    if (String(t.side).toUpperCase() === 'SELL') {
      const sellQty = Math.min(qty, p.qty);
      if (qty > p.qty + EPS) {
        warnings.push({
          symbol,
          id: t.id,
          message: `Bán ${qty} ${baseAsset(symbol)} nhưng chỉ đang giữ ${p.qty} — chỉ tính phần đang giữ.`,
        });
      }
      const avg = p.qty > EPS ? p.cost / p.qty : 0;
      p.realized += sellQty * (price - avg) - fee;
      p.cost -= sellQty * avg;
      p.qty -= sellQty;
      p.sellQty += sellQty;
      if (p.qty <= EPS) { p.qty = 0; p.cost = 0; }
    } else {
      p.qty += qty;
      p.cost += qty * price + fee;
      p.buyQty += qty;
    }
  }

  const positions = [];
  for (const p of bySymbol.values()) {
    const mark = num(prices[p.symbol], 0) || p.lastPrice;
    const avgCost = p.qty > EPS ? p.cost / p.qty : 0;
    const value = p.qty * mark;
    const unrealized = p.qty > EPS ? p.qty * (mark - avgCost) : 0;
    positions.push({
      symbol: p.symbol,
      base: baseAsset(p.symbol),
      qty: p.qty,
      avgCost,
      cost: p.cost,
      mark,
      value,
      realized: p.realized,
      unrealized,
      pnl: p.realized + unrealized,
      pnlPct: p.cost > EPS ? (unrealized / p.cost) * 100 : 0,
      tradeCount: p.tradeCount,
      hasPrice: num(prices[p.symbol], 0) > 0,
    });
  }

  positions.sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));

  const totalValue = positions.reduce((s, p) => s + p.value, 0);
  for (const p of positions) {
    p.allocation = totalValue > EPS ? (p.value / totalValue) * 100 : 0;
  }

  const totals = {
    value: totalValue,
    cost: positions.reduce((s, p) => s + p.cost, 0),
    realized: positions.reduce((s, p) => s + p.realized, 0),
    unrealized: positions.reduce((s, p) => s + p.unrealized, 0),
    pnl: positions.reduce((s, p) => s + p.pnl, 0),
    openPositions: positions.filter((p) => p.qty > EPS).length,
  };
  totals.pnlPct = totals.cost > EPS ? (totals.unrealized / totals.cost) * 100 : 0;

  return { positions, totals, warnings };
}

/** Symbols that currently hold a position (what we need live prices for). */
function symbolsInUse(trades) {
  const set = new Set();
  for (const t of trades) {
    const s = normalizeSymbol(t.symbol);
    if (s) set.add(s);
  }
  return [...set];
}

module.exports = { computePositions, normalizeSymbol, baseAsset, symbolsInUse, sortTrades };
