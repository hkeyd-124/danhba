'use strict';
/**
 * Which size setting a resize writes — pure decisions, no Electron.
 *
 * ---------------------------------------------------------------------------
 * The bug this module exists to prevent
 *
 * The docked strip and the expanded panel are two different sizes, but every
 * version up to v8 stored ONE number (`dockWidth`) for both, and only wrote it
 * when the window was expanded:
 *
 *     if (persist && ... && !collapsed) { store.patchSettings({ dockWidth }) }
 *
 * In 'taskbar' mode the strip is ALWAYS collapsed, so that condition was never
 * true while the user was dragging the strip. The drag moved the window, the
 * window looked right, and nothing was saved. Expanding then collapsing again
 * re-derived the strip from the stale `dockWidth` — the strip snapped back to
 * its old width. That is exactly the reported symptom.
 *
 * Two things fix it, and both are needed:
 *
 *   1. The strip gets its OWN setting (`stripWidth`), so resizing the panel
 *      does not stretch the strip and vice versa.
 *   2. A resize while collapsed-and-docked writes that setting. The old code
 *      treated "collapsed" as "nothing worth saving", which is true for a
 *      floating window (its collapsed size is a constant) and false for a
 *      docked strip (its width is the user's).
 * ---------------------------------------------------------------------------
 */

/** Width of a docked strip that has never been dragged. */
const DEFAULT_STRIP_WIDTH = 300;

/**
 * Narrowest a docked strip may be dragged.
 *
 * Below this the total value and the P/L pill collide, so the strip stops
 * being readable — which defeats the point of having it on the taskbar.
 */
const MIN_STRIP_WIDTH = 200;

/**
 * The strip's width, in the order the settings are trusted.
 *
 * `stripWidth` wins once it exists. Until then the panel width is used, which
 * is what every earlier version drew the strip at — so an existing install
 * looks unchanged until the user drags the strip for the first time, instead
 * of silently jumping to a new default.
 *
 * @param {object} settings
 * @returns {number}
 */
function stripWidth(settings) {
  const s = settings || {};

  // `!== 0` rather than `> 0`: a negative width is junk that must be clamped
  // up to the minimum, not treated as "never set" and silently replaced by the
  // default. Only 0 and non-numbers mean "the user has not dragged it".
  const own = Number(s.stripWidth);
  if (Number.isFinite(own) && own !== 0) {
    return Math.max(MIN_STRIP_WIDTH, Math.round(own));
  }

  const panel = Number(s.dockWidth);
  if (Number.isFinite(panel) && panel > 0) {
    return Math.max(MIN_STRIP_WIDTH, Math.round(panel));
  }

  return DEFAULT_STRIP_WIDTH;
}

/**
 * The settings patch a finished resize should write, or null for "nothing".
 *
 * The four cases are genuinely different, which is why this is a function and
 * not an `if` buried in a window event handler:
 *
 *   floating, expanded  -> the whole rectangle is the user's; save `bounds`
 *   floating, collapsed -> the collapsed size is a constant; save nothing
 *   docked,   expanded  -> width and height are the user's; the position is
 *                          derived from the taskbar, so only `dockX` is kept
 *   docked,   collapsed -> the strip's HEIGHT is derived from the taskbar and
 *                          must not be saved (saving 44px as `expandedHeight`
 *                          would reopen the panel as a sliver); its WIDTH is
 *                          the user's, and that is the whole point of this fix
 *
 * @param {{docked: boolean, collapsed: boolean, x: number, y: number,
 *          width: number, height: number}} r
 * @returns {object|null}
 */
function sizePatchFor(r) {
  const x = Math.round(Number(r.x) || 0);
  const y = Math.round(Number(r.y) || 0);
  const width = Math.round(Number(r.width) || 0);
  const height = Math.round(Number(r.height) || 0);

  if (!r.docked) {
    if (r.collapsed) return null;
    return { bounds: { x, y, width, height } };
  }

  if (r.collapsed) {
    return { stripWidth: width, dockX: x };
  }

  return { dockWidth: width, expandedHeight: height, dockX: x };
}

/**
 * The settings patch a finished MOVE should write, or null.
 *
 * Kept separate from `sizePatchFor` on purpose: a move must never write a
 * width. `moved` and `resized` both fire for our own `setBounds` calls, and a
 * move handler that also wrote `stripWidth` would freeze the strip at whatever
 * width the last placement happened to use.
 *
 * @param {{docked: boolean, collapsed: boolean, x: number, y: number,
 *          width: number, height: number}} r
 * @returns {object|null}
 */
function movePatchFor(r) {
  const x = Math.round(Number(r.x) || 0);
  const y = Math.round(Number(r.y) || 0);

  if (r.docked) return { dockX: x };
  if (r.collapsed) return null;
  return {
    bounds: {
      x,
      y,
      width: Math.round(Number(r.width) || 0),
      height: Math.round(Number(r.height) || 0),
    },
  };
}

module.exports = {
  stripWidth,
  sizePatchFor,
  movePatchFor,
  DEFAULT_STRIP_WIDTH,
  MIN_STRIP_WIDTH,
};
