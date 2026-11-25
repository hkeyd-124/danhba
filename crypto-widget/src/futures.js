'use strict';
/**
 * Demo futures positions — pure math, no I/O, no Electron.
 *
 * ---------------------------------------------------------------------------
 * What "demo" means here, precisely
 *
 * Nothing in this module touches an exchange. There is no API key, no order,
 * no account, no money. A position is a row in the local JSON file: a symbol,
 * a side, a margin mode, a leverage, a quantity, a margin and an entry price.
 * Everything else — PnL, ROE, the liquidation price — is DERIVED from the live
 * mark price the price feed already fetches for the spot portfolio.
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
 * Isolated vs cross — the one place the two really differ
 *
 * ISOLATED: the position's own margin is the only thing standing behind it.
 * It dies when its own loss has eaten that margin down to the maintenance
 * requirement. Nothing else in the book can save it, and it cannot hurt
 * anything else.
 *
 * CROSS: every cross position shares one pool. A position does not die on its
 * own — the ACCOUNT dies, when the pool's equity falls to the sum of all
 * maintenance requirements. So a cross position's liquidation price is not a
 * property of that position alone: it depends on the other cross positions and
 * on where they are marked. That is why `computeFutures` marks in two passes
 * and why `crossLiquidation` takes the pool as an argument.
 *
 * Modelling this honestly matters more than modelling it simply: a cross
 * position shown with an isolated liquidation price would tell the user they
 * are 9% from death when they are in fact 40% away, or the reverse.
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

/** The two margin modes, in the order the UI shows them. */
const MARGIN_MODES = ['isolated', 'cross'];

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
 * 'cross' | 'CROSS' | 'chéo' -> 'cross'; anything else -> 'isolated'.
 *
 * Isolated is the default because it is the safer of the two to be wrong
 * about: an isolated position dies sooner, so a mislabelled one understates
 * the danger rather than overstating it.
 */
function normalizeMarginMode(raw) {
  const s = String(raw || '').trim().toLowerCase();
  return s === 'cross' ? 'cross' : 'isolated';
}

/**
 * Liquidation price for an ISOLATED position, from leverage alone.
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
 * This is the "required margin only" case. When the user has posted MORE than
 * the required margin, use `isolatedLiquidation`, which takes the actual
 * margin into account.
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
 * Liquidation price for an ISOLATED position, from its actual margin.
 *
 * The position dies when its loss has consumed everything above the
 * maintenance requirement:
 *
 *   buffer = margin - MMR * notional
 *   LONG : entry - buffer / qty
 *   SHORT: entry + buffer / qty
 *
 * With margin equal to the required margin this reduces exactly to
 * `liquidationPrice`, which is what the tests pin down. With extra margin
 * added it moves further away — the whole point of adding margin.
 *
 * @param {number} entry
 * @param {string} side
 * @param {number} qty
 * @param {number} margin
 * @returns {number} 0 when the inputs cannot produce a meaningful price
 */
function isolatedLiquidation(entry, side, qty, margin) {
  const e = num(entry);
  const q = num(qty);
  const m = num(margin);
  if (!(e > 0) || !(q > 0) || !(m > 0)) return 0;
  const buffer = m - MMR * q * e;
  if (!(buffer > 0)) return 0;
  const p = normalizeSide(side) === 'LONG' ? e - buffer / q : e + buffer / q;
  return p > 0 ? p : 0;
}

/**
 * Liquidation price for a CROSS position, given the shared pool.
 *
 * The account dies when the pool's equity reaches the sum of every cross
 * position's maintenance requirement. Holding the other positions at their
 * current mark, the move in THIS position's price that gets there is:
 *
 *   delta = (equity - maintenance) / qty
 *   LONG : mark - delta      (a long dies on the way down)
 *   SHORT: mark + delta      (a short dies on the way up)
 *
 * When `equity` is already at or below `maintenance`, delta is <= 0 and the
 * returned price lands on the wrong side of the mark — which is exactly the
 * signal that the account is already liquidatable. `markPosition` reads that
 * as `liquidated`.
 *
 * @param {object} pos   a marked position (needs mark, qty, side)
 * @param {number} equity      pool equity: sum(margin + pnl) over cross rows
 * @param {number} maintenance sum(MMR * notional) over cross rows
 * @returns {number} 0 when the inputs cannot produce a meaningful price
 */
function crossLiquidation(pos, equity, maintenance) {
  const p = pos || {};
  const mark = num(p.mark);
  const q = num(p.qty);
  if (!(mark > 0) || !(q > 0)) return 0;
  const delta = (num(equity) - num(maintenance)) / q;
  const price = normalizeSide(p.side) === 'LONG' ? mark - delta : mark + delta;
  return price > 0 ? price : 0;
}

/**
 * Validate and build a position from user input.
 *
 * Returns `{ ok: true, position }` or `{ ok: false, error }` — never throws,
 * because this is called straight from an IPC handler whose return value the
 * renderer prints.
 *
 * QUANTITY and MARGIN are both real, per-position fields, and they are not
 * independent: `leverage` fixes the MINIMUM margin a given quantity requires
 * (notional / leverage). The user may post more than that — that is what
 * "adding margin" means on the exchange, and it is the only way to move a
 * liquidation price without changing the size of the bet. Posting less is
 * refused, because it would silently mean a higher leverage than the one the
 * user typed.
 *
 * Backward compatibility: a row written before quantity existed has margin,
 * leverage and entry but no qty. In that case qty is derived from them, which
 * reproduces exactly the position that row described.
 *
 * @param {object} input  {symbol, side, marginMode, leverage, entry, qty, margin, note}
 * @param {string} symbol already normalised by the caller
 * @returns {{ok:boolean, position?:object, error?:string}}
 */
function buildPosition(input, symbol) {
  const i = input || {};
  const sym = String(symbol || '').trim().toUpperCase();
  if (!sym) return { ok: false, error: 'Chưa nhập đồng coin.' };

  const entry = num(i.entry);
  if (!(entry > 0)) return { ok: false, error: 'Giá vào phải lớn hơn 0.' };

  const leverage = Math.round(num(i.leverage, 1));
  if (!(leverage >= MIN_LEVERAGE && leverage <= MAX_LEVERAGE)) {
    return { ok: false, error: `Đòn bẩy phải từ ${MIN_LEVERAGE} đến ${MAX_LEVERAGE}.` };
  }

  const side = normalizeSide(i.side);
  const marginMode = normalizeMarginMode(i.marginMode);

  /**
   * Quantity: taken from the input when given, otherwise derived from the
   * margin and leverage of an older row.
   */
  let qty = num(i.qty);
  let margin = num(i.margin);

  if (!(qty > 0)) {
    if (!(margin > 0)) return { ok: false, error: 'Khối lượng phải lớn hơn 0.' };
    qty = (margin * leverage) / entry;
  }
  if (!(qty > 0)) return { ok: false, error: 'Khối lượng phải lớn hơn 0.' };

  const notional = qty * entry;
  const requiredMargin = notional / leverage;

  if (!(margin > 0)) margin = requiredMargin;

  /**
   * A margin below the requirement is not "a smaller position" — it is the
   * same position at a higher leverage than the one on the label. Refused
   * rather than silently rounded up, so the number the user sees is the number
   * that is actually backing the bet.
   */
  if (margin < requiredMargin - 1e-9) {
    return {
      ok: false,
      error: `Ký quỹ tối thiểu ${requiredMargin.toFixed(2)} USDT cho `
        + `${qty} đơn vị ở ${leverage}x.`,
    };
  }

  const entryFee = notional * TAKER_FEE;

  return {
    ok: true,
    position: {
      id: i.id || null,
      symbol: sym,
      side,
      marginMode,
      leverage,
      entry,
      qty,
      margin,
      notional,
      requiredMargin,
      // What the position is really running at once the posted margin is
      // taken into account. Equal to `leverage` unless extra margin was added.
      effectiveLeverage: notional / margin,
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
 * The liquidation price is filled in for ISOLATED positions here. A CROSS
 * position's price depends on the whole pool, so it is left at 0 and filled in
 * by `computeFutures` on its second pass.
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
  const marginMode = normalizeMarginMode(p.marginMode);
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

  const liq = marginMode === 'isolated'
    ? isolatedLiquidation(entry, side, qty, margin)
    : 0;

  /**
   * An isolated position's liquidation price, distance and flag are all
   * properties of the row alone, so they are filled in here. A cross row's are
   * not — they depend on the whole pool — so they are left at 0/false and
   * filled in by `computeFutures` on its second pass.
   */
  const out = {
    ...p,
    side,
    marginMode,
    mark: price,
    hasPrice,
    gross,
    exitFee,
    pnl,
    roe,
    liq,
    liqDistancePct: 0,
    liquidated: false,
    // Value of the position if closed right now: margin plus what it made.
    equity: margin + pnl,
    // Kept for a row written before `effectiveLeverage` existed.
    effectiveLeverage: margin > EPS ? (qty * entry) / margin : lev,
  };

  if (marginMode === 'isolated') {
    out.liqDistancePct = liqDistance(out);
    out.liquidated = hasPrice && liq > 0
      && (side === 'LONG' ? price <= liq : price >= liq);
  }

  return out;
}

/**
 * Distance to liquidation, as a percentage of the current price.
 *
 * Positive means "still alive, this far from dying". The sign has to be taken
 * per side: a long's liquidation sits BELOW the price and a short's ABOVE it,
 * so a plain `(liq - price) / price` reported a healthy long as -9.6% —
 * reading as if it were already past its liquidation.
 */
function liqDistance(pos) {
  const p = pos || {};
  const price = num(p.mark);
  const liq = num(p.liq);
  if (!(price > 0) || !(liq > 0)) return 0;
  const d = normalizeSide(p.side) === 'LONG' ? price - liq : liq - price;
  return (d / price) * 100;
}

/**
 * Mark every open position and total the book.
 *
 * Two passes, because cross positions cannot be marked in one:
 *
 *   1. mark each row to the live price (PnL, fees, isolated liquidation);
 *   2. for the cross rows, build the shared pool from pass 1 and give each of
 *      them the liquidation price that pool implies.
 *
 * @param {Array} list    stored positions
 * @param {Object} prices {BTCUSDT: 65000}
 * @returns {{positions:Array, totals:Object}}
 */
function computeFutures(list, prices = {}) {
  const rows = Array.isArray(list) ? list : [];
  const positions = rows.map((p) => markPosition(p, prices[p.symbol]));

  // ---- pass 2: the cross pool -------------------------------------------
  const cross = positions.filter((p) => p.marginMode === 'cross');
  if (cross.length) {
    const equity = cross.reduce((s, p) => s + num(p.margin) + num(p.pnl), 0);
    const maintenance = cross.reduce((s, p) => s + MMR * num(p.notional), 0);
    const wiped = equity <= maintenance;

    for (const p of cross) {
      p.liq = crossLiquidation(p, equity, maintenance);
      p.liqDistancePct = liqDistance(p);
      /**
       * In cross mode the whole account dies together, so every cross row is
       * reported as liquidated at once. Reporting them one by one would let
       * the UI show a "safe" row next to a dead one in the same pool.
       */
      p.liquidated = wiped || (p.liq > 0 && (p.side === 'LONG'
        ? p.mark <= p.liq
        : p.mark >= p.liq));
    }
  }

  // ---- isolated rows: distance and the liquidation flag ------------------
  for (const p of positions) {
    if (p.marginMode === 'cross') continue;
    p.liqDistancePct = liqDistance(p);
    p.liquidated = p.hasPrice && p.liq > 0
      && (p.side === 'LONG' ? p.mark <= p.liq : p.mark >= p.liq);
  }

  const totals = {
    count: positions.length,
    margin: positions.reduce((s, p) => s + num(p.margin), 0),
    notional: positions.reduce((s, p) => s + num(p.notional), 0),
    pnl: positions.reduce((s, p) => s + num(p.pnl), 0),
    equity: positions.reduce((s, p) => s + num(p.equity), 0),
    atRisk: positions.filter((p) => p.liquidated).length,
    crossCount: cross.length,
    isolatedCount: positions.length - cross.length,
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
      mode: n.marginMode,
    });
  }
  return out;
}

module.exports = {
  MMR,
  TAKER_FEE,
  MIN_LEVERAGE,
  MAX_LEVERAGE,
  MARGIN_MODES,
  normalizeSide,
  normalizeMarginMode,
  liquidationPrice,
  isolatedLiquidation,
  crossLiquidation,
  liqDistance,
  buildPosition,
  markPosition,
  computeFutures,
  stripRows,
};
