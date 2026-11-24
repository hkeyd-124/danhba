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
  klines: {},
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

/**
 * Apply the data-attribute styles that the CSP forbids as inline attributes.
 *
 * Called once after each innerHTML write. It is a single pass over the
 * container, and it is idempotent, so calling it more often than necessary
 * costs nothing but a few property writes.
 */
function paintStyles(root) {
  const scope = root || document;

  scope.querySelectorAll('[data-coin]').forEach((el) => {
    el.style.setProperty('--coin', el.dataset.coin);
    el.style.setProperty('--coin-ink', el.dataset.coinInk || '#ffffff');
  });

  scope.querySelectorAll('[data-w]').forEach((el) => {
    el.style.setProperty('width', `${el.dataset.w}%`);
  });

  scope.querySelectorAll('[data-bg]').forEach((el) => {
    el.style.setProperty('background', el.dataset.bg);
  });

  // `data-fg` is the text colour, kept separate from `data-bg` because the
  // coin symbol is drawn in its brand colour as TEXT, not as a fill.
  scope.querySelectorAll('[data-fg]').forEach((el) => {
    el.style.setProperty('color', el.dataset.fg);
  });

  scope.querySelectorAll('[data-c]').forEach((el) => {
    el.style.setProperty('--c', el.dataset.c);
  });
}

/**
 * A coin's candlestick chart, as inline SVG.
 *
 * ---------------------------------------------------------------------------
 * Where it goes and why
 *
 * Between the ticker and the price — the empty middle of the row. That space
 * was dead: the name is left-aligned, the price is right-aligned, and nothing
 * used the gap. Putting the chart there means the row reads
 * "which coin · how it moved · what it costs", left to right, with no extra
 * line of height.
 *
 * ---------------------------------------------------------------------------
 * Why candles and not the line that was here before
 *
 * The line was built from candle CLOSES: one number per period, joined up. It
 * answered "which way did it drift" and threw away the open, the high and the
 * low — three quarters of what the exchange published. A candlestick keeps all
 * four in the same box: the body is open→close, the wick is high→low, and the
 * colour says which way the period closed.
 *
 * ---------------------------------------------------------------------------
 * Why the geometry is a separate module
 *
 * `candles.js` is pure (rows in, paths out) and unit-tested on the cases that
 * actually break a candle chart: a flat series, a doji (open === close), a
 * single candle, a high below its low. This function only measures the box and
 * writes the result into the DOM.
 *
 * ---------------------------------------------------------------------------
 * Why the viewBox is fixed and `preserveAspectRatio="none"`
 *
 * The same markup is used in the 13px strip and in the panel, at two different
 * widths. A fixed viewBox with `none` lets one set of paths stretch to either
 * without a re-render on resize. The bodies are FILLED, so stretching them is
 * harmless; the wicks are stroked with `vector-effect: non-scaling-stroke`, so
 * they stay 1px instead of thickening with the box.
 * ---------------------------------------------------------------------------
 *
 * @param {string} symbol  e.g. "LDOUSDT"
 * @param {{cls:string}} opts
 * @returns {string} SVG markup, or '' when there is nothing to draw
 *
 * NOTE the box keys are `width` / `height`, matching chart.js. They were `w` /
 * `h` in the first version of this function, which `Candles.build` read as
 * undefined and defaulted to 1 — so all 24 candles were laid out inside a 1x1
 * unit box and the whole chart collapsed into a ~1px sliver on the left edge.
 * The paths were well formed, which is why a "does a path exist" assertion
 * passed; only a measurement caught it.
 */
const CANDLE_BOX = { width: 100, height: 30, padY: 2, bodyRatio: 0.58 };

/**
 * How many candles each box can actually show.
 *
 * Measured, not guessed. The panel gives the chart 88px and the strip 84px, but
 * the strip row is only 11px tall. At 18 candles the strip's slot is 4.7px,
 * which leaves a ~2.7px body and a ~2px gap — the smallest that still reads as
 * a candle rather than a smear. Pushing past that in an 11px row blurs the wick
 * into the body.
 *
 * So the strip merges its series down to 18. Merging (not truncating) keeps the
 * full window and makes each candle a true OHLC roll-up of the ones it replaces
 * — see `downsample` in candles.js. The panel has the height for 36.
 */
const CANDLE_MAX_PANEL = 36;
const CANDLE_MAX_STRIP = 18;

function candleHtml(symbol, opts) {
  const o = opts || {};
  const entry = state.klines && state.klines[symbol];
  if (!entry || !Array.isArray(entry.candles) || !entry.candles.length) return '';

  const box = o.max ? { ...CANDLE_BOX, maxCandles: o.max } : CANDLE_BOX;
  const built = window.Candles.build(entry.candles, box);
  if (built.empty) return '';

  const dir = built.direction;
  const cls = `candles is-${dir}${o.cls ? ` ${o.cls}` : ''}`;

  /**
   * `aria-hidden` because the number beside it already states the change: a
   * screen reader announcing "graphic" adds nothing the row does not say.
   *
   * Four paths, not forty: every rising body in one, every falling body in
   * another, and the same for the wicks. See the note in candles.js.
   */
  return `<svg class="${cls}" viewBox="0 0 ${CANDLE_BOX.width} ${CANDLE_BOX.height}" preserveAspectRatio="none" aria-hidden="true" focusable="false">`
    + `<path class="cd-wick cd-wick-up" d="${built.wickPathUp}" />`
    + `<path class="cd-wick cd-wick-down" d="${built.wickPathDown}" />`
    + `<path class="cd-body cd-body-up" d="${built.bodyPathUp}" />`
    + `<path class="cd-body cd-body-down" d="${built.bodyPathDown}" />`
    + '</svg>';
}

function toLocalInput(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fmtTime(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ------------------------------------------------------------------ toast
let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2400);
}

// ------------------------------------------------------------------ render
/**
 * The display record, always complete.
 *
 * `state.settings.display` comes from the main process already normalised, but
 * the very first paint happens before the first state arrives, so this falls
 * back to "everything on" rather than to `undefined` — which would make every
 * `!== false` check pass by accident and then flip when the state landed.
 */
function display() {
  const d = (state.settings && state.settings.display) || {};
  return d;
}
function shows(key) {
  return display()[key] !== false;
}

function render() {
  const t = state.totals || {};
  const pnl = Number(t.pnl) || 0;
  const pct = Number(t.pnlPct) || 0;

  // ---- expanded panel: each block is shown or hidden on its own switch ----
  $('heroLabel').hidden = !shows('total');
  $('totalValue').hidden = !shows('total');
  $('totalPnl').hidden = !shows('pnl');
  $('totalPct').hidden = !shows('pct');
  $('posCount').hidden = !shows('positions');
  // The row itself has no reason to exist once all three of its children are
  // gone: an empty flex row still takes its margin and leaves a gap.
  $('heroRow').hidden = !shows('pnl') && !shows('pct') && !shows('positions');

  $('totalValue').textContent = `${fmtMoney(t.value)} USDT`;
  const pnlEl = $('totalPnl');
  pnlEl.textContent = fmtSigned(pnl);
  pnlEl.className = `pill ${pnl < 0 ? 'is-down' : ''}`;
  const pctEl = $('totalPct');
  pctEl.textContent = fmtPct(pct);
  pctEl.className = `pill pill-ghost ${cls(pct)}`;
  $('posCount').textContent = t.openPositions ? `${t.openPositions} vị thế` : '';

  // ---- collapsed strip: its own three switches ----
  $('cvLeft').hidden = !shows('stripTotal');
  $('cvValue').textContent = `${fmtMoney(t.value)}`;
  const cvPnl = $('cvPnl');
  cvPnl.hidden = !shows('stripPnl');
  cvPnl.textContent = fmtSigned(pnl);
  cvPnl.className = `cv-pnl ${cls(pnl)}`;
  const cvPct = $('cvPct');
  cvPct.hidden = !shows('stripPct');
  cvPct.textContent = fmtPct(pct);
  cvPct.className = `cv-pct ${cls(pct)}`;

  renderStripCoins();

  renderPositions();
  renderTrades();
  renderAlerts();
  renderWarnings();
  renderFeed();
  renderChart();
  renderSettings();

  // The swatches live in the settings sheet, which is static markup, so their
  // colours are painted once here rather than on every list render.
  paintStyles(document);
}

/**
 * The per-coin rows in the collapsed strip.
 *
 * ---------------------------------------------------------------------------
 * What this is for
 *
 * The strip's summary line is the whole portfolio in one number. That is fine
 * until the user wants to watch one coin: the total moves and there is no way
 * to tell which holding did it. Ticking a coin in the settings sheet adds a
 * row for it here — its own price and its own change — so the strip answers
 * "what is LDO doing" without opening the panel.
 *
 * ---------------------------------------------------------------------------
 * Why the rows are rebuilt rather than updated in place
 *
 * The list is short (at most 8) and it changes only when the user ticks
 * something or a coin is sold out. Rebuilding is a few string concatenations
 * and it cannot drift out of sync with the selection; a diffing update would
 * be more code for no measurable gain at this size.
 *
 * The rows are hidden entirely when nothing is selected, so the strip is
 * byte-for-byte the same layout every earlier version drew.
 */
function renderStripCoins() {
  const box = $('cvCoins');
  if (!box) return;

  /**
   * The rows come from the main process, already resolved.
   *
   * `state.stripRows` is `display.stripCoinRows(positions, stripCoins)` — the
   * same call the window height is derived from. This function used to repeat
   * that rule here, which meant two copies of it that could disagree: the
   * window could be sized for three rows while two were drawn, and nothing
   * would report it. One source, one answer.
   *
   * A selected coin that is no longer held gets no row: after selling out,
   * `qty` is 0 and a row reading "0.00" is noise. The selection is kept, so
   * buying back in brings the row straight back without re-ticking it — that
   * rule lives in display.js and is applied before the rows get here.
   */
  const rows = state.stripRows || [];

  if (!rows.length) {
    box.hidden = true;
    box.innerHTML = '';
    return;
  }
  box.hidden = false;

  box.innerHTML = rows.map((p) => {
    const pnlCls = cls(p.unrealized);
    const price = p.hasPrice ? fmtPrice(p.mark) : '—';
    /**
     * The candlestick chart sits between the ticker and the price — the empty middle
     * of the row. It is omitted (not blanked) when the switch is off or the
     * series has not arrived, so the price keeps its right edge either way.
     */
    const spark = shows('stripSpark') ? candleHtml(p.symbol, { cls: 'cd-strip', max: CANDLE_MAX_STRIP }) : '';
    return `
      <div class="cv-coin" data-symbol="${esc(p.symbol)}">
        ${badgeHtml(p.symbol, 'sm')}
        <span class="cv-coin-sym">${esc(p.base)}</span>
        ${spark}
        <span class="cv-coin-price">${price}</span>
        <span class="cv-coin-pct ${pnlCls}">${fmtPct(p.pnlPct)}</span>
      </div>`;
  }).join('');

  paintStyles(box);
}

function renderPositions() {
  const list = $('posList');
  const empty = $('posEmpty');
  const alloc = $('allocBar');
  const positions = state.positions || [];

  // The allocation bar and the list are separate switches: the bar is a
  // one-line summary of the same data, and someone who only wants the bar
  // should not have to keep the list open to get it.
  alloc.hidden = !shows('alloc');
  $('panel-positions').classList.toggle('no-list', !shows('list'));

  if (!positions.length) {
    list.innerHTML = '';
    empty.hidden = !shows('list');
    alloc.innerHTML = '';
    return;
  }
  empty.hidden = true;

  alloc.innerHTML = positions
    .filter((p) => p.allocation > 0.01)
    .map((p) => `<span data-w="${p.allocation.toFixed(2)}" data-bg="${esc(colorFor(p.symbol))}" title="${esc(p.base)} ${p.allocation.toFixed(1)}%"></span>`)
    .join('');

  if (!shows('list')) { list.innerHTML = ''; paintStyles(alloc); return; }

  const withIcons = shows('icons');
  list.innerHTML = positions.map((p) => {
    const c = colorFor(p.symbol);
    const pnlCls = cls(p.unrealized);
    const priceNote = p.hasPrice ? '' : ' <span class="warn warn-inline">chưa có giá</span>';
    /**
     * The ticker appears exactly once.
     *
     * The badge already carries it, so drawing the symbol again next to the
     * badge said "BTC BTC" — which is what the first version did, and it read
     * as a rendering mistake. The badge is the label when icons are on; the
     * text label is the fallback when they are off, so the row is never
     * nameless.
     */
    const name = withIcons
      ? badgeHtml(p.symbol)
      : `<span class="pos-sym" data-fg="${esc(c)}">${esc(p.base)}</span>`;
    /**
     * The candlestick chart goes in the row's own middle: after the name, before the
     * value. `.pos-top` is a flex row, so the SVG takes the leftover width and
     * the value column keeps its right edge.
     */
    const spark = shows('spark') ? candleHtml(p.symbol, { cls: 'cd-pos', max: CANDLE_MAX_PANEL }) : '';
    return `
      <div class="pos" data-symbol="${esc(p.symbol)}">
        <div class="pos-top">
          ${name}
          ${spark}
          <span class="pos-qty">${fmtQty(p.qty)} · TB ${fmtPrice(p.avgCost)}</span>
        </div>
        <div class="pos-val">${fmtMoney(p.value)}</div>
        <div class="pos-sub">
          <span>${fmtPrice(p.mark)} USDT${priceNote}</span>
          <span>${p.allocation.toFixed(1)}%</span>
        </div>
        <div class="pos-pnl ${pnlCls}">${fmtSigned(p.unrealized)} (${fmtPct(p.pnlPct)})</div>
        <div class="pos-bar"><i data-w="${Math.min(100, p.allocation).toFixed(2)}" data-bg="${esc(c)}"></i></div>
      </div>`;
  }).join('');

  paintStyles(list);
  paintStyles(alloc);
}

function renderTrades() {
  const list = $('tradeList');
  const empty = $('tradeEmpty');
  const trades = [...(state.trades || [])].sort((a, b) => (b.time || 0) - (a.time || 0));

  if (!trades.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = trades.map((t) => {
    const side = String(t.side).toUpperCase() === 'SELL' ? 'sell' : 'buy';
    const total = Number(t.price) * Number(t.qty);
    return `
      <div class="trade" data-id="${esc(t.id)}">
        <span class="side ${side}">${side === 'buy' ? 'Mua' : 'Bán'}</span>
        <div class="trade-main">
          <div class="trade-sym">${esc(baseOf(t.symbol))} <span class="muted muted-inline">${fmtQty(t.qty)} @ ${fmtPrice(t.price)}</span></div>
          <div class="trade-meta">${fmtMoney(total)} USDT${Number(t.fee) > 0 ? ` · phí ${fmtMoney(t.fee, 4)}` : ''} · ${fmtTime(t.time)}</div>
        </div>
        <div class="trade-actions">
          <button class="iconbtn" data-edit="${esc(t.id)}" title="Sửa">✎</button>
          <button class="iconbtn danger" data-del="${esc(t.id)}" title="Xoá">🗑</button>
        </div>
      </div>`;
  }).join('');
}

function renderAlerts() {
  const list = $('alertList');
  const empty = $('alertEmpty');
  const alerts = state.alerts || [];

  if (!alerts.length) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = alerts.map((a) => {
    const cur = state.prices[a.symbol];
    const dirText = a.direction === 'touch'
      ? 'chạm mốc'
      : a.direction === 'below' ? '↓ dưới' : '↑ trên';
    const dist = Number.isFinite(cur) && cur > 0
      ? ` · cách ${fmtPct(((Number(a.price) - cur) / cur) * 100)}`
      : '';
    const tolText = a.direction === 'touch'
      ? ` · ±${Number(a.tolerance) || 0.1}%`
      : '';
    return `
      <div class="alert ${a.enabled === false ? 'is-off' : ''}" data-id="${esc(a.id)}">
        <span class="alert-ico">${a.direction === 'touch' ? '🎯' : a.direction === 'below' ? '🔻' : '🔔'}</span>
        <div class="alert-main">
          <div class="alert-title">${esc(baseOf(a.symbol))} ${dirText} ${fmtPrice(a.price)}</div>
          <div class="alert-meta">Giá: ${Number.isFinite(cur) ? fmtPrice(cur) : '—'}${dist}${tolText}${a.note ? ` · ${esc(a.note)}` : ''}</div>
        </div>
        <div class="alert-actions">
          <label class="switch" title="Bật/tắt">
            <input type="checkbox" data-toggle="${esc(a.id)}" ${a.enabled === false ? '' : 'checked'} />
            <i></i>
          </label>
          <button class="iconbtn" data-aedit="${esc(a.id)}" title="Sửa">✎</button>
          <button class="iconbtn danger" data-adel="${esc(a.id)}" title="Xoá">🗑</button>
        </div>
      </div>`;
  }).join('');
}

function renderWarnings() {
  const el = $('warnLine');
  const w = state.warnings || [];
  if (!w.length) { el.hidden = true; el.textContent = ''; return; }
  el.hidden = false;
  el.textContent = `⚠ ${w[0].message}${w.length > 1 ? ` (+${w.length - 1})` : ''}`;
  el.title = w.map((x) => x.message).join('\n');
}

const STATUS_TEXT = {
  idle: 'chưa có dữ liệu',
  connecting: 'đang kết nối…',
  live: 'trực tiếp',
  reconnecting: 'đang kết nối lại…',
  offline: 'mất kết nối',
};
function renderFeed() {
  $('feedDot').dataset.status = state.feedStatus;
  $('feedLabel').textContent = STATUS_TEXT[state.feedStatus] || state.feedStatus;
}

// ------------------------------------------------------------------ chart
/**
 * Draw the portfolio value chart.
 *
 * The geometry lives in chart.js (pure, unit-tested); this only measures the
 * box, hands the numbers over, and writes the result into the SVG.
 *
 * The viewBox is a fixed 100x34 with preserveAspectRatio="none", so the path is
 * expressed in a normalised space and the browser stretches it to the real
 * width. That is what lets the chart follow the window as the user resizes it
 * without a re-render on every pixel.
 */
const CHART_BOX = { width: 100, height: 34, padX: 0, padY: 3 };

function renderChart() {
  const box = $('chartBox');
  const s = state.settings || {};
  const on = s.chart !== false;

  // The chart is meaningless in the docked strip: the hero block is hidden
  // there, and a 20px squiggle behind the total would be noise.
  const visible = on && !state.collapsed && !state.docked;
  box.hidden = !visible;
  if (!visible) return;

  const rangeMin = Number(s.chartRange) || 15;
  const built = window.Chart.build(state.history, {
    now: Date.now(),
    rangeMs: rangeMin * 60 * 1000,
    box: CHART_BOX,
  });

  const line = $('chartLine');
  const area = $('chartArea');
  const dot = $('chartDot');
  const cap = $('chartCap');

  if (built.empty) {
    line.setAttribute('d', '');
    area.setAttribute('d', '');
    dot.setAttribute('cx', '-10');
    dot.setAttribute('cy', '-10');
    cap.textContent = 'chưa có dữ liệu';
    box.className = 'chart is-flat';
    return;
  }

  line.setAttribute('d', built.line);
  area.setAttribute('d', built.area);

  const lastPt = built.projected[built.projected.length - 1];
  dot.setAttribute('cx', String(lastPt.x));
  dot.setAttribute('cy', String(lastPt.y));

  box.className = `chart is-${built.direction}`;

  /**
   * The caption states the window and the change across it.
   *
   * A bare chart cannot tell you whether it covers five minutes or five
   * hours, and a shape with no scale is decoration. One short line fixes that
   * without adding axes or a legend.
   */
  const dirCls = built.direction === 'up' ? 'up' : built.direction === 'down' ? 'down' : '';
  const sign = built.change > 0 ? '+' : built.change < 0 ? '−' : '';
  const pctSign = built.changePct > 0 ? '+' : built.changePct < 0 ? '−' : '';
  const rangeLabel = rangeMin >= 60 ? `${Math.round(rangeMin / 60)} giờ` : `${rangeMin} phút`;

  if (built.single) {
    cap.innerHTML = `<span class="${dirCls}">đang lấy mẫu…</span>`;
  } else {
    cap.innerHTML = `${rangeLabel} · <span class="${dirCls}">${sign}${fmtMoney(Math.abs(built.change))} (${pctSign}${Math.abs(built.changePct).toFixed(2)}%)</span>`;
  }
}

function renderSettings() {
  const s = state.settings || {};
  $('btnPin').classList.toggle('is-on', s.alwaysOnTop !== false);
  $('btnSound').textContent = `Âm thanh: ${s.sound === false ? 'Tắt' : 'Bật'}`;
  const w = $('widget');
  w.classList.toggle('is-collapsed', !!state.collapsed);
  w.classList.toggle('is-docked', !!state.docked);
  // 'taskbar' is a distinct look from 'edge': the strip drops its own frame and
  // takes the taskbar's surface, so it reads as part of the taskbar.
  w.classList.toggle('is-taskbar', state.dockMode === 'taskbar');
  $('collapsedView').hidden = !state.collapsed;
  $('btnCollapse').textContent = state.collapsed ? '▴' : '▾';
  $('btnCollapse').title = state.collapsed ? 'Mở rộng' : 'Thu gọn';

  // Placement controls reflect the stored mode.
  document.querySelectorAll('#dockSeg .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.dock === (state.dockMode || 'float'));
  });
  document.querySelectorAll('#blurSeg .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', (b.dataset.blur === '1') === (s.collapseOnBlur !== false));
  });
  document.querySelectorAll('#roleSeg .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', (b.dataset.role === '1') === (s.widgetRole !== false));
  });
  document.querySelectorAll('#chartSeg .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', (b.dataset.chart === '1') === (s.chart !== false));
  });
  document.querySelectorAll('#rangeSeg .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', Number(b.dataset.range) === Number(s.chartRange || 15));
  });
  document.querySelectorAll('#candleSeg .seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.candle === (s.candleInterval || '15m'));
  });

  // The hint has to describe the mode that is actually selected, or it tells
  // the user about a placement they are not using.
  const DOCK_HINT = {
    float: 'Cửa sổ nổi tự do: kéo thanh tiêu đề để di chuyển, kéo viền để đổi kích thước.',
    edge: '“Sát taskbar”: dải mỏng nằm ngay trên thanh taskbar, trong vùng làm việc nên không che các nút của taskbar.',
    taskbar: '“Trong taskbar”: dải nằm cùng hàng với các icon trên thanh taskbar. Bấm vào để bung ra, bấm ra ngoài để thu lại.',
  };
  $('dockHint').textContent = DOCK_HINT[state.dockMode] || DOCK_HINT.float;

  syncDisplayChecks();
  applyLook(s);
}

// ------------------------------------------------------------------ appearance
/**
 * Every appearance setting is painted here, from CSS variables and a
 * data-theme attribute. Nothing is re-created, so switching a theme never
 * loses scroll position, focus, or an open form.
 */
const THEME_HINT = {
  solid: 'Nền đặc, không nhìn xuyên qua.',
  midnight: 'Đen tuyệt đối, hợp màn hình OLED.',
  glass: 'Kính mờ — nền bán trong suốt, tông xanh.',
  clear: 'Trong suốt — nhìn xuyên qua thấy desktop.',
  bare: 'Chỉ chữ — không nền, không viền, không bóng. Nhìn thẳng ra desktop.',
  aurora: 'Dải màu chuyển sắc xanh–tím.',
  light: 'Nền sáng cho môi trường nhiều ánh sáng.',
};

/**
 * Relative luminance of a #rrggbb colour (WCAG formula).
 * Used to pick the halo colour: light text needs a dark halo and vice versa,
 * which is what keeps the numbers readable on a white wallpaper and on a black
 * one with the same text colour.
 */
function luminance(hex) {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return 0.5;
  const ch = [m[1], m[2], m[3]].map((h) => {
    const c = parseInt(h, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function applyLook(s) {
  const theme = THEME_HINT[s.theme] ? s.theme : 'solid';
  const w = $('widget');
  w.dataset.theme = theme;

  // Background opacity: only meaningful for the see-through themes.
  const alpha = Number.isFinite(Number(s.bgAlpha)) ? Number(s.bgAlpha) : 1;
  w.style.setProperty('--bg-alpha', String(Math.min(1, Math.max(0, alpha))));

  /**
   * Text colour, and everything derived from it.
   *
   * The old version set `--text` and left `--muted` at a fixed blue-grey, so
   * the labels, hints, placeholders and the whole secondary layer kept a tone
   * that no longer belonged to the chosen colour. The derived tones now come
   * from the main process (src/text-color.js), which measures each one against
   * the surface the current theme actually paints.
   *
   * `tones` is null only before the first state arrives; the fallbacks below
   * are the same values the module would produce for the default colour, so
   * the first paint is not visibly different from the second.
   */
  const color = /^#[0-9a-f]{6}$/i.test(String(s.textColor || '')) ? s.textColor : '#e8eefc';
  const tones = state.tones || null;
  w.style.setProperty('--text', color);
  w.style.setProperty('--muted', tones ? tones.muted : '#9aabc6');
  w.style.setProperty('--faint', tones ? tones.faint : '#55647d');

  // ---- "Chỉ chữ": the halo is the only thing standing between the text and
  // an arbitrary wallpaper, so it is derived from the text colour itself.
  const halo = Number.isFinite(Number(s.halo)) ? Math.min(100, Math.max(0, Number(s.halo))) : 70;
  w.style.setProperty('--halo', String(halo / 100));

  /**
   * Pick the halo colour for a given text colour.
   *
   * This has to be per-colour, not global. The P&L numbers are green/red, and
   * a single global halo gets them wrong: with dark body text the halo is
   * white, and white behind mid-tone green is only ~2.2:1 — the numbers wash
   * out. Each colour therefore gets the halo that maximises its own contrast.
   *
   * The choice is made by actually computing both WCAG ratios and taking the
   * larger one. An earlier version used a luminance threshold ("above 0.35 ->
   * dark halo"), which is wrong for mid-tones: the accent blue #4f8cff has
   * luminance 0.28, so it got a WHITE halo and only 3.2:1, when a dark halo
   * gives it 6.5:1. Measuring beats guessing.
   */
  const contrastWith = (hex, haloName) => {
    const a = luminance(hex);
    const b = haloName === 'dark' ? 0 : 1;
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  };
  const haloFor = (hex) => (contrastWith(hex, 'dark') >= contrastWith(hex, 'light')
    ? 'rgba(0, 0, 0, .92)'
    : 'rgba(255, 255, 255, .92)');

  w.style.setProperty('--halo-color', tones ? tones.halo : haloFor(color));
  // The semantic colours are fixed, so their halos are too.
  w.style.setProperty('--halo-up', haloFor('#16c784'));
  w.style.setProperty('--halo-down', haloFor('#ea3943'));
  w.style.setProperty('--halo-accent', haloFor('#4f8cff'));

  // Reflect the current values in the controls.
  document.querySelectorAll('.theme').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.theme === theme);
  });
  $('themeHint').textContent = THEME_HINT[theme];

  const pct = Math.round(alpha * 100);
  $('alphaRange').value = String(pct);
  $('alphaVal').textContent = `${pct}%`;
  // Opacity is meaningless when there is no surface to make opaque.
  $('alphaField').hidden = theme === 'bare';
  $('haloField').hidden = theme !== 'bare';
  $('haloRange').value = String(halo);
  $('haloVal').textContent = `${halo}%`;

  document.querySelectorAll('.swatch[data-color]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.color.toLowerCase() === color.toLowerCase());
  });
  $('colorPick').value = color;

  /**
   * The custom swatch shows the colour actually in use.
   *
   * It used to be a fixed rainbow gradient, which meant that after picking a
   * custom colour NOTHING in the grid was marked as active: the eight presets
   * did not match, and the custom swatch was still a rainbow. The user could
   * not see which colour the widget was using, and the only way to find out was
   * to open the OS colour dialog.
   *
   * So when the current colour is not one of the presets, the custom swatch is
   * painted with it and marked active. When it IS a preset, the rainbow comes
   * back — it is then a button that means "pick something else", which is
   * exactly what it should look like.
   */
  const custom = document.querySelector('.swatch-custom');
  if (custom) {
    const isPreset = [...document.querySelectorAll('.swatch[data-color]')]
      .some((b) => b.dataset.color.toLowerCase() === color.toLowerCase());
    custom.classList.toggle('is-active', !isPreset);
    custom.classList.toggle('is-custom', !isPreset);
    if (isPreset) custom.style.removeProperty('--c');
    else custom.style.setProperty('--c', color);
  }

  /**
   * The contrast readout.
   *
   * This is the part the old picker was missing: it let the user choose a
   * colour that made the widget unreadable and said nothing at all. The number
   * is measured against the surface the theme paints, and on 'bare' it says
   * "unknown" rather than inventing a ratio against a wallpaper it cannot see.
   */
  /*
   * Three states, not two.
   *
   * `ratio === null` means "this theme has no surface to measure against" —
   * true only for 'bare'. The old fallback reused that same null for "no tones
   * yet", so a missing `tones` object made the chip claim the background was
   * transparent on a solid theme: a false statement about the user's own
   * setting, produced by a missing value rather than by the setting.
   *
   * This is reachable in the shipped app, not just in theory: `onCollapsed`
   * calls renderSettings() directly, and the main process can emit a collapse
   * event before the first full state payload has been handled. On that path
   * `state.tones` is still null, and the chip used to read "nền trong suốt" on
   * a solid theme. A missing value must read as "not measured yet", never as a
   * claim about the theme.
   */
  const judge = tones && tones.judge ? tones.judge : null;
  const chip = $('contrastChip');
  if (!judge) {
    chip.dataset.level = 'unknown';
    chip.textContent = 'chưa đo';
    $('contrastHint').textContent = 'Đang tải…';
  } else {
    chip.dataset.level = judge.level;
    chip.textContent = judge.ratio === null ? 'nền trong suốt' : `${judge.ratio}:1`;
    $('contrastHint').textContent = judge.message;
  }
}

$('btnLook').addEventListener('click', () => openModal('lookModal'));

$('themeGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.theme');
  if (!b) return;
  const next = b.dataset.theme;
  const patch = { theme: next };
  // "Trong suốt" is pointless at full opacity — drop it so the choice is visible.
  if (next === 'clear' && Number(state.settings.bgAlpha) >= 0.95) patch.bgAlpha = 0.35;
  api.patchSettings(patch);
});

$('alphaRange').addEventListener('input', (e) => {
  const v = Number(e.target.value) / 100;
  $('alphaVal').textContent = `${e.target.value}%`;
  $('widget').style.setProperty('--bg-alpha', String(v));
});
$('alphaRange').addEventListener('change', (e) => {
  api.patchSettings({ bgAlpha: Number(e.target.value) / 100 });
});

$('haloRange').addEventListener('input', (e) => {
  const v = Number(e.target.value);
  $('haloVal').textContent = `${v}%`;
  $('widget').style.setProperty('--halo', String(v / 100));
});
$('haloRange').addEventListener('change', (e) => {
  api.patchSettings({ halo: Number(e.target.value) });
});

$('colorGrid').addEventListener('click', (e) => {
  const b = e.target.closest('.swatch[data-color]');
  if (!b) return;
  api.patchSettings({ textColor: b.dataset.color });
});
$('colorPick').addEventListener('change', (e) => {
  api.patchSettings({ textColor: e.target.value });
});

/**
 * "Màu mặc định cho nền này".
 *
 * Not simply the default colour: on the light theme the default light text is
 * invisible, so the reset has to know which way the surface goes. The value
 * comes from the same module that judges contrast, so the two can never
 * disagree about what "readable" means.
 */
$('btnResetColor').addEventListener('click', () => {
  const theme = (state.settings && state.settings.theme) || 'solid';
  const light = theme === 'light';
  api.patchSettings({ textColor: light ? '#1f2937' : '#e8eefc' });
  toast('Đã đặt lại màu chữ cho nền này');
});

/**
 * The display checkboxes.
 *
 * One delegated listener for both groups: the boxes are plain checkboxes, so
 * the only thing to do is send the one key that changed. The main process
 * merges it into the stored record and pushes the state back, which is what
 * repaints the widget — no local optimistic update, so the UI can never show a
 * tick that was not actually saved.
 */
function wireDisplayChecks(containerId) {
  const box = $(containerId);
  if (!box) return;
  box.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-display]');
    if (!input) return;
    api.patchSettings({ display: { [input.dataset.display]: input.checked } });
  });
}
wireDisplayChecks('displayPanel');
wireDisplayChecks('displayStrip');

/**
 * Reflect the stored display record in the checkboxes.
 *
 * Called from renderSettings, so the boxes always show what is actually saved
 * — including after a reload, and including a key the user never touched
 * (which is on by default).
 */
function syncDisplayChecks() {
  document.querySelectorAll('input[data-display]').forEach((input) => {
    input.checked = shows(input.dataset.display);
  });

  // A panel with nothing ticked is an empty box. Say so instead of leaving the
  // user to wonder whether the app broke.
  const anyPanel = ['total', 'pnl', 'pct', 'positions', 'list', 'alloc']
    .some((k) => shows(k));
  $('emptyNotice').hidden = anyPanel || (state.settings && state.settings.chart !== false);
  $('displayPanelHint').textContent = anyPanel
    ? 'Bỏ tích để ẩn. Ít nhất một mục nên được bật, nếu không bảng sẽ trống.'
    : 'Đang tắt hết — bảng chi tiết sẽ trống. Tích lại ít nhất một mục.';

  const anyStrip = ['stripTotal', 'stripPnl', 'stripPct'].some((k) => shows(k));
  $('displayStripHint').textContent = anyStrip
    ? 'Dải hẹp có thể tự ẩn bớt số cho vừa chỗ — đó là bố cục, không phải mất tuỳ chọn.'
    : 'Đang tắt hết — dải trong taskbar sẽ trống. Tích lại ít nhất một mục.';

  renderStripCoinChecks();
}

/**
 * The per-coin tick list in the settings sheet.
 *
 * Built from the positions the user actually holds, so it is never a stale
 * hard-coded list: buy a new coin and it appears here on the next render.
 *
 * A coin that is selected but no longer held still gets a row, marked as such.
 * Dropping it silently would leave the user with a selection they cannot see
 * or clear — the strip would show nothing for it and the sheet would not
 * explain why.
 */
function renderStripCoinChecks() {
  const box = $('stripCoins');
  if (!box) return;

  const selected = ((state.settings && state.settings.stripCoins) || [])
    .map((s) => String(s).toUpperCase());
  const positions = state.positions || [];

  const held = [];
  const seen = new Set();
  for (const p of positions) {
    const base = String(p.base || '').toUpperCase();
    if (!base || seen.has(base)) continue;
    seen.add(base);
    held.push({ base, qty: Number(p.qty) || 0 });
  }
  // Selected-but-sold-out coins, so the tick can be cleared.
  for (const base of selected) {
    if (!seen.has(base)) { seen.add(base); held.push({ base, qty: 0 }); }
  }

  if (!held.length) {
    box.innerHTML = '';
    $('stripCoinsHint').textContent = 'Chưa có coin nào — thêm lệnh mua để chọn coin theo dõi.';
    return;
  }

  box.innerHTML = held.map(({ base, qty }) => {
    const on = selected.includes(base);
    const gone = qty <= 0;
    /**
     * The coin's own logo, at the same size as the tick box.
     *
     * Without it the list was five identical rows of ticker text, and the user
     * had to read every one to find the coin they wanted. The logo is what
     * makes the row recognisable at a glance — which is the whole reason the
     * strip rows carry one too.
     *
     * `badgeHtml` is reused rather than a second <img> written here, so the
     * fallback for a coin with no vendored logo (the drawn ticker badge) is the
     * same in both places.
     */
    return `
      <label class="check${gone ? ' is-gone' : ''}">
        <input type="checkbox" data-strip-coin="${esc(base)}" ${on ? 'checked' : ''} />
        <i></i>${badgeHtml(base + 'USDT', 'xs')}<span>${esc(base)}${gone ? ' <em class="muted">(đã bán hết)</em>' : ''}</span>
      </label>`;
  }).join('');

  paintStyles(box);

  const n = selected.length;
  $('stripCoinsHint').textContent = n === 0
    ? 'Tích để thêm một dòng giá của coin đó vào dải trong taskbar.'
    : `Đang theo dõi ${n} coin trong dải. Dải trong taskbar chỉ đủ chỗ cho vài dòng — phần dư sẽ bị cắt bớt.`;
}

/**
 * One delegated listener for the coin ticks.
 *
 * The whole selection is sent on every change rather than a delta: the list is
 * at most 8 entries, and sending the complete list means the stored value can
 * never be the result of a lost or reordered message.
 *
 * ---------------------------------------------------------------------------
 * Why there is a local mirror
 *
 * `state.settings.stripCoins` only changes when the main process pushes the
 * new state back, which is a round trip. Ticking two coins in quick succession
 * therefore read the SAME stale list twice, and the second tick overwrote the
 * first — the user ticked LDO and ETH and got only ETH. The e2e test caught
 * this by ticking both in one go.
 *
 * `pendingStripCoins` is that mirror: it is updated synchronously on every
 * click, so the second tick builds on the first. It is cleared as soon as the
 * main process confirms, so the stored value stays the single source of truth
 * and a rejected patch cannot leave the UI lying.
 */
let pendingStripCoins = null;

function currentStripCoins() {
  if (pendingStripCoins) return pendingStripCoins;
  return ((state.settings && state.settings.stripCoins) || [])
    .map((s) => String(s).toUpperCase());
}

$('stripCoins').addEventListener('change', (e) => {
  const input = e.target.closest('input[data-strip-coin]');
  if (!input) return;
  const base = input.dataset.stripCoin;
  const current = currentStripCoins();
  const next = input.checked
    ? [...current.filter((s) => s !== base), base]
    : current.filter((s) => s !== base);
  pendingStripCoins = next;
  api.patchSettings({ stripCoins: next });
});

$('btnResetSize').addEventListener('click', () => {
  api.window('reset-size');
  toast('Đã đưa về kích thước mặc định');
});

// ------------------------------------------------------------------ auto-hide title bar
/**
 * The bar is invisible until the pointer reaches the top edge.
 *
 * Hover is detected from a document-level mousemove rather than from a sensor
 * element. The old sensor was a real element covering the top strip, which
 * meant it also swallowed clicks there — harmless in a 660px window, but in
 * dock mode the whole window is 44px tall, so the sensor covered the top half
 * of the summary and clicking it did nothing. A passive listener has no such
 * side effect: it observes the pointer without ever taking a click.
 */
let tbHideTimer = null;
const tb = $('titlebar');
const TB_H = 26;

function showTitlebar() {
  clearTimeout(tbHideTimer);
  tb.classList.add('is-shown');
  // The widget carries the same state so CSS can make room for the buttons.
  // In the 44px docked strip the buttons would otherwise sit on top of the
  // numbers; with this class the least important element yields instead.
  $('widget').classList.add('tb-open');
}
function hideTitlebarSoon() {
  clearTimeout(tbHideTimer);
  tbHideTimer = setTimeout(() => {
    tb.classList.remove('is-shown');
    $('widget').classList.remove('tb-open');
  }, 220);
}

document.addEventListener('mousemove', (e) => {
  // The sensor band matches the bar's own height in each mode: 26px in the
  // floating panel, 20px in the edge strip, 18px inside the taskbar. Using one
  // value everywhere would either miss the bar or steal clicks from the strip.
  const h = state.dockMode === 'taskbar' ? 18 : state.docked ? 20 : TB_H;
  if (e.clientY <= h) showTitlebar();
  else if (tb.classList.contains('is-shown') && !tb.contains(e.target)) hideTitlebarSoon();
});

tb.addEventListener('mouseenter', showTitlebar);
tb.addEventListener('mouseleave', hideTitlebarSoon);

/**
 * Keyboard focus keeps the bar open, but only for real keyboard focus.
 * A mouse click also focuses a button, and that used to pin the bar open for
 * good (the old CSS `:focus-within` rule). So: buttons are blurred right after
 * a click, and `:focus-visible` decides whether focus counts.
 */
tb.addEventListener('focusin', (e) => {
  if (e.target.matches(':focus-visible')) showTitlebar();
});
tb.addEventListener('focusout', hideTitlebarSoon);
tb.querySelectorAll('.wbtn').forEach((b) => {
  b.addEventListener('click', () => b.blur());
});

// ------------------------------------------------------------ resize grips
/**
 * The window is transparent and frameless, so Windows draws no resize border.
 * These strips hand the drag to the main process, which follows the cursor.
 */
document.querySelectorAll('.grip').forEach((g) => {
  g.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    api.resizeStart(g.dataset.edge);
    const stop = () => {
      api.resizeEnd();
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('blur', stop);
    };
    window.addEventListener('mouseup', stop);
    window.addEventListener('blur', stop);
  });
});

// ------------------------------------------------------------ tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('is-active', p.id === `panel-${btn.dataset.tab}`);
    });
  });
});

// ------------------------------------------------------------ modals
/**
 * Every modal raises the main process's blur guard while it is open.
 *
 * Without this, "collapse when the window loses focus" would fold the widget
 * away the moment a dialog appeared — the user would be typing into a form
 * that had just been hidden. The guard is a counter, so nested dialogs (a
 * confirm opened from inside a modal) are handled correctly.
 */
const openModals = new Set();
function openModal(id) {
  const el = $(id);
  if (el.hidden) {
    el.hidden = false;
    openModals.add(id);
    api.blurGuard(true);
  }
}
function closeModal(id) {
  const el = $(id);
  if (!el.hidden) {
    el.hidden = true;
    if (openModals.delete(id)) api.blurGuard(false);
  }
}
function closeAllModals() {
  document.querySelectorAll('.modal').forEach((m) => closeModal(m.id));
}
document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => closeModal(b.dataset.close));
});
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(m.id); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAllModals();
});

// segmented controls
function wireSeg(containerId, attr) {
  const box = $(containerId);
  box.addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    box.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
    box.dataset.value = b.dataset[attr];
  });
}
wireSeg('tradeSide', 'side');
wireSeg('alertDir', 'dir');

// ------------------------------------------------------------------ trade form
let tradeSideValue = 'BUY';
$('tradeSide').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (b) tradeSideValue = b.dataset.side;
});

function updateTradeCalc() {
  const price = parseFloat($('tradePrice').value);
  const qty = parseFloat($('tradeQty').value);
  const fee = parseFloat($('tradeFee').value) || 0;
  const el = $('tradeCalc');
  if (!Number.isFinite(price) || !Number.isFinite(qty) || price <= 0 || qty <= 0) {
    el.textContent = 'Nhập giá và số lượng để xem giá trị lệnh.';
    return;
  }
  const gross = price * qty;
  const net = tradeSideValue === 'BUY' ? gross + fee : gross - fee;
  el.textContent = `${tradeSideValue === 'BUY' ? 'Chi' : 'Thu'} ${fmtMoney(net)} USDT · khối lượng ${fmtMoney(gross)}${fee > 0 ? ` · phí ${fmtMoney(fee, 4)}` : ''}`;
}
['tradePrice', 'tradeQty', 'tradeFee'].forEach((id) => $(id).addEventListener('input', updateTradeCalc));

function openTradeModal(trade) {
  $('tradeError').hidden = true;
  $('tradeId').value = trade ? trade.id : '';
  $('tradeTitle').textContent = trade ? 'Sửa lệnh' : 'Thêm lệnh';
  $('tradeSymbol').value = trade ? baseOf(trade.symbol) : '';
  $('tradePrice').value = trade ? trade.price : '';
  $('tradeQty').value = trade ? trade.qty : '';
  $('tradeFee').value = trade && trade.fee ? trade.fee : '';
  $('tradeNote').value = trade ? (trade.note || '') : '';
  $('tradeTime').value = toLocalInput(trade ? trade.time : Date.now());
  tradeSideValue = trade ? String(trade.side).toUpperCase() : 'BUY';
  $('tradeSide').querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.side === tradeSideValue);
  });
  updateTradeCalc();
  openModal('tradeModal');
  setTimeout(() => $('tradeSymbol').focus(), 60);
}

$('btnAddTrade').addEventListener('click', () => openTradeModal(null));

$('tradeForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('tradeError');
  err.hidden = true;
  const timeVal = $('tradeTime').value;
  const payload = {
    id: $('tradeId').value || undefined,
    symbol: $('tradeSymbol').value,
    side: tradeSideValue,
    price: parseFloat($('tradePrice').value),
    qty: parseFloat($('tradeQty').value),
    fee: parseFloat($('tradeFee').value) || 0,
    note: $('tradeNote').value,
    time: timeVal ? new Date(timeVal).getTime() : Date.now(),
  };
  const res = await api.saveTrade(payload);
  if (!res || !res.ok) {
    err.textContent = (res && res.error) || 'Không lưu được lệnh.';
    err.hidden = false;
    return;
  }
  closeModal('tradeModal');
  toast(payload.id ? 'Đã cập nhật lệnh' : 'Đã thêm lệnh');
});

// ------------------------------------------------------------ alert form
let alertDirValue = 'above';

const DIR_HINTS = {
  above: 'Chỉ báo khi giá vượt hẳn lên trên mốc.',
  below: 'Chỉ báo khi giá giảm xuống dưới mốc.',
  touch: 'Báo ngay khi giá chạm mốc, dù đang tăng hay giảm.',
};

/**
 * The tolerance field only exists for 'touch'. It is hidden rather than
 * disabled so an above/below alert can never carry a stale tolerance into the
 * save call — the value is read only when the field is visible.
 */
function syncAlertDirUi() {
  $('alertDir').querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.dir === alertDirValue);
  });
  $('alertDirHint').textContent = DIR_HINTS[alertDirValue] || DIR_HINTS.above;
  $('alertTolField').hidden = alertDirValue !== 'touch';
}

$('alertDir').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  alertDirValue = b.dataset.dir;
  syncAlertDirUi();
});

function updateAlertNow() {
  const sym = $('alertSymbol').value.trim().toUpperCase();
  const norm = sym && !/(USDT|USDC|BUSD)$/.test(sym) ? `${sym}USDT` : sym;
  const cur = state.prices[norm];
  $('alertNow').textContent = Number.isFinite(cur) ? `Giá hiện tại: ${fmtPrice(cur)} USDT` : 'Giá hiện tại: —';
}
$('alertSymbol').addEventListener('input', updateAlertNow);

function openAlertModal(alert) {
  $('alertError').hidden = true;
  $('alertId').value = alert ? alert.id : '';
  $('alertTitle').textContent = alert ? 'Sửa cảnh báo' : 'Thêm cảnh báo';
  $('alertSymbol').value = alert ? baseOf(alert.symbol) : '';
  $('alertPrice').value = alert ? alert.price : '';
  $('alertNote').value = alert ? (alert.note || '') : '';
  alertDirValue = alert ? alert.direction : 'above';
  $('alertTolerance').value = alert && alert.direction === 'touch'
    ? (alert.tolerance ?? 0.1)
    : '';
  syncAlertDirUi();
  updateAlertNow();
  openModal('alertModal');
  setTimeout(() => $('alertSymbol').focus(), 60);
}

$('btnAddAlert').addEventListener('click', () => openAlertModal(null));

$('alertForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('alertError');
  err.hidden = true;
  const res = await api.saveAlert({
    id: $('alertId').value || undefined,
    symbol: $('alertSymbol').value,
    price: parseFloat($('alertPrice').value),
    direction: alertDirValue,
    // Only sent for 'touch'; the field is hidden otherwise, so its value is
    // whatever the last touch alert left there and must not leak out.
    tolerance: alertDirValue === 'touch' ? parseFloat($('alertTolerance').value) : undefined,
    note: $('alertNote').value,
  });
  if (!res || !res.ok) {
    err.textContent = (res && res.error) || 'Không lưu được cảnh báo.';
    err.hidden = false;
    return;
  }
  closeModal('alertModal');
  toast('Đã lưu cảnh báo');
});

// ------------------------------------------------------------------ list actions
$('tradeList').addEventListener('click', async (e) => {
  const editId = e.target.closest('[data-edit]')?.dataset.edit;
  const delId = e.target.closest('[data-del]')?.dataset.del;
  if (editId) {
    const t = state.trades.find((x) => x.id === editId);
    if (t) openTradeModal(t);
  } else if (delId) {
    const t = state.trades.find((x) => x.id === delId);
    if (!t) return;
    // A native confirm steals focus, which would collapse the widget mid-flow.
    api.blurGuard(true);
    const ok = confirm(`Xoá lệnh ${String(t.side).toUpperCase() === 'SELL' ? 'bán' : 'mua'} ${fmtQty(t.qty)} ${baseOf(t.symbol)}?`);
    api.blurGuard(false);
    if (!ok) return;
    await api.deleteTrade(delId);
    toast('Đã xoá lệnh');
  }
});

$('alertList').addEventListener('click', async (e) => {
  const editId = e.target.closest('[data-aedit]')?.dataset.aedit;
  const delId = e.target.closest('[data-adel]')?.dataset.adel;
  if (editId) {
    const a = state.alerts.find((x) => x.id === editId);
    if (a) openAlertModal(a);
  } else if (delId) {
    await api.deleteAlert(delId);
    toast('Đã xoá cảnh báo');
  }
});

$('alertList').addEventListener('change', async (e) => {
  const id = e.target.dataset.toggle;
  if (!id) return;
  await api.toggleAlert(id, e.target.checked);
});

// clicking a position jumps to its trades
$('posList').addEventListener('click', (e) => {
  const row = e.target.closest('.pos');
  if (!row) return;
  const sym = row.dataset.symbol;
  document.querySelector('.tab[data-tab="trades"]').click();
  const first = state.trades.find((t) => t.symbol === sym);
  if (first) toast(`${baseOf(sym)} · ${state.trades.filter((t) => t.symbol === sym).length} lệnh`);
});

// ------------------------------------------------------------------ window controls
$('btnCollapse').addEventListener('click', () => api.window('collapse'));
$('btnClose').addEventListener('click', () => api.window('hide'));
$('btnPin').addEventListener('click', () => api.window('pin'));

/**
 * Click the collapsed strip to expand.
 *
 * This is the whole point of dock mode: the strip is a button, not a window.
 * It is wired on the section itself so a click anywhere on the summary works,
 * and on keydown so it is reachable from the keyboard.
 */
const collapsedView = $('collapsedView');
function expandFromStrip() {
  if (!state.collapsed) return;
  api.window('expand');
}
collapsedView.addEventListener('click', expandFromStrip);
collapsedView.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); expandFromStrip(); }
});

// placement / blur / chart segmented controls
$('dockSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  api.patchSettings({ dockMode: b.dataset.dock });
});
$('blurSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  api.patchSettings({ collapseOnBlur: b.dataset.blur === '1' });
});
$('roleSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  api.patchSettings({ widgetRole: b.dataset.role === '1' });
});
$('chartSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  api.patchSettings({ chart: b.dataset.chart === '1' });
});
$('rangeSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  api.patchSettings({ chartRange: Number(b.dataset.range) });
});
/**
 * The candlestick frame.
 *
 * The main process switches the cache, refetches and pushes the new series, so
 * there is no local optimistic update here: the buttons are repainted from the
 * stored setting when the state comes back. That is the same rule the display
 * checkboxes follow, and it means a rejected patch cannot leave a button
 * showing a frame the app is not actually drawing.
 */
$('candleSeg').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (!b) return;
  api.patchSettings({ candleInterval: b.dataset.candle });
});
$('btnTestAlert').addEventListener('click', () => { api.testAlert(); toast('Đã gửi thông báo thử'); });
$('btnSound').addEventListener('click', () => {
  api.patchSettings({ sound: state.settings.sound === false });
});
$('btnData').addEventListener('click', () => api.openDataFolder());

// ------------------------------------------------------------------ IPC wiring
api.onState(((s) => {
  Object.assign(state, s);
  /**
   * `klines` arrives in the same `{interval, series}` shape as the dedicated
   * channel, so it is unwrapped here too. Without this the first paint would
   * read `state.klines[symbol]` off the envelope and find nothing, and every
   * chart would stay blank until the next 60s refresh — the exact "empty on
   * launch" bug the candle fetch exists to prevent.
   */
  const k = s && s.klines;
  state.klines = (k && k.series) || {};
  state.klineInterval = (k && k.interval) || state.klineInterval;
  /**
   * The main process has confirmed the selection, so the local mirror is no
   * longer needed. Clearing it here — rather than after a timeout — means the
   * stored value is authoritative again the moment it arrives, and a patch
   * that was rejected cannot leave the ticks showing something that was never
   * saved.
   */
  pendingStripCoins = null;
  render();
});
/**
 * Recompute value / P&L from the new prices without waiting for a main-process
 * round trip, so the widget moves the instant a tick arrives.
 * Cost basis and quantity are already settled by the main process; only the
 * mark-to-market part depends on price.
 */
function recomputeFromPrices() {
  const positions = state.positions || [];
  let totalValue = 0;
  for (const p of positions) {
    const mark = Number(state.prices[p.symbol]);
    if (Number.isFinite(mark) && mark > 0) {
      p.mark = mark;
      p.hasPrice = true;
    }
    p.value = p.qty * p.mark;
    p.unrealized = p.qty > 0 ? p.qty * (p.mark - p.avgCost) : 0;
    p.pnl = p.realized + p.unrealized;
    p.pnlPct = p.cost > 0 ? (p.unrealized / p.cost) * 100 : 0;
    totalValue += p.value;
  }
  for (const p of positions) {
    p.allocation = totalValue > 0 ? (p.value / totalValue) * 100 : 0;
  }
  positions.sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));

  const t = state.totals || (state.totals = {});
  t.value = totalValue;
  t.unrealized = positions.reduce((s, p) => s + p.unrealized, 0);
  t.realized = positions.reduce((s, p) => s + p.realized, 0);
  t.pnl = t.realized + t.unrealized;
  t.pnlPct = t.cost > 0 ? (t.unrealized / t.cost) * 100 : 0;
}

api.onPrices(({ prices }) => {
  state.prices = prices;
  recomputeFromPrices();
  render();
});
api.onHistory((h) => {
  state.history = h || [];
  renderChart();
});
/**
 * Candle history arrived (or was refreshed).
 *
 * Only the two lists that draw a candlestick chart are repainted, not the whole
 * widget: this fires on a 60s timer, and a full render would rebuild the
 * trade list and the settings sheet for a change that touches neither.
 */
api.onKlines((k) => {
  /**
   * The payload is `{interval, series}`.
   *
   * `series` is keyed by symbol and holds only the ACTIVE frame, so the
   * renderer never has to know which frame it is looking at to find a chart.
   * The interval travels alongside it for the settings sheet's label.
   */
  state.klines = (k && k.series) || {};
  state.klineInterval = (k && k.interval) || state.klineInterval;
  renderStripCoins();
  renderPositions();
});
api.onFeedStatus((s) => { state.feedStatus = s; renderFeed(); });
api.onCollapsed((c) => { state.collapsed = c; renderSettings(); });
api.onAlertFired((p) => {
  const verb = p.direction === 'touch'
    ? 'chạm'
    : p.direction === 'above' ? 'vượt' : 'xuống';
  toast(`⚅ ${baseOf(p.symbol)} ${verb} ${fmtPrice(p.level)}`);
});

api.getState();
