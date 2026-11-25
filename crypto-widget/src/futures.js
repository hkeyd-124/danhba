'use strict';
/**
 * Demo futures positions — pure math, no I/O, no Electron.
 *
 * ---------------------------------------------------------------------------
 * What "demo" means here, precisely
 *
 * Nothing in this module touches an exchange. There is no API key, no order,
 * no account, no money. A position is a row in the local JSON file: a symbol,
 * a side, a leverage, a margin and an entry price. Everything else — PnL,
 * ROE, the liquidation price — is DERIVED from the live mark price the price
 * feed already fetches for the spot portfolio.
 *
 * That is the whole feature: a calculator that keeps its own book. It is
 * labelled "demo" everywhere it appears, because a number that looks like a
 * real position and is not one is the single most dangerous thing this app
 * could show.
 * ---------------------------------------------------------------------------
 * Why the formulas live here and not in the renderer
 *
 * The liquidation price is the number a trader acts on. If the renderer
 * computed it, the strip and the panel could disagree about where a position
 * dies, and there would be no way to test either. One function, called by the
 * main process, sent to both surfaces.
 * ---------------------------------------------------------------------------
 */

/** Maintenance margin rate used for the liquidation estimate. */
const MMR = 0.004;

/** Taker fee, per side, as a fraction of notional. */
const TAKER_FEE = 0.0005;

const MIN_LEVERAGE = 1;
const MAX_LEVERAGE = 125;

/** A position smaller than this is treated as closed. */
const EPS = 1e-9;

function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 'long' | 'LONG' | 'buy' -> 'LONG'; anything else -> 'SHORT'. */
function normalizeSide(raw) {
  const s = String(raw || '').trim().toUpperCase();
  return s === 'LONG' || s === 'BUY' ? 'LONG' : 'SHORT';
}

/**
 * Liquidation price for an isolated-margin position.
 *
 * Binance's own formula, with the maintenance margin folded in:
 *
 *   LONG : entry * (1 - 1/leverage + MMR)
 *   SHORT: entry * (1 + 1/leverage - MMR)
 *
 * At 10x that puts a long's liquidation 9.6% below entry, which is what the
 * exchange shows for a position with no extra margin added. It is an ESTIMATE:
 * the real figure depends on the maintenance-margin bracket, which depends on
 * notional size, and on funding. The UI says "ước tính" for that reason.
 *
 * @param {number} entry
 * @param {string} side
 * @param {number} leverage
 * @returns {number} 0 when the inputs cannot produce a meaningful price
 */
function liquidationPrice(entry, side, leverage) {
  const e = num(entry);
  const lev = num(leverage);
  if (!(e > 0) || !(lev >= MIN_LEVERAGE)) return 0;
  const move = 1 / lev - MMR;
  if (!(move > 0)) return 0;
  const p = normalizeSide(side) === 'LONG' ? e * (1 - move) : e * (1 + move);
  return p > 0 ? p : 0;
}

/**
 * Validate and build a position from user input.
 *
 * Returns `{ ok: true, position }` or `{ ok: false, error }` — never throws,
 * because this is called straight from an IPC handler whose return value the
 * renderer prints.
 *
 * `qty` is derived, not entered: the user says "500 USDT at 10x", and the
 * contract size follows from that. Letting both be entered would allow a
 * position whose margin and notional disagree, and there is no honest way to
 * draw that.
 *
 * @param {object} input  {symbol, side, leverage, margin, entry, note}
 * @param {string} symbol already normalised by the caller
 * @returns {{ok:boolean, position?:object, error?:string}}
 */
function buildPosition(input, symbol) {
  const i = input || {};
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'Chưa nhập đồng coin.' };

  const entry = num(i.entry);
  if (!(entry > 0)) return { ok: false, error: 'Giá vào phải lớn hơn 0.' };

  const margin = num(i.margin);
  if (!(margin > 0)) return { ok: false, error: 'Ký quỹ phải lớn hơn 0.' };

  const leverage = Math.round(num(i.leverage, 1));
  if (!(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE)) {
    return { ok: false, error: `Đòn bẩy phải từ ${MIN_LEVERAGE} đến ${MAX_LEVERAGE}.` };
  }

  const side = normalizeSide(i.side);
  const notional = margin * leverage;
  const qty = notional / entry;
  const entryFee = notional * TAKER_FEE;

  return {
    ok: true,
    position: {
      id: i.id || null,
      symbol: sym,
      side,
      leverage,
      margin,
      entry,
      qty,
      notional,
      entryFee,
      note: String(i.note || '').slice(0, 120),
      openedAt: num(i.openedAt) || Date.now(),
    },
  };
}

/**
 * Mark a position to market.
 *
 * PnL is net of both fees: the entry fee was paid when the position opened,
 * and closing it would pay the taker fee again at the current mark. Showing
 * gross PnL would overstate every position by ~0.1% of notional, which at 20x
 * is 2% of the margin — not a rounding error.
 *
 * @param {object} pos   a stored position
 * @param {number} mark  current price
 * @returns {object} the position plus its derived numbers
 */
function markPosition(pos, mark) {
  const p = pos || {};
  const entry = num(p.entry);
  const qty = num(p.qty);
  const margin = num(p.margin);
  const lev = num(p.leverage, 1);
  const side = normalizeSide(p.side);
  const m = num(mark);

  const hasPrice = m > 0;
  const price = hasPrice ? m : entry;

  const gross = side === 'LONG' ? (price - entry) * qty : (entry - price) * qty;
  /**
   * No price means no exit, so no exit fee.
   *
   * Charging one anyway made an unpriced position report a loss of twice the
   * entry fee — a number that looks like a real mark-to-market and is not.
   * With no price the only cost that has actually been paid is the entry fee.
   */
  const exitFee = hasPrice ? price * qty * TAKER_FEE : 0;
  const pnl = gross - num(p.entryFee) - exitFee;
  const roe = margin > EPS ? (pnl / margin) * 100 : 0;
  const liq = liquidationPrice(entry, side, lev);

  /**
   * Distance to liquidation, as a percentage of the current price.
   *
   * Positive means "still alive, this far from dying". The sign has to be
   * taken per side: a long's liquidation sits BELOW the price and a short's
   * ABOVE it, so a plain `(liq - price) / price` reported a healthy long as
   * -9.6% — reading as if it were already past its liquidation.
   */
  const liqDistancePct = hasPrice && liq > 0
    ? ((side === 'LONG' ? price - liq : liq - price) / price) * 100
    : 0;

  /**
   * A position is liquidated when the mark crosses the liquidation price.
   * Reported, not acted on: this is a demo book, so nothing is force-closed.
   * The UI shows it in red and the user closes it themselves.
   */
  const liquidated = hasPrice && liq > 0
    && (side === 'LONG' ? price <= liq : price >= liq);

  return {
    ...p,
    side,
    mark: price,
    hasPrice,
    gross,
    exitFee,
    pnl,
    roe,
    liq,
    liqDistancePct,
    liquidated,
    // Value of the position if closed right now: margin plus what it made.
    equity: margin + pnl,
  };
}

/**
 * Mark every open position and total the book.
 *
 * @param {Array} list    stored positions
 * @param {Object} prices {BTCUSDT: 65000}
 * @returns {{positions:Array, totals:Object}}
 */
function computeFutures(list, prices = {}) {
  const rows = Array.isArray(list) ? list : [];
  const positions = rows.map((p) => markPosition(p, prices[p.symbol]));

  const totals = {
    count: positions.length,
    margin: positions.reduce((s, p) => s + num(p.margin), 0),
    notional: positions.reduce((s, p) => s + num(p.notional), 0),
    pnl: positions.reduce((s, p) => s + num(p.pnl), 0),
    equity: positions.reduce((s, p) => s + num(p.equity), 0),
    atRisk: positions.filter((p) => p.liquidated).length,
  };
  totals.roe = totals.margin > EPS ? (totals.pnl / totals.margin) * 100 : 0;

  /**
   * The position closest to liquidation, for the strip.
   *
   * "Closest" is the smallest absolute distance, so a short 0.4% above its
   * liquidation outranks a long 30% below its own. Only positions with a
   * price are considered — an unpriced one has no distance to compare.
   */
  let nearest = null;
  for (const p of positions) {
    if (!p.hasPrice || !(p.liq > 0)) continue;
    const d = Math.abs(p.liqDistancePct);
    if (!nearest || d < Math.abs(nearest.liqDistancePct)) nearest = p;
  }
  totals.nearest = nearest;

  return { positions, totals };
}

/**
 * The rows the collapsed strip draws for the futures book.
 *
 * Two independent pins, because they answer different questions: the PnL row
 * says "am I up", the liquidation row says "am I about to be wiped out". A
 * user watching a 3x position wants the first; a user at 50x wants the second.
 *
 * @param {object} totals   from computeFutures
 * @param {object} pins     {pnl:boolean, liq:boolean}
 * @returns {Array<{kind:string, text:string, tone:string}>}
 */
function stripRows(totals, pins) {
  const t = totals || {};
  const p = pins || {};
  const out = [];
  if (!(t.count > 0)) return out;

  if (p.pnl !== false) {
    out.push({
      kind: 'pnl',
      label: 'FUT',
      text: `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}`,
      sub: `${t.roe >= 0 ? '+' : ''}${t.roe.toFixed(1)}%`,
      tone: t.pnl > 0 ? 'up' : t.pnl < 0 ? 'down' : 'flat',
    });
  }
  if (p.liq !== false && t.nearest) {
    const n = t.nearest;
    out.push({
      kind: 'liq',
      label: n.base || String(n.symbol || '').replace(/USDT$/, ''),
      text: n.liq.toFixed(n.liq < 1 ? 4 : 2),
      sub: `${n.liqDistancePct >= 0 ? '+' : ''}${n.liqDistancePct.toFixed(1)}%`,
      tone: n.liquidated ? 'down' : Math.abs(n.liqDistancePct) < 5 ? 'down' : 'flat',
    });
  }
  return out;
}

module.exports = {
  MMR,
  TAKER_FEE,
  MIN_LEVERAGE,
  MAX_LEVERAGE,
  normalizeSide,
  liquidationPrice,
  buildPosition,
  markPosition,
  computeFutures,
  stripRows,
};
