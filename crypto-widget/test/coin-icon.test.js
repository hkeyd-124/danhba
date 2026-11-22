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

/* ==========================================================================
 * Real logos
 * ========================================================================== */

const { iconFor, COIN_ICON, COIN_DATA } = require('../src/coin-icon');

/**
 * The bytes behind a data URI, whichever way it is encoded.
 *
 * Two encodings are in use and both are legitimate:
 *   - `;base64,`  the raster logos (PNG has no text form)
 *   - percent-encoded  the vector logos, which are SVG text and come out ~22KB
 *     smaller that way than base64 for the same bytes on screen
 *
 * The first version of this file assumed base64 everywhere, so the moment the
 * vectors switched encoding every viewBox assertion decoded to garbage and
 * failed. Decoding is the test's job, not the data's.
 */
function decode(uri) {
  const payload = uri.slice(uri.indexOf(',') + 1);
  if (/;base64,/.test(uri)) return Buffer.from(payload, 'base64');
  return Buffer.from(decodeURIComponent(payload), 'utf8');
}

test('every coin in the icon table has real bytes behind it', () => {
  // A coin listed here but with no data renders a broken image, which looks
  // worse than the drawn badge it replaced. This is the assertion that keeps
  // the table and the vendored data from drifting apart.
  const bad = [];
  for (const base of Object.keys(COIN_ICON)) {
    const uri = COIN_DATA[base];
    if (!uri) { bad.push(`${base} -> no data`); continue; }
    if (!/^data:image\/(svg\+xml|png)(;base64)?,[\s\S]+$/.test(uri)) {
      bad.push(`${base} -> not an image data URI`);
      continue;
    }
    // A truncated payload decodes to a few bytes and paints nothing.
    if (decode(uri).length < 100) bad.push(`${base} -> payload too small`);
  }
  assert.deepEqual(bad, [], `bad icon data:\n${bad.join('\n')}`);
});

test('iconFor returns a data URI, never a URL or a path', () => {
  // The page's CSP is `img-src 'self' data:`. A path would need a file on disk
  // the sandboxed renderer cannot read; an absolute URL would be blocked. The
  // data URI is the only form that works, and it can never point off-machine.
  const p = iconFor('ETHUSDT');
  assert.ok(p.startsWith('data:image/'), `expected a data URI, got ${String(p).slice(0, 40)}`);
  assert.ok(!/^https?:/i.test(p), 'must not be an absolute URL');
  assert.ok(!p.startsWith('/'), 'must not be a filesystem path');
});

test('iconFor accepts a bare ticker as well as a full symbol', () => {
  assert.equal(iconFor('ETH'), iconFor('ETHUSDT'));
  assert.equal(iconFor('eth'), iconFor('ETHUSDT'));
});

test('iconFor returns null for a coin with no vendored logo', () => {
  // The drawn badge is the fallback, so this must be null rather than a URI
  // to data that does not exist.
  assert.equal(iconFor('PEPEUSDT'), null);
  assert.equal(iconFor('NOTACOINUSDT'), null);
  assert.equal(iconFor(''), null);
});

test('badgeFor carries the icon alongside the colour and glyph', () => {
  const eth = badgeFor('ETHUSDT');
  assert.ok(eth.icon.startsWith('data:image/'), 'ETH must carry a real logo');
  assert.equal(eth.color, BRAND.ETH);
  assert.equal(eth.glyph, 'ETH');

  // A coin with no logo still gets a usable badge.
  const pepe = badgeFor('PEPEUSDT');
  assert.equal(pepe.icon, null);
  assert.equal(pepe.glyph, 'PEPE');
  assert.ok(/^#[0-9a-f]{6}$/i.test(pepe.color));
});

test('the icon table only names coins that are in the brand table', () => {
  // A logo for a coin with no brand colour would render, but its allocation
  // bar and ticker text would fall back to a hash colour — an inconsistency
  // nobody would think to look for.
  const orphans = Object.keys(COIN_ICON).filter((b) => !BRAND[b]);
  assert.deepEqual(orphans, []);
});

/* ==========================================================================
 * Sharpness — the resolution has to be enough for the size it is drawn at
 * ========================================================================== */

/**
 * The largest a badge is ever drawn, in CSS px.
 *
 * `.coin` is 22px in the panel (renderer/styles.css). A source image smaller
 * than this is UPSCALED by the browser, which is what "the icons look blurry"
 * was: every logo was a 20x20 PNG painted into a 22px box.
 *
 * The number is duplicated from the stylesheet on purpose. If the badge grows,
 * this test should fail and force the icons to be regenerated — that is the
 * point of it, and a test that read the CSS would silently follow the change.
 */
const MAX_DRAWN_PX = 22;

test('every raster logo has at least as many pixels as it is drawn at', () => {
  const bad = [];
  for (const [base, uri] of Object.entries(COIN_DATA)) {
    if (!uri.startsWith('data:image/png')) continue;
    const buf = decode(uri);
    // PNG: width is a big-endian uint32 at byte 16, height at 20.
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    if (w < MAX_DRAWN_PX || h < MAX_DRAWN_PX) {
      bad.push(`${base} ${w}x${h} < ${MAX_DRAWN_PX}px`);
    }
  }
  assert.deepEqual(bad, [], `logos that would be upscaled:\n${bad.join('\n')}`);
});

test('every vector logo carries a viewBox, so it scales without blurring', () => {
  // An SVG with width/height but no viewBox does not scale: the browser paints
  // it at its intrinsic size and the result is as soft as a small raster. The
  // viewBox is what makes the vector actually vector.
  const bad = [];
  for (const [base, uri] of Object.entries(COIN_DATA)) {
    if (!uri.startsWith('data:image/svg+xml')) continue;
    const svg = decode(uri).toString('utf8');
    if (!/^<svg[\s>]/.test(svg)) bad.push(`${base} -> not an <svg> root`);
    else if (!/viewBox=/.test(svg)) bad.push(`${base} -> no viewBox`);
  }
  assert.deepEqual(bad, [], `vectors that would not scale:\n${bad.join('\n')}`);
});

test('the two logo formats are both present, and neither is empty', () => {
  // Guards the regeneration: a run that silently produced only one format, or
  // dropped a set, would still pass every other assertion here.
  const kinds = { svg: 0, png: 0 };
  for (const uri of Object.values(COIN_DATA)) {
    if (uri.startsWith('data:image/svg+xml')) kinds.svg++;
    else if (uri.startsWith('data:image/png')) kinds.png++;
  }
  assert.ok(kinds.svg > 0, 'expected some vector logos');
  assert.ok(kinds.png > 0, 'expected some raster logos');
  assert.equal(kinds.svg + kinds.png, Object.keys(COIN_DATA).length);
});
