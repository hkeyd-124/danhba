'use strict';
/**
 * Demo futures — renderer side.
 *
 * ---------------------------------------------------------------------------
 * Why this is a separate file and not a block inside app.js
 *
 * The feature is self-contained: one panel, one strip container, one sheet. It
 * needs nothing from app.js except the formatting helpers and the modal
 * plumbing, all of which are plain function declarations in the shared global
 * scope of a classic script. Keeping it here means app.js — 1800 lines of
 * portfolio, dock and appearance logic — is not touched at all by a feature
 * that has nothing to do with any of it.
 *
 * It subscribes to the IPC channels itself rather than being called from
 * app.js's render(), for the same reason: no edit, no coupling, and a futures
 * tick repaints only the futures surfaces.
 *
 * ---------------------------------------------------------------------------
 * Why the numbers are not computed here
 *
 * PnL, ROE and the liquidation price all arrive from the main process, already
 * marked to the live price by src/futures.js. This file only formats them. A
 * second copy of the liquidation formula would be a number the user acts on,
 * computed twice, with no way to tell which one is on screen.
 *
 * The ONE exception is the live preview inside the open-position sheet: it has
 * to answer "where would this liquidate" before the position exists, and there
 * is no IPC round trip for a number the user is still typing. The stored
 * position is always recomputed by the main process, so a drift there can only
 * mislead the preview, never the book.
 */

(function initFuturesUi() {
  const api = window.cpw;
  if (!api || !api.saveFuture) return;

  /** Local mirror of the futures slice of the state payload. */
  const fut = {
    positions: [],
    totals: {},
    rows: [],
    pins: { pnl: true, liq: true },
  };

  let sideValue = 'LONG';
  let modeValue = 'isolated';

  /** Mirrors MMR in src/futures.js — preview only, see the file header. */
  const MMR = 0.004;

  const MODE_HINT = {
    isolated: 'Isolate: ký quỹ riêng, lệnh tự chết khi lỗ hết phần ký quỹ của nó.',
    cross: 'Cross: mọi lệnh cross dùng chung một pool. Cháy là cháy cả tài khoản.',
  };

  // ------------------------------------------------------------- panel list
  function renderPanel() {
    const list = $('futureList');
    const empty = $('futureEmpty');
    if (!list) return;

    const pinPnl = fut.pins.pnl !== false;
    const pinLiq = fut.pins.liq !== false;
    $('btnPinPnl').textContent = `Ghim PnL: ${pinPnl ? 'Bật' : 'Tắt'}`;
    $('btnPinLiq').textContent = `Ghim thanh lý: ${pinLiq ? 'Bật' : 'Tắt'}`;

    if (!fut.positions.length) {
      list.innerHTML = '';
      empty.hidden = false;
      return;
    }
    empty.hidden = true;

    list.innerHTML = fut.positions.map((p) => {
      const pnlCls = cls(p.pnl);
      const sideCls = p.side === 'LONG' ? 'buy' : 'sell';
      /**
       * The liquidation line is the one that has to be unmissable.
       *
       * A position past its liquidation price is drawn in the down colour and
       * says so in words — a red number alone is easy to read as "a bit down".
       */
      const liqCls = p.liquidated ? 'down' : Math.abs(p.liqDistancePct) < 5 ? 'down' : 'flat';
      const liqText = p.liq > 0 ? fmtPrice(p.liq) : '—';
      const distText = p.hasPrice && p.liq > 0
        ? `${p.liqDistancePct >= 0 ? '+' : ''}${p.liqDistancePct.toFixed(1)}%`
        : '—';
      const isCross = p.marginMode === 'cross';
      /**
       * Effective leverage is shown only when it differs from the label.
       *
       * With extra margin posted, "10x" is no longer what the position is
       * running at, and showing the label alone would overstate the risk.
       */
      const effLev = Number(p.effectiveLeverage);
      const levText = Number.isFinite(effLev) && Math.abs(effLev - p.leverage) > 0.05
        ? `${p.leverage}x → ${effLev.toFixed(1)}x`
        : `${p.leverage}x`;
      return `
      <div class="fut" data-fid="${esc(p.id)}">
        <div class="fut-top">
          ${badgeHtml(p.symbol, 'sm')}
          <span class="fut-sym">${esc(baseOf(p.symbol))}</span>
          <span class="side ${sideCls}">${p.side === 'LONG' ? 'LONG' : 'SHORT'}</span>
          <span class="fut-mode ${isCross ? 'is-cross' : ''}">${isCross ? 'CROSS' : 'ISOLATE'}</span>
          <span class="fut-lev">${levText}</span>
          <span class="fut-pnl ${pnlCls}">${fmtSigned(p.pnl)} (${fmtPct(p.roe)})</span>
        </div>
        <div class="fut-sub">
          <span>Vào ${fmtPrice(p.entry)}</span>
          <span>Mark ${p.hasPrice ? fmtPrice(p.mark) : '—'}</span>
          <span>KL ${fmtQty(p.qty)}</span>
          <span>Ký quỹ ${fmtMoney(p.margin)}</span>
        </div>
        <div class="fut-liq ${liqCls}">
          ${p.liquidated ? '⚠ Đã chạm giá thanh lý' : 'Thanh lý'} ${liqText}
          <span class="fut-dist">cách ${distText}</span>
          ${isCross ? '<span class="fut-dist">· theo pool cross</span>' : ''}
        </div>
        <div class="fut-actions">
          <button class="linkbtn" data-fdel="${esc(p.id)}">Đóng lệnh</button>
        </div>
      </div>`;
    }).join('');

    paintStyles(list);
  }

  // ------------------------------------------------------------- strip rows
  /**
   * The pinned futures rows in the collapsed strip.
   *
   * `fut.rows` is built by `futures.stripRows` in the main process, so the rows
   * drawn here and the strip height computed there come from one call. Nothing
   * is drawn when the book is empty, which keeps the strip byte-for-byte the
   * layout every earlier version drew.
   */
  function renderStrip() {
    const box = $('cvFutures');
    if (!box) return;
    if (!fut.rows.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = fut.rows.map((r) => `
      <div class="cv-fut" data-kind="${esc(r.kind)}">
        <span class="cv-fut-tag">${esc(r.label)}</span>
        <span class="cv-fut-val ${r.tone}">${esc(r.text)}</span>
        <span class="cv-fut-sub ${r.tone}">${esc(r.sub)}</span>
      </div>`).join('');
    paintStyles(box);
  }

  function renderAll() {
    renderPanel();
    renderStrip();
  }

  // ------------------------------------------------------------- open sheet
  /**
   * The live preview inside the open-position sheet.
   *
   * Mirrors `buildPosition` + `isolatedLiquidation` / `crossLiquidation` from
   * src/futures.js. This is a deliberate second copy of the FORMULA and the
   * only one in the renderer — see the file header for why it is acceptable
   * here and nowhere else.
   *
   * For CROSS the preview has to guess at the pool, because the position does
   * not exist yet. It uses the cross rows already in the book, which is the
   * honest answer to "if I add this now, where does the account die".
   */
  function updateCalc() {
    const el = $('futureCalc');
    const qty = parseFloat($('futureQty').value);
    const lev = parseFloat($('futureLeverage').value);
    const entry = parseFloat($('futureEntry').value);
    const marginIn = parseFloat($('futureMargin').value);

    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(lev) || lev < 1) {
      el.textContent = 'Nhập khối lượng và đòn bẩy để xem ký quỹ tối thiểu và giá thanh lý.';
      $('futureMarginHint').textContent = 'Tối thiểu theo khối lượng và đòn bẩy.';
      return;
    }

    const notional = qty * (Number.isFinite(entry) && entry > 0 ? entry : 0);
    const required = notional > 0 ? notional / lev : 0;
    const margin = Number.isFinite(marginIn) && marginIn > 0 ? marginIn : required;

    $('futureMarginHint').textContent = required > 0
      ? `Tối thiểu ${fmtMoney(required)} USDT. Thêm vào đây để đẩy giá thanh lý ra xa.`
      : 'Tối thiểu theo khối lượng và đòn bẩy.';

    if (!(notional > 0)) {
      el.textContent = `Ký quỹ tối thiểu ${fmtMoney(required)} USDT · nhập giá vào để xem giá thanh lý.`;
      return;
    }

    if (margin < required - 1e-9) {
      el.textContent = `Ký quỹ thấp hơn mức tối thiểu ${fmtMoney(required)} USDT cho `
        + `${fmtQty(qty)} đơn vị ở ${lev}x.`;
      return;
    }

    let liq = 0;
    if (modeValue === 'isolated') {
      const buffer = margin - MMR * notional;
      if (buffer > 0) {
        liq = sideValue === 'LONG' ? entry - buffer / qty : entry + buffer / qty;
      }
    } else {
      /**
       * Cross: pool = the cross rows already open, plus this one.
       *
       * The new position is assumed to open at its entry, so it contributes
       * margin and no PnL yet.
       */
      let equity = margin;
      let maintenance = MMR * notional;
      for (const p of fut.positions) {
        if (p.marginMode !== 'cross') continue;
        equity += Number(p.margin) + Number(p.pnl);
        maintenance += MMR * Number(p.notional);
      }
      const delta = (equity - maintenance) / qty;
      liq = sideValue === 'LONG' ? entry - delta : entry + delta;
    }

    const effLev = notional / margin;
    el.textContent = `Khối lượng ${fmtQty(qty)} · ${fmtMoney(notional)} USDT · ${lev}x`
      + (Math.abs(effLev - lev) > 0.05 ? ` (thực tế ${effLev.toFixed(1)}x)` : '')
      + ` · ký quỹ ${fmtMoney(margin)}`
      + (liq > 0 ? ` · thanh lý ~${fmtPrice(liq)}` : '');
  }

  function setMode(mode) {
    modeValue = mode === 'cross' ? 'cross' : 'isolated';
    $('futureMode').querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.mode === modeValue);
    });
    $('futureModeHint').textContent = MODE_HINT[modeValue];
    updateCalc();
  }

  function openSheet(pos) {
    $('futureError').hidden = true;
    $('futureId').value = pos ? pos.id : '';
    $('futureTitle').textContent = pos ? 'Sửa lệnh future demo' : 'Mở lệnh future demo';
    $('futureSymbol').value = pos ? baseOf(pos.symbol) : '';
    $('futureQty').value = pos ? pos.qty : '';
    $('futureLeverage').value = pos ? pos.leverage : 10;
    $('futureMargin').value = pos ? pos.margin : '';
    $('futureEntry').value = pos ? pos.entry : '';
    $('futureNote').value = pos ? (pos.note || '') : '';
    sideValue = pos ? pos.side : 'LONG';
    $('futureSide').querySelectorAll('.seg-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.side === sideValue);
    });
    setMode(pos ? pos.marginMode : 'isolated');
    openModal('futureModal');
    setTimeout(() => $('futureSymbol').focus(), 60);
  }

  // ------------------------------------------------------------- wiring
  $('btnAddFuture').addEventListener('click', () => openSheet(null));

  $('futureSide').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    sideValue = b.dataset.side;
    updateCalc();
  });

  $('futureMode').addEventListener('click', (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    setMode(b.dataset.mode);
  });

  ['futureQty', 'futureLeverage', 'futureMargin', 'futureEntry']
    .forEach((id) => $(id).addEventListener('input', updateCalc));

  $('futureForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('futureError');
    err.hidden = true;

    const res = await api.saveFuture({
      id: $('futureId').value || null,
      symbol: $('futureSymbol').value,
      side: sideValue,
      marginMode: modeValue,
      qty: parseFloat($('futureQty').value),
      leverage: parseFloat($('futureLeverage').value),
      margin: parseFloat($('futureMargin').value),
      entry: parseFloat($('futureEntry').value),
      note: $('futureNote').value,
    });

    if (!res || !res.ok) {
      err.textContent = (res && res.error) || 'Không lưu được lệnh.';
      err.hidden = false;
      return;
    }
    closeModal('futureModal');
    toast('Đã lưu lệnh future demo');
  });

  $('futureList').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-fdel]');
    if (!b) return;
    await api.deleteFuture(b.dataset.fdel);
    toast('Đã đóng lệnh');
  });

  $('btnPinPnl').addEventListener('click', () => {
    fut.pins.pnl = !fut.pins.pnl;
    api.pinFutures({ pnl: fut.pins.pnl, liq: fut.pins.liq });
    renderPanel();
  });

  $('btnPinLiq').addEventListener('click', () => {
    fut.pins.liq = !fut.pins.liq;
    api.pinFutures({ pnl: fut.pins.pnl, liq: fut.pins.liq });
    renderPanel();
  });

  // ------------------------------------------------------------- IPC
  /**
   * Both channels carry the futures slice, because both change it: a state push
   * follows a save or a settings change, a price tick follows the market. The
   * strip has to move on the tick — a PnL that only updates when something else
   * happens is worse than no PnL at all.
   */
  function absorb(payload) {
    if (!payload) return;
    if (Array.isArray(payload.futures)) fut.positions = payload.futures;
    if (payload.futuresTotals) fut.totals = payload.futuresTotals;
    if (Array.isArray(payload.futuresRows)) fut.rows = payload.futuresRows;
    if (payload.settings) {
      fut.pins.pnl = payload.settings.futPinPnl !== false;
      fut.pins.liq = payload.settings.futPinLiq !== false;
    }
    renderAll();
  }

  api.onState(absorb);
  api.onPrices(absorb);

  // The first paint: getState() resolves with the same shape as a state push.
  api.getState().then(absorb).catch(() => {});
}());
