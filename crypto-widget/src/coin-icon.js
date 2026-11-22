'use strict';
/**
 * Coin badges — drawn locally, never downloaded.
 *
 * ---------------------------------------------------------------------------
 * Why these are not the official logos
 *
 * The app's security promise is that the ONLY outbound connection is the
 * Binance Futures price feed. Fetching coin logos from a CDN would break that
 * promise for a decoration, so it is not done. Instead each coin gets a badge
 * drawn from two local facts: a brand colour and the ticker's first letters.
 *
 * That is a deliberate trade, and it is stated in the README rather than
 * hidden: the badge identifies the coin at a glance and is instantly
 * recognisable in a list, but it is NOT the official mark and must not be read
 * as one.
 * ---------------------------------------------------------------------------
 */

/**
 * Brand colours for the coins people actually hold.
 *
 * Hand-picked rather than hashed, because a hash gives BTC a random colour and
 * the whole point of a badge is that the same coin always looks the same. The
 * values are the colours each project uses for itself, which is what makes the
 * badge readable without a legend.
 */
const BRAND = Object.freeze({
  BTC: '#f7931a',
  ETH: '#627eea',
  BNB: '#f3ba2f',
  SOL: '#14f195',
  XRP: '#23292f',
  ADA: '#0033ad',
  DOGE: '#c2a633',
  AVAX: '#e84142',
  DOT: '#e6007a',
  LINK: '#2a5ada',
  MATIC: '#8247e5',
  POL: '#8247e5',
  LTC: '#345d9d',
  TRX: '#ff060a',
  ATOM: '#2e3148',
  NEAR: '#00ec97',
  APT: '#06b6d4',
  ARB: '#12aaff',
  OP: '#ff0420',
  SUI: '#4da2ff',
  TON: '#0098ea',
  SHIB: '#f00500',
  PEPE: '#3d8130',
  FIL: '#0090ff',
  INJ: '#00a3ff',
  TIA: '#7b2bf9',
  SEI: '#9e1f19',
  RUNE: '#33ff99',
  AAVE: '#b6509e',
  UNI: '#ff007a',
  ETC: '#328332',
  BCH: '#8dc351',
  XLM: '#7d00ff',
  ALGO: '#000000',
  VET: '#15bdff',
  ICP: '#29abe2',
  HBAR: '#222222',
  ENA: '#5b6ef5',
  WIF: '#c8a06a',
  ORDI: '#f4b400',
  JUP: '#c7f284',
  PYTH: '#e6dafe',
  WLD: '#191c20',
  FET: '#1c1c1c',
  RNDR: '#ff3d00',
  RENDER: '#ff3d00',
  GALA: '#1d1d1d',
  SAND: '#00adef',
  MANA: '#ff2d55',
  AXS: '#0055d5',
  CRV: '#40649f',
  MKR: '#1aab9b',
  SNX: '#00d1ff',
  COMP: '#00d395',
  ZEC: '#ecb244',
  DASH: '#008ce7',
  XMR: '#ff6600',
  EOS: '#443f54',
  NEO: '#58bf00',
  IOTA: '#131f37',
  QTUM: '#2e9ad0',
  ZIL: '#29b6f6',
  ONE: '#00aee9',
  KSM: '#e6007a',
  FLOW: '#00ef8b',
  CHZ: '#cd0124',
  ENJ: '#7866d5',
  THETA: '#2ab8e6',
  GRT: '#6747ed',
  LDO: '#00a3ff',
  STX: '#fc6432',
  IMX: '#0b0e11',
  BLUR: '#ff8700',
  GMX: '#2d42fc',
  DYDX: '#6966ff',
  ONDO: '#1b1b1b',
  EIGEN: '#1a0c6d',
  TAO: '#000000',
  HYPE: '#97fce4',
  BERA: '#7c3aed',
  TRUMP: '#c9a227',
  PENGU: '#7ab8e8',
  VIRTUAL: '#1f2937',
  AI16Z: '#0f172a',
});

/**
 * Fallback palette for a coin that is not in the table.
 *
 * Chosen to stay distinguishable from each other and from the semantic green
 * and red, so an unknown coin never looks like a P&L colour.
 */
const FALLBACK = Object.freeze([
  '#4f8cff', '#7c5cff', '#00c2d1', '#ff7ab6',
  '#8bd450', '#ff9f45', '#5b8def', '#b06bff',
]);

/** "BTCUSDT" -> "BTC". Mirrors src/portfolio.js without importing it. */
function baseOf(symbol) {
  return String(symbol || '').replace(/(USDT|USDC|BUSD|USDT_PERP)$/i, '').toUpperCase();
}

/** Stable hash, so an unknown coin keeps the same colour across restarts. */
function hash(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * The badge for a symbol.
 *
 * @param {string} symbol  e.g. "BTCUSDT" or "BTC"
 * @returns {{base: string, color: string, glyph: string, known: boolean}}
 */
function badgeFor(symbol) {
  const base = baseOf(symbol);
  if (!base) return { base: '', color: FALLBACK[0], glyph: '?', known: false };

  const color = BRAND[base] || FALLBACK[hash(base) % FALLBACK.length];

  /**
   * The glyph is the ticker itself, not a letter.
   *
   * A single letter is ambiguous the moment a portfolio holds SOL and SUI, or
   * ETH and ETC. Two to four characters fit in the badge at the sizes used
   * here and are unambiguous, which is the only job the glyph has.
   */
  const glyph = base.length <= 4 ? base : base.slice(0, 4);

  return { base, color, glyph, known: Object.prototype.hasOwnProperty.call(BRAND, base) };
}

/**
 * Text colour to draw ON the badge.
 *
 * Some brand colours are very light (SOL's mint, JUP's lime) and some are very
 * dark (XRP's near-black). A single white glyph would vanish on the light ones,
 * so the choice is made by measuring WCAG contrast against both black and
 * white and taking the better one — the same method the halo uses.
 */
function glyphColor(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return '#ffffff';
  const ch = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  const lum = 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  const onWhite = (1.05) / (lum + 0.05);
  const onBlack = (lum + 0.05) / 0.05;
  /**
   * `onBlack` is the contrast between the disc and BLACK ink, so a higher
   * `onBlack` means black is the better choice — not white.
   *
   * The first version of this had the comparison the wrong way round and
   * returned white for a white disc (1:1, invisible). The unit test that walks
   * every brand colour caught it: BTC's orange came out at 2.30:1 with white
   * when black gives it 9.1:1.
   */
  return onBlack >= onWhite ? '#0b0f17' : '#ffffff';
}

module.exports = { badgeFor, glyphColor, baseOf, BRAND, FALLBACK };
