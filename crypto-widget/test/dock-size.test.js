'use strict';
/**
 * The docked strip's width must survive an expand/collapse round trip.
 *
 * These tests exist because of a real bug: dragging the taskbar strip changed
 * the window but saved nothing, so expanding and collapsing again snapped the
 * strip back to its old width. The cause was a single `!collapsed` guard in the
 * resize handler, and a single `dockWidth` shared by the strip and the panel.
 */
const test = require('node:test');
const assert = require('node:assert');
const {
  stripWidth,
  sizePatchFor,
  movePatchFor,
  DEFAULT_STRIP_WIDTH,
  MIN_STRIP_WIDTH,
} = require('../src/dock-size');

test('a strip that was never dragged falls back to the panel width', () => {
  // This is what every version before v9 drew the strip at, so an existing
  // install must look unchanged until the user drags the strip.
  assert.strictEqual(stripWidth({ stripWidth: null, dockWidth: 420 }), 420);
});

test('a dragged strip width wins over the panel width', () => {
  assert.strictEqual(stripWidth({ stripWidth: 512, dockWidth: 420 }), 512);
});

test('with neither setting the default is used', () => {
  assert.strictEqual(stripWidth({}), DEFAULT_STRIP_WIDTH);
  assert.strictEqual(stripWidth(null), DEFAULT_STRIP_WIDTH);
});

test('a strip narrower than the readable minimum is clamped up', () => {
  // Below this the total and the P/L pill collide, so the strip stops being
  // readable — which defeats the point of having it on the taskbar.
  assert.strictEqual(stripWidth({ stripWidth: 40 }), MIN_STRIP_WIDTH);
  assert.strictEqual(stripWidth({ stripWidth: -10 }), MIN_STRIP_WIDTH);
});

test('junk in the settings file does not produce a NaN width', () => {
  assert.strictEqual(stripWidth({ stripWidth: 'abc', dockWidth: 420 }), 420);
  assert.strictEqual(stripWidth({ stripWidth: NaN, dockWidth: NaN }), DEFAULT_STRIP_WIDTH);
  assert.strictEqual(stripWidth({ stripWidth: 0, dockWidth: 0 }), DEFAULT_STRIP_WIDTH);
});

test('a fractional width is rounded, not truncated to a sub-pixel window', () => {
  assert.strictEqual(stripWidth({ stripWidth: 411.7 }), 412);
});

// ---------------------------------------------------------------- size patches

test('resizing the docked strip SAVES its width — the bug that was reported', () => {
  const patch = sizePatchFor({ docked: true, collapsed: true, x: 900, y: 1000, width: 512, height: 44 });
  assert.ok(patch, 'a docked strip resize must produce a patch, not null');
  assert.strictEqual(patch.stripWidth, 512);
  assert.strictEqual(patch.dockX, 900);
});

test('resizing the docked strip does NOT overwrite the panel height', () => {
  // The strip is 44px. Saving that as expandedHeight would reopen the panel as
  // a 44px sliver — the mirror image of the reported bug.
  const patch = sizePatchFor({ docked: true, collapsed: true, x: 0, y: 0, width: 512, height: 44 });
  assert.strictEqual(patch.expandedHeight, undefined);
  assert.strictEqual(patch.dockWidth, undefined);
});

test('resizing the docked strip does not touch the panel width', () => {
  const patch = sizePatchFor({ docked: true, collapsed: true, x: 0, y: 0, width: 512, height: 44 });
  assert.strictEqual(patch.dockWidth, undefined);
});

test('resizing the expanded docked panel saves the panel size, not the strip', () => {
  const patch = sizePatchFor({ docked: true, collapsed: false, x: 100, y: 200, width: 480, height: 700 });
  assert.strictEqual(patch.dockWidth, 480);
  assert.strictEqual(patch.expandedHeight, 700);
  assert.strictEqual(patch.stripWidth, undefined);
});

test('resizing a floating window saves the whole rectangle', () => {
  const patch = sizePatchFor({ docked: false, collapsed: false, x: 10, y: 20, width: 420, height: 660 });
  assert.deepStrictEqual(patch, { bounds: { x: 10, y: 20, width: 420, height: 660 } });
});

test('a collapsed floating window saves nothing — its size is a constant', () => {
  assert.strictEqual(
    sizePatchFor({ docked: false, collapsed: true, x: 0, y: 0, width: 420, height: 108 }),
    null,
  );
});

test('a move never writes a width', () => {
  // `moved` and `resized` both fire for our own setBounds calls. A move handler
  // that also wrote stripWidth would freeze the strip at whatever width the
  // last placement happened to use.
  const patch = movePatchFor({ docked: true, collapsed: true, x: 700, y: 1000, width: 512, height: 44 });
  assert.deepStrictEqual(patch, { dockX: 700 });
  assert.strictEqual(patch.stripWidth, undefined);
});

test('a move of a collapsed floating window saves nothing', () => {
  assert.strictEqual(
    movePatchFor({ docked: false, collapsed: true, x: 5, y: 5, width: 420, height: 108 }),
    null,
  );
});

test('a move of an expanded floating window keeps its size', () => {
  const patch = movePatchFor({ docked: false, collapsed: false, x: 5, y: 6, width: 420, height: 660 });
  assert.deepStrictEqual(patch, { bounds: { x: 5, y: 6, width: 420, height: 660 } });
});

// ---------------------------------------------------------------- round trip

test('the reported round trip: drag the strip, expand, collapse — width is kept', () => {
  // Simulate the exact sequence from the bug report, using only the pure
  // decisions, so the regression is pinned without needing a display.
  let settings = { dockWidth: 420, stripWidth: null, expandedHeight: 660 };

  // 1. The strip is drawn at the fallback width.
  assert.strictEqual(stripWidth(settings), 420);

  // 2. The user drags the strip's east edge out to 512px.
  const dragged = sizePatchFor({ docked: true, collapsed: true, x: 800, y: 1000, width: 512, height: 44 });
  settings = { ...settings, ...dragged };

  // 3. The user clicks the strip: it expands. The panel uses dockWidth, which
  //    the strip drag must not have changed.
  assert.strictEqual(settings.dockWidth, 420);

  // 4. The user clicks outside: it collapses again. The strip must come back at
  //    512, not 420.
  assert.strictEqual(stripWidth(settings), 512);
});

test('resizing the panel does not stretch the strip', () => {
  let settings = { dockWidth: 420, stripWidth: 512, expandedHeight: 660 };
  const panel = sizePatchFor({ docked: true, collapsed: false, x: 0, y: 0, width: 600, height: 720 });
  settings = { ...settings, ...panel };
  assert.strictEqual(settings.dockWidth, 600);
  assert.strictEqual(stripWidth(settings), 512, 'the strip must keep its own width');
});
