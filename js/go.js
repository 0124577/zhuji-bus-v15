/* 出行：方案列表（精简卡片：总时长 / 步行距离 / 公交线路 / 车辆实时状态）
   点卡片进入换乘详情页；列表页不再跳独立线路页 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;
  const HIST_KEY = 'zjbus.history.v1';

  const G = {
    from: '', to: '', plans: [], idx: 0, computing: false, tip: '',
    walk: null, allClosed: false, live: new Map(), sig: '', timer: null
  };

  /* ---------- 历史 ---------- */
  function history() { return ZJ.Store.get(HIST_KEY, []); }
  function pushHistory(from, to) {
    const list = history().filter((h) => !(h.from === from && h.to === to));
    list.unshift({ from: from, to: to, ts: Date.now() });
    ZJ.Store.set(HIST_KEY, list.slice(0, 20));
  }
  function fmtWhen(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    return (sameDay ? '今天 ' : (d.getMonth() + 1) + '/' + d.getDate() + ' ') + ZJ.pad(d.getHours()) + ':' + ZJ.pad(d.getMinutes());
  }

  function renderHistory() {
    const list = history();
    if (!list.length) {
      $('histList').innerHTML = '<div class="empty-block">还没有查询记录<br>查询一次换乘方案就会自动保存</div>';
      return;
    }
    $('histList').innerHTML = list.map((h, i) =>
      '<div class="hist-row" data-act="hist-open" data-i="' + i + '">' +
      '<div class="hist-main"><b>' + ZJ.esc(h.from) + ' → ' + ZJ.esc(h.to) + '</b><span>' + fmtWhen(h.ts) + '</span></div>' +
      '<button class="hist-del" data-act="hist-del" data-i="' + i + '"><svg class="ico"><use href="#i-trash"/></svg></button>' +
      '</div>').join('');
  }

  /* ---------- 选择器 ---------- */
  function renderSelectors() {
    const fc = $('fromName'), tc = $('toName');
    fc.textContent = G.from || '选择起点站';
    tc.textContent = G.to || '选择终点站';
    fc.classList.toggle('ph', !G.from);
    tc.classList.toggle('ph', !G.to);
  }

  /* ---------- 实时状态 ---------- */
  function liveOf(id) { return G.live.get(id) || { loading: true, at: 0 }; }

  function vehStatus(p) {
    const leg = p.legs[0];
    if (p.off) return { cls: 'off', txt: p.closed ? '已收班' : '首班未发' };
    const d = liveOf(leg.dir.id);
    if (ZJ.Api.mode === 'static') return { cls: 'dim', txt: '静态模式 · 仅时刻表' };
    if (d.err) {
      const tt = ZJ.Timetable.cached(leg.dir, leg.fromOrder, 3);
      return { cls: 'warn', txt: '实时不可用' + (tt && tt.length ? ' · 时刻表 ' + tt.map((x) => x.dep).join(' · ') : ' · 仅首末班') };
    }
    if (!d.at) return { cls: 'dim', txt: '正在获取车辆…' };
    const arr = (d.vehicles || []).length ? ZJ.RT.arrivalsTo(leg.dir, d.vehicles, leg.fromOrder) : [];
    if (!arr.length) {
      const tt = ZJ.Timetable.cached(leg.dir, leg.fromOrder, 3);
      return { cls: 'dim', txt: '暂无在线车辆' + (tt && tt.length ? ' · 时刻表 ' + tt.map((x) => x.dep).join(' · ') : '') };
    }
    const b = arr[0];
    return { cls: 'live', txt: leg.line + (b.atStation ? ' 车已到站' : ' 还有 ' + b.remain + ' 站') };
  }

  async function loadLive() {
    if (!G.plans.length) return;
    const dirs = new Map();
    G.plans.forEach((p) => { if (!p.off) dirs.set(p.legs[0].dir.id, p.legs[0].dir); });
    if (!dirs.size) return;
    await ZJ.batch([...dirs.keys()], 3, async (id) => {
      const old = G.live.get(id);
      if (old && old.at && Date.now() - old.at < 8000) return;
      try {
        const data = await ZJ.Api.vehicles(id);
        G.live.set(id, { vehicles: ZJ.RT.normalize(dirs.get(id), data), at: Date.now(), err: '' });
      } catch (e) {
        G.live.set(id, { vehicles: [], at: Date.now(), err: (e && e.message) || '网络异常' });
      }
    });
    /* 只有实时失败时才补时刻表，避免对正常线路发多余请求 */
    if (ZJ.Api.mode !== 'static' && [...G.live.values()].some((x) => x.err)) {
      dirs.forEach((d) => { ZJ.Timetable.load(d).then(() => { if ($('page-go').classList.contains('on')) renderPlans(); }); });
    }
    if ($('page-go').classList.contains('on')) renderPlans();
  }

  function startLive() {
    stopLive();
    G.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && $('page-go').classList.contains('on')) loadLive();
    }, 20000);
  }
  function stopLive() { if (G.timer) clearInterval(G.timer); G.timer = null; }

  /* ---------- 渲染 ---------- */
  function renderTip(msg) {
    $('planResult').innerHTML =
      '<div class="plan-empty tip"><svg class="ico"><use href="#i-route"/></svg><b>' + ZJ.esc(msg) + '</b></div>';
  }
  function renderPrompt() {
    $('planResult').innerHTML =
      '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
      '<b>输入起点和终点</b>点上面两个框，选好站就会自动规划</div>';
  }

  function renderWalk(w) {
    if (!w) return '';
    return '<div class="walk-card">' +
      '<span class="walk-ico"><svg class="ico"><use href="#i-walk"/></svg></span>' +
      '<div class="walk-txt"><b>两地相距 ' + ZJ.distTxt(w.meters) + '，步行约 ' + w.minutes + ' 分钟</b>' +
      '<span>' + (w.meters <= 600 ? '距离很近，走路可能比等车更快' : '不赶时间的话步行也可以') +
      ' · 直线距离估算</span></div></div>';
  }

  function chain(p) {
    return p.legs.map((l) =>
      '<span class="tc-line"><span class="leg-badge">' + ZJ.esc(l.line) + '</span>' +
      '<span class="tc-to">' + ZJ.esc(l.to) + '</span></span>').join('<span class="tc-arrow">›</span>');
  }

  function tripCard(p, i, n) {
    const v = vehStatus(p);
    const meters = p.meters >= 50 ? ZJ.distTxt(p.meters) : '相邻站点';
    const walk = p.walkMeters > 0 ? '步行 ' + ZJ.distTxt(p.walkMeters) : '无需步行换乘';
    const tags = p.off
      ? '<span class="plan-tag gray">' + (p.closed ? '已收班' : '首班未发') + '</span>'
      : ((n === 0 ? '<span class="plan-tag rec">推荐</span>' : '') +
        (p.lastGone ? '<span class="plan-tag warn">末班车已发出</span>' : ''));
    const offNote = p.offInfo ? ZJ.Service.note(p.offInfo) + ' · ' + ZJ.Service.resume(p.offInfo) : '已过运营时段';
    return '<article class="trip-card' + (p.off ? ' off' : '') + '" data-act="trip-open" data-i="' + i + '">' +
      '<div class="trip-h"><span class="trip-no">方案 ' + (n + 1) + '</span>' +
      '<span class="plan-tag">' + (p.transfers === 0 ? '直达' : p.transfers + ' 次换乘') + '</span>' + tags +
      '<span class="trip-dur' + (p.off ? ' off' : '') + '">' +
      (p.off ? (p.closed ? '已收班' : '首班未发') : p.total + '<em>分钟</em>') + '</span></div>' +
      '<div class="trip-chain">' + chain(p) + '</div>' +
      '<div class="trip-meta">' +
      '<span>' + (p.off ? ZJ.esc(offNote) : walk + ' · ' + meters) + '</span>' +
      (p.off ? '' : '<span class="trip-veh ' + v.cls + '">' + ZJ.esc(v.txt) + '</span>') +
      '<svg class="ico trip-go"><use href="#i-right"/></svg></div>' +
      '</article>';
  }

  function renderPlans() {
    if (!G.plans.length) {
      $('planResult').innerHTML =
        '<div class="plan-empty"><svg class="ico"><use href="#i-route"/></svg>' +
        '<b>暂无可用方案</b>「' + ZJ.esc(G.from) + '」到「' + ZJ.esc(G.to) + '」没有直达或换乘线路<br>可以换一个邻近站点试试</div>';
      return;
    }
    G.plans.forEach(ZJ.Planner.annotate);
    G.sig = G.plans.map((p) => p.svcs.map((s) => s.state).join(',')).join('|');

    const avail = G.plans.filter((p) => !p.off);
    G.allClosed = avail.length === 0;
    const shown = avail.length ? avail : G.plans;
    G.idx = Math.max(0, G.plans.indexOf(shown[0]));
    G.visible = shown;

    const banner = G.allClosed
      ? '<div class="degrade-banner soft"><svg class="ico"><use href="#i-clock"/></svg>' +
        '<div><b>今日末班已过</b><span>以下方案为明日参考，收班后不再显示剩余站数与到达时间</span></div></div>'
      : (ZJ.Api.mode === 'static'
        ? '<div class="degrade-banner soft"><svg class="ico"><use href="#i-refresh"/></svg>' +
          '<div><b>静态数据模式</b><span>已关闭到站预估，仅显示站点、首末班与时刻表</span></div></div>'
        : '');

    $('planResult').innerHTML = banner + renderWalk(G.walk) + '<div class="trip-list">' +
      shown.map((p, n) => tripCard(p, G.plans.indexOf(p), n)).join('') + '</div>';

    const hint = ZJ.DataSync ? ZJ.DataSync.status() : null;
    const dh = $('goDataHint');
    if (dh) {
      const stale = hint && (hint.state === 'stale' || hint.state === 'offline');
      dh.hidden = !stale;
      dh.textContent = stale ? ZJ.DataSync.hint() : '';
    }
  }

  /* ---------- 计算 ---------- */
  function plan(opts) {
    opts = opts || {};
    if (!G.from) { if (!opts.silent) ZJ.toast('请先选择起点站'); return; }
    if (!G.to) { if (!opts.silent) ZJ.toast('请先选择终点站'); return; }
    if (G.from === G.to) {
      G.plans = []; G.idx = 0; G.computing = false;
      renderTip('起点和终点不能是同一个站，请换一个');
      if (!opts.silent) ZJ.toast('起点和终点不能是同一个站');
      return;
    }
    if (G.computing) return;
    G.tip = '';
    if (!opts.noHistory) { pushHistory(G.from, G.to); renderHistory(); }
    G.computing = true;
    G.live = new Map();
    if (!opts.silent) {
      $('planResult').innerHTML = '<div class="plan-empty"><b>正在计算出行方案…</b>直达优先，其次比较换乘次数</div>';
    }
    setTimeout(() => {
      const res = ZJ.Planner.search(G.from, G.to, G.prefs || 'fast');
      G.plans = res.plans;
      G.walk = res.walk;
      G.allClosed = res.allClosed;
      G.computing = false;
      renderPlans();
      startLive();
      loadLive();
      if (opts.silent) return;
      if (!G.plans.length) ZJ.toast('暂无可行方案');
      else if (G.allClosed) ZJ.toast('今日末班已过，已列出明日方案');
      else ZJ.toast('找到 ' + G.plans.length + ' 套方案');
    }, 40);
  }

  function openNearby() {
    const list = ZJ.Geo && ZJ.Geo.state === 'ok' ? Data.nearby(ZJ.Geo.lat, ZJ.Geo.lng, 8) : [];
    if (!list.length) {
      ZJ.toast('还没定位成功，请检查定位权限');
      ZJ.Geo.locate(true).then(() => openNearby()).catch(() => {});
      return;
    }
    ZJ.UI.sheet(
      '<div class="sheet-h"><b>选择附近的站点</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
      '<div class="sheet-body"><div class="pick-stops">' +
      list.map((x) => '<button class="pick-stop" data-act="pick-near" data-name="' + ZJ.esc(x.station.name) + '">' +
        ZJ.esc(x.station.name) + ' · ' + ZJ.distTxt(x.dist) + '</button>').join('') +
      '</div><p class="sheet-note">距离为直线距离估算，仅供参考</p></div>'
    );
  }

  const Go = {
    render() {
      renderSelectors();
      renderHistory();
      if (!G.from || !G.to) renderPrompt();
      else if (!G.plans.length) { if (G.tip) renderTip(G.tip); else renderPrompt(); }
      else renderPlans();
    },
    plan: plan,
    state() { return G; },
    /* 详情页改上下车点后，列表页同步新的起终点 */
    setEndpoints(from, to, opts) {
      G.from = from; G.to = to;
      renderSelectors();
      plan(Object.assign({ silent: true }, opts || {}));
    },
    /* 详情页就地改站后，列表里的同一套方案同步为新方案 */
    replacePlan(origin, next) {
      if (!next) return;
      const i = G.plans.indexOf(origin);
      if (i > -1) G.plans[i] = next;
      else if (G.plans[G.idx]) G.plans[G.idx] = next;
      renderPlans();
    },
    /* 数据版本更新后：重新规划，保证方案与新的首末班 / 站序一致 */
    afterData() {
      G.live = new Map();
      if (G.from && G.to) plan({ silent: true, noHistory: true });
    },
    tick() {
      if (!G.plans.length) return;
      if (!document.getElementById('page-go').classList.contains('on')) return;
      const sig = G.plans.map((p) => p.legs.map((l) => ZJ.Service.info(l.dir, l.fromOrder).state).join(',')).join('|');
      if (sig === G.sig) return;
      G.sig = sig;
      renderPlans();
    }
  };
  ZJ.Go = Go;

  setInterval(() => { try { Go.tick(); } catch (e) {} }, 30000);

  /* ---------- 动作 ---------- */
  function pickEnd(which, name) {
    const other = which === 'from' ? G.to : G.from;
    if (name && name === other) { ZJ.toast('起点和终点不能是同一个站'); return; }
    if (which === 'from') G.from = name; else G.to = name;
    G.tip = '';
    renderSelectors();
    if (G.from && G.to) plan();
  }
  ZJ.act('pick-from', () => ZJ.Picker.open('选择起点站', null, (name) => pickEnd('from', name)));
  ZJ.act('pick-to', () => ZJ.Picker.open('选择终点站', null, (name) => pickEnd('to', name)));
  ZJ.act('pick-my', (el, e) => { if (e) e.stopPropagation(); openNearby(); });
  ZJ.act('swap-stops', (el, e) => {
    if (e) e.stopPropagation();
    const t = G.from; G.from = G.to; G.to = t;
    renderSelectors();
    if (G.from && G.to) plan();
  });
  ZJ.act('plan', () => plan());
  ZJ.act('pick-near', (el) => {
    const name = el.dataset.name;
    if (name === G.to) { ZJ.toast('起点和终点不能是同一个站'); return; }
    G.from = name;
    G.tip = '';
    ZJ.UI.closeSheet();
    renderSelectors();
    ZJ.toast('起点已设为「' + G.from + '」');
    if (G.to) plan();
  });
  ZJ.act('trip-open', (el) => {
    const p = G.plans[+el.dataset.i];
    if (!p) { ZJ.toast('方案信息不完整'); return; }
    ZJ.Plan.open(p, G.from, G.to);
  });
  ZJ.act('hist-open', (el) => {
    const h = history()[+el.dataset.i];
    if (!h) return;
    G.from = h.from; G.to = h.to;
    renderSelectors();
    plan();
  });
  ZJ.act('hist-del', (el, e) => {
    if (e) e.stopPropagation();
    const list = history();
    list.splice(+el.dataset.i, 1);
    ZJ.Store.set(HIST_KEY, list);
    renderHistory();
    ZJ.toast('已删除该记录');
  });
  ZJ.act('clear-hist', () => {
    if (!history().length) { ZJ.toast('暂无搜索记录'); return; }
    ZJ.Store.set(HIST_KEY, []);
    renderHistory();
    ZJ.toast('已清空搜索历史');
  });
})();
