'use strict';
/**
 * Tests for the text-colour module.
 *
 * The bug this covers: the old picker set `--text` and left `--muted` and the
 * placeholder colour hard-coded, so choosing a colour left half the widget in
 * a tone that no longer belonged to the palette. These tests pin down that the
 * derived tones actually follow the choice AND stay readable.
 */
const test = require('node:test');
const assert = require('node:assert');
const tc = require('../src/text-color');

test('parseHex accepts #rgb and #rrggbb, rejects junk', () => {
  assert.deepEqual(tc.parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(tc.parseHex('#4f8cff'), [79, 140, 255]);
  assert.equal(tc.parseHex('nope'), null);
  assert.equal(tc.parseHex('#12345'), null);
  assert.equal(tc.parseHex(''), null);
});

test('normalizeHex lowercases and expands', () => {
  assert.equal(tc.normalizeHex('#FFF'), '#ffffff');
  assert.equal(tc.normalizeHex('#4F8CFF'), '#4f8cff');
  assert.equal(tc.normalizeHex('bad'), null);
});

test('contrast matches the WCAG reference values', () => {
  // Black on white is the canonical 21:1.
  assert.equal(Math.round(tc.contrast('#000000', '#ffffff')), 21);
  // A colour against itself is 1:1.
  assert.equal(Math.round(tc.contrast('#4f8cff', '#4f8cff')), 1);
});

test('muted follows the text colour instead of staying a fixed blue-grey', () => {
  const warm = tc.mutedFor('#fde68a', 'solid');
  const cool = tc.mutedFor('#cfe0ff', 'solid');
  assert.notEqual(warm, cool, 'two different text colours must give two different muted tones');
});

test('muted stays readable on every dark theme', () => {
  const bad = [];
  for (const theme of ['solid', 'midnight', 'glass', 'clear', 'aurora']) {
    for (const text of ['#e8eefc', '#ffffff', '#cfe0ff', '#a7f3d0', '#fde68a', '#fbcfe8']) {
      const m = tc.mutedFor(text, theme);
      const r = tc.contrast(m, tc.THEME_SURFACE[theme]);
      if (r < 4.4) bad.push(`${theme} ${text} -> ${m} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(bad, [], `muted tones below 4.5:1:\n${bad.join('\n')}`);
});

test('muted stays readable on the light theme with dark text', () => {
  const m = tc.mutedFor('#1f2937', 'light');
  const r = tc.contrast(m, tc.THEME_SURFACE.light);
  assert.ok(r >= 4.4, `${m} on light = ${r.toFixed(2)}:1`);
});

test('faint is dimmer than muted but still above the 3:1 floor', () => {
  const muted = tc.mutedFor('#e8eefc', 'solid');
  const faint = tc.faintFor('#e8eefc', 'solid');
  assert.notEqual(muted, faint);
  const r = tc.contrast(faint, tc.THEME_SURFACE.solid);
  assert.ok(r >= 2.9, `faint = ${r.toFixed(2)}:1`);
});

test('on the bare theme the tones mix toward the halo, not a surface', () => {
  // There is no surface, so the halo is what the glyphs sit on.
  const dark = tc.mutedFor('#e8eefc', 'bare', 'rgba(0, 0, 0, .92)');
  const light = tc.mutedFor('#1f2937', 'bare', 'rgba(255, 255, 255, .92)');
  assert.notEqual(dark, light);
  assert.ok(/^#[0-9a-f]{6}$/.test(dark));
});

test('judge reports a real ratio on a solid theme', () => {
  const j = tc.judge('#e8eefc', 'solid');
  assert.equal(typeof j.ratio, 'number');
  assert.equal(j.level, 'good');
  /*
   * The message must NOT repeat the ratio.
   *
   * The chip beside it already prints "16.5:1", so a message that also began
   * "Tương phản 16.5:1 —" showed the same figure twice in one row and read as
   * a rendering glitch. The number belongs to the chip; the sentence carries
   * the verdict. This assertion is what keeps the two from drifting back
   * together.
   */
  assert.ok(!j.message.includes(':1'), 'the message must not repeat the ratio the chip already shows');
  assert.ok(j.message.length > 10, 'the message must still say something useful');
});

test('judge refuses to invent a ratio on the bare theme', () => {
  // The background is the user's wallpaper. A number here would be a guess
  // presented as a measurement, which is worse than saying "unknown".
  const j = tc.judge('#e8eefc', 'bare');
  assert.equal(j.ratio, null);
  assert.equal(j.level, 'unknown');
});

test('judge flags an unreadable choice as poor', () => {
  // Dark text on the dark solid surface: this is the exact mistake the old
  // picker allowed silently.
  const j = tc.judge('#1f2937', 'solid');
  assert.equal(j.level, 'poor');
  assert.ok(j.ratio < 3);
});

test('defaultTextFor knows which way the surface goes', () => {
  assert.equal(tc.defaultTextFor('light'), '#1f2937');
  assert.equal(tc.defaultTextFor('solid'), tc.DEFAULT_TEXT);
  assert.equal(tc.defaultTextFor('midnight'), tc.DEFAULT_TEXT);
});

test('haloFor picks the opposite tone', () => {
  assert.ok(tc.haloFor('#ffffff').includes('0, 0, 0'));
  assert.ok(tc.haloFor('#000000').includes('255, 255, 255'));
});

test('an invalid colour falls back instead of throwing', () => {
  assert.doesNotThrow(() => tc.mutedFor('not-a-colour', 'solid'));
  assert.doesNotThrow(() => tc.judge(undefined, 'solid'));
  assert.equal(tc.judge(undefined, 'solid').level, 'good');
});

/* ==========================================================================
 * A see-through theme at low opacity has no measurable surface
 * ========================================================================== */

test('a translucent theme at low opacity reports "unknown", not a fake ratio', () => {
  // The bug: 'clear' at 35% opacity paints a mostly-transparent fill, so the
  // text sits on the wallpaper. Measuring against the theme's nominal colour
  // produced a confident "16.5:1" for text that might be on a white photo —
  // the exact failure this readout exists to prevent, reachable by dragging
  // one slider.
  const j = tc.judge('#e8eefc', 'clear', 0.35);
  assert.equal(j.ratio, null);
  assert.equal(j.level, 'unknown');
  assert.match(j.message, /35%/);
});

test('the same theme at high opacity is measured normally', () => {
  const j = tc.judge('#e8eefc', 'clear', 0.95);
  assert.equal(typeof j.ratio, 'number');
  assert.equal(j.level, 'good');
});

test('a solid theme is measured whatever the opacity says', () => {
  // 'solid' is opaque by definition; the alpha slider does not apply to it,
  // so a low value must not turn its readout into "unknown".
  const j = tc.judge('#e8eefc', 'solid', 0.1);
  assert.equal(typeof j.ratio, 'number');
});

test('omitting the opacity keeps the old behaviour', () => {
  // A caller that does not know the opacity (an older payload, a unit test)
  // must not silently lose its readout.
  const j = tc.judge('#e8eefc', 'clear');
  assert.equal(typeof j.ratio, 'number');
});

test('bare is still unknown regardless of opacity', () => {
  const j = tc.judge('#e8eefc', 'bare', 1);
  assert.equal(j.ratio, null);
  assert.equal(j.level, 'unknown');
});
