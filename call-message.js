/* ============================================================
   GỌI ĐIỆN + TIN NHẮN (MÔ PHỎNG) — iOS & ANDROID
   Nạp SAU app.js. Không sửa app.js: module này bắt sự kiện ở pha
   capture trên #screen, tự vẽ lớp phủ toàn màn hình và tự xử lý
   hành động của mình. Dữ liệu vẫn chỉ nằm trong localStorage.
   ============================================================ */

(function () {
  'use strict';

  if (document.body.getAttribute('data-page') !== 'sim') return;

  var STORE_KEY = 'danhba.sim.contacts.v1';
  var RECENT_KEY = 'danhba.sim.recents.v1';
  var MSG_KEY = 'danhba.sim.messages.v1';

  var screen = document.getElementById('screen');
  var device = document.getElementById('device');
  if (!screen || !device) return;

  /* Toast đang nằm ngoài khung máy; app.js tự chuyển nó vào #screen khi render. */
  var toast = document.getElementById('toast');

  var PALETTE = [
    ['#ff8a65', '#f4511e'], ['#4fc3f7', '#0288d1'], ['#81c784', '#388e3c'],
    ['#ba68c8', '#7b1fa2'], ['#ffd54f', '#f9a825'], ['#4db6ac', '#00796b'],
    ['#f06292', '#c2185b'], ['#9575cd', '#512da8'], ['#a1887f', '#5d4037'],
    ['#64b5f6', '#1565c0']
  ];

  var ICON = {
    phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.3 2.3z"/></svg>',
    message: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.9 3 3 6.4 3 10.6c0 2.4 1.3 4.5 3.4 5.9-.2 1.2-.8 2.4-1.7 3.4 1.7-.2 3.2-.9 4.4-1.9 1 .3 2 .4 2.9.4 5.1 0 9-3.4 9-7.6S17.1 3 12 3z"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-6A2.5 2.5 0 0 1 4 17.5v-11zM16.5 9.6l3.2-2.1c.5-.3 1.1 0 1.1.6v7.8c0 .6-.6 1-1.1.6l-3.2-2.1V9.6z"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.6 3.7-5.6 7.5-5.6s6.9 2 7.5 5.6"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    speaker: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.6h3.3L12 5.6v12.8L7.3 14.4H4z" fill="currentColor" stroke="none"/><path d="M15.4 8.8a4.6 4.6 0 0 1 0 6.4"/><path d="M18 6.2a8.2 8.2 0 0 1 0 11.6"/></svg>',
    micOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="2.6" width="6" height="11" rx="3"/><path d="M5.6 11.4a6.4 6.4 0 0 0 12.8 0M12 17.8V21"/><path d="M4 3.4l16 16"/></svg>',
    keypad: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="7" cy="6" r="1.7"/><circle cx="12" cy="6" r="1.7"/><circle cx="17" cy="6" r="1.7"/><circle cx="7" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="17" cy="12" r="1.7"/><circle cx="7" cy="18" r="1.7"/><circle cx="12" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19.5V5M5.8 11.2L12 5l6.2 6.2"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    endCall: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.3 2.3z"/></svg>'
  };

  /* ---------------- tiện ích ---------------- */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }

  function writeJSON(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* bỏ qua */ }
  }

  function contacts() {
    var list = readJSON(STORE_KEY, []);
    return Array.isArray(list) ? list : [];
  }

  function getContact(id) {
    var list = contacts();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function displayName(c) {
    if (!c) return 'Không rõ';
    var n = ((c.lastName || '') + ' ' + (c.firstName || '')).trim();
    if (n) return n;
    if (c.company) return c.company;
    var p = c.phones && c.phones[0] && c.phones[0].value;
    return p || 'Không có tên';
  }

  function initials(c) {
    var f = (c.firstName || '').trim();
    var l = (c.lastName || '').trim();
    if (f && l) return (l.charAt(0) + f.charAt(0)).toUpperCase();
    var base = f || l || c.company || '?';
    var parts = base.trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
    return base.charAt(0).toUpperCase();
  }

  function avatarStyle(c) {
    var a = c && c.avatar;
    if (a && a.kind === 'photo' && a.value) {
      return 'background-image:url(' + a.value + ');background-size:cover;background-position:center;background-repeat:no-repeat';
    }
    if (a && a.kind === 'color' && a.value) return 'background:' + a.value;
    var key = ((c.lastName || '') + ' ' + (c.firstName || '')).trim() || (c.company || '');
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 9973;
    var p = PALETTE[h % PALETTE.length];
    return 'background:linear-gradient(150deg,' + p[0] + ' 0%,' + p[1] + ' 100%)';
  }

  function avatarText(c) {
    var a = c && c.avatar;
    if (a && a.kind === 'photo' && a.value) return '';
    return esc(initials(c));
  }

  function avatarHTML(c, cls) {
    return '<span class="' + cls + '" style="' + avatarStyle(c) + '">' + avatarText(c) + '</span>';
  }

  function currentOS() {
    var v = device.getAttribute('data-os');
    return v === 'android' ? 'android' : 'ios';
  }

  function nowTime() {
    var d = new Date();
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function timeOf(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function dayLabel(ts) {
    var d = new Date(ts), now = new Date();
    if (dayKey(ts) === dayKey(now.getTime())) return 'Hôm nay';
    if (dayKey(ts) === dayKey(now.getTime() - 86400000)) return 'Hôm qua';
    return d.getDate() + ' tháng ' + (d.getMonth() + 1) + ', ' + d.getFullYear();
  }

  function fmtDur(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function statusBar(os) {
    var t = nowTime();
    if (os === 'ios') {
      return '<div class="statusbar statusbar--light">' +
        '<span>' + t + '</span>' +
        '<span class="sb-right">' +
          '<svg class="sb-icon" width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0.5" width="3" height="11.5" rx="1"/></svg>' +
          '<svg class="sb-icon" width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 10.6l1.9-2.2a2.9 2.9 0 0 0-3.8 0L8 10.6zM8 6.2c1.4 0 2.7.5 3.7 1.4l1.3-1.5A7.6 7.6 0 0 0 8 4.1c-1.9 0-3.7.7-5 2l1.3 1.5A5.6 5.6 0 0 1 8 6.2zM8 2c2.4 0 4.6.9 6.2 2.4L15.5 3A10.4 10.4 0 0 0 8 0C5.1 0 2.4 1.1.5 3l1.3 1.4A8.4 8.4 0 0 1 8 2z"/></svg>' +
          '<svg class="sb-icon" width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="0.6" y="0.6" width="21" height="10.8" rx="3" stroke="currentColor" stroke-opacity="0.4"/><rect x="2.2" y="2.2" width="16" height="7.6" rx="1.8" fill="currentColor"/><path d="M23.2 4.2v3.6c.9-.3 1.4-.9 1.4-1.8s-.5-1.5-1.4-1.8z" fill="currentColor" fill-opacity="0.45"/></svg>' +
        '</span>' +
      '</div>';
    }
    return '<div class="statusbar statusbar--light">' +
      '<span>' + t + '</span>' +
      '<span class="sb-right">' +
        '<svg class="sb-icon" width="15" height="12" viewBox="0 0 15 12" fill="currentColor"><path d="M7.5 10.8l2-2.3a3 3 0 0 0-4 0l2 2.3zM7.5 6.4c1.4 0 2.7.5 3.7 1.4l1.2-1.4A7.4 7.4 0 0 0 7.5 4.3c-1.9 0-3.6.7-4.9 2.1l1.2 1.4a5.5 5.5 0 0 1 3.7-1.4zM7.5 2.2c2.3 0 4.4.9 6 2.3l1.2-1.4A10.2 10.2 0 0 0 7.5.2C4.7.2 2.1 1.3.3 3.1l1.2 1.4a8.2 8.2 0 0 1 6-2.3z"/></svg>' +
        '<svg class="sb-icon" width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="7.5" width="2.6" height="4.5" rx="0.8"/><rect x="3.8" y="5" width="2.6" height="7" rx="0.8"/><rect x="7.6" y="2.5" width="2.6" height="9.5" rx="0.8"/><rect x="11.4" y="0" width="2.6" height="12" rx="0.8"/></svg>' +
        '<svg class="sb-icon" width="24" height="12" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="3.2" stroke="currentColor" stroke-opacity="0.45"/><rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor"/><path d="M22 4.2v3.6c.9-.3 1.4-.9 1.4-1.8s-.5-1.5-1.4-1.8z" fill="currentColor" fill-opacity="0.5"/></svg>' +
      '</span>' +
    '</div>';
  }

  function toastMsg(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastMsg._t);
    toastMsg._t = setTimeout(function () { toast.classList.remove('show'); }, 2200);
  }

  /* ---------------- nhật ký cuộc gọi ---------------- */

  function logCall(c, phone) {
    if (!c) return;
    var list = readJSON(RECENT_KEY, []);
    if (!Array.isArray(list)) list = [];
    list.unshift({
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      contactId: c.id,
      name: displayName(c),
      phone: phone || ((c.phones && c.phones[0] && c.phones[0].value) || ''),
      at: Date.now(),
      type: 'call'
    });
    writeJSON(RECENT_KEY, list.slice(0, 120));
  }

  /* ---------------- tin nhắn ---------------- */

  function allMessages() {
    var m = readJSON(MSG_KEY, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }

  function threadOf(id) {
    var m = allMessages();
    if (!Array.isArray(m[id])) m[id] = [];
    return m[id];
  }

  function pushMessage(id, text) {
    var m = allMessages();
    if (!Array.isArray(m[id])) m[id] = [];
    m[id].push({
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      text: text,
      at: Date.now(),
      from: 'me'
    });
    writeJSON(MSG_KEY, m);
  }

  /* ---------------- trạng thái lớp phủ ---------------- */

  var call = null;      /* {contactId,name,phone,phase,connectedAt,muted,speaker,keypad,keys} */
  var thread = null;    /* {contactId,draft} */
  var callPhaseTimer = null;
  var callTicker = null;
  var layer = null;

  function ensureLayer() {
    if (layer && layer.parentNode === device) return layer;
    layer = document.createElement('div');
    layer.className = 'cm-layer';
    /* Gắn vào .device (không phải #screen) để app.js re-render #screen
       không xoá mất lớp phủ đang mở. */
    device.appendChild(layer);
    return layer;
  }

  function closeLayer() {
    clearTimeout(callPhaseTimer);
    clearInterval(callTicker);
    call = null;
    thread = null;
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = null;
  }

  /* ---------------- màn hình gọi ---------------- */

  function startCall(contactId, phone) {
    var c = getContact(contactId);
    if (!c) return;
    var num = phone || ((c.phones && c.phones[0] && c.phones[0].value) || '');
    if (!num) { toastMsg('Liên hệ này chưa có số điện thoại.'); return; }
    call = {
      contactId: c.id, name: displayName(c), phone: num,
      phase: 'connecting', connectedAt: 0,
      muted: false, speaker: false, keypad: false, keys: ''
    };
    thread = null;
    logCall(c, num);
    renderCall();
    runCallPhases();
  }

  function runCallPhases() {
    clearTimeout(callPhaseTimer);
    clearInterval(callTicker);
    callPhaseTimer = setTimeout(function () {
      if (!call) return;
      call.phase = 'active';
      call.connectedAt = Date.now();
      var st = document.getElementById('call-status');
      if (st) st.textContent = '00:00';
      callTicker = setInterval(function () {
        if (!call) { clearInterval(callTicker); return; }
        var el = document.getElementById('call-status');
        if (!el) return;
        el.textContent = fmtDur(Math.floor((Date.now() - call.connectedAt) / 1000));
      }, 1000);
    }, 3400);
  }

  function endCall() {
    var k = call;
    var dur = (k && k.phase === 'active') ? Math.floor((Date.now() - k.connectedAt) / 1000) : 0;
    closeLayer();
    toastMsg(k && k.phase === 'active' ? 'Đã kết thúc cuộc gọi · ' + fmtDur(dur) : 'Đã huỷ cuộc gọi');
  }

  function callBtn(icon, label, action, on) {
    return '<button class="call-btn' + (on ? ' is-on' : '') + '" type="button" data-cm="' + action + '">' +
      '<span class="cb-ic">' + icon + '</span>' +
      '<span class="cb-lb">' + esc(label) + '</span>' +
    '</button>';
  }

  function renderCall() {
    if (!call) return;
    var os = currentOS();
    var c = getContact(call.contactId);
    var av = c
      ? avatarHTML(c, 'call-avatar')
      : '<span class="call-avatar" style="background:#546e7a">' + esc((call.name || '?').charAt(0).toUpperCase()) + '</span>';

    var status = call.phase === 'connecting'
      ? (os === 'ios' ? 'đang gọi…' : 'Đang gọi…')
      : fmtDur(Math.floor((Date.now() - call.connectedAt) / 1000));

    var bottom;
    if (call.keypad) {
      var keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
      bottom = '<div class="call-keypad">' +
        '<div class="ck-display">' + esc(call.keys || '') + '</div>' +
        '<div class="ck-grid">' + keys.map(function (d) {
          return '<button class="ck-key" type="button" data-cm="call-key" data-key="' + d + '">' + d + '</button>';
        }).join('') + '</div>' +
        '<button class="ck-hide" type="button" data-cm="call-keypad">Ẩn bàn phím</button>' +
      '</div>';
    } else {
      bottom = '<div class="call-grid">' +
        callBtn(ICON.micOff, 'Tắt tiếng', 'call-mute', call.muted) +
        callBtn(ICON.keypad, 'Bàn phím', 'call-keypad', false) +
        callBtn(ICON.speaker, 'Loa', 'call-speaker', call.speaker) +
        callBtn(ICON.plus, 'Thêm', 'noop', false) +
        callBtn(ICON.video, 'Video', 'noop', false) +
        callBtn(ICON.person, 'Danh bạ', 'noop', false) +
      '</div>';
    }

    var endBtn = '<div class="call-endrow">' +
      '<button class="call-end" type="button" data-cm="end-call" aria-label="Kết thúc cuộc gọi">' + ICON.endCall + '</button>' +
    '</div>';

    var head;
    if (os === 'ios') {
      head = '<div class="call-head">' +
        '<div class="call-name">' + esc(call.name) + '</div>' +
        '<div class="call-status" id="call-status">' + esc(status) + '</div>' +
      '</div>' +
      '<div class="call-mid">' + av + '</div>';
    } else {
      head = '<div class="call-head call-head--md">' + av +
        '<div class="call-name">' + esc(call.name) + '</div>' +
        '<div class="call-num">' + esc(call.phone) + '</div>' +
        '<div class="call-status" id="call-status">' + esc(status) + '</div>' +
      '</div>';
    }

    ensureLayer().innerHTML = '<div class="call call--' + os + '">' +
      '<div class="call-bg" aria-hidden="true"></div>' +
      '<div class="call-inner">' + statusBar(os) + head +
        '<div class="call-bottom">' + bottom + endBtn + '</div>' +
      '</div>' +
    '</div>';
  }

  /* ---------------- màn hình tin nhắn ---------------- */

  function openThread(contactId) {
    var c = getContact(contactId);
    if (!c) return;
    call = null;
    thread = { contactId: c.id, draft: '' };
    renderThread();
  }

  function sendMessage() {
    if (!thread) return;
    var text = (thread.draft || '').trim();
    if (!text) return;
    pushMessage(thread.contactId, text);
    thread.draft = '';
    renderThread();
  }

  function renderThread() {
    if (!thread) return;
    var os = currentOS();
    var c = getContact(thread.contactId);
    var msgs = threadOf(thread.contactId);
    var name = c ? displayName(c) : 'Không rõ';

    var body;
    if (!msgs.length) {
      body = '<div class="msg-empty">' +
        '<div class="mse-title">Bắt đầu trò chuyện</div>' +
        '<div class="mse-sub">Tin nhắn bạn gửi chỉ được lưu trên máy này. Đây là mô phỏng để thực hành.</div>' +
      '</div>';
    } else {
      body = '<div class="msg-day">' + esc(dayLabel(msgs[0].at)) + '</div>';
      msgs.forEach(function (m, i) {
        var mine = m.from === 'me';
        body += '<div class="msg-row msg-row--' + (mine ? 'me' : 'them') + '">' +
          '<div class="msg-bubble">' + esc(m.text) + '</div>' +
        '</div>';
        if (i === msgs.length - 1) {
          body += '<div class="msg-time msg-time--' + (mine ? 'me' : 'them') + '">' + timeOf(m.at) + '</div>';
        }
      });
    }

    var nav;
    if (os === 'ios') {
      nav = '<div class="msg-nav">' +
        '<button class="msg-back" type="button" data-cm="close-thread" aria-label="Quay lại">' +
          '<svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 10l8 8"/></svg>' +
        '</button>' +
        '<div class="msg-who">' + (c ? avatarHTML(c, 'msg-av') : '') +
          '<span class="msg-name">' + esc(name) + '</span>' +
        '</div>' +
        '<div class="msg-nav-right"></div>' +
      '</div>';
    } else {
      nav = '<div class="msg-nav msg-nav--md">' +
        '<button class="md-icon-btn" type="button" data-cm="close-thread" aria-label="Quay lại">' + ICON.back + '</button>' +
        (c ? avatarHTML(c, 'msg-av msg-av--md') : '') +
        '<div class="msg-who msg-who--md"><span class="msg-name">' + esc(name) + '</span></div>' +
        '<button class="md-icon-btn" type="button" data-cm="call-from-thread" aria-label="Gọi">' + ICON.phone + '</button>' +
      '</div>';
    }

    var inputbar = '<div class="msg-inputbar msg-inputbar--' + os + '">' +
      '<div class="msg-field">' +
        '<input type="text" id="msg-input" placeholder="' + (os === 'ios' ? 'Tin nhắn' : 'Tin nhắn văn bản') + '" value="' + esc(thread.draft || '') + '" autocomplete="off" />' +
      '</div>' +
      '<button class="msg-send' + ((thread.draft || '').trim() ? ' is-ready' : '') + '" type="button" data-cm="send-message" aria-label="Gửi">' + ICON.send + '</button>' +
    '</div>';

    ensureLayer().innerHTML = '<div class="app app--msg" data-os="' + os + '">' +
      statusBar(os) + nav +
      '<div class="app-body">' +
        '<div class="msg-scroll" id="msg-scroll">' + body + '</div>' +
        inputbar +
      '</div>' +
    '</div>';

    var input = layer.querySelector('#msg-input');
    if (input) {
      input.addEventListener('input', function () {
        if (!thread) return;
        thread.draft = input.value;
        var btn = layer.querySelector('.msg-send');
        if (btn) btn.classList.toggle('is-ready', !!input.value.trim());
      });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); sendMessage(); }
      });
      var sc = layer.querySelector('#msg-scroll');
      if (sc) sc.scrollTop = sc.scrollHeight;
    }
  }

  /* ---------------- bắt sự kiện ---------------- */

  function labelOf(btn) {
    var span = btn.querySelector('span');
    return (span ? span.textContent : btn.textContent || '').trim();
  }

  /* app.js không lộ state, nên ghi nhớ id mỗi lần mở chi tiết. */
  var lastDetailId = null;

  screen.addEventListener('click', function (e) {
    var row = e.target.closest('[data-action="open-detail"][data-id]');
    if (row) lastDetailId = row.getAttribute('data-id');
  }, true);

  screen.addEventListener('click', function (e) {
    var btn = e.target.closest('.ios-action, .md-action');
    if (!btn) return;
    var label = labelOf(btn);
    var id = lastDetailId;
    if (!id) return;

    if (label === 'Nhắn tin') {
      e.preventDefault();
      e.stopPropagation();
      openThread(id);
      return;
    }
    if (label === 'Gọi') {
      e.preventDefault();
      e.stopPropagation();
      startCall(id, null);
    }
  }, true);

  /* Nút số điện thoại trong thẻ chi tiết iOS (call-sheet) và nút Gọi cũ của
     Android (call-contact) cũng mở màn hình gọi. */
  screen.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action="call-sheet"], [data-action="call-contact"]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    var id = lastDetailId;
    if (!id) return;
    startCall(id, el.getAttribute('data-value'));
  }, true);

  /* Hành động bên trong lớp phủ */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-cm]');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    var a = el.getAttribute('data-cm');

    if (a === 'end-call') { endCall(); return; }
    if (a === 'call-mute') { if (call) { call.muted = !call.muted; renderCall(); } return; }
    if (a === 'call-speaker') { if (call) { call.speaker = !call.speaker; renderCall(); } return; }
    if (a === 'call-keypad') { if (call) { call.keypad = !call.keypad; renderCall(); } return; }
    if (a === 'call-key') {
      if (call) { call.keys = (call.keys + el.getAttribute('data-key')).slice(0, 18); renderCall(); }
      return;
    }
    if (a === 'send-message') { sendMessage(); return; }
    if (a === 'close-thread') { closeLayer(); return; }
    if (a === 'call-from-thread') {
      var tid = thread && thread.contactId;
      closeLayer();
      if (tid) startCall(tid, null);
      return;
    }
    if (a === 'noop') { toastMsg('Đây là mô phỏng — chức năng này chưa được bật.'); return; }
  }, true);

  window.addEventListener('resize', function () {
    if (call) renderCall();
  });
})();
