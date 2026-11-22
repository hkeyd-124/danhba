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
  assert.ok(j.message.includes(':1'));
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
