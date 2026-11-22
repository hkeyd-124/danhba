'use strict';
/**
 * Coin badges — the real logo where we have one, a drawn badge otherwise.
 *
 * ---------------------------------------------------------------------------
 * Where the logos come from, and why that is not a network call
 *
 * The app's security promise is that the ONLY outbound connection is the
 * Binance Futures price feed. Fetching coin logos from a CDN at runtime would
 * break that promise for a decoration, so it is not done.
 *
 * Instead the logos are VENDORED into `renderer/assets/coins/` and loaded from
 * disk like any other stylesheet. Nothing is fetched while the widget runs; the
 * only thing that ever reaches the network is the price feed.
 *
 * Sources, both of which permit redistribution:
 *   - spothq/cryptocurrency-icons (CC0-1.0) — 43 coins, as SVG
 *   - coincap.io asset icons — 34 further coins, as PNG
 *
 * A coin with no vendored logo keeps the drawn badge: a rounded square in the
 * coin's brand colour with its ticker inside. That is a deliberate fallback,
 * not a placeholder to be embarrassed about — it identifies the coin at a
 * glance and is what every version before this one drew.
 *
 * `renderer/assets/coins/CREDITS.md` records the provenance and licence.
 * ---------------------------------------------------------------------------
 */

/**
 * Brand colours for the coins people actually hold.
 *
 * Still needed even with real logos: these colour the allocation bar, the
 * per-coin bars and the ticker text, none of which is an icon. Hand-picked
 * rather than hashed, because a hash gives BTC a random colour and the whole
 * point of a badge is that the same coin always looks the same.
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
 * Coins whose real logo is vendored in `renderer/assets/coins/`.
 *
 * Generated from what actually downloaded, not from a wish list: a coin listed
 * here but missing on disk would render a broken image, which looks worse than
 * the drawn badge it replaced. `test/coin-icon.test.js` walks this table and
 * asserts every file exists, so the two can never drift apart.
 */
const COIN_ICON = Object.freeze({
  AAVE: 'aave.svg',
  ADA: 'ada.svg',
  ALGO: 'algo.svg',
  APT: 'apt.png',
  ARB: 'arb.png',
  ATOM: 'atom.svg',
  AVAX: 'avax.svg',
  AXS: 'axs.png',
  BCH: 'bch.svg',
  BERA: 'bera.png',
  BNB: 'bnb.svg',
  BTC: 'btc.svg',
  CHZ: 'chz.svg',
  COMP: 'comp.svg',
  CRV: 'crv.svg',
  DASH: 'dash.svg',
  DOGE: 'doge.svg',
  DOT: 'dot.svg',
  DYDX: 'dydx.png',
  EIGEN: 'eigen.png',
  ENA: 'ena.png',
  ENJ: 'enj.svg',
  EOS: 'eos.svg',
  ETC: 'etc.svg',
  ETH: 'eth.svg',
  FET: 'fet.png',
  FIL: 'fil.svg',
  FLOW: 'flow.png',
  GALA: 'gala.png',
  GRT: 'grt.svg',
  HBAR: 'hbar.png',
  HYPE: 'hype.png',
  ICP: 'icp.svg',
  IMX: 'imx.png',
  INJ: 'inj.png',
  JUP: 'jup.png',
  KSM: 'ksm.svg',
  LDO: 'ldo.png',
  LINK: 'link.svg',
  LTC: 'ltc.svg',
  MANA: 'mana.svg',
  MATIC: 'matic.svg',
  MKR: 'mkr.svg',
  NEAR: 'near.png',
  NEO: 'neo.svg',
  ONDO: 'ondo.png',
  ONE: 'one.svg',
  OP: 'op.png',
  PENGU: 'pengu.png',
  POL: 'pol.png',
  PYTH: 'pyth.png',
  QTUM: 'qtum.svg',
  RENDER: 'render.png',
  RNDR: 'rndr.png',
  RUNE: 'rune.png',
  SAND: 'sand.svg',
  SEI: 'sei.png',
  SHIB: 'shib.png',
  SNX: 'snx.svg',
  SOL: 'sol.svg',
  STX: 'stx.svg',
  SUI: 'sui.png',
  TAO: 'tao.png',
  THETA: 'theta.svg',
  TIA: 'tia.png',
  TON: 'ton.png',
  TRX: 'trx.svg',
  UNI: 'uni.svg',
  VET: 'vet.svg',
  VIRTUAL: 'virtual.png',
  WIF: 'wif.png',
  WLD: 'wld.png',
  XLM: 'xlm.svg',
  XMR: 'xmr.svg',
  XRP: 'xrp.svg',
  ZEC: 'zec.svg',
  ZIL: 'zil.svg',
});

/** Where the vendored logos live, relative to the renderer's own document. */
const ICON_DIR = 'assets/coins';

/**
 * Fallback palette for a coin that is not in the brand table.
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
 * The path to a coin's vendored logo, or null when we have none.
 *
 * Returns a path, never a URL: the renderer resolves it against its own
 * document, and the page's CSP (`img-src 'self'`) allows exactly that and
 * nothing off the machine.
 *
 * @param {string} symbol e.g. "ETHUSDT" or "ETH"
 * @returns {string|null}
 */
function iconFor(symbol) {
  const base = baseOf(symbol);
  const file = COIN_ICON[base];
  return file ? `${ICON_DIR}/${file}` : null;
}

/**
 * The badge for a symbol.
 *
 * @param {string} symbol  e.g. "BTCUSDT" or "BTC"
 * @returns {{base: string, color: string, glyph: string, icon: string|null,
 *            known: boolean}}
 */
function badgeFor(symbol) {
  const base = baseOf(symbol);
  if (!base) return { base: '', color: FALLBACK[0], glyph: '?', icon: null, known: false };

  const color = BRAND[base] || FALLBACK[hash(base) % FALLBACK.length];

  /**
   * The glyph is the ticker itself, not a letter.
   *
   * A single letter is ambiguous the moment a portfolio holds SOL and SUI, or
   * ETH and ETC. Two to four characters fit in the badge at the sizes used
   * here and are unambiguous, which is the only job the glyph has.
   */
  const glyph = base.length <= 4 ? base : base.slice(0, 4);

  return {
    base,
    color,
    glyph,
    icon: iconFor(base),
    known: Object.prototype.hasOwnProperty.call(BRAND, base),
  };
}

/**
 * Text colour to draw ON the badge.
 *
 * Some brand colours are very light (SOL's mint, JUP's lime) and some are very
 * dark (XRP's near-black). A single white glyph would vanish on the light ones,
 * so the choice is made by measuring WCAG contrast against both black and
 * white and taking the better one — the same method the halo uses.
 *
 * Only the drawn fallback needs this: a real logo carries its own colours.
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

module.exports = {
  badgeFor,
  iconFor,
  glyphColor,
  baseOf,
  BRAND,
  COIN_ICON,
  ICON_DIR,
  FALLBACK,
};
