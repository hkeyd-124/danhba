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
  let h = 0;
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
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
function render() {
  const t = state.totals || {};
  const pnl = Number(t.pnl) || 0;
  const pct = Number(t.pnlPct) || 0;

  $('totalValue').textContent = `${fmtMoney(t.value)} USDT`;
  const pnlEl = $('totalPnl');
  pnlEl.textContent = fmtSigned(pnl);
  pnlEl.className = `pill ${pnl < 0 ? 'is-down' : ''}`;
  const pctEl = $('totalPct');
  pctEl.textContent = fmtPct(pct);
  pctEl.className = `pill pill-ghost ${cls(pct)}`;
  $('posCount').textContent = t.openPositions ? `${t.openPositions} vị thế` : '';

  $('cvValue').textContent = `${fmtMoney(t.value)}`;
  const cvPnl = $('cvPnl');
  cvPnl.textContent = fmtSigned(pnl);
  cvPnl.className = `cv-pnl ${cls(pnl)}`;
  const cvPct = $('cvPct');
  cvPct.textContent = fmtPct(pct);
  cvPct.className = `cv-pct ${cls(pct)}`;

  renderPositions();
  renderTrades();
  renderAlerts();
  renderWarnings();
  renderFeed();
  renderChart();
  renderSettings();
}

function renderPositions() {
  const list = $('posList');
  const empty = $('posEmpty');
  const alloc = $('allocBar');
  const positions = state.positions || [];

  if (!positions.length) {
    list.innerHTML = '';
    empty.hidden = false;
    alloc.innerHTML = '';
    return;
  }
  empty.hidden = true;

  alloc.innerHTML = positions
    .filter((p) => p.allocation > 0.01)
    .map((p) => `<span style="width:${p.allocation.toFixed(2)}%;background:${colorFor(p.symbol)}" title="${esc(p.base)} ${p.allocation.toFixed(1)}%"></span>`)
    .join('');

  list.innerHTML = positions.map((p) => {
    const c = colorFor(p.symbol);
    const pnlCls = cls(p.unrealized);
    const priceNote = p.hasPrice ? '' : ' <span class="warn" style="display:inline">chưa có giá</span>';
    return `
      <div class="pos" data-symbol="${esc(p.symbol)}">
        <div class="pos-top">
          <span class="pos-sym" style="color:${c}">${esc(p.base)}</span>
          <span class="pos-qty">${fmtQty(p.qty)} · TB ${fmtPrice(p.avgCost)}</span>
        </div>
        <div class="pos-val">${fmtMoney(p.value)}</div>
        <div class="pos-sub">
          <span>${fmtPrice(p.mark)} USDT${priceNote}</span>
          <span>${p.allocation.toFixed(1)}%</span>
        </div>
        <div class="pos-pnl ${pnlCls}">${fmtSigned(p.unrealized)} (${fmtPct(p.pnlPct)})</div>
        <div class="pos-bar"><i style="width:${Math.min(100, p.allocation).toFixed(2)}%;background:${c}"></i></div>
      </div>`;
  }).join('');
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
          <div class="trade-sym">${esc(baseOf(t.symbol))} <span class="muted" style="display:inline">${fmtQty(t.qty)} @ ${fmtPrice(t.price)}</span></div>
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
   * A bare sparkline cannot tell you whether it covers five minutes or five
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

  // The hint has to describe the mode that is actually selected, or it tells
  // the user about a placement they are not using.
  const DOCK_HINT = {
    float: 'Cửa sổ nổi tự do: kéo thanh tiêu đề để di chuyển, kéo viền để đổi kích thước.',
    edge: '“Sát taskbar”: dải mỏng nằm ngay trên thanh taskbar, trong vùng làm việc nên không che các nút của taskbar.',
    taskbar: '“Trong taskbar”: dải nằm cùng hàng với các icon trên thanh taskbar. Bấm vào để bung ra, bấm ra ngoài để thu lại.',
  };
  $('dockHint').textContent = DOCK_HINT[state.dockMode] || DOCK_HINT.float;

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

  // Text colour drives --text; muted tones are derived so contrast stays sane.
  const color = /^#[0-9a-f]{6}$/i.test(String(s.textColor || '')) ? s.textColor : '#e8eefc';
  w.style.setProperty('--text', color);

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

  w.style.setProperty('--halo-color', haloFor(color));
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

// ------------------------------------------------------------------ resize grips
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

// ------------------------------------------------------------------ tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('is-active', p.id === `panel-${btn.dataset.tab}`);
    });
  });
});

// ------------------------------------------------------------------ modals
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

// ------------------------------------------------------------------ alert form
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
$('btnTestAlert').addEventListener('click', () => { api.testAlert(); toast('Đã gửi thông báo thử'); });
$('btnSound').addEventListener('click', () => {
  api.patchSettings({ sound: state.settings.sound === false });
});
$('btnData').addEventListener('click', () => api.openDataFolder());

// ------------------------------------------------------------------ IPC wiring
api.onState((s) => {
  Object.assign(state, s);
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
api.onFeedStatus((s) => { state.feedStatus = s; renderFeed(); });
api.onCollapsed((c) => { state.collapsed = c; renderSettings(); });
api.onAlertFired((p) => {
  const verb = p.direction === 'touch'
    ? 'chạm'
    : p.direction === 'above' ? 'vượt' : 'xuống';
  toast(`⚡ ${baseOf(p.symbol)} ${verb} ${fmtPrice(p.level)}`);
});

api.getState();
