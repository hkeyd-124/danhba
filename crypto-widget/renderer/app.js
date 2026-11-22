'use strict';
/* Renderer. No network primitives are used here — everything comes over IPC. */

const $ = (id) => document.getElementById(id);
const api = window.cpw;

const state = {
  trades: [],
  alerts: [],
  settings: {},
  positions: [],
  totals: {},
  warnings: [],
  prices: {},
  badges: {},
  tones: null,
  history: [],
  feedStatus: 'idle',
  collapsed: false,
  docked: false,
  dockMode: 'float',
};

const COLORS = ['#4f8cff', '#7c5cff', '#16c784', '#f0b429', '#ea3943', '#00c2d1', '#ff7ab6', '#8bd450', '#ff9f45', '#5b8def'];

// ------------------------------------------------------------------ formatting
function fmtMoney(n, digits) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const d = digits !== undefined ? digits : (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 1 ? 2 : 4);
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtPrice(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (v >= 1) return v.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
  return v.toPrecision(4);
}
function fmtQty(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return parseFloat(v.toFixed(8)).toString();
}
function fmtSigned(n, digits) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return s + fmtMoney(Math.abs(v), digits);
}
function fmtPct(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const s = v > 0 ? '+' : v < 0 ? '−' : '';
  return `${s}${Math.abs(v).toFixed(2)}%`;
}
function cls(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || Math.abs(v) < 1e-9) return 'flat';
  return v > 0 ? 'up' : 'down';
}
function baseOf(sym) { return String(sym).replace(/(USDT|USDC|BUSD)$/, ''); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function colorFor(sym) {
  // The badge colour comes from the main process (src/coin-icon.js), so the
  // brand table exists in exactly one place. The hash is only a fallback for a
  // symbol that arrived before its badge did.
  const b = state.badges && state.badges[sym];
  if (b && b.color) return b.color;
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/**
 * Coin badge markup.
 *
 * Two shapes, decided by whether a real logo is vendored for the coin:
 *
 *   with a logo   <img class="coin coin-img" src="data:image/png;base64,...">
 *   without       <span class="coin" data-coin="#...">LDO</span>
 *
 * The `src` is a data URI, not a path: the renderer is sandboxed and cannot
 * read the disk, so the bytes travel with the state. The page's CSP allows
 * `img-src 'self' data:` and nothing else, so this is the only kind of image
 * the widget can paint — and it can never point off the machine.
 *
 * ---------------------------------------------------------------------------
 * Why the colours are NOT written as a `style="..."` attribute
 *
 * The page's CSP is `style-src 'self'`, which blocks every inline style
 * attribute. That is deliberate — it is what stops injected markup from
 * restyling the widget — but it means `style="--coin:#f7931a"` is silently
 * dropped and the badge falls back to its CSS default.
 *
 * This was not theoretical: a probe against the running app showed the swatch
 * buttons, the allocation bar and the per-coin bars had ALL been rendering
 * with no colour at all, because every one of them used an inline style. The
 * CSP was right; the markup was wrong.
 *
 * The fix is CSSOM: `el.style.setProperty()` is a script API, not an inline
 * style attribute, so the CSP allows it. The markup therefore carries the
 * values as data attributes and `paintStyles()` applies them after the HTML is
 * in the DOM.
 * ---------------------------------------------------------------------------
 */
function badgeHtml(symbol, size) {
  const b = (state.badges && state.badges[symbol]) || null;
  const color = b ? b.color : colorFor(symbol);
  const glyph = b ? b.glyph : baseOf(symbol).slice(0, 4);
  const icon = b ? b.icon : null;
  const cls = size === 'xs' ? 'coin coin-xs' : size === 'sm' ? 'coin coin-sm' : 'coin';

  if (icon) {
    // `alt=""` because the ticker is always written next to the badge: naming
    // the image too would make a screen reader say "Ethereum ETH".
    return `<img class="${cls} coin-img" src="${esc(icon)}" alt="" aria-hidden="true" draggable="false" />`;
  }

  const ink = b ? b.ink : '#ffffff';
  return `<span class="${cls}" data-coin="${esc(color)}" data-coin-ink="${esc(ink)}" aria-hidden="true">${esc(glyph)}</span>`;
}
