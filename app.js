/* ============================================================
   MÔ PHỎNG DANH BẠ — iOS & ANDROID
   Toàn bộ dữ liệu lưu trong localStorage của trình duyệt.
   Trang 1 (index.html): chọn hệ điều hành.
   Trang 2 (sim.html):    sân khấu mô phỏng thiết bị.
   ============================================================ */

(function () {
  'use strict';

  var STORE_KEY = 'danhba.sim.contacts.v1';
  var OS_KEY = 'danhba.sim.os.v1';
  var RECENT_KEY = 'danhba.sim.recents.v1';

  var PAGE = document.body.getAttribute('data-page');

  /* ------------------------------------------------------------
     DỮ LIỆU MẪU
     ------------------------------------------------------------ */

  var SEED = [
    { firstName: 'Minh Anh', lastName: 'Nguyễn', company: 'Trường THCS Nguyễn Du', phones: [{ label: 'di động', value: '0912 345 678' }], emails: [{ label: 'nhà riêng', value: 'minhanh@example.com' }], note: 'Bạn cùng lớp 8A.', favorite: true },
    { firstName: 'Bảo', lastName: 'Trần', company: '', phones: [{ label: 'di động', value: '0987 654 321' }], emails: [], note: '' },
    { firstName: 'Thu Hà', lastName: 'Lê', company: 'Nhà sách Phương Nam', phones: [{ label: 'di động', value: '0903 111 222' }, { label: 'cơ quan', value: '028 3822 1234' }], emails: [{ label: 'cơ quan', value: 'thuha@example.com' }], note: '', favorite: true },
    { firstName: 'Quốc Huy', lastName: 'Phạm', company: '', phones: [{ label: 'di động', value: '0938 777 888' }], emails: [], note: 'Đội bóng rổ của trường.' },
    { firstName: 'Khánh Linh', lastName: 'Võ', company: '', phones: [{ label: 'di động', value: '0977 222 333' }], emails: [{ label: 'di động', value: 'khanhlinh@example.com' }], note: '' },
    { firstName: 'Tuấn Kiệt', lastName: 'Đặng', company: 'Cửa hàng xe đạp An Bình', phones: [{ label: 'cơ quan', value: '028 3999 5555' }], emails: [], note: '' },
    { firstName: 'Ngọc Lan', lastName: 'Bùi', company: '', phones: [{ label: 'di động', value: '0918 444 555' }], emails: [], note: '' },
    { firstName: 'Gia Bảo', lastName: 'Hoàng', company: '', phones: [{ label: 'di động', value: '0966 123 456' }], emails: [], note: '' },
    { firstName: 'Thanh Mai', lastName: 'Đỗ', company: 'Phòng khám Hòa Bình', phones: [{ label: 'cơ quan', value: '028 3777 8888' }], emails: [{ label: 'cơ quan', value: 'thanhmai@example.com' }], note: '' },
    { firstName: 'Hải Nam', lastName: 'Ngô', company: '', phones: [{ label: 'di động', value: '0909 888 777' }], emails: [], note: '' },
    { firstName: 'Phương Thảo', lastName: 'Trịnh', company: '', phones: [{ label: 'di động', value: '0932 555 666' }], emails: [], note: 'Học nhóm môn Toán.' },
    { firstName: 'Đức Thành', lastName: 'Lý', company: 'Trường THCS Nguyễn Du', phones: [{ label: 'cơ quan', value: '028 3811 2233' }], emails: [], note: 'Thầy giáo chủ nhiệm.', favorite: true }
  ];

  /* ------------------------------------------------------------
     TRẠNG THÁI
     ------------------------------------------------------------ */

  var state = {
    os: 'ios',
    contacts: [],
    recents: [],
    screen: 'home',
    tab: 'contacts',
    selectedId: null,
    query: '',
    form: null,
    overlay: null,
    snackbar: null
  };

  var els = {};
  var snackTimer = null;
  var clockTimer = null;

  /* ------------------------------------------------------------
     TIỆN ÍCH
     ------------------------------------------------------------ */

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function stripDiacritics(s) {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D');
  }

  function displayName(c) {
    var n = ((c.lastName || '') + ' ' + (c.firstName || '')).trim();
    if (n) return n;
    if (c.company) return c.company;
    var p = c.phones && c.phones[0] && c.phones[0].value;
    return p || 'Không có tên';
  }

  function sortName(c) {
    var n = ((c.lastName || '') + ' ' + (c.firstName || '')).trim();
    return n || c.company || '';
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

  var PALETTE = [
    ['#ff8a65', '#f4511e'],
    ['#4fc3f7', '#0288d1'],
    ['#81c784', '#388e3c'],
    ['#ba68c8', '#7b1fa2'],
    ['#ffd54f', '#f9a825'],
    ['#4db6ac', '#00796b'],
    ['#f06292', '#c2185b'],
    ['#9575cd', '#512da8'],
    ['#a1887f', '#5d4037'],
    ['#64b5f6', '#1565c0']
  ];

  /* Bảng màu phẳng cho bộ chọn ảnh đại diện (kiểu Danh bạ iOS) */
  var AVATAR_COLORS = [
    '#e57373', '#f06292', '#ba68c8', '#9575cd',
    '#7986cb', '#64b5f6', '#4fc3f7', '#4db6ac',
    '#81c784', '#aed581', '#ffd54f', '#ffb74d',
    '#ff8a65', '#a1887f', '#90a4ae', '#546e7a'
  ];

  function avatarGradient(c) {
    var key = sortName(c) || displayName(c);
    var h = 0;
    for (var i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 9973;
    var p = PALETTE[h % PALETTE.length];
    return 'linear-gradient(150deg,' + p[0] + ' 0%,' + p[1] + ' 100%)';
  }

  /* Trả về style nền cho avatar: ảnh tải lên > màu đã chọn > gradient theo tên */
  function avatarStyle(c) {
    var a = c && c.avatar;
    if (a && a.kind === 'photo' && a.value) {
      return 'background-image:url(' + a.value + ');background-size:cover;background-position:center;background-repeat:no-repeat';
    }
    if (a && a.kind === 'color' && a.value) {
      return 'background:' + a.value;
    }
    return 'background:' + avatarGradient(c);
  }

  function avatarText(c) {
    var a = c && c.avatar;
    if (a && a.kind === 'photo' && a.value) return '';
    return esc(initials(c));
  }

  function avatarHTML(c, cls) {
    return '<span class="' + cls + '" style="' + avatarStyle(c) + '">' + avatarText(c) + '</span>';
  }

  function groupLetter(c) {
    var n = stripDiacritics(sortName(c)).trim();
    if (!n) return '#';
    var ch = n.charAt(0).toUpperCase();
    return /[A-Z]/.test(ch) ? ch : '#';
  }

  function sortedContacts() {
    return state.contacts.slice().sort(function (a, b) {
      return stripDiacritics(sortName(a)).localeCompare(stripDiacritics(sortName(b)), 'vi', { sensitivity: 'base' });
    });
  }

  function filteredContacts() {
    var q = stripDiacritics(state.query).toLowerCase().trim();
    var list = sortedContacts();
    if (!q) return list;
    return list.filter(function (c) {
      var hay = [
        c.firstName, c.lastName, c.company, c.note,
        (c.phones || []).map(function (p) { return p.value; }).join(' '),
        (c.emails || []).map(function (e) { return e.value; }).join(' ')
      ].join(' ');
      return stripDiacritics(hay).toLowerCase().indexOf(q) !== -1;
    });
  }

  function favoriteContacts() {
    return sortedContacts().filter(function (c) { return !!c.favorite; });
  }

  function groupList(list) {
    var out = [];
    var map = {};
    list.forEach(function (c) {
      var L = groupLetter(c);
      if (!map[L]) { map[L] = { letter: L, items: [] }; out.push(map[L]); }
      map[L].items.push(c);
    });
    out.sort(function (a, b) {
      if (a.letter === '#') return 1;
      if (b.letter === '#') return -1;
      return a.letter.localeCompare(b.letter);
    });
    return out;
  }

  function getContact(id) {
    for (var i = 0; i < state.contacts.length; i++) if (state.contacts[i].id === id) return state.contacts[i];
    return null;
  }

  function nowTime() {
    var d = new Date();
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function todayLabel() {
    var d = new Date();
    var days = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
    return days[d.getDay()] + ', ' + d.getDate() + ' tháng ' + (d.getMonth() + 1);
  }

  function timeOf(ts) {
    var d = new Date(ts);
    var h = d.getHours();
    var m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function dayLabel(ts) {
    var d = new Date(ts);
    var now = new Date();
    var k = dayKey(ts);
    if (k === dayKey(now.getTime())) return 'Hôm nay';
    var y = new Date(now.getTime() - 86400000);
    if (k === dayKey(y.getTime())) return 'Hôm qua';
    return d.getDate() + ' tháng ' + (d.getMonth() + 1) + ', ' + d.getFullYear();
  }

  /* ------------------------------------------------------------
     LƯU TRỮ
     ------------------------------------------------------------ */

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          state.contacts = parsed.map(normalizeContact);
          loadRecents();
          return;
        }
      }
    } catch (e) { /* bỏ qua */ }
    state.contacts = SEED.map(function (c) {
      var n = normalizeContact(c);
      n.id = uid();
      return n;
    });
    save();
    loadRecents();
  }

  function normalizeContact(c) {
    var av = null;
    if (c.avatar && (c.avatar.kind === 'photo' || c.avatar.kind === 'color') && c.avatar.value) {
      av = { kind: c.avatar.kind, value: c.avatar.value };
    }
    return {
      id: c.id || uid(),
      firstName: c.firstName || '',
      lastName: c.lastName || '',
      company: c.company || '',
      phones: Array.isArray(c.phones) ? c.phones.map(function (p) { return { label: p.label || 'di động', value: p.value || '' }; }) : [],
      emails: Array.isArray(c.emails) ? c.emails.map(function (e) { return { label: e.label || 'nhà riêng', value: e.value || '' }; }) : [],
      note: c.note || '',
      favorite: !!c.favorite,
      avatar: av
    };
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state.contacts));
    } catch (e) { /* bỏ qua */ }
  }

  function loadRecents() {
    try {
      var raw = localStorage.getItem(RECENT_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) { state.recents = parsed; return; }
      }
    } catch (e) { /* bỏ qua */ }
    state.recents = [];
  }

  function saveRecents() {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(state.recents.slice(0, 120)));
    } catch (e) { /* bỏ qua */ }
  }

  function loadOS() {
    try {
      var v = localStorage.getItem(OS_KEY);
      if (v === 'ios' || v === 'android') return v;
    } catch (e) { /* bỏ qua */ }
    return null;
  }

  function saveOS(v) {
    try { localStorage.setItem(OS_KEY, v); } catch (e) { /* bỏ qua */ }
  }

  /* ------------------------------------------------------------
     ICON
     ------------------------------------------------------------ */

  var ICON = {
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="12" cy="19" r="1.9"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.3 2.3z"/></svg>',
    message: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3C6.9 3 3 6.4 3 10.6c0 2.4 1.3 4.5 3.4 5.9-.2 1.2-.8 2.4-1.7 3.4 1.7-.2 3.2-.9 4.4-1.9 1 .3 2 .4 2.9.4 5.1 0 9-3.4 9-7.6S17.1 3 12 3z"/></svg>',
    video: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h6A2.5 2.5 0 0 1 15 6.5v11A2.5 2.5 0 0 1 12.5 20h-6A2.5 2.5 0 0 1 4 17.5v-11zM16.5 9.6l3.2-2.1c.5-.3 1.1 0 1.1.6v7.8c0 .6-.6 1-1.1.6l-3.2-2.1V9.6z"/></svg>',
    mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4l10-10a2.8 2.8 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M8 8l4-4 4 4"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
    person: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c.6-3.6 3.7-5.6 7.5-5.6s6.9 2 7.5 5.6"/></svg>',
    contacts: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><rect x="4" y="3" width="16" height="18" rx="3"/><circle cx="12" cy="10" r="2.6"/><path d="M7.8 17.4c.5-2 2.2-3.1 4.2-3.1s3.7 1.1 4.2 3.1"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4l2.5 5.2 5.5.8-4 3.9 1 5.6-5-2.7-5 2.7 1-5.6-4-3.9 5.5-.8z"/></svg>',
    starFill: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3.6l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.9-5.4 2.9 1-6L3.3 10l6-.9z"/></svg>',
    history: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 8h2M13 8h2M9 12h2M13 12h2M9 16h6"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h5"/></svg>',
    camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.2l1.1-1.6h6.4L16.3 6h1.2A2.5 2.5 0 0 1 20 8.5v8A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-8z"/><circle cx="12" cy="12.4" r="3.4"/></svg>',
    callIn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.3 2.3z"/></svg>'
  };

  function statusBar(os) {
    var t = nowTime();
    if (os === 'ios') {
      return '<div class="statusbar">' +
        '<span>' + t + '</span>' +
        '<span class="sb-right">' +
          '<svg class="sb-icon" width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0.5" width="3" height="11.5" rx="1"/></svg>' +
          '<svg class="sb-icon" width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 10.6l1.9-2.2a2.9 2.9 0 0 0-3.8 0L8 10.6zM8 6.2c1.4 0 2.7.5 3.7 1.4l1.3-1.5A7.6 7.6 0 0 0 8 4.1c-1.9 0-3.7.7-5 2l1.3 1.5A5.6 5.6 0 0 1 8 6.2zM8 2c2.4 0 4.6.9 6.2 2.4L15.5 3A10.4 10.4 0 0 0 8 0C5.1 0 2.4 1.1.5 3l1.3 1.4A8.4 8.4 0 0 1 8 2z"/></svg>' +
          '<svg class="sb-icon" width="25" height="12" viewBox="0 0 25 12" fill="none"><rect x="0.6" y="0.6" width="21" height="10.8" rx="3" stroke="currentColor" stroke-opacity="0.4"/><rect x="2.2" y="2.2" width="16" height="7.6" rx="1.8" fill="currentColor"/><path d="M23.2 4.2v3.6c.9-.3 1.4-.9 1.4-1.8s-.5-1.5-1.4-1.8z" fill="currentColor" fill-opacity="0.45"/></svg>' +
        '</span>' +
      '</div>';
    }
    return '<div class="statusbar">' +
      '<span>' + t + '</span>' +
      '<span class="sb-right">' +
        '<svg class="sb-icon" width="15" height="12" viewBox="0 0 15 12" fill="currentColor"><path d="M7.5 10.8l2-2.3a3 3 0 0 0-4 0l2 2.3zM7.5 6.4c1.4 0 2.7.5 3.7 1.4l1.2-1.4A7.4 7.4 0 0 0 7.5 4.3c-1.9 0-3.6.7-4.9 2.1l1.2 1.4a5.5 5.5 0 0 1 3.7-1.4zM7.5 2.2c2.3 0 4.4.9 6 2.3l1.2-1.4A10.2 10.2 0 0 0 7.5.2C4.7.2 2.1 1.3.3 3.1l1.2 1.4a8.2 8.2 0 0 1 6-2.3z"/></svg>' +
        '<svg class="sb-icon" width="14" height="12" viewBox="0 0 14 12" fill="currentColor"><rect x="0" y="7.5" width="2.6" height="4.5" rx="0.8"/><rect x="3.8" y="5" width="2.6" height="7" rx="0.8"/><rect x="7.6" y="2.5" width="2.6" height="9.5" rx="0.8"/><rect x="11.4" y="0" width="2.6" height="12" rx="0.8"/></svg>' +
        '<svg class="sb-icon" width="24" height="12" viewBox="0 0 24 12" fill="none"><rect x="0.5" y="0.5" width="20" height="11" rx="3.2" stroke="currentColor" stroke-opacity="0.45"/><rect x="2" y="2" width="15" height="8" rx="2" fill="currentColor"/><path d="M22 4.2v3.6c.9-.3 1.4-.9 1.4-1.8s-.5-1.5-1.4-1.8z" fill="currentColor" fill-opacity="0.5"/></svg>' +
      '</span>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     MÀN HÌNH CHÍNH (HOME)
     ------------------------------------------------------------ */

  function appIcon(cls, label, inner, action) {
    return '<button class="app-icon" type="button" ' + (action ? 'data-action="' + action + '"' : 'data-action="noop"') + '>' +
      '<span class="ic ' + cls + '">' + inner + '</span>' +
      '<span class="lbl">' + esc(label) + '</span>' +
    '</button>';
  }

  function renderHome() {
    var os = state.os;
    var contactsIcon = '<span style="color:#0b57d0">' + ICON.contacts + '</span>';

    var grid = '';
    grid += appIcon('ic--contacts', 'Danh bạ', contactsIcon, 'open-contacts');
    grid += appIcon('ic--phone', 'Điện thoại', '<svg viewBox="0 0 24 24" fill="#fff">' + ICON.phone.replace(/<\/?svg[^>]*>/g, '') + '</svg>');
    grid += appIcon('ic--messages', 'Tin nhắn', '<svg viewBox="0 0 24 24" fill="#fff">' + ICON.message.replace(/<\/?svg[^>]*>/g, '') + '</svg>');
    grid += appIcon('ic--camera', 'Máy ảnh', '<svg viewBox="0 0 24 24" fill="#3a3a3c"><path d="M9 4h6l1.2 2H20a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.8L9 4zm3 5.2a4.3 4.3 0 1 0 0 8.6 4.3 4.3 0 0 0 0-8.6z"/></svg>');
    grid += appIcon('ic--photos', 'Ảnh', '<svg viewBox="0 0 24 24" fill="none" stroke="#f5a623" stroke-width="2"><circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16" stroke="#4a90e2"/></svg>');
    grid += appIcon('ic--clock', 'Đồng hồ', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5.2l3.4 2" stroke-linecap="round"/></svg>');
    grid += appIcon('ic--notes', 'Ghi chú', '<svg viewBox="0 0 24 24" fill="none" stroke="#8a6d00" stroke-width="1.8"><path d="M6 3h9l4 4v14H6z"/><path d="M9 11h7M9 15h5" stroke-linecap="round"/></svg>');
    grid += appIcon('ic--settings', 'Cài đặt', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M18.4 5.6l-1.7 1.7M7.3 16.7l-1.7 1.7"/></svg>');
    grid += appIcon('ic--calc', 'Máy tính', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M8 7h8M8 12h2M12 12h2M16 12h.01M8 16h2M12 16h2M16 16h.01"/></svg>');
    grid += appIcon('ic--maps', 'Bản đồ', '<svg viewBox="0 0 24 24" fill="none" stroke="#1b5e20" stroke-width="1.8"><path d="M9 4l6 2 5-2v14l-5 2-6-2-5 2V6z"/><path d="M9 4v14M15 6v14"/></svg>');
    grid += appIcon('ic--safari', 'Safari', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="#fff" stroke="none"/></svg>');
    grid += appIcon('ic--mail', 'Thư', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7.5l8.5 6 8.5-6"/></svg>');

    var dock = '';
    dock += appIcon('ic--phone', 'Điện thoại', '<svg viewBox="0 0 24 24" fill="#fff">' + ICON.phone.replace(/<\/?svg[^>]*>/g, '') + '</svg>');
    dock += appIcon('ic--safari', 'Safari', '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2 5-5 2 2-5z" fill="#fff" stroke="none"/></svg>');
    dock += appIcon('ic--messages', 'Tin nhắn', '<svg viewBox="0 0 24 24" fill="#fff">' + ICON.message.replace(/<\/?svg[^>]*>/g, '') + '</svg>');
    dock += appIcon('ic--contacts', 'Danh bạ', contactsIcon, 'open-contacts');

    return '<div class="wallpaper"></div>' +
      '<div class="home">' +
        statusBar(os) +
        '<div class="home-body">' +
          '<div class="home-clock">' +
            '<div class="hc-date">' + esc(todayLabel()) + '</div>' +
            '<div class="hc-time" data-clock>' + nowTime() + '</div>' +
          '</div>' +
          '<div class="app-grid">' + grid + '</div>' +
        '</div>' +
        '<div class="dock">' + dock + '</div>' +
      '</div>';
  }

  /* ------------------------------------------------------------
     iOS — DANH SÁCH
     ------------------------------------------------------------ */

  function iosNav(opts) {
    var left = opts.left || '';
    var right = opts.right || '';
    var title = opts.title || '';
    return '<div class="ios-nav">' +
      '<div class="ios-nav-top">' +
        '<div style="min-width:64px;display:flex">' + left + '</div>' +
        '<div class="ios-nav-title">' + esc(title) + '</div>' +
        '<div style="min-width:64px;display:flex;justify-content:flex-end">' + right + '</div>' +
      '</div>' +
      (opts.below || '') +
    '</div>';
  }

  function renderIOSList() {
    var list = filteredContacts();
    var groups = groupList(list);
    var letters = groups.map(function (g) { return g.letter; });

    var body = '';
    if (!list.length) {
      body = '<div class="ios-empty">' +
        '<div class="ie-title">' + (state.query ? 'Không tìm thấy' : 'Chưa có liên hệ') + '</div>' +
        '<div class="ie-sub">' + (state.query ? 'Thử tìm bằng tên hoặc số điện thoại khác.' : 'Nhấn nút + để thêm liên hệ đầu tiên.') + '</div>' +
      '</div>';
    } else {
      groups.forEach(function (g) {
        body += '<div class="ios-section-head" data-letter="' + g.letter + '">' + g.letter + '</div>';
        g.items.forEach(function (c) {
          body += '<button class="ios-row" type="button" data-action="open-detail" data-id="' + c.id + '">' +
            avatarHTML(c, 'ios-avatar') +
            '<span class="ios-row-main">' +
              '<span class="ios-row-name">' + esc(displayName(c)) + '</span>' +
              (c.company ? '<span class="ios-row-sub">' + esc(c.company) + '</span>' : '') +
            '</span>' +
          '</button>';
        });
      });
    }

    var index = '';
    if (letters.length > 1) {
      index = '<div class="ios-index">' + letters.map(function (L) {
        return '<span data-action="jump" data-letter="' + L + '">' + L + '</span>';
      }).join('') + '</div>';
    }

    var search = '<div class="ios-search-wrap">' +
      '<div class="ios-search">' +
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
        '<input type="text" id="ios-search" placeholder="Tìm kiếm" value="' + esc(state.query) + '" autocomplete="off" />' +
        (state.query ? '<button class="clear-btn" type="button" data-action="clear-search">✕</button>' : '') +
      '</div>' +
    '</div>';

    return '<div class="app" data-os="ios">' +
      statusBar('ios') +
      iosNav({
        title: '',
        left: '',
        right: '<button class="ios-nav-btn ios-nav-btn--right" type="button" data-action="new-contact" aria-label="Thêm liên hệ">' + ICON.plus.replace('<svg', '<svg width="22" height="22"') + '</button>',
        below: '<div class="ios-large-title">Danh bạ</div>' + search
      }) +
      '<div class="app-body">' +
        '<div class="ios-scroll" id="ios-scroll">' + body + '</div>' +
        index +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     iOS — CHI TIẾT
     ------------------------------------------------------------ */

  function renderIOSDetail() {
    var c = getContact(state.selectedId);
    if (!c) return renderIOSList();

    var rows = '';
    (c.phones || []).forEach(function (p) {
      if (!p.value) return;
      rows += '<div class="ios-card-row">' +
        '<div class="ios-card-label">' + esc(p.label) + '</div>' +
        '<button class="ios-card-value" type="button" data-action="call-sheet" data-value="' + esc(p.value) + '">' + esc(p.value) + '</button>' +
      '</div>';
    });
    (c.emails || []).forEach(function (e) {
      if (!e.value) return;
      rows += '<div class="ios-card-row">' +
        '<div class="ios-card-label">' + esc(e.label) + '</div>' +
        '<div class="ios-card-value">' + esc(e.value) + '</div>' +
      '</div>';
    });
    if (c.company) {
      rows += '<div class="ios-card-row">' +
        '<div class="ios-card-label">công ty</div>' +
        '<div class="ios-card-value ios-card-value--plain">' + esc(c.company) + '</div>' +
      '</div>';
    }

    var noteCard = c.note ? '<div class="ios-card">' +
      '<div class="ios-card-row" style="flex-direction:column;gap:4px">' +
        '<div class="ios-card-label" style="min-width:0">ghi chú</div>' +
        '<div class="ios-card-note">' + esc(c.note) + '</div>' +
      '</div>' +
    '</div>' : '';

    return '<div class="app" data-os="ios">' +
      statusBar('ios') +
      iosNav({
        title: '',
        left: '<button class="ios-nav-btn" type="button" data-action="back">' +
          '<svg width="12" height="20" viewBox="0 0 12 20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2L2 10l8 8"/></svg>' +
          '<span style="margin-left:4px">Danh bạ</span></button>',
        right: '<button class="ios-nav-btn ios-nav-btn--right" type="button" data-action="edit-contact">Sửa</button>'
      }) +
      '<div class="app-body">' +
        '<div class="ios-detail">' +
          '<div class="ios-detail-head">' +
            '<div class="ios-detail-avatar" style="' + avatarStyle(c) + '">' + avatarText(c) + '</div>' +
            '<div class="ios-detail-name">' + esc(displayName(c)) + '</div>' +
            (c.company ? '<div class="ios-detail-org">' + esc(c.company) + '</div>' : '') +
            '<div class="ios-actions">' +
              '<button class="ios-action" type="button" data-action="noop">' + ICON.message + '<span>Nhắn tin</span></button>' +
              '<button class="ios-action" type="button" data-action="call-sheet" data-value="' + esc((c.phones[0] || {}).value || '') + '">' + ICON.phone + '<span>Gọi</span></button>' +
              '<button class="ios-action" type="button" data-action="noop">' + ICON.video + '<span>Video</span></button>' +
              '<button class="ios-action" type="button" data-action="noop">' + ICON.mail + '<span>Thư</span></button>' +
            '</div>' +
          '</div>' +
          (rows ? '<div class="ios-card">' + rows + '</div>' : '') +
          noteCard +
          '<div class="ios-danger"><button type="button" data-action="delete-contact">Xoá liên hệ</button></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     iOS — FORM
     ------------------------------------------------------------ */

  function renderIOSForm() {
    var f = state.form;
    var d = f.draft;
    var isNew = f.mode === 'new';

    var phoneRows = d.phones.map(function (p, i) {
      return '<div class="ios-field">' +
        '<input type="tel" data-field="phone" data-index="' + i + '" value="' + esc(p.value) + '" placeholder="số điện thoại" inputmode="tel" />' +
        '<span style="font-size:15px;color:#8a8a8e">' + esc(p.label) + '</span>' +
        (d.phones.length > 1 ? '<button class="ios-remove-btn" type="button" data-action="remove-phone" data-index="' + i + '">−</button>' : '') +
      '</div>';
    }).join('');

    var emailRows = d.emails.map(function (e, i) {
      return '<div class="ios-field">' +
        '<input type="email" data-field="email" data-index="' + i + '" value="' + esc(e.value) + '" placeholder="email" inputmode="email" />' +
        '<span style="font-size:15px;color:#8a8a8e">' + esc(e.label) + '</span>' +
        (d.emails.length > 1 ? '<button class="ios-remove-btn" type="button" data-action="remove-email" data-index="' + i + '">−</button>' : '') +
      '</div>';
    }).join('');

    var draftForAvatar = { firstName: d.firstName, lastName: d.lastName, company: d.company, avatar: d.avatar };

    return '<div class="app" data-os="ios">' +
      statusBar('ios') +
      iosNav({
        title: isNew ? 'Liên hệ mới' : 'Sửa liên hệ',
        left: '<button class="ios-nav-btn" type="button" data-action="form-cancel">Huỷ</button>',
        right: '<button class="ios-nav-btn ios-nav-btn--right" type="button" data-action="form-save" style="font-weight:600">Xong</button>'
      }) +
      '<div class="app-body">' +
        '<div class="ios-form">' +
          '<div class="ios-form-card" style="display:flex;justify-content:center;padding:18px 0">' +
            '<button class="avatar-edit-btn" type="button" data-action="pick-avatar" aria-label="Chọn ảnh đại diện">' +
              '<span class="ios-detail-avatar" style="width:80px;height:80px;font-size:32px;margin:0;' + avatarStyle(draftForAvatar) + '">' + avatarText(draftForAvatar) + '</span>' +
              '<span class="avatar-edit-badge">' + ICON.camera + '</span>' +
            '</button>' +
          '</div>' +
          '<p class="avatar-edit-hint">Chạm vào ảnh để chọn màu hoặc tải ảnh lên</p>' +

          '<div class="ios-form-card">' +
            '<div class="ios-field"><span class="ios-field-label">Họ</span><input type="text" data-field="lastName" value="' + esc(d.lastName) + '" placeholder="Họ và tên đệm" autocomplete="off" /></div>' +
            '<div class="ios-field"><span class="ios-field-label">Tên</span><input type="text" data-field="firstName" value="' + esc(d.firstName) + '" placeholder="Tên" autocomplete="off" /></div>' +
            '<div class="ios-field"><span class="ios-field-label">Công ty</span><input type="text" data-field="company" value="' + esc(d.company) + '" placeholder="công ty" autocomplete="off" /></div>' +
          '</div>' +

          '<div class="ios-form-card">' +
            phoneRows +
            '<button class="ios-add-row" type="button" data-action="add-phone"><span class="plus">+</span> Thêm số</button>' +
          '</div>' +

          '<div class="ios-form-card">' +
            emailRows +
            '<button class="ios-add-row" type="button" data-action="add-email"><span class="plus">+</span> Thêm email</button>' +
          '</div>' +

          '<div class="ios-form-card">' +
            '<div class="ios-field ios-field--stack">' +
              '<span class="ios-field-label">Ghi chú</span>' +
              '<textarea data-field="note" placeholder="Thêm ghi chú" rows="3">' + esc(d.note) + '</textarea>' +
            '</div>' +
          '</div>' +

          (isNew ? '' : '<div class="ios-danger"><button type="button" data-action="delete-contact">Xoá liên hệ</button></div>') +
          '<p class="ios-form-hint">Nhấn <strong>Xong</strong> để lưu liên hệ vào danh bạ trên máy.</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     ANDROID — APP BAR
     ------------------------------------------------------------ */

  function mdAppBar(opts) {
    return '<div class="md-appbar">' +
      '<div class="md-appbar-row">' +
        (opts.back ? '<button class="md-icon-btn" type="button" data-action="back" aria-label="Quay lại">' + ICON.back + '</button>' : '') +
        '<div class="md-appbar-title">' + esc(opts.title || '') + '</div>' +
        (opts.actions || '') +
      '</div>' +
      (opts.below || '') +
    '</div>';
  }

  function mdBottomNav(active) {
    function item(key, icon, label) {
      return '<button class="md-navitem' + (active === key ? ' active' : '') + '" type="button" data-action="tab" data-tab="' + key + '">' +
        '<span class="pill">' + icon + '</span><span>' + label + '</span></button>';
    }
    return '<div class="md-bottomnav">' +
      item('contacts', ICON.contacts, 'Danh bạ') +
      item('favorites', ICON.star, 'Yêu thích') +
      item('recents', ICON.history, 'Nhật ký') +
    '</div>';
  }

  /* ------------------------------------------------------------
     ANDROID — DANH SÁCH
     ------------------------------------------------------------ */

  function renderAndroidList() {
    var list = filteredContacts();
    var groups = groupList(list);

    var body = '';
    if (!list.length) {
      body = '<div class="md-empty">' +
        '<div class="me-title">' + (state.query ? 'Không tìm thấy liên hệ' : 'Danh bạ trống') + '</div>' +
        '<div class="me-sub">' + (state.query ? 'Hãy thử một từ khoá khác.' : 'Nhấn nút + để thêm liên hệ mới.') + '</div>' +
      '</div>';
    } else {
      groups.forEach(function (g) {
        body += '<div class="md-section-head" data-letter="' + g.letter + '">' + g.letter + '</div>';
        g.items.forEach(function (c) {
          var sub = (c.phones && c.phones[0] && c.phones[0].value) || c.company || '';
          body += '<button class="md-row" type="button" data-action="open-detail" data-id="' + c.id + '">' +
            avatarHTML(c, 'md-avatar') +
            '<span class="md-row-main">' +
              '<span class="md-row-name">' + esc(displayName(c)) + '</span>' +
              (sub ? '<span class="md-row-sub">' + esc(sub) + '</span>' : '') +
            '</span>' +
          '</button>';
        });
      });
    }

    var search = '<div class="md-search">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.6-3.6"/></svg>' +
      '<input type="text" id="md-search" placeholder="Tìm trong danh bạ" value="' + esc(state.query) + '" autocomplete="off" />' +
      (state.query ? '<button class="md-icon-btn" style="width:28px;height:28px" type="button" data-action="clear-search">' + ICON.close + '</button>' : '') +
    '</div>';

    return '<div class="app" data-os="android">' +
      statusBar('android') +
      mdAppBar({
        title: 'Danh bạ',
        actions: '<button class="md-icon-btn" type="button" data-action="focus-search" aria-label="Tìm kiếm">' + ICON.search + '</button>' +
                 '<button class="md-icon-btn" type="button" data-action="noop" aria-label="Tuỳ chọn khác">' + ICON.more + '</button>',
        below: search
      }) +
      '<div class="app-body">' +
        '<div class="md-scroll" id="md-scroll">' + body + '</div>' +
        '<button class="md-fab" type="button" data-action="new-contact" aria-label="Thêm liên hệ">' + ICON.plus + '</button>' +
        mdBottomNav('contacts') +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     ANDROID — YÊU THÍCH
     ------------------------------------------------------------ */

  function renderAndroidFavorites() {
    var list = favoriteContacts();

    var body = '';
    if (!list.length) {
      body = '<div class="md-empty">' +
        '<div class="me-title">Chưa có liên hệ yêu thích</div>' +
        '<div class="me-sub">Mở một liên hệ rồi nhấn ngôi sao ☆ trên thanh trên cùng để thêm vào Yêu thích.</div>' +
      '</div>';
    } else {
      body += '<div class="md-section-head">' + list.length + ' liên hệ yêu thích</div>';
      list.forEach(function (c) {
        var sub = (c.phones && c.phones[0] && c.phones[0].value) || c.company || '';
        body += '<button class="md-row" type="button" data-action="open-detail" data-id="' + c.id + '">' +
          avatarHTML(c, 'md-avatar') +
          '<span class="md-row-main">' +
            '<span class="md-row-name">' + esc(displayName(c)) + '</span>' +
            (sub ? '<span class="md-row-sub">' + esc(sub) + '</span>' : '') +
          '</span>' +
          '<span class="md-row-star">' + ICON.starFill + '</span>' +
        '</button>';
      });
    }

    return '<div class="app" data-os="android">' +
      statusBar('android') +
      mdAppBar({
        title: 'Yêu thích',
        actions: '<button class="md-icon-btn" type="button" data-action="noop" aria-label="Tuỳ chọn khác">' + ICON.more + '</button>'
      }) +
      '<div class="app-body">' +
        '<div class="md-scroll" id="md-scroll">' + body + '</div>' +
        '<button class="md-fab" type="button" data-action="new-contact" aria-label="Thêm liên hệ">' + ICON.plus + '</button>' +
        mdBottomNav('favorites') +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     ANDROID — NHẬT KÝ (lịch sử cuộc gọi)
     ------------------------------------------------------------ */

  function renderAndroidRecents() {
    var items = state.recents.slice().sort(function (a, b) { return b.at - a.at; });

    var body = '';
    if (!items.length) {
      body = '<div class="md-empty">' +
        '<div class="me-title">Nhật ký trống</div>' +
        '<div class="me-sub">Các cuộc gọi bạn thực hiện trong mô phỏng sẽ được ghi lại ở đây.</div>' +
      '</div>';
    } else {
      var lastDay = null;
      items.forEach(function (r) {
        var k = dayKey(r.at);
        if (k !== lastDay) {
          lastDay = k;
          body += '<div class="md-section-head">' + esc(dayLabel(r.at)) + '</div>';
        }
        var c = r.contactId ? getContact(r.contactId) : null;
        var av = c ? avatarHTML(c, 'md-avatar') : '<span class="md-avatar" style="background:#90a4ae">' + esc((r.name || '?').charAt(0).toUpperCase()) + '</span>';
        body += '<button class="md-row md-row--recent" type="button" ' + (c ? 'data-action="open-detail" data-id="' + c.id + '"' : 'data-action="noop"') + '>' +
          av +
          '<span class="md-row-main">' +
            '<span class="md-row-name">' + esc(r.name || 'Không rõ') + '</span>' +
            '<span class="md-row-sub md-row-sub--call">' + ICON.callIn + '<span>' + esc(r.phone || '') + '</span></span>' +
          '</span>' +
          '<span class="md-recent-time">' + timeOf(r.at) + '</span>' +
        '</button>';
      });
    }

    return '<div class="app" data-os="android">' +
      statusBar('android') +
      mdAppBar({
        title: 'Nhật ký',
        actions: (items.length ? '<button class="md-icon-btn" type="button" data-action="clear-recents" aria-label="Xoá nhật ký">' + ICON.trash + '</button>' : '') +
                 '<button class="md-icon-btn" type="button" data-action="noop" aria-label="Tuỳ chọn khác">' + ICON.more + '</button>'
      }) +
      '<div class="app-body">' +
        '<div class="md-scroll" id="md-scroll">' + body + '</div>' +
        mdBottomNav('recents') +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     ANDROID — CHI TIẾT
     ------------------------------------------------------------ */

  function renderAndroidDetail() {
    var c = getContact(state.selectedId);
    if (!c) return renderAndroidList();

    var phoneSection = '';
    if ((c.phones || []).some(function (p) { return p.value; })) {
      phoneSection = '<div class="md-section">' +
        '<div class="md-section-title">Số điện thoại</div>' +
        c.phones.filter(function (p) { return p.value; }).map(function (p) {
          return '<div class="md-info-row">' +
            '<span class="md-info-icon">' + ICON.phone + '</span>' +
            '<div class="md-info-main">' +
              '<div class="md-info-value">' + esc(p.value) + '</div>' +
              '<div class="md-info-label">' + esc(p.label) + '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    var emailSection = '';
    if ((c.emails || []).some(function (e) { return e.value; })) {
      emailSection = '<div class="md-section">' +
        '<div class="md-section-title">Email</div>' +
        c.emails.filter(function (e) { return e.value; }).map(function (e) {
          return '<div class="md-info-row">' +
            '<span class="md-info-icon">' + ICON.mail + '</span>' +
            '<div class="md-info-main">' +
              '<div class="md-info-value">' + esc(e.value) + '</div>' +
              '<div class="md-info-label">' + esc(e.label) + '</div>' +
            '</div>' +
          '</div>';
        }).join('') +
      '</div>';
    }

    var companySection = c.company ? '<div class="md-section">' +
      '<div class="md-section-title">Công ty</div>' +
      '<div class="md-info-row">' +
        '<span class="md-info-icon">' + ICON.building + '</span>' +
        '<div class="md-info-main"><div class="md-info-value">' + esc(c.company) + '</div></div>' +
      '</div>' +
    '</div>' : '';

    var noteSection = c.note ? '<div class="md-section">' +
      '<div class="md-section-title">Ghi chú</div>' +
      '<div class="md-info-row">' +
        '<span class="md-info-icon">' + ICON.note + '</span>' +
        '<div class="md-info-main"><div class="md-info-note">' + esc(c.note) + '</div></div>' +
      '</div>' +
    '</div>' : '';

    return '<div class="app" data-os="android">' +
      statusBar('android') +
      mdAppBar({
        title: '',
        back: true,
        actions: '<button class="md-icon-btn' + (c.favorite ? ' md-icon-btn--star' : '') + '" type="button" data-action="toggle-favorite" aria-label="Yêu thích">' + (c.favorite ? ICON.starFill : ICON.star) + '</button>' +
                 '<button class="md-icon-btn" type="button" data-action="toggle-menu" aria-label="Tuỳ chọn">' + ICON.more + '</button>'
      }) +
      '<div class="app-body">' +
        '<div class="md-detail">' +
          '<div class="md-detail-head">' +
            '<div class="md-detail-avatar" style="' + avatarStyle(c) + '">' + avatarText(c) + '</div>' +
            '<div class="md-detail-name">' + esc(displayName(c)) + '</div>' +
            (c.company ? '<div class="md-detail-org">' + esc(c.company) + '</div>' : '') +
            '<div class="md-actions">' +
              '<button class="md-action" type="button" data-action="call-contact">' + ICON.phone + '<span>Gọi</span></button>' +
              '<button class="md-action" type="button" data-action="noop">' + ICON.message + '<span>Nhắn tin</span></button>' +
              '<button class="md-action" type="button" data-action="noop">' + ICON.video + '<span>Video</span></button>' +
              '<button class="md-action" type="button" data-action="noop">' + ICON.mail + '<span>Email</span></button>' +
            '</div>' +
          '</div>' +
          phoneSection + emailSection + companySection + noteSection +
          '<div class="md-section">' +
            '<button class="md-danger-row" type="button" data-action="delete-contact">' + ICON.trash + '<span>Xoá liên hệ</span></button>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     ANDROID — FORM
     ------------------------------------------------------------ */

  function renderAndroidForm() {
    var f = state.form;
    var d = f.draft;
    var isNew = f.mode === 'new';

    var phoneFields = d.phones.map(function (p, i) {
      return '<div class="md-field">' +
        '<div class="md-field-inner">' +
          '<span class="md-field-icon">' + ICON.phone + '</span>' +
          '<input type="tel" data-field="phone" data-index="' + i + '" value="' + esc(p.value) + '" placeholder="Số điện thoại" inputmode="tel" />' +
          (d.phones.length > 1 ? '<button class="md-remove-field" type="button" data-action="remove-phone" data-index="' + i + '" aria-label="Xoá số">' + ICON.close + '</button>' : '') +
        '</div>' +
        '<div class="md-field-label">' + esc(p.label) + '</div>' +
      '</div>';
    }).join('');

    var emailFields = d.emails.map(function (e, i) {
      return '<div class="md-field">' +
        '<div class="md-field-inner">' +
          '<span class="md-field-icon">' + ICON.mail + '</span>' +
          '<input type="email" data-field="email" data-index="' + i + '" value="' + esc(e.value) + '" placeholder="Email" inputmode="email" />' +
          (d.emails.length > 1 ? '<button class="md-remove-field" type="button" data-action="remove-email" data-index="' + i + '" aria-label="Xoá email">' + ICON.close + '</button>' : '') +
        '</div>' +
        '<div class="md-field-label">' + esc(e.label) + '</div>' +
      '</div>';
    }).join('');

    var draftForAvatar = { firstName: d.firstName, lastName: d.lastName, company: d.company, avatar: d.avatar };

    return '<div class="app" data-os="android">' +
      statusBar('android') +
      mdAppBar({
        title: isNew ? 'Liên hệ mới' : 'Sửa liên hệ',
        back: true,
        actions: '<button class="md-icon-btn" type="button" data-action="form-save" style="width:auto;padding:0 14px;font-size:14.5px;font-weight:600;color:#0b57d0">Lưu</button>'
      }) +
      '<div class="app-body">' +
        '<div class="md-form">' +
          '<div class="md-form-head">' +
            '<button class="avatar-edit-btn" type="button" data-action="pick-avatar" aria-label="Chọn ảnh đại diện">' +
              '<span class="md-form-avatar" style="' + avatarStyle(draftForAvatar) + '">' + avatarText(draftForAvatar) + '</span>' +
              '<span class="avatar-edit-badge avatar-edit-badge--md">' + ICON.camera + '</span>' +
            '</button>' +
            '<div class="md-form-avatar-hint">Chạm để thêm ảnh</div>' +
          '</div>' +

          '<div class="md-field">' +
            '<div class="md-field-inner">' +
              '<span class="md-field-icon">' + ICON.person + '</span>' +
              '<input type="text" data-field="lastName" value="' + esc(d.lastName) + '" placeholder="Họ và tên đệm" autocomplete="off" />' +
            '</div>' +
            '<div class="md-field-label">Họ</div>' +
          '</div>' +

          '<div class="md-field">' +
            '<div class="md-field-inner">' +
              '<span class="md-field-icon">' + ICON.person + '</span>' +
              '<input type="text" data-field="firstName" value="' + esc(d.firstName) + '" placeholder="Tên" autocomplete="off" />' +
            '</div>' +
            '<div class="md-field-label">Tên</div>' +
          '</div>' +

          '<div class="md-field">' +
            '<div class="md-field-inner">' +
              '<span class="md-field-icon">' + ICON.building + '</span>' +
              '<input type="text" data-field="company" value="' + esc(d.company) + '" placeholder="Công ty" autocomplete="off" />' +
            '</div>' +
            '<div class="md-field-label">Công ty</div>' +
          '</div>' +

          phoneFields +
          '<button class="md-add-field" type="button" data-action="add-phone">' + ICON.plus + '<span>Thêm số điện thoại</span></button>' +

          emailFields +
          '<button class="md-add-field" type="button" data-action="add-email">' + ICON.plus + '<span>Thêm email</span></button>' +

          '<div class="md-field md-field--stack">' +
            '<div class="md-field-inner">' +
              '<span class="md-field-icon">' + ICON.note + '</span>' +
              '<textarea data-field="note" placeholder="Ghi chú" rows="3">' + esc(d.note) + '</textarea>' +
            '</div>' +
            '<div class="md-field-label">Ghi chú</div>' +
          '</div>' +

          (isNew ? '' : '<div class="md-section" style="margin-top:12px">' +
            '<button class="md-danger-row" type="button" data-action="delete-contact">' + ICON.trash + '<span>Xoá liên hệ</span></button>' +
          '</div>') +

          '<p class="md-form-hint">Nhấn <strong>Lưu</strong> để lưu liên hệ vào danh bạ trên máy.</p>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     BỘ CHỌN ẢNH ĐẠI DIỆN
     ------------------------------------------------------------ */

  function renderAvatarPicker() {
    var d = state.form.draft;
    var draftForAvatar = { firstName: d.firstName, lastName: d.lastName, company: d.company, avatar: d.avatar };
    var isIOS = state.os === 'ios';

    var swatches = AVATAR_COLORS.map(function (col) {
      var on = d.avatar && d.avatar.kind === 'color' && d.avatar.value === col;
      return '<button class="swatch' + (on ? ' on' : '') + '" type="button" data-action="pick-color" data-color="' + col + '" style="background:' + col + '" aria-label="Màu ' + col + '">' +
        (on ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>' : '') +
      '</button>';
    }).join('');

    var inner =
      '<div class="avatar-picker-head">' +
        '<div class="avatar-picker-preview" style="' + avatarStyle(draftForAvatar) + '">' + avatarText(draftForAvatar) + '</div>' +
        '<div class="avatar-picker-title">Ảnh đại diện</div>' +
      '</div>' +
      '<div class="avatar-picker-label">Chọn màu</div>' +
      '<div class="swatch-grid">' + swatches + '</div>' +
      '<div class="avatar-picker-label">Hoặc dùng ảnh từ máy</div>' +
      '<button class="avatar-picker-action" type="button" data-action="upload-avatar">' + ICON.camera + '<span>Tải ảnh lên từ máy</span></button>' +
      (d.avatar ? '<button class="avatar-picker-action avatar-picker-action--danger" type="button" data-action="clear-avatar">' + ICON.trash + '<span>Bỏ ảnh đại diện</span></button>' : '');

    if (isIOS) {
      return '<div class="sheet-backdrop" data-action="close-overlay">' +
        '<div class="ios-sheet" data-stop="1">' +
          '<div class="ios-sheet-group avatar-picker">' + inner + '</div>' +
          '<div class="ios-sheet-group">' +
            '<button class="ios-sheet-btn ios-sheet-btn--bold" type="button" data-action="close-overlay">Xong</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    return '<div class="sheet-backdrop sheet-backdrop--md" data-action="close-overlay">' +
      '<div class="md-sheet" data-stop="1">' +
        '<div class="md-sheet-handle"></div>' +
        '<div class="avatar-picker avatar-picker--md">' + inner + '</div>' +
        '<button class="md-sheet-done" type="button" data-action="close-overlay">Xong</button>' +
      '</div>' +
    '</div>';
  }

  /* ------------------------------------------------------------
     LỚP PHỦ (SHEET / ALERT / MENU / SNACKBAR)
     ------------------------------------------------------------ */

  function renderOverlay() {
    var o = state.overlay;
    var html = '';

    if (o && o.type === 'avatar') {
      html += renderAvatarPicker();
    }

    if (o && o.type === 'ios-sheet') {
      html += '<div class="sheet-backdrop" data-action="close-overlay">' +
        '<div class="ios-sheet" data-stop="1">' +
          '<div class="ios-sheet-group">' +
            '<div class="ios-sheet-title">' + esc(o.title || '') + '</div>' +
            (o.actions || []).map(function (a, i) {
              return '<button class="ios-sheet-btn ' + (a.danger ? 'ios-sheet-btn--danger' : '') + '" type="button" data-action="sheet-pick" data-index="' + i + '">' + esc(a.label) + '</button>';
            }).join('') +
          '</div>' +
          '<div class="ios-sheet-group">' +
            '<button class="ios-sheet-btn ios-sheet-btn--bold" type="button" data-action="close-overlay">Huỷ</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    if (o && o.type === 'ios-alert') {
      html += '<div class="ios-alert" data-action="close-overlay">' +
        '<div class="ios-alert-box" data-stop="1">' +
          '<div class="ios-alert-body">' +
            '<div class="ios-alert-title">' + esc(o.title || '') + '</div>' +
            (o.message ? '<div class="ios-alert-msg">' + esc(o.message) + '</div>' : '') +
          '</div>' +
          '<div class="ios-alert-actions">' +
            '<button type="button" data-action="close-overlay">' + esc(o.cancelLabel || 'Huỷ') + '</button>' +
            '<button type="button" class="' + (o.danger ? 'danger' : 'primary') + '" data-action="alert-confirm">' + esc(o.confirmLabel || 'OK') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    if (o && o.type === 'md-dialog') {
      html += '<div class="md-dialog-backdrop" data-action="close-overlay">' +
        '<div class="md-dialog" data-stop="1">' +
          '<div class="md-dialog-title">' + esc(o.title || '') + '</div>' +
          (o.message ? '<div class="md-dialog-msg">' + esc(o.message) + '</div>' : '') +
          '<div class="md-dialog-actions">' +
            '<button type="button" data-action="close-overlay">' + esc(o.cancelLabel || 'Huỷ') + '</button>' +
            '<button type="button" class="' + (o.danger ? 'danger' : '') + '" data-action="alert-confirm">' + esc(o.confirmLabel || 'OK') + '</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    }

    if (o && o.type === 'md-menu') {
      var c = getContact(state.selectedId);
      html += '<div class="sheet-backdrop" style="background:rgba(0,0,0,0.18);align-items:flex-start;justify-content:flex-end;padding:56px 12px 0 0" data-action="close-overlay">' +
        '<div class="md-menu" data-stop="1">' +
          '<button type="button" data-action="edit-contact">' + ICON.edit + '<span>Sửa</span></button>' +
          '<button type="button" data-action="toggle-favorite">' + (c && c.favorite ? ICON.starFill : ICON.star) + '<span>' + (c && c.favorite ? 'Bỏ yêu thích' : 'Thêm vào Yêu thích') + '</span></button>' +
          '<button type="button" data-action="noop">' + ICON.share + '<span>Chia sẻ</span></button>' +
          '<button type="button" class="danger" data-action="delete-contact">' + ICON.trash + '<span>Xoá</span></button>' +
        '</div>' +
      '</div>';
    }

    if (state.snackbar) {
      html += '<div class="md-snackbar">' +
        '<span>' + esc(state.snackbar.text) + '</span>' +
        (state.snackbar.action ? '<button type="button" data-action="snack-undo">' + esc(state.snackbar.action) + '</button>' : '') +
      '</div>';
    }

    return html;
  }

  /* ------------------------------------------------------------
     RENDER
     ------------------------------------------------------------ */

  /* Cờ: hiệu ứng mở app chỉ chạy MỘT LẦN, không phát lại mỗi lần render. */
  var animateApp = false;

  function buildHTML() {
    var html = '';
    if (state.screen === 'home') {
      html = renderHome();
    } else if (state.os === 'ios') {
      if (state.screen === 'list') html = renderIOSList();
      else if (state.screen === 'detail') html = renderIOSDetail();
      else if (state.screen === 'form') html = renderIOSForm();
    } else {
      if (state.screen === 'list') {
        if (state.tab === 'favorites') html = renderAndroidFavorites();
        else if (state.tab === 'recents') html = renderAndroidRecents();
        else html = renderAndroidList();
      }
      else if (state.screen === 'detail') html = renderAndroidDetail();
      else if (state.screen === 'form') html = renderAndroidForm();
    }

    return html + renderOverlay();
  }

  function render() {
    els.screen.innerHTML = buildHTML();
    if (animateApp) {
      var appEl = els.screen.querySelector('.app');
      if (appEl) appEl.classList.add('is-entering');
      animateApp = false;
    }
    els.device.setAttribute('data-os', state.os);
    els.island.style.display = state.os === 'ios' ? 'block' : 'none';
    els.punch.style.display = state.os === 'android' ? 'block' : 'none';
    els.labTitle.textContent = state.os === 'ios' ? 'iOS' : 'Android';
    els.labHint.innerHTML = state.screen === 'home'
      ? 'Chạm vào biểu tượng <strong>Danh bạ</strong> trên màn hình để bắt đầu.'
      : 'Thực hành: nhấn <strong>+</strong> để thêm liên hệ, chạm một dòng để xem chi tiết, nhấn <strong>Sửa</strong> để chỉnh.';

    bindInputs();
    fitDevice();
  }

  /* Cập nhật CHỈ phần danh sách khi gõ tìm kiếm — không dựng lại cả màn hình,
     nên không mất focus và không chớp tắt. */
  function refreshList() {
    if (state.screen !== 'list') return;
    var tmp = document.createElement('div');
    tmp.innerHTML = buildHTML();

    var newScroll = tmp.querySelector('#ios-scroll, #md-scroll');
    var oldScroll = els.screen.querySelector('#ios-scroll, #md-scroll');
    if (newScroll && oldScroll) oldScroll.innerHTML = newScroll.innerHTML;

    var oldIdx = els.screen.querySelector('.ios-index');
    if (oldIdx && oldIdx.parentNode) oldIdx.parentNode.removeChild(oldIdx);
    var newIdx = tmp.querySelector('.ios-index');
    if (newIdx) {
      var ab = els.screen.querySelector('.app-body');
      if (ab) ab.appendChild(newIdx);
    }

    var newClear = tmp.querySelector('[data-action="clear-search"]');
    var oldClear = els.screen.querySelector('[data-action="clear-search"]');
    if (newClear && !oldClear) {
      var wrap = els.screen.querySelector('.ios-search, .md-search');
      if (wrap) wrap.appendChild(newClear);
    } else if (!newClear && oldClear && oldClear.parentNode) {
      oldClear.parentNode.removeChild(oldClear);
    }
  }

  function bindInputs() {
    var search = els.screen.querySelector('#ios-search, #md-search');
    if (search) {
      search.addEventListener('input', function () {
        state.query = search.value;
        refreshList();
      });
    }

    if (state.screen === 'form' && state.form) {
      var d = state.form.draft;
      els.screen.querySelectorAll('[data-field]').forEach(function (input) {
        input.addEventListener('input', function () {
          var f = input.getAttribute('data-field');
          if (f === 'phone') d.phones[+input.getAttribute('data-index')].value = input.value;
          else if (f === 'email') d.emails[+input.getAttribute('data-index')].value = input.value;
          else d[f] = input.value;
        });
      });
    }
  }

  /* ------------------------------------------------------------
     HÀNH ĐỘNG
     ------------------------------------------------------------ */

  function openContacts() {
    state.screen = 'list';
    state.tab = 'contacts';
    state.query = '';
    state.selectedId = null;
    animateApp = true;
    render();
  }

  function goBack() {
    if (state.screen === 'form') {
      state.form = null;
      state.screen = state.selectedId ? 'detail' : 'list';
      render();
      return;
    }
    if (state.screen === 'detail') {
      state.screen = 'list';
      state.selectedId = null;
      render();
      return;
    }
    if (state.screen === 'list') {
      state.screen = 'home';
      state.query = '';
      render();
    }
  }

  function newContact() {
    state.form = {
      mode: 'new',
      id: null,
      draft: { firstName: '', lastName: '', company: '', phones: [{ label: 'di động', value: '' }], emails: [], note: '', avatar: null }
    };
    state.screen = 'form';
    render();
    var first = els.screen.querySelector('[data-field="lastName"]');
    if (first) setTimeout(function () { first.focus(); }, 60);
  }

  function editContact() {
    var c = getContact(state.selectedId);
    if (!c) return;
    state.overlay = null;
    state.form = {
      mode: 'edit',
      id: c.id,
      draft: {
        firstName: c.firstName,
        lastName: c.lastName,
        company: c.company,
        phones: c.phones.length ? c.phones.map(function (p) { return { label: p.label, value: p.value }; }) : [{ label: 'di động', value: '' }],
        emails: c.emails.map(function (e) { return { label: e.label, value: e.value }; }),
        note: c.note,
        avatar: c.avatar ? { kind: c.avatar.kind, value: c.avatar.value } : null
      }
    };
    state.screen = 'form';
    render();
  }

  function saveForm() {
    var f = state.form;
    if (!f) return;
    var d = f.draft;
    var name = (d.lastName + ' ' + d.firstName).trim();
    var hasPhone = d.phones.some(function (p) { return p.value.trim(); });
    if (!name && !d.company.trim() && !hasPhone) {
      showToast('Hãy nhập ít nhất tên hoặc số điện thoại.');
      return;
    }

    var payload = {
      firstName: d.firstName.trim(),
      lastName: d.lastName.trim(),
      company: d.company.trim(),
      phones: d.phones.filter(function (p) { return p.value.trim(); }).map(function (p) { return { label: p.label, value: p.value.trim() }; }),
      emails: d.emails.filter(function (e) { return e.value.trim(); }).map(function (e) { return { label: e.label, value: e.value.trim() }; }),
      note: d.note.trim(),
      avatar: d.avatar ? { kind: d.avatar.kind, value: d.avatar.value } : null
    };

    if (f.mode === 'new') {
      var c = normalizeContact(payload);
      c.id = uid();
      state.contacts.push(c);
      save();
      state.selectedId = c.id;
      state.form = null;
      state.screen = 'detail';
      render();
      showToast('Đã lưu liên hệ mới');
    } else {
      var target = getContact(f.id);
      if (target) {
        target.firstName = payload.firstName;
        target.lastName = payload.lastName;
        target.company = payload.company;
        target.phones = payload.phones;
        target.emails = payload.emails;
        target.note = payload.note;
        target.avatar = payload.avatar;
        save();
      }
      state.form = null;
      state.screen = 'detail';
      render();
      showToast('Đã cập nhật liên hệ');
    }
  }

  function askDelete() {
    var c = getContact(state.selectedId);
    if (!c) return;
    if (state.os === 'ios') {
      state.overlay = {
        type: 'ios-alert',
        title: 'Xoá liên hệ?',
        message: displayName(c) + ' sẽ bị xoá khỏi danh bạ trên máy.',
        cancelLabel: 'Huỷ',
        confirmLabel: 'Xoá',
        danger: true
      };
    } else {
      state.overlay = {
        type: 'md-dialog',
        title: 'Xoá liên hệ?',
        message: 'Liên hệ "' + displayName(c) + '" sẽ bị xoá khỏi danh bạ trên máy.',
        cancelLabel: 'Huỷ',
        confirmLabel: 'Xoá',
        danger: true
      };
    }
    render();
  }

  function doDelete() {
    var id = state.selectedId;
    var c = getContact(id);
    if (!c) return;
    var backup = JSON.parse(JSON.stringify(c));
    var idx = state.contacts.findIndex(function (x) { return x.id === id; });
    state.contacts = state.contacts.filter(function (x) { return x.id !== id; });
    save();
    state.overlay = null;
    state.form = null;
    state.selectedId = null;
    state.screen = 'list';
    render();

    if (state.os === 'android') {
      state.snackbar = { text: 'Đã xoá ' + displayName(backup), action: 'HOÀN TÁC', backup: backup, idx: idx };
      render();
      clearTimeout(snackTimer);
      snackTimer = setTimeout(function () {
        state.snackbar = null;
        render();
      }, 5000);
    } else {
      showToast('Đã xoá liên hệ');
    }
  }

  function undoDelete() {
    if (!state.snackbar || !state.snackbar.backup) return;
    var b = state.snackbar.backup;
    state.contacts.splice(Math.max(0, state.snackbar.idx), 0, b);
    save();
    state.snackbar = null;
    render();
    showToast('Đã khôi phục liên hệ');
  }

  function callSheet(value) {
    if (!value) {
      showToast('Liên hệ này chưa có số điện thoại.');
      return;
    }
    state.overlay = {
      type: 'ios-sheet',
      title: value,
      actions: [
        { label: 'Gọi di động' },
        { label: 'Nhắn tin' },
        { label: 'Gọi FaceTime' }
      ]
    };
    render();
  }

  function logCall(c, phone) {
    if (!c) return;
    state.recents.unshift({
      id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      contactId: c.id,
      name: displayName(c),
      phone: phone || ((c.phones[0] || {}).value || ''),
      at: Date.now(),
      type: 'call'
    });
    saveRecents();
  }

  function callContact() {
    var c = getContact(state.selectedId);
    if (!c) return;
    var phone = (c.phones[0] || {}).value || '';
    if (!phone) {
      showToast('Liên hệ này chưa có số điện thoại.');
      return;
    }
    logCall(c, phone);
    render();
    showToast('Mô phỏng: đã ghi cuộc gọi vào Nhật ký.');
  }

  function toggleFavorite() {
    var c = getContact(state.selectedId);
    if (!c) return;
    c.favorite = !c.favorite;
    save();
    state.overlay = null;
    render();
    showToast(c.favorite ? 'Đã thêm vào Yêu thích' : 'Đã bỏ khỏi Yêu thích');
  }

  function clearRecents() {
    state.overlay = {
      type: 'md-dialog',
      title: 'Xoá nhật ký?',
      message: 'Toàn bộ lịch sử cuộc gọi trong mô phỏng sẽ bị xoá.',
      cancelLabel: 'Huỷ',
      confirmLabel: 'Xoá',
      danger: true,
      onConfirm: 'clear-recents'
    };
    render();
  }

  function doClearRecents() {
    state.recents = [];
    saveRecents();
    state.overlay = null;
    render();
    showToast('Đã xoá nhật ký');
  }

  function jumpTo(letter) {
    var el = els.screen.querySelector('[data-letter="' + letter + '"]');
    if (el) el.scrollIntoView({ block: 'start' });
  }

  function showToast(msg) {
    els.toast.textContent = msg;
    els.toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      els.toast.classList.remove('show');
    }, 2200);
  }

  function resetData() {
    state.overlay = {
      type: state.os === 'ios' ? 'ios-alert' : 'md-dialog',
      title: 'Đặt lại dữ liệu?',
      message: 'Toàn bộ liên hệ sẽ trở về danh sách mẫu ban đầu.',
      cancelLabel: 'Huỷ',
      confirmLabel: 'Đặt lại',
      danger: true,
      onConfirm: 'reset'
    };
    render();
  }

  function doReset() {
    state.contacts = SEED.map(function (c) {
      var n = normalizeContact(c);
      n.id = uid();
      return n;
    });
    save();
    state.recents = [];
    saveRecents();
    state.overlay = null;
    state.screen = 'home';
    state.tab = 'contacts';
    state.selectedId = null;
    state.query = '';
    render();
    showToast('Đã đặt lại dữ liệu mẫu');
  }

  /* ------------------------------------------------------------
     ẢNH ĐẠI DIỆN — chọn màu / tải ảnh
     ------------------------------------------------------------ */

  function openAvatarPicker() {
    if (!state.form) return;
    state.overlay = { type: 'avatar' };
    render();
  }

  function pickColor(col) {
    if (!state.form) return;
    state.form.draft.avatar = { kind: 'color', value: col };
    render();
  }

  function clearAvatar() {
    if (!state.form) return;
    state.form.draft.avatar = null;
    render();
  }

  function triggerUpload() {
    var input = document.getElementById('avatar-file');
    if (!input) return;
    input.value = '';
    input.click();
  }

  function readImageFile(file, cb) {
    if (!file || !/^image\//.test(file.type)) {
      showToast('Vui lòng chọn một tệp ảnh.');
      return;
    }
    var reader = new FileReader();
    reader.onerror = function () { showToast('Không đọc được tệp ảnh.'); };
    reader.onload = function () {
      var img = new Image();
      img.onerror = function () { showToast('Tệp ảnh không hợp lệ.'); };
      img.onload = function () {
        try {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          var side = Math.min(w, h);
          var out = Math.min(320, side);
          var cv = document.createElement('canvas');
          cv.width = out;
          cv.height = out;
          var ctx = cv.getContext('2d');
          ctx.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out);
          cb(cv.toDataURL('image/jpeg', 0.85));
        } catch (e) {
          showToast('Không xử lý được ảnh này.');
        }
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ------------------------------------------------------------
     SỰ KIỆN
     ------------------------------------------------------------ */

  function handleAction(action, el) {
    switch (action) {
      case 'open-contacts': openContacts(); break;
      case 'back': goBack(); break;
      case 'new-contact': newContact(); break;
      case 'edit-contact': editContact(); break;
      case 'form-save': saveForm(); break;
      case 'form-cancel':
        state.form = null;
        state.screen = state.selectedId ? 'detail' : 'list';
        render();
        break;
      case 'open-detail':
        state.selectedId = el.getAttribute('data-id');
        state.screen = 'detail';
        render();
        break;
      case 'delete-contact': askDelete(); break;
      case 'alert-confirm':
        if (state.overlay && state.overlay.onConfirm === 'reset') doReset();
        else if (state.overlay && state.overlay.onConfirm === 'clear-recents') doClearRecents();
        else doDelete();
        break;
      case 'close-overlay':
        state.overlay = null;
        render();
        break;
      case 'sheet-pick': {
        var idx = +el.getAttribute('data-index');
        var c0 = getContact(state.selectedId);
        state.overlay = null;
        if (idx === 0 && c0) {
          logCall(c0, (c0.phones[0] || {}).value || '');
          render();
          showToast('Mô phỏng: đã ghi cuộc gọi vào Nhật ký.');
        } else {
          render();
          showToast('Đây là mô phỏng — chức năng này chưa được bật.');
        }
        break;
      }
      case 'call-sheet': callSheet(el.getAttribute('data-value')); break;
      case 'call-contact': callContact(); break;
      case 'toggle-favorite': toggleFavorite(); break;
      case 'clear-recents': clearRecents(); break;
      case 'tab':
        state.tab = el.getAttribute('data-tab');
        state.query = '';
        state.screen = 'list';
        render();
        break;
      case 'clear-search':
        state.query = '';
        render();
        break;
      case 'jump': jumpTo(el.getAttribute('data-letter')); break;
      case 'add-phone':
        state.form.draft.phones.push({ label: 'di động', value: '' });
        render();
        focusLast('phone');
        break;
      case 'add-email':
        state.form.draft.emails.push({ label: 'nhà riêng', value: '' });
        render();
        focusLast('email');
        break;
      case 'remove-phone': {
        var pi = +el.getAttribute('data-index');
        state.form.draft.phones.splice(pi, 1);
        render();
        break;
      }
      case 'remove-email': {
        var ei = +el.getAttribute('data-index');
        state.form.draft.emails.splice(ei, 1);
        render();
        break;
      }
      case 'toggle-menu':
        state.overlay = state.overlay && state.overlay.type === 'md-menu' ? null : { type: 'md-menu' };
        render();
        break;
      case 'snack-undo': undoDelete(); break;
      case 'focus-search': {
        var s = els.screen.querySelector('#md-search');
        if (s) s.focus();
        break;
      }
      case 'pick-avatar': openAvatarPicker(); break;
      case 'pick-color': pickColor(el.getAttribute('data-color')); break;
      case 'clear-avatar': clearAvatar(); break;
      case 'upload-avatar': triggerUpload(); break;
      case 'noop':
        showToast('Đây là mô phỏng — chức năng này chưa được bật.');
        break;
      default: break;
    }
  }

  function focusLast(field) {
    var nodes = els.screen.querySelectorAll('[data-field="' + field + '"]');
    if (nodes.length) {
      var last = nodes[nodes.length - 1];
      setTimeout(function () { last.focus(); }, 40);
    }
  }

  function bindGlobal() {
    els.screen.addEventListener('click', function (e) {
      var stop = e.target.closest('[data-stop]');
      var target = e.target.closest('[data-action]');
      if (!target) return;
      /* Bấm ra vùng nền (ngoài khối data-stop) thì bỏ qua, để lớp phủ tự đóng. */
      if (stop && !stop.contains(target)) return;
      var action = target.getAttribute('data-action');
      if (action === 'noop') { e.preventDefault(); }
      handleAction(action, target);
    });

    document.getElementById('btn-reset').addEventListener('click', resetData);

    var fileInput = document.getElementById('avatar-file');
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        var file = fileInput.files && fileInput.files[0];
        if (!file) return;
        readImageFile(file, function (dataUrl) {
          if (!state.form) return;
          state.form.draft.avatar = { kind: 'photo', value: dataUrl };
          render();
          showToast('Đã thêm ảnh đại diện');
        });
      });
    }

    window.addEventListener('resize', scheduleFit);
    window.addEventListener('orientationchange', function () {
      /* Trình duyệt đổi kích thước sau khi xoay xong — đo lại vài nhịp. */
      scheduleFit();
      setTimeout(scheduleFit, 120);
      setTimeout(scheduleFit, 400);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', scheduleFit);
    }
    /* Khi đổi OS, khung máy đổi kích thước có transition 0.3s → đo lại sau đó. */
    els.device.addEventListener('transitionend', function (e) {
      if (e.propertyName === 'width' || e.propertyName === 'height') scheduleFit();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(scheduleFit).observe(els.deviceWrap);
    }
  }

  var fitRaf = 0;

  /* Thu/phóng khung thiết bị sao cho LUÔN hiện trọn trong màn hình,
     dù người dùng để màn hình dọc hay ngang. */
  function fitDevice() {
    var wrap = els.deviceWrap;
    var dev = els.device;
    if (!wrap || !dev) return;

    /* offsetWidth/Height là kích thước layout thật, không phụ thuộc transform. */
    var h = dev.offsetHeight;
    var w = dev.offsetWidth;
    if (!h || !w) return;

    var availH = wrap.clientHeight - 8;
    var availW = wrap.clientWidth - 8;
    if (availH <= 0 || availW <= 0) return;

    /* Luôn thu nhỏ để vừa trọn khung; cho phép phóng nhẹ trên màn hình lớn. */
    var scale = Math.min(1.2, availH / h, availW / w);
    dev.style.transform = 'scale(' + scale.toFixed(4) + ')';
  }

  function scheduleFit() {
    if (fitRaf) cancelAnimationFrame(fitRaf);
    fitRaf = requestAnimationFrame(function () {
      fitRaf = 0;
      fitDevice();
    });
  }

  function startClock() {
    clearInterval(clockTimer);
    clockTimer = setInterval(function () {
      var nodes = document.querySelectorAll('[data-clock]');
      nodes.forEach(function (n) { n.textContent = nowTime(); });
      var sb = document.querySelectorAll('.statusbar > span:first-child');
      sb.forEach(function (n) { n.textContent = nowTime(); });
    }, 20000);
  }

  /* ------------------------------------------------------------
     KHỞI TẠO
     ------------------------------------------------------------ */

  function initSim() {
    els.screen = document.getElementById('screen');
    els.device = document.getElementById('device');
    els.deviceWrap = document.getElementById('device-wrap');
    els.island = document.getElementById('island');
    els.punch = document.getElementById('punch');
    els.labTitle = document.getElementById('lab-title');
    els.labHint = document.getElementById('lab-hint');
    els.toast = document.getElementById('toast');

    load();

    var params = new URLSearchParams(window.location.search);
    var qos = params.get('os');
    if (qos === 'ios' || qos === 'android') {
      state.os = qos;
      saveOS(qos);
    } else {
      var savedOS = loadOS();
      if (savedOS) state.os = savedOS;
    }

    bindGlobal();
    startClock();
    render();
  }

  function init() {
    if (PAGE === 'sim') {
      initSim();
      return;
    }
    /* Trang chọn hệ điều hành: chỉ cần ghi nhớ lựa chọn khi bấm thẻ. */
    document.querySelectorAll('.os-card').forEach(function (card) {
      card.addEventListener('click', function () {
        saveOS(card.getAttribute('data-os'));
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
