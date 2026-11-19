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
  feedStatus: 'idle',
  collapsed: false,
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
    const dirText = a.direction === 'below' ? '↓ dưới' : '↑ trên';
    const dist = Number.isFinite(cur) && cur > 0
      ? ` · cách ${fmtPct(((Number(a.price) - cur) / cur) * 100)}`
      : '';
    return `
      <div class="alert ${a.enabled === false ? 'is-off' : ''}" data-id="${esc(a.id)}">
        <span class="alert-ico">${a.direction === 'below' ? '🔻' : '🔔'}</span>
        <div class="alert-main">
          <div class="alert-title">${esc(baseOf(a.symbol))} ${dirText} ${fmtPrice(a.price)}</div>
          <div class="alert-meta">Giá: ${Number.isFinite(cur) ? fmtPrice(cur) : '—'}${dist}${a.note ? ` · ${esc(a.note)}` : ''}</div>
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

function renderSettings() {
  const s = state.settings || {};
  $('btnPin').classList.toggle('is-on', s.alwaysOnTop !== false);
  $('btnSound').textContent = `Âm thanh: ${s.sound === false ? 'Tắt' : 'Bật'}`;
  const w = $('widget');
  w.classList.toggle('is-collapsed', !!state.collapsed);
  $('collapsedView').hidden = !state.collapsed;
  $('btnCollapse').textContent = state.collapsed ? '▴' : '▾';
  $('btnCollapse').title = state.collapsed ? 'Mở rộng' : 'Thu gọn';

  // Windows drops toasts for an app with no Start Menu shortcut (portable
  // build). Say so instead of letting the user think alerts are broken.
  const n = state.notif || {};
  const warn = $('notifWarn');
  if (warn) {
    if (n.supported === false) {
      warn.hidden = false;
      warn.textContent = 'Máy này không hỗ trợ thông báo hệ thống. Cảnh báo vẫn hiện trong widget kèm tiếng bíp.';
    } else if (n.portable) {
      warn.hidden = false;
      warn.textContent = 'Bản portable không có shortcut Start Menu nên Windows có thể bỏ qua thông báo. Cài bằng bộ Setup để nhận thông báo đầy đủ — cảnh báo vẫn hiện trong widget kèm tiếng bíp.';
    } else {
      warn.hidden = true;
    }
  }
}

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
function openModal(id) { $(id).hidden = false; }
function closeModal(id) { $(id).hidden = true; }
document.querySelectorAll('[data-close]').forEach((b) => {
  b.addEventListener('click', () => closeModal(b.dataset.close));
});
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('mousedown', (e) => { if (e.target === m) m.hidden = true; });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal').forEach((m) => { m.hidden = true; });
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
$('alertDir').addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn');
  if (b) alertDirValue = b.dataset.dir;
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
  $('alertDir').querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.dir === alertDirValue);
  });
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
    if (!confirm(`Xoá lệnh ${String(t.side).toUpperCase() === 'SELL' ? 'bán' : 'mua'} ${fmtQty(t.qty)} ${baseOf(t.symbol)}?`)) return;
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
api.onFeedStatus((s) => { state.feedStatus = s; renderFeed(); });
api.onCollapsed((c) => { state.collapsed = c; renderSettings(); });
api.onAlertFired((p) => {
  toast(`⚡ ${baseOf(p.symbol)} ${p.direction === 'above' ? 'vượt' : 'xuống'} ${fmtPrice(p.level)}`);
});

api.getState();
