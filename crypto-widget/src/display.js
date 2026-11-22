'use strict';
/**
 * Which parts of the widget are shown — pure decisions, no Electron, no DOM.
 *
 * ---------------------------------------------------------------------------
 * Why this is a module and not a handful of `if`s in the renderer
 *
 * The widget has two surfaces that show the same numbers: the expanded panel
 * and the 44px strip inside the taskbar. They are not the same thing, and the
 * user may well want the total in the strip but not in the panel, or the P&L
 * in the panel but not in a strip that is only 200px wide.
 *
 * So the choice is a small, explicit record with one key per thing that can be
 * shown, and every surface asks this module rather than reading a boolean
 * inline. That keeps the two surfaces from drifting apart, and it makes the
 * whole thing testable without a browser.
 * ---------------------------------------------------------------------------
 */

/**
 * Every toggle, in the order the settings sheet lists them.
 *
 * `strip*` keys are the collapsed strip's own switches. They are separate on
 * purpose: the strip is a different surface with a different amount of room,
 * and tying it to the panel's switches would mean turning the chart off in the
 * panel also blanked the strip.
 */
const DISPLAY_KEYS = [
  'total',
  'pnl',
  'pct',
  'positions',
  'list',
  'alloc',
  'icons',
  'spark',
  'stripTotal',
  'stripPnl',
  'stripPct',
  'stripSpark',
];

/**
 * Defaults: everything on.
 *
 * That is what every earlier version showed, so an existing install looks
 * exactly the same after the upgrade until the user unticks something.
 */
const DEFAULT_DISPLAY = Object.freeze({
  total: true,
  pnl: true,
  pct: true,
  positions: true,
  list: true,
  alloc: true,
  icons: true,
  spark: true,
  stripTotal: true,
  stripPnl: true,
  stripPct: true,
  stripSpark: true,
});

/** Human labels, used by the settings sheet and by the tests' messages. */
const DISPLAY_LABELS = Object.freeze({
  total: 'Tổng giá trị',
  pnl: 'Lãi/lỗ (số tiền)',
  pct: 'Lãi/lỗ (%)',
  positions: 'Số vị thế đang mở',
  list: 'Danh sách coin',
  alloc: 'Thanh phân bổ',
  icons: 'Icon đồng coin',
  spark: 'Biểu đồ nến',
  stripTotal: 'Tổng giá trị',
  stripPnl: 'Lãi/lỗ (số tiền)',
  stripPct: 'Lãi/lỗ (%)',
  stripSpark: 'Biểu đồ nến',
});

/**
 * Coerce anything into a complete, valid display record.
 *
 * Unknown keys are dropped and missing keys take their default, so a settings
 * file written by a future version (or hand-edited) can never leave a surface
 * asking about a key that does not exist.
 *
 * @param {object|null|undefined} raw
 * @returns {object} a fresh record with exactly DISPLAY_KEYS
 */
function normalizeDisplay(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of DISPLAY_KEYS) {
    // Only an explicit `false` turns something off. A missing key, a string,
    // a null — all mean "leave it at the default", which is on. Reading it the
    // other way round would blank the widget for anyone whose file predates
    // this feature.
    out[key] = src[key] === false ? false : DEFAULT_DISPLAY[key];
  }
  return out;
}

/** Is one thing shown? Unknown keys are treated as "not a thing" -> false. */
function isVisible(display, key) {
  if (!DISPLAY_KEYS.includes(key)) return false;
  const d = normalizeDisplay(display);
  return d[key] !== false;
}

/** The keys that are currently on, in DISPLAY_KEYS order. */
function visibleKeys(display) {
  const d = normalizeDisplay(display);
  return DISPLAY_KEYS.filter((k) => d[k] !== false);
}

/**
 * True when the expanded panel would show nothing at all.
 *
 * The chart is not part of this record (it has its own switch, because it also
 * has a range), so it is passed in. A panel with no numbers, no list and no
 * chart is an empty box, and the renderer uses this to say so instead of
 * leaving the user staring at a blank widget wondering what broke.
 */
function isEmptyPanel(display, chartOn) {
  const d = normalizeDisplay(display);
  const anyNumber = d.total || d.pnl || d.pct || d.positions;
  return !anyNumber && !d.list && !chartOn;
}

/** True when the collapsed strip would show nothing at all. */
function isEmptyStrip(display) {
  const d = normalizeDisplay(display);
  return !d.stripTotal && !d.stripPnl && !d.stripPct;
}

/**
 * Apply a partial change, returning a complete record.
 *
 * The renderer sends one key at a time (a checkbox click), so this is the
 * function that turns that into something the store can hold.
 */
function patchDisplay(current, patch) {
  const base = normalizeDisplay(current);
  const p = patch && typeof patch === 'object' ? patch : {};
  const out = { ...base };
  for (const key of DISPLAY_KEYS) {
    if (p[key] === true || p[key] === false) out[key] = p[key];
  }
  return out;
}

/* ==========================================================================
 * Per-coin rows in the collapsed strip
 * --------------------------------------------------------------------------
 * The strip's three switches above decide whether the SUMMARY line shows the
 * total, the P&L and the percentage. That is the whole portfolio in one line,
 * which is what the strip has always been.
 *
 * What they cannot express is "also follow LDO". A portfolio of six coins has
 * one number that moves for reasons the user cannot see, so the strip gains a
 * row per coin the user ticks — its own price and its own change.
 *
 * Kept out of DISPLAY_KEYS on purpose. That record is a flat set of booleans
 * and `normalizeDisplay` coerces every key to true/false; a per-coin selection
 * is a variable-length list of symbols, so folding it in would either lose the
 * symbols or turn them into `true`.
 * ========================================================================== */

/**
 * Height of one line in the stacked strip, in px.
 *
 * 13, not the 18-20 a roomy layout would use. The strip is an overlay INSIDE
 * the taskbar's own rectangle, so its height is capped by the taskbar's: on a
 * 48px taskbar the usable box is 44px. Three 13px lines plus padding is 43px,
 * which fits. Any larger and the third line would be clipped, and a clipped
 * number is worse than one that is not shown.
 */
const STRIP_ROW_H = 13;

/** Vertical padding inside the strip, top and bottom, in px. */
const STRIP_PAD_Y = 2;

/** The strip's height when it holds the summary line alone. */
const STRIP_BASE_H = 44;

/** Never smaller than this, whatever the taskbar measures. */
const STRIP_MIN_H = 28;

/**
 * How many coin rows the strip may ever hold.
 *
 * A cap, not a target: past this the strip stops reading as a taskbar widget
 * and starts reading as a panel, and the user should open the panel instead.
 */
const STRIP_MAX_ROWS = 8;

/** The most symbols that may be selected, matching STRIP_MAX_ROWS. */
const STRIP_MAX_SELECTED = 8;

/**
 * Coerce anything into a clean list of selected coin symbols.
 *
 * Accepts the array the renderer sends, and also the object form
 * `{LDO: true, ETH: false}` so a hand-edited settings file or an older shape
 * cannot wedge the feature. Order is preserved and duplicates dropped, so the
 * user's rows keep the order they were ticked in rather than jumping around.
 *
 * @param {string[]|object|null|undefined} raw
 * @returns {string[]} uppercase base symbols, e.g. ["LDO", "ETH"]
 */
function normalizeStripCoins(raw) {
  let list = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (raw && typeof raw === 'object') {
    list = Object.keys(raw).filter((k) => raw[k] === true);
  }
  const out = [];
  for (const item of list) {
    /**
     * Strings only.
     *
     * `String(42)` is "42", which passes the ticker pattern below and would
     * put a row labelled "42" in the strip. A number in this list is junk from
     * a hand-edited file, not a coin, so it is dropped before the pattern is
     * even consulted. The unit test that feeds `42` in caught this.
     */
    if (typeof item !== 'string') continue;
    const s = item.trim().toUpperCase();
    // Tickers are 2-10 characters and alphanumeric. Anything else is junk from
    // a hand-edited file, and passing it through would put a nameless row in
    // the strip.
    if (!/^[A-Z0-9]{2,10}$/.test(s)) continue;
    if (out.includes(s)) continue;
    out.push(s);
    if (out.length >= STRIP_MAX_SELECTED) break;
  }
  return out;
}

/**
 * The coin rows the strip should draw, in portfolio order.
 *
 * A selected coin that is no longer held produces no row: after selling out,
 * `qty` is 0 and a row reading "0.00" is noise. The selection is remembered,
 * so buying back in brings the row straight back without re-ticking it.
 *
 * @param {Array} positions  from computePositions
 * @param {string[]|object} selected
 * @returns {Array} the position objects to draw, at most STRIP_MAX_ROWS
 */
function stripCoinRows(positions, selected) {
  const want = normalizeStripCoins(selected);
  if (!want.length) return [];
  const list = Array.isArray(positions) ? positions : [];
  const byBase = new Map();
  for (const p of list) {
    if (!p || !(Number(p.qty) > 0)) continue;
    byBase.set(String(p.base || '').toUpperCase(), p);
  }
  const out = [];
  // Iterate the SELECTION, not the positions: the rows then appear in the
  // order the user ticked them, which is the order they see in the settings
  // sheet. Portfolio order would reshuffle the strip whenever a price moved.
  for (const base of want) {
    const p = byBase.get(base);
    if (p) out.push(p);
    if (out.length >= STRIP_MAX_ROWS) break;
  }
  return out;
}

/**
 * How many coin rows fit in a strip of `limit` px.
 *
 * The summary line always gets its row first; whatever is left over is divided
 * into 13px lines. A strip inside a 48px taskbar therefore holds two coin rows
 * (44 - 13 = 31, 31 / 13 = 2), and a docked strip that is not confined to the
 * taskbar holds as many as were selected.
 *
 * @param {number} limit  available height in px; Infinity when unconstrained
 * @returns {number} 0..STRIP_MAX_ROWS
 */
function stripRowsThatFit(limit) {
  const cap = Number(limit);
  if (!Number.isFinite(cap)) return STRIP_MAX_ROWS;
  const room = Math.floor((cap - STRIP_PAD_Y * 2 - STRIP_ROW_H) / STRIP_ROW_H);
  return Math.max(0, Math.min(STRIP_MAX_ROWS, room));
}

/**
 * The strip's window height for a given number of coin rows.
 *
 * The summary line plus one 13px line per coin, clamped to the space actually
 * available. With no coins selected this returns STRIP_BASE_H, so the strip is
 * exactly the size every earlier version drew it at.
 *
 * @param {number} rowCount
 * @param {number} limit  the most the surroundings allow, in px
 * @returns {number}
 */
function stripHeightFor(rowCount, limit) {
  const n = Math.max(0, Math.min(STRIP_MAX_ROWS, Math.round(Number(rowCount) || 0)));
  const wanted = n === 0 ? STRIP_BASE_H : (1 + n) * STRIP_ROW_H + STRIP_PAD_Y * 2;
  const cap = Number(limit);
  const max = Number.isFinite(cap) && cap > 0 ? Math.round(cap) : wanted;
  return Math.max(STRIP_MIN_H, Math.min(wanted, Math.max(STRIP_MIN_H, max)));
}

module.exports = {
  DISPLAY_KEYS,
  DEFAULT_DISPLAY,
  DISPLAY_LABELS,
  normalizeDisplay,
  isVisible,
  visibleKeys,
  isEmptyPanel,
  isEmptyStrip,
  patchDisplay,
  STRIP_ROW_H,
  STRIP_PAD_Y,
  STRIP_BASE_H,
  STRIP_MIN_H,
  STRIP_MAX_ROWS,
  STRIP_MAX_SELECTED,
  normalizeStripCoins,
  stripCoinRows,
  stripRowsThatFit,
  stripHeightFor,
};
