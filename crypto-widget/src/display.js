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
  'stripTotal',
  'stripPnl',
  'stripPct',
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
  stripTotal: true,
  stripPnl: true,
  stripPct: true,
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
  stripTotal: 'Tổng giá trị',
  stripPnl: 'Lãi/lỗ (số tiền)',
  stripPct: 'Lãi/lỗ (%)',
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
};
