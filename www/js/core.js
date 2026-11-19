/* 核心：工具 / 静态数据索引 / 本地存储 / 通用 UI */
(function () {
  const ZJ = window.ZJ || (window.ZJ = {});
  const $ = (id) => document.getElementById(id);
  ZJ.$ = $;

  ZJ.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  };

  let toastTimer = null;
  ZJ.toast = function (msg) {
    const t = $('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('on'), 1900);
  };

  const pad = (n) => (n < 10 ? '0' : '') + n;
  ZJ.pad = pad;
  ZJ.hm = function (t) {
    if (!t) return '—';
    const s = String(t);
    return s.length >= 5 ? s.slice(0, 5) : s;
  };
  ZJ.clock = function (d) {
    const x = d || new Date();
    return pad(x.getHours()) + ':' + pad(x.getMinutes()) + ':' + pad(x.getSeconds());
  };
  /* 时钟：统一出口，测试可固定当前分钟数（ZJ.Clock.setFixed(540) → 09:00） */
  ZJ.Clock = {
    fixed: null,
    setFixed(m) {
      ZJ.Clock.fixed = m == null ? null : ((Math.round(m) % 1440) + 1440) % 1440;
      return ZJ.Clock.fixed;
    },
    nowMin() {
      if (ZJ.Clock.fixed != null) return ZJ.Clock.fixed;
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  };
  ZJ.nowMin = function () { return ZJ.Clock.nowMin(); };
  ZJ.minHM = function (m) {
    const v = ((Math.round(m) % 1440) + 1440) % 1440;
    return pad(Math.floor(v / 60)) + ':' + pad(v % 60);
  };
  ZJ.distTxt = function (m) {
    if (!(m >= 0)) return '—';
    return m < 1000 ? Math.round(m) + ' 米' : (m / 1000).toFixed(1) + ' 公里';
  };

  /* 球面距离（Haversine，米） */
  ZJ.hav = function (lat1, lng1, lat2, lng2) {
    if (!lat1 || !lng1 || !lat2 || !lng2) return Infinity;
    const R = 6371000, r = Math.PI / 180;
    const p1 = lat1 * r, p2 = lat2 * r;
    const x = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin((lng2 - lng1) * r / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  };

  /* 本地存储 */
  const Store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? d : JSON.parse(v);
      } catch (e) { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };
  ZJ.Store = Store;

  ZJ.CFG = {
    API_BASE: 'https://zjcx.zhuji.gov.cn:9443',
    API_H: {
      deviceId: 'zjbus_lite_1',
      userToken: 'userToken',
      codeValue: '330681',
      appCode: '330681',
      sourceCodeValue: '330681',
      appVersion: '1.0.0',
      deviceTypeName: 'weixin'
    },
    AVG_SPEED: 240,
    DWELL: 0.35,
    LINE_POLL: 20000,
    STATION_POLL: 30000,
    REMIND_POLL: 15000,
    MAX_FAV: 30,
    VERSION: '1.5.0',
    MANIFEST_URL: 'data/manifest.json',
    SYNC_INTERVAL: 6 * 3600 * 1000,
    CALIBRATE_INTERVAL: 2 * 86400000,
    DATA_STALE_DAYS: 30
  };

  /* ================= 偏好设置（主题 / 提示音 / 震动 / 音量 / 轮询） ================= */
  const PREF_KEY = 'zjbus.settings.v1';
  const THEMES = [
    { key: 'rose', name: '玫瑰粉', color: '#FF5C8A' },
    { key: 'sky', name: '天空蓝', color: '#2E7BF6' },
    { key: 'leaf', name: '松柏绿', color: '#18A05E' },
    { key: 'amber', name: '暖橙', color: '#F08019' }
  ];
  const PREF_DEF = { theme: 'rose', sound: true, vibrate: true, volume: 70, poll: 15 };

  function applyTheme() {
    const t = Prefs.all().theme;
    document.documentElement.setAttribute('data-theme', THEMES.some((x) => x.key === t) ? t : 'rose');
    const meta = document.querySelector('meta[name="theme-color"]');
    const cur = THEMES.find((x) => x.key === Prefs.get('theme')) || THEMES[0];
    if (meta) meta.setAttribute('content', cur.color);
  }

  const Prefs = {
    THEMES: THEMES,
    KEY: PREF_KEY,
    DEFAULTS: PREF_DEF,
    all() {
      const raw = Store.get(PREF_KEY, {}) || {};
      return Object.assign({}, PREF_DEF, raw);
    },
    get(k) { return Prefs.all()[k]; },
    set(k, v) {
      const a = Prefs.all();
      a[k] = v;
      Store.set(PREF_KEY, a);
      applyTheme();
      return a;
    },
    reset() { Store.del(PREF_KEY); applyTheme(); }
  };
  ZJ.Prefs = Prefs;
  applyTheme();

  /* ================= 提示音（WebAudio 合成，无需音频文件） ================= */
  const Sound = {
    ctx: null,
    ensure() {
      if (Sound.ctx) return Sound.ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { Sound.ctx = new AC(); } catch (e) { Sound.ctx = null; }
      return Sound.ctx;
    },
    unlock() {
      const c = Sound.ensure();
      if (c && c.state === 'suspended') c.resume().catch(() => {});
    },
    /* 三声上行提示音，音量 0–100 */
    chime(volume) {
      if (!Prefs.get('sound')) return false;
      const c = Sound.ensure();
      if (!c) return false;
      if (c.state === 'suspended') c.resume().catch(() => {});
      const v = volume == null ? Prefs.get('volume') : volume;
      const gain0 = Math.max(0, Math.min(1, v / 100)) * 0.34;
      if (gain0 <= 0.001) return false;
      const now = c.currentTime;
      [0, 0.22, 0.44].forEach((t, i) => {
        const o = c.createOscillator();
        const g = c.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime([880, 1046.5, 1318.5][i], now + t);
        g.gain.setValueAtTime(0, now + t);
        g.gain.linearRampToValueAtTime(gain0, now + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.26);
        o.connect(g).connect(c.destination);
        o.start(now + t);
        o.stop(now + t + 0.3);
      });
      return true;
    }
  };
  ZJ.Sound = Sound;

  /* ================= 系统通知（Capacitor 原生插件优先，Web 兜底） ================= */
  const Notify = {
    plugin() {
      try {
        const C = window.Capacitor;
        return (C && C.Plugins && C.Plugins.ZjNotify) || null;
      } catch (e) { return null; }
    },
    native() { return !!Notify.plugin(); },
    /* granted | prompt | denied | unsupported */
    async status() {
      const p = Notify.plugin();
      if (p && p.check) {
        try {
          const r = await p.check();
          if (r && r.granted) return 'granted';
          return r && r.canAsk ? 'prompt' : 'denied';
        } catch (e) {}
      }
      if (typeof window.Notification === 'undefined') return 'unsupported';
      const s = window.Notification.permission;
      return s === 'granted' ? 'granted' : s === 'denied' ? 'denied' : 'prompt';
    },
    async request() {
      const p = Notify.plugin();
      if (p && p.request) {
        try {
          const r = await p.request();
          return r && r.granted ? 'granted' : 'denied';
        } catch (e) { return 'denied'; }
      }
      if (typeof window.Notification === 'undefined') return 'unsupported';
      try {
        const r = await window.Notification.requestPermission();
        return r === 'granted' ? 'granted' : r === 'denied' ? 'denied' : 'prompt';
      } catch (e) { return 'denied'; }
    },
    async openSettings() {
      const p = Notify.plugin();
      if (p && p.openSettings) {
        try { await p.openSettings(); return true; } catch (e) { return false; }
      }
      return false;
    },
    /* 到站时：系统通知（响铃）+ 应用内提示音 */
    async fire(title, body) {
      const p = Notify.plugin();
      if (p && p.notify) {
        try {
          await p.notify({
            title: title,
            body: body,
            sound: !!Prefs.get('sound'),
            vibrate: !!Prefs.get('vibrate'),
            volume: Number(Prefs.get('volume')) || 0
          });
          return true;
        } catch (e) {}
      }
      try {
        if (typeof window.Notification !== 'undefined' && window.Notification.permission === 'granted') {
          new window.Notification(title, { body: body, tag: 'zjbus-arrive' });
          return true;
        }
      } catch (e) {}
      return false;
    }
  };
  ZJ.Notify = Notify;

/* ================= 静态数据索引（可重建：版本同步后原地替换） ================= */
  function lineSortKey(n) {
    const m = String(n).match(/^(\d+)/);
    return m ? [0, +m[1], String(n)] : [1, 0, String(n)];
  }

  const Data = {
    names: [],
    lines: [],
    lineMap: new Map(),
    dirs: new Map(),
    stations: [],
    stationMap: new Map(),
    stopCount: 0,
    generated: '',
    version: 0,
    source: 'bundled',
    lineOf: (n) => Data.lineMap.get(n) || null,
    stationOf: (n) => Data.stationMap.get(n) || null,
    rideMeters(dir, fromOrder, toOrder) {
      let m = 0;
      for (let i = fromOrder - 1; i < toOrder - 1; i++) m += dir.stops[i].seg || 0;
      return m || (toOrder - fromOrder) * 500;
    },
    rideMinutes(dir, fromOrder, toOrder) {
      return Math.max(1, Math.round(Data.rideMeters(dir, fromOrder, toOrder) / ZJ.CFG.AVG_SPEED + (toOrder - fromOrder) * ZJ.CFG.DWELL));
    },
    searchLines(kw, limit) {
      const q = String(kw || '').trim().replace(/\s+/g, '');
      if (!q) return Data.lines.slice(0, limit || Data.lines.length);
      const hit = Data.lines.filter((l) => l.name.replace(/\s+/g, '').indexOf(q) > -1);
      hit.sort((a, b) => {
        const ax = a.name === q || a.name === q + '路' ? 0 : a.name.indexOf(q) === 0 ? 1 : 2;
        const bx = b.name === q || b.name === q + '路' ? 0 : b.name.indexOf(q) === 0 ? 1 : 2;
        return ax - bx || lineSortKey(a.name)[1] - lineSortKey(b.name)[1] || a.name.localeCompare(b.name, 'zh');
      });
      return limit ? hit.slice(0, limit) : hit;
    },
    searchStations(kw, limit) {
      const q = String(kw || '').trim();
      if (!q) return [];
      const hit = Data.stations.filter((s) => s.name.indexOf(q) > -1);
      hit.sort((a, b) => {
        const ax = a.name.indexOf(q) === 0 ? 0 : 1;
        const bx = b.name.indexOf(q) === 0 ? 0 : 1;
        return ax - bx || a.name.length - b.name.length || b.entries.length - a.entries.length;
      });
      return limit ? hit.slice(0, limit) : hit;
    },
    nearby(lat, lng, limit) {
      if (!lat || !lng) return [];
      const out = [];
      Data.stations.forEach((s) => {
        if (!s.lat || !s.lng) return;
        const d = ZJ.hav(lat, lng, s.lat, s.lng);
        if (d < 12000) out.push({ station: s, dist: d });
      });
      out.sort((a, b) => a.dist - b.dist);
      return out.slice(0, limit || 6);
    },
    /* dataset: { version, generated, names?, lines:[{n, d:[{k,id,f,l,s:[[name|idx,seg,lat,lng]]}]}] } */
    rebuild(dataset) {
      const ds = dataset || { lines: [] };
      const names = ds.names || [];
      const lineMap = new Map();
      const dirById = new Map();
      const stationMap = new Map();
      const lines = [];
      let stopCount = 0;

      (ds.lines || []).forEach((L) => {
        const srcDirs = L.d || L.dirs || [];
        const dirs = srcDirs.map((d) => {
          let cum = 0;
          const srcStops = d.s || d.stops || [];
          const stops = srcStops.map((s, i) => {
            const name = typeof s[0] === 'string' ? s[0] : (names[s[0]] || '');
            const st = {
              o: i + 1,
              name: name,
              lat: (s[2] || 0) / 100000,
              lng: (s[3] || 0) / 100000,
              seg: s[1] || 0,
              cum: cum
            };
            cum += st.seg;
            return st;
          });
          const dir = {
            key: d.k,
            id: d.id,
            first: ZJ.hm(d.f),
            last: ZJ.hm(d.l),
            line: L.n,
            stops: stops,
            total: cum,
            start: stops.length ? stops[0].name : '',
            end: stops.length ? stops[stops.length - 1].name : ''
          };
          stopCount += stops.length;
          dirById.set(dir.id, dir);
          stops.forEach((st) => {
            if (!st.name) return;
            let s = stationMap.get(st.name);
            if (!s) {
              s = { name: st.name, lat: st.lat, lng: st.lng, entries: [] };
              stationMap.set(st.name, s);
            }
            s.entries.push({ line: L.n, dir: dir, order: st.o });
            if (!s.lat && st.lat) { s.lat = st.lat; s.lng = st.lng; }
          });
          return dir;
        });
        const line = { name: L.n, dirs: dirs };
        lines.push(line);
        lineMap.set(L.n, line);
      });

      lines.sort((a, b) => {
        const x = lineSortKey(a.name), y = lineSortKey(b.name);
        return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'zh');
      });

      Data.names = names.length ? names : [...stationMap.keys()];
      Data.lines = lines;
      Data.lineMap = lineMap;
      Data.dirs = dirById;
      Data.stationMap = stationMap;
      Data.stations = [...stationMap.values()];
      Data.stopCount = stopCount;
      Data.generated = ds.generated || '';
      Data.version = Number(ds.version) || 0;
      Data.source = ds.source || 'bundled';
      Data.buildAt = Date.now();
      return Data;
    }
  };
  ZJ.Data = Data;
  Data.rebuild(window.SNAPSHOT || { lines: [] });

  /* ================= 运营时段判断 ================= */
  /* ================= 首末班运营状态（每次渲染都按当前时间重算） =================
     数据来源：官方静态快照里每条线路每个方向的首班 / 末班时间（dir.first / dir.last）。
     口径：
       1. 末班车从起点站发出后仍会沿途载客，所以「本站已无末班车」的时刻 =
          末班发车时间 + 起点站到本站的行驶时间（用静态里程与平均车速估算）。
       2. 首班车同理：首班尚未发车时本站也不会有车；首班前 15 分钟内按「即将发车」处理。
       3. 跨零点线路（末班 < 首班，如 22:00–01:30）单独判定。
       4. 缺首末班数据时返回 unknown，界面按旧逻辑处理（不做拦截）。
     状态：
       running   正常运营
       lastGone  末班车已从起点发出，但还没有驶过本站（仍可能坐到，可显示剩余站数）
       closed    已收班（本站今日不会再有车）
       before    首班未发
       unknown   无首末班数据
  */
  const Service = {
    toMin(t) {
      const m = String(t == null ? '' : t).match(/(\d{1,2}):(\d{2})/);
      return m ? +m[1] * 60 + +m[2] : null;
    },
    /* 某方向、某上车站（1 基序号，缺省为首站）的可乘车时间窗 */
    window(dir, order) {
      const first = Service.toMin(dir && dir.first);
      const last = Service.toMin(dir && dir.last);
      const n = dir && dir.stops ? dir.stops.length : 0;
      const o = Math.max(1, Math.min(n || 1, Number(order) || 1));
      const ride = n > 1 ? ZJ.Data.rideMinutes(dir, 1, o) : 0;
      return {
        first: first,
        last: last,
        lastBoard: last == null ? null : last + ride,
        ride: ride,
        order: o,
        firstTxt: (dir && dir.first) || '—',
        lastTxt: (dir && dir.last) || '—'
      };
    },
    /* 核心判定：任何一次渲染 / 刷新都重新调用，不缓存结果 */
    info(dir, order) {
      const w = Service.window(dir, order);
      const now = ZJ.nowMin();
      let state = 'unknown';
      if (w.first != null && w.lastBoard != null) {
        const grace = 1; /* 允许 1 分钟误差，避免整点瞬间抖动 */
        if (w.lastBoard < w.first) {
          /* 跨零点：首班之前、末班车驶过本站之后才算收班 */
          state = (now >= w.first || now <= w.lastBoard + grace) ? 'running' : 'closed';
        } else if (now > w.lastBoard + grace) {
          state = 'closed';
        } else if (now < w.first - 15) {
          state = 'before';
        } else if (now > w.last) {
          state = 'lastGone';
        } else {
          state = 'running';
        }
      }
      return {
        state: state,
        now: now,
        first: w.first,
        last: w.last,
        lastBoard: w.lastBoard,
        firstTxt: w.firstTxt,
        lastTxt: w.lastTxt,
        order: w.order,
        /* 不在运营时段：不再渲染剩余站数与预估到站时间 */
        off: state === 'closed' || state === 'before'
      };
    },
    isOpen(dir, order) {
      const s = Service.info(dir, order).state;
      return s === 'running' || s === 'lastGone' || s === 'unknown';
    },
    isClosed(dir, order) { return Service.info(dir, order).state === 'closed'; },
    /* 短标签 */
    tag(info) {
      const s = info && info.state;
      if (s === 'closed') return '已收班';
      if (s === 'before') return '首班未发';
      if (s === 'lastGone') return '末班车已发出';
      if (s === 'unknown') return '运营时段未知';
      return '运营中';
    },
    /* 收班 / 首班前的说明文字（含运营时段与恢复时间） */
    note(info) {
      if (!info) return '';
      if (info.state === 'closed') return '末班 ' + info.lastTxt + ' 已发出';
      if (info.state === 'before') return '首班 ' + info.firstTxt + ' 发车';
      return '运营时段 ' + info.firstTxt + ' – ' + info.lastTxt;
    },
    /* 收班后何时恢复：末班已过 → 明日首班；首班前 → 今日首班 */
    resume(info) {
      if (!info) return '';
      if (info.state === 'closed') return '明日首班 ' + info.firstTxt;
      if (info.state === 'before') return '今日首班 ' + info.firstTxt;
      return '';
    }
  };
  ZJ.Service = Service;

  /* 兼容旧调用：方向整体是否在运营（按首站口径） */
  ZJ.isInService = function (dir, order) { return Service.isOpen(dir, order); };

  /* ================= 横向站点时间轴（竖屏 · 竖排站名 · 左右滚动） =================
     html(dir, opt) 返回 .tl 内部 HTML；mount(dir, opt) 负责挂载、设宽并滚动到焦点站。
     opt: { el, selected, board, alight, vehicles, step, pad, focus, hint }
     序号一律使用 1 基站序（与静态数据 st.o 一致）
  */
  const Timeline = {
    width(dir, opt) {
      const step = (opt && opt.step) || 72;
      const pad = (opt && opt.pad) || 24;
      return (dir.stops.length - 1) * step + pad * 2;
    },
    html(dir, opt) {
      opt = opt || {};
      const step = opt.step || 72;
      const pad = opt.pad || 24;
      const sel = opt.selected || 0;
      const board = opt.board || 0;
      const alight = opt.alight || 0;
      const vehicles = opt.vehicles || [];
      let html = '<div class="tl-bar"><div class="tl-chev"></div></div>';
      dir.stops.forEach((s, i) => {
        const o = s.o;
        let cls = '';
        if (board && o === board) cls = 'sel';
        else if (alight && o === alight) cls = 'alight';
        else if (sel && o === sel) cls = 'sel';
        else if ((board && o < board) || (!board && sel && o < sel)) cls = 'passed';
        const nm = s.name.length > 9 ? s.name.slice(0, 8) + '…' : s.name;
        html += '<div class="tl-item ' + cls + '" style="left:' + (pad + i * step) + 'px" data-act="' +
          (opt.stopAct || 'noop') + '" data-station="' + ZJ.esc(s.name) + '" data-order="' + o + '">' +
          '<span class="tl-no">' + o + '</span><span class="tl-dot"></span>' +
          '<span class="tl-nm">' + ZJ.esc(nm) + '</span></div>';
      });
      if (vehicles.length) {
        vehicles.slice(0, 8).forEach((v) => {
          const left = pad + Math.max(0, Math.min(dir.stops.length - 1, v.pos)) * step;
          html += '<div class="tl-bus" style="left:' + left.toFixed(1) + 'px" data-act="bus-tip" data-plate="' + ZJ.esc(v.plate) + '">' +
            '<span class="bub"><svg class="ico"><use href="#i-bus"/></svg></span><span class="pin"></span></div>';
        });
      }
      return html;
    },
    /* 挂载并滚动到焦点站（1 基序号），opt.el 为 .tl 容器
       opt.restore 传入已有 scrollLeft 时保持用户当前横向位置（轮询刷新不跳动） */
    mount(dir, opt) {
      opt = opt || {};
      const el = opt.el;
      if (!el) return;
      const step = opt.step || 72;
      const pad = opt.pad || 24;
      el.style.width = Timeline.width(dir, opt) + 'px';
      el.innerHTML = Timeline.html(dir, opt);
      const focus = opt.focus || opt.selected || opt.board || 1;
      const sc = el.parentNode;
      if (!sc) return;
      if (opt.restore != null && opt.restore > 0) {
        sc.scrollLeft = opt.restore;
        return;
      }
      const target = pad + (focus - 1) * step - sc.clientWidth / 2;
      requestAnimationFrame(() => { sc.scrollLeft = Math.max(0, target); });
    },
    /* 把某站滚动到视野中央 */
    center(scroller, order, opt) {
      if (!scroller) return;
      const step = (opt && opt.step) || 72;
      const pad = (opt && opt.pad) || 24;
      scroller.scrollTo({ left: Math.max(0, pad + (order - 1) * step - scroller.clientWidth / 2), behavior: 'smooth' });
    },
    /* 左右滑动提示：是否还有更多内容 */
    edges(scroller) {
      if (!scroller) return { left: false, right: false };
      return {
        left: scroller.scrollLeft > 4,
        right: scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4
      };
    },
    /* 绑定滚动提示：滚动到两端时更新提示文字 */
    bindHint(scroller, hintEl) {
      if (!scroller || !hintEl || scroller.dataset.hintBound) return;
      scroller.dataset.hintBound = '1';
      const total = hintEl.dataset.total || '';
      const upd = () => {
        const e = Timeline.edges(scroller);
        if (!e.left && !e.right) hintEl.textContent = total ? '共 ' + total + ' 站 · 已显示全程' : '已显示全程';
        else if (!e.left) hintEl.textContent = (total ? '共 ' + total + ' 站 · ' : '') + '向右滑动查看后续 →';
        else if (!e.right) hintEl.textContent = '← 向左滑动回看前序站点';
        else hintEl.textContent = (total ? '共 ' + total + ' 站 · ' : '') + '← 左右滑动浏览全程 →';
      };
      scroller.addEventListener('scroll', upd, { passive: true });
      requestAnimationFrame(upd);
    }
  };
  ZJ.Timeline = Timeline;

  /* ================= 竖向时间轴（大字版 · 老年友好） =================
     与横向时间轴内容一致，但站名更大、行高更高、提醒按钮更大，便于长者阅读点按。
     opt: { selected, board, alight, vehicles, err, range:[from,to], line, dirKey,
            bellAct, bellClass, staticEta(order), hintAct }
  */
  const VTimeline = {
    html(dir, opt) {
      opt = opt || {};
      const offTxt = opt.off ? (opt.offTxt || '已收班') : '';
      const vehicles = opt.off ? [] : (opt.vehicles || []);
      const sel = opt.selected || 0;
      const board = opt.board || 0;
      const alight = opt.alight || 0;
      const bellAct = opt.bellAct || 'stop-remind';
      const hasLive = vehicles.length > 0 && !opt.err;
      const from = opt.range ? opt.range[0] : 1;
      const to = opt.range ? opt.range[1] : dir.stops.length;
      const rows = [];
      dir.stops.forEach((s) => {
        const o = s.o;
        if (o < from || o > to) return;
        let cls = '';
        if (board && o === board) cls += ' board';
        if (alight && o === alight) cls += ' alight';
        if (sel && o === sel && !board) cls += ' sel';
        if (board && o < board) cls += ' passed';

        let tag = '';
        if (board && o === board) tag = '<i class="vt-tag">上车站</i>';
        else if (alight && o === alight) tag = '<i class="vt-tag green">下车站</i>';

        /* 车辆标记：该站有车停靠 / 正在驶向下一站 */
        let bus = '';
        const here = vehicles.filter((v) => v.order === o);
        if (here.length) {
          const v = here[0];
          bus = '<span class="vt-bus"><svg class="ico"><use href="#i-bus"/></svg>' +
            (v.arrived ? '车辆停靠本站' : '车辆正在本站 → 下一站') + (here.length > 1 ? ' ×' + here.length : '') + '</span>';
        }

        /* 预计到站：本站已有车辆时只显示车辆徽标，避免重复；不在运营时段一律不显示预估 */
        let eta = '';
        if (offTxt) {
          eta = '<span class="vt-eta off">' + ZJ.esc(offTxt) + '</span>';
        } else if (opt.etaOff) {
          eta = '<span class="vt-eta dim">时刻表</span>';
        } else if (hasLive && here.length) {
          eta = '';
        } else if (hasLive) {
          const arr = ZJ.RT.arrivalsTo(dir, vehicles, o);
          const b = arr[0];
          if (b) eta = '<span class="vt-eta live">' + (b.atStation ? '车辆已到站' : '还有 ' + b.remain + ' 站 · 约 ' + b.minutes + ' 分钟') + '</span>';
          else {
            const ahead = vehicles.some((v) => v.order > o || (v.order === o && !v.arrived));
            eta = '<span class="vt-eta' + (ahead ? ' dim' : '') + '">' + (ahead ? '车辆已过站' : '—') + '</span>';
          }
        } else if (typeof opt.staticEta === 'function') {
          eta = '<span class="vt-eta">' + ZJ.esc(opt.staticEta(o)) + '</span>';
        } else {
          eta = '<span class="vt-eta">约 ' + ZJ.Data.rideMinutes(dir, from, o) + ' 分钟（静态）</span>';
        }

        const rm = opt.line && opt.dirKey ? ZJ.Reminder.find(opt.line, opt.dirKey, s.name) : null;
        const bell = opt.bell === false ? '' :
          '<button class="' + (opt.bellClass || 'vt-bell') + (rm ? ' on' : '') + '" data-act="' + bellAct +
          '" data-station="' + ZJ.esc(s.name) + '" data-order="' + o +
          '"' + (opt.line ? ' data-line="' + ZJ.esc(opt.line) + '"' : '') + (opt.dirKey ? ' data-dir="' + ZJ.esc(opt.dirKey) + '"' : '') +
          ' aria-label="到站提醒"><svg class="ico"><use href="#i-bell"/></svg></button>';

        rows.push('<div class="vt-row' + cls + '" data-act="' + (opt.rowAct || 'stop') + '" data-station="' + ZJ.esc(s.name) + '" data-order="' + o + '">' +
          '<span class="vt-axis"><i class="vt-dot"></i></span>' +
          '<div class="vt-body"><div class="vt-top"><b class="vt-name">' + ZJ.esc(s.name) + '</b>' + tag + '</div>' +
          '<div class="vt-meta"><span class="vt-no">第 ' + o + ' 站</span>' + eta + bus + '</div></div>' +
          bell + '</div>');
      });
      return rows.join('');
    }
  };
  ZJ.VTimeline = VTimeline;

  /* ================= 收藏 ================= */
  const FAV_L_KEY = 'zjbus.fav.lines.v1';
  const FAV_S_KEY = 'zjbus.fav.stations.v1';
  const Fav = {
    lines: () => Store.get(FAV_L_KEY, []),
    stations: () => Store.get(FAV_S_KEY, []),
    hasLine(n) { return Fav.lines().indexOf(n) > -1; },
    hasStation(n) { return Fav.stations().indexOf(n) > -1; },
    toggleLine(n) {
      const arr = Fav.lines();
      const i = arr.indexOf(n);
      if (i > -1) arr.splice(i, 1);
      else {
        if (arr.length >= ZJ.CFG.MAX_FAV) { ZJ.toast('收藏线路已达上限'); return Fav.hasLine(n); }
        arr.unshift(n);
      }
      Store.set(FAV_L_KEY, arr);
      return i === -1;
    },
    toggleStation(n) {
      const arr = Fav.stations();
      const i = arr.indexOf(n);
      if (i > -1) arr.splice(i, 1);
      else {
        if (arr.length >= ZJ.CFG.MAX_FAV) { ZJ.toast('收藏站点已达上限'); return Fav.hasStation(n); }
        arr.unshift(n);
      }
      Store.set(FAV_S_KEY, arr);
      return i === -1;
    }
  };
  ZJ.Fav = Fav;

  /* ================= 动作注册（全局事件委托） ================= */
  ZJ.actions = {};
  ZJ.act = function (name, fn) { ZJ.actions[name] = fn; };
  ZJ.run = function (name, el, e) {
    const fn = ZJ.actions[name];
    if (fn) { fn(el, e); return true; }
    return false;
  };

  /* ================= 通用 UI ================= */
  const layers = [];
  let popping = false;

  function showSheet() {
    const mask = $('mask');
    mask.hidden = false;
    requestAnimationFrame(() => mask.classList.add('on'));
    document.body.style.overflow = 'hidden';
  }
  function hideSheetVisual() {
    const mask = $('mask');
    if (!mask || mask.hidden) return;
    mask.classList.remove('on');
    document.body.style.overflow = '';
    setTimeout(() => {
      if (!mask.classList.contains('on')) {
        mask.hidden = true;
        $('sheet').innerHTML = '';
      }
    }, 260);
  }
  function showFull(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function hideFull(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('on');
    document.body.style.overflow = '';
    setTimeout(() => { if (!el.classList.contains('on')) el.scrollTop = 0; }, 340);
  }
  function pushLayer(layer) {
    layers.push(layer);
    try { history.pushState({ zjLayer: layers.length }, ''); } catch (e) {}
  }
  function popHistory() {
    try {
      if (history.state && history.state.zjLayer) { popping = true; history.back(); }
    } catch (e) {}
  }

  const UI = {
    sheet(html) {
      $('sheet').innerHTML = html;
      const mask = $('mask');
      mask.scrollTop = 0;
      showSheet();
      pushLayer({ type: 'sheet' });
    },
    isSheetOpen() {
      const mask = $('mask');
      return !!(mask && !mask.hidden);
    },
    updateSheet(html) {
      const mask = $('mask');
      if (mask && !mask.hidden) $('sheet').innerHTML = html;
    },
    closeSheet() {
      const i = layers.map((l) => l.type).lastIndexOf('sheet');
      if (i > -1) layers.splice(i, 1);
      hideSheetVisual();
      popHistory();
    },
    openFull(id) {
      showFull(id);
      pushLayer({ type: 'full', id: id });
    },
    closeFull(id) {
      const i = layers.findIndex((l) => l.type === 'full' && l.id === id);
      if (i > -1) layers.splice(i, 1);
      hideFull(id);
      popHistory();
    },
    alert(html) {
      $('alertCard').innerHTML = html;
      const mask = $('alertMask');
      mask.hidden = false;
      requestAnimationFrame(() => mask.classList.add('on'));
    },
    closeAlert() {
      const mask = $('alertMask');
      if (!mask || mask.hidden) return;
      mask.classList.remove('on');
      setTimeout(() => { if (!mask.classList.contains('on')) { mask.hidden = true; $('alertCard').innerHTML = ''; } }, 240);
    },
    vibrate(pattern) {
      if (!Prefs.get('vibrate')) return false;
      try {
        if (navigator.vibrate) { navigator.vibrate(pattern || [300, 120, 300]); return true; }
      } catch (e) {}
      return false;
    },
    closeTop() {
      const l = layers[layers.length - 1];
      if (!l) return false;
      if (l.type === 'sheet') hideSheetVisual();
      else hideFull(l.id);
      layers.pop();
      return true;
    }
  };
  ZJ.UI = UI;

  /* Android 返回键 / 浏览器后退：先关弹层，再关详情页 */
  window.addEventListener('popstate', () => {
    if (popping) { popping = false; return; }
    if (layers.length) UI.closeTop();
  });

  /* 全局点击委托 */
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    if (ZJ.run(el.dataset.act, el, e)) {
      if (el.tagName === 'BUTTON' || el.dataset.act !== 'noop') e.preventDefault();
    }
  }, false);

  /* 点遮罩关闭弹层 */
  document.addEventListener('DOMContentLoaded', () => {
    const mask = $('mask');
    if (mask) mask.addEventListener('click', (e) => { if (e.target === mask) UI.closeSheet(); });
  });
})();
