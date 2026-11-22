'use strict';
/**
 * Tests for the coin badges.
 *
 * Two properties matter and both are easy to break:
 *   1. The same coin always gets the same colour (a hash would not guarantee
 *      that for a known coin, and a random pick would be worse).
 *   2. The glyph is readable on the disc — measured, not assumed, because some
 *      brand colours are near-white and some are near-black.
 */
const test = require('node:test');
const assert = require('node:assert');
const { badgeFor, glyphColor, baseOf, BRAND, FALLBACK } = require('../src/coin-icon');

test('baseOf strips the quote asset', () => {
  assert.equal(baseOf('BTCUSDT'), 'BTC');
  assert.equal(baseOf('ethusdt'), 'ETH');
  assert.equal(baseOf('SOLUSDC'), 'SOL');
  assert.equal(baseOf('BTC'), 'BTC');
  assert.equal(baseOf(''), '');
});

test('a known coin gets its brand colour', () => {
  assert.equal(badgeFor('BTCUSDT').color, BRAND.BTC);
  assert.equal(badgeFor('ETHUSDT').color, BRAND.ETH);
  assert.equal(badgeFor('SOLUSDT').color, BRAND.SOL);
  assert.equal(badgeFor('BTCUSDT').known, true);
});

test('the same coin always gets the same colour, across calls', () => {
  const a = badgeFor('FOOUSDT');
  const b = badgeFor('FOOUSDT');
  assert.equal(a.color, b.color);
  assert.equal(a.glyph, b.glyph);
});

test('an unknown coin still gets a colour from the fallback palette', () => {
  const b = badgeFor('ZZZUSDT');
  assert.equal(b.known, false);
  assert.ok(FALLBACK.includes(b.color), `${b.color} should be in the fallback palette`);
});

test('the glyph is the ticker, not a single letter', () => {
  // A single letter is ambiguous the moment a portfolio holds SOL and SUI.
  assert.equal(badgeFor('BTCUSDT').glyph, 'BTC');
  assert.equal(badgeFor('SOLUSDT').glyph, 'SOL');
  assert.equal(badgeFor('DOGEUSDT').glyph, 'DOGE');
  // Longer tickers are cut to four, which is what fits in the disc.
  assert.equal(badgeFor('LONGTICKERUSDT').glyph, 'LONG');
});

test('an empty symbol does not throw', () => {
  const b = badgeFor('');
  assert.equal(b.base, '');
  assert.equal(b.glyph, '?');
});

test('glyph ink is chosen by measured contrast, not by a fixed white', () => {
  // A near-white disc needs dark ink; a near-black disc needs light ink.
  assert.equal(glyphColor('#ffffff'), '#0b0f17');
  assert.equal(glyphColor('#000000'), '#ffffff');
  // SOL's mint is light enough that white would be unreadable on it.
  assert.equal(glyphColor(BRAND.SOL), '#0b0f17');
  // BTC's orange is mid-tone: black ink gives it ~8:1, white only ~2.3:1.
  // (The first version of glyphColor had this comparison inverted and returned
  // white here — this assertion is what caught it.)
  assert.equal(glyphColor(BRAND.BTC), '#0b0f17');
  // XRP's near-black disc is the case that needs light ink.
  assert.equal(glyphColor(BRAND.XRP), '#ffffff');
});

test('every brand colour produces a glyph ink with usable contrast', () => {
  // 3:1 is the WCAG floor for large text and UI boundaries; the badge glyph is
  // tiny, so anything under that is a real legibility failure.
  const lum = (hex) => {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    const ch = [m[1], m[2], m[3]].map((h) => {
      const c = parseInt(h, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => {
    const la = lum(a);
    const lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };

  const bad = [];
  for (const [sym, color] of Object.entries(BRAND)) {
    const ink = glyphColor(color);
    const r = ratio(color, ink);
    if (r < 3) bad.push(`${sym} ${color} -> ${ink} = ${r.toFixed(2)}:1`);
  }
  assert.deepEqual(bad, [], `badges below 3:1:\n${bad.join('\n')}`);
});

test('every brand colour is a valid 6-digit hex', () => {
  const bad = Object.entries(BRAND).filter(([, c]) => !/^#[0-9a-f]{6}$/i.test(c));
  assert.deepEqual(bad, []);
});
