/* 换乘详情页：整合全部信息
   - 直达：整条线路的实时车辆 + 全部途经站点
   - 换乘：分段模块（每段实时到站 + 途经站点）
   - 点上下车站点可就地改站并立即重算，不跳独立线路页
   - 独立线路页改为次要入口（「查看完整线路」）
*/
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;

  const P = {
    plan: null,
    origin: null,
    from: '',
    to: '',
    data: new Map(),
    req: 0,
    timer: null
  };

  function legData(leg) {
    return P.data.get(leg.dir.id) || { vehicles: [], err: '', at: 0, loading: !P.data.get(leg.dir.id) };
  }
  function arrivals(leg) {
    const d = legData(leg);
    return d.vehicles.length ? ZJ.RT.arrivalsTo(leg.dir, d.vehicles, leg.fromOrder) : [];
  }
  function liveBlocked(leg) {
    const d = legData(leg);
    return ZJ.Api.mode === 'static' || ZJ.Api.degraded || !!d.err;
  }

  function soonest() {
    let best = null;
    P.plan.legs.forEach((leg, i) => {
      const b = arrivals(leg)[0];
      if (!b) return;
      const remain = b.atStation ? 0 : b.remain;
      if (!best || remain < best.remain) {
        best = { remain: remain, minutes: b.minutes, atStation: !!b.atStation, plate: b.v.plate || '', leg: leg, idx: i };
      }
    });
    return best;
  }

  function hero() {
    const p = P.plan;
    const infos = p.legs.map((l) => ZJ.Service.info(l.dir, l.fromOrder));
    const offIdx = infos.findIndex((i) => i.off);
    if (offIdx > -1) {
      const s = infos[offIdx];
      const closed = s.state === 'closed';
      return '<div class="pl-hl off">' +
        '<div class="pl-hl-l"><span class="pl-hl-txt">' + (closed ? '末班已发出' : '首班还未发车') + '</span>' +
        '<span class="pl-hl-num off">' + (closed ? '已收班' : '未发车') + '</span></div>' +
        '<div class="pl-hl-r"><b>' + ZJ.esc(ZJ.Service.note(s)) + '</b>' +
        '<span>' + ZJ.esc(ZJ.Service.resume(s)) + ' · 运营 ' + ZJ.esc(s.firstTxt) + '–' + ZJ.esc(s.lastTxt) + '</span></div></div>';
    }
    const stops = p.legs.reduce((a, l) => a + l.stops, 0);
    const s = soonest();
    const blocked = p.legs.some((l) => liveBlocked(l));
    const anyErr = p.legs.some((l) => legData(l).err);
    const lastGone = infos.some((i) => i.state === 'lastGone');
    let sub;
    if (s) {
      sub = '<i class="live-dot"></i>' + ZJ.esc(s.leg.line) +
        (s.remain === 0 ? ' 车已到上车站' : ' 还有 ' + s.remain + ' 站到上车站');
    } else if (blocked) {
      sub = '<i class="live-dot off"></i>' + (anyErr || ZJ.Api.mode === 'static' ? '实时不可用' : '实时车辆暂不可用') +
        ' · 已关闭到站预估 · 按时刻表';
    } else {
      sub = '<i class="live-dot off"></i>暂无在线车辆 · 按时刻表';
    }
    if (lastGone) sub += ' · <span class="hot">末班车已发出</span>';
    const right = blocked && !s
      ? '<b>全程约 ' + p.total + ' 分钟 · 按时刻表</b>'
      : '<b>约 ' + p.total + ' 分钟 · ' + ZJ.minHM(ZJ.nowMin() + p.total) + ' 到达</b>';
    return '<div class="pl-hl' + (s ? '' : ' static') + '"' +
      (s ? ' data-act="pl-hl" data-idx="' + s.idx + '"' : '') + '>' +
      '<div class="pl-hl-l"><span class="pl-hl-txt">到目的地还有</span>' +
      '<span class="pl-hl-num">' + stops + '<em>站</em></span></div>' +
      '<div class="pl-hl-r">' + right + '<span>' + sub + '</span></div></div>';
  }

  function renderSummary() {
    const p = P.plan;
    const degraded = p.legs.some((l) => liveBlocked(l));
    let banner = '';
    if (degraded) {
      banner = '<div class="degrade-banner"><svg class="ico"><use href="#i-refresh"/></svg>' +
        '<div><b>实时车辆不可用，已关闭到站预估</b><span>站点、首末班、时刻表与静态里程照常可用；联网后自动恢复实时</span></div>' +
        '<button data-act="plan-refresh">重试</button></div>';
    }
    $('plSummary').innerHTML = banner + hero();
  }

  /* 时刻表块：实时不可用时只给班次，不再给「还有几站 / 约几分钟」 */
  function ttBlock(leg) {
    const arr = ZJ.Timetable.cached(leg.dir, leg.fromOrder, 3);
    const times = arr && arr.length ? arr.map((x) => x.dep).join(' · ') : '';
    const sub = times
      ? '起点发车：<b class="tt-times">' + ZJ.esc(times) + '</b> · 运营 ' + ZJ.esc(leg.dir.first) + '–' + ZJ.esc(leg.dir.last)
      : '时刻表暂不可用 · 首班 ' + ZJ.esc(leg.dir.first) + ' · 末班 ' + ZJ.esc(leg.dir.last);
    return '<div class="pl-live tt">' +
      '<div class="pl-live-main"><b>按时刻表乘车</b><span class="pl-eta">已关闭到站预估</span></div>' +
      '<div class="pl-live-sub">' + sub + '</div>' +
      '<button class="pl-retry" data-act="plan-refresh">重新获取实时</button></div>';
  }

  function liveBlock(leg) {
    const d = legData(leg);
    const dir = leg.dir;
    const svc = ZJ.Service.info(dir, leg.fromOrder);
    if (svc.off) {
      const closed = svc.state === 'closed';
      return '<div class="pl-live empty off"><div class="pl-live-main"><b>' + (closed ? '已收班' : '首班未发') + '</b>' +
        '<span class="pl-eta">' + ZJ.esc(ZJ.Service.note(svc)) + '</span></div>' +
        '<div class="pl-live-sub">' + ZJ.esc(ZJ.Service.resume(svc)) + ' · 运营时段 ' +
        ZJ.esc(svc.firstTxt) + ' – ' + ZJ.esc(svc.lastTxt) + '</div></div>';
    }
    if (d.loading && !d.at) {
      return '<div class="pl-live"><div class="pl-live-loading"><span class="spin"></span>正在获取实时车辆…</div></div>';
    }
    if (liveBlocked(leg)) return ttBlock(leg);
    const best = arrivals(leg)[0];
    if (best) {
      const remain = best.atStation ? 0 : best.remain;
      const etaTxt = best.atStation ? '车辆已到上车站' : '约 ' + best.minutes + ' 分钟到上车站';
      return '<div class="pl-live">' +
        '<div class="pl-live-main"><span class="pl-remain"><i>' + (remain === 0 ? '已到' : '还有') + '</i><b>' + remain + '</b><em>站</em></span>' +
        '<span class="pl-eta">' + ZJ.esc(etaTxt) + '</span></div>' +
        '<div class="pl-live-sub"><i class="live-dot"></i>' + ZJ.esc(best.v.plate || '车辆') + ' · ' + ZJ.esc(ZJ.RT.positionText(dir, best.v)) + '</div>' +
        '</div>';
    }
    const head = svc.state === 'lastGone' ? '末班车已发出，暂无其他车辆' : '此刻暂无开往上车站的车辆';
    return '<div class="pl-live empty"><div class="pl-live-main"><b>' + ZJ.esc(head) + '</b></div>' +
      '<div class="pl-live-sub">本段按静态里程估算乘车约 ' + leg.minutes + ' 分钟，稍后自动刷新</div></div>';
  }

  function vRows(leg, full) {
    const d = legData(leg);
    const svc = ZJ.Service.info(leg.dir, leg.fromOrder);
    const from = full ? 1 : leg.fromOrder;
    const to = full ? leg.dir.stops.length : leg.toOrder;
    return ZJ.VTimeline.html(leg.dir, {
      board: leg.fromOrder,
      alight: leg.toOrder,
      vehicles: d.vehicles,
      err: d.err,
      range: [from, to],
      line: leg.line,
      dirKey: leg.dir.key,
      rowAct: 'noop',
      bellAct: 'pl-bell',
      bellClass: 'pl-bell',
      off: svc.off,
      offTxt: svc.state === 'before' ? '首班未发' : '已收班',
      etaOff: !svc.off && liveBlocked(leg),
      staticEta: (o) => '静态约 ' + Math.max(1, Math.round(ZJ.Data.rideMeters(leg.dir, leg.fromOrder, o) / ZJ.CFG.AVG_SPEED + (o - leg.fromOrder) * ZJ.CFG.DWELL)) + ' 分钟'
    });
  }

  function renderLegs() {
    const p = P.plan;
    const full = p.transfers === 0;
    $('plLegs').innerHTML = p.legs.map((leg, i) => {
      const svcOff = ZJ.Service.info(leg.dir, leg.fromOrder).off;
      const isLast = i === p.legs.length - 1;
      return '<section class="card pl-leg" data-leg="' + i + '">' +
        '<div class="pl-leg-h"><span class="leg-badge">' + ZJ.esc(leg.line) + '</span>' +
        '<div class="pl-leg-t"><b>' + ZJ.esc(leg.from) + ' → ' + ZJ.esc(leg.to) + '</b>' +
        '<span>' + (svcOff
          ? '往 ' + ZJ.esc(leg.dir.end) + ' · 运营时段 ' + ZJ.esc(leg.dir.first) + ' – ' + ZJ.esc(leg.dir.last)
          : '往 ' + ZJ.esc(leg.dir.end) + ' · 乘 ' + leg.stops + ' 站 · 约 ' + leg.minutes + ' 分钟') + '</span></div>' +
        '<span class="pl-leg-idx">' + (full ? '直达' : '第 ' + (i + 1) + ' 段') + '</span></div>' +
        liveBlock(leg) +
        '<div class="pl-hops">' +
        '<button class="pl-hop" data-act="pl-hop" data-leg="' + i + '" data-kind="board">' +
        '<span class="hop-top"><span class="lab">上车站</span><span class="ord">第 ' + leg.fromOrder + ' 站</span><i class="hop-edit">改</i></span>' +
        '<b>' + ZJ.esc(leg.from) + '</b></button>' +
        '<button class="pl-hop" data-act="pl-hop" data-leg="' + i + '" data-kind="alight">' +
        '<span class="hop-top"><span class="lab">下车站</span><span class="ord">第 ' + leg.toOrder + ' 站</span><i class="hop-edit">改</i></span>' +
        '<b>' + ZJ.esc(leg.to) + '</b></button>' +
        '</div>' +
        '<div class="pl-strip-h"><b>' + (full ? '全线路站点' : '线路站点') + '</b><span class="tl-hint" id="plHint' + i + '" data-total="' + leg.dir.stops.length + '">左右滑动浏览</span></div>' +
        '<div class="tl-scroll pl-strip" id="plSc' + i + '"><div class="tl tl-sm" id="plTl' + i + '"></div></div>' +
        '<div class="pl-stops"><div class="pl-stops-h"><b>竖向时间轴 · 大字</b><span>点铃铛开关提醒</span></div>' +
        '<div class="vt vt-plan">' + vRows(leg, full) + '</div></div>' +
        (isLast
          ? '<div class="pl-leg-foot">到 <b>' + ZJ.esc(leg.to) + '</b> 下车，步行前往目的地</div>'
          : '<div class="pl-leg-foot">在 <b>' + ZJ.esc(leg.to) + '</b> 同站换乘，预留 5 分钟</div>') +
        '<button class="pl-open-line" data-act="pl-full-line" data-line="' + ZJ.esc(leg.line) + '" data-dir="' + ZJ.esc(leg.dir.key) +
        '" data-station="' + ZJ.esc(leg.from) + '">查看完整线路（含全部车辆）' +
        '<svg class="ico"><use href="#i-right"/></svg></button>' +
        '</section>';
    }).join('');
  }

  function mountStrips(keep) {
    P.plan.legs.forEach((leg, i) => {
      const el = $('plTl' + i);
      if (!el) return;
      const d = legData(leg);
      ZJ.Timeline.mount(leg.dir, {
        el: el,
        board: leg.fromOrder,
        alight: leg.toOrder,
        vehicles: d.vehicles,
        focus: leg.fromOrder,
        restore: keep ? keep[i] : null,
        stopAct: 'noop'
      });
      ZJ.Timeline.bindHint($('plSc' + i), $('plHint' + i));
    });
  }

  function render(keepScroll) {
    if (!P.plan) return;
    const keep = keepScroll ? P.plan.legs.map((l, i) => {
      const sc = $('plSc' + i);
      return sc ? sc.scrollLeft : null;
    }) : null;
    renderSummary();
    renderLegs();
    mountStrips(keep);
  }

  function syncHeader() {
    $('plTitle').textContent = P.plan.transfers === 0 ? '直达方案' : '换乘方案';
    $('plSub').textContent = P.from + ' → ' + P.to + ' · ' +
      (P.plan.transfers === 0 ? '直达 · 乘 ' + P.plan.stops + ' 站' : P.plan.transfers + ' 次换乘 · 共 ' + P.plan.stops + ' 站');
  }

  async function loadAll() {
    if (!P.plan) return;
    const allOff = P.plan.legs.every((l) => ZJ.Service.info(l.dir, l.fromOrder).off);
    if (allOff) {
      P.data = new Map();
      P.plan.legs.forEach((l) => P.data.set(l.dir.id, { vehicles: [], err: '', at: Date.now(), loading: false }));
      P.req++;
      render(true);
      return;
    }
    const rid = ++P.req;
    P.plan.legs.forEach((leg) => {
      const old = P.data.get(leg.dir.id) || {};
      P.data.set(leg.dir.id, { vehicles: old.vehicles || [], err: '', at: old.at || 0, loading: !old.at });
    });
    render(true);
    await ZJ.batch(P.plan.legs, 3, async (leg) => {
      try {
        const data = await ZJ.Api.vehicles(leg.dir.id);
        if (rid !== P.req) return;
        P.data.set(leg.dir.id, { vehicles: ZJ.RT.normalize(leg.dir, data), err: '', at: Date.now(), loading: false });
      } catch (e) {
        if (rid !== P.req) return;
        P.data.set(leg.dir.id, { vehicles: [], err: (e && e.message) || '网络异常', at: Date.now(), loading: false });
        /* 实时失效：缓存时刻表，关闭到站预估后仍有班次可看 */
        if (ZJ.Api.mode !== 'static') ZJ.Timetable.load(leg.dir).then(() => { if (rid === P.req) render(true); });
      }
    });
    if (rid !== P.req) return;
    render(true);
  }

  function startPoll() {
    stopPoll();
    P.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && $('page-plan').classList.contains('on')) loadAll();
    }, ZJ.CFG.LINE_POLL);
  }
  function stopPoll() { if (P.timer) clearInterval(P.timer); P.timer = null; }

  const Plan = {
    open(plan, from, to) {
      if (!plan || !plan.legs || !plan.legs.length) { ZJ.toast('方案信息不完整'); return; }
      P.plan = plan;
      P.origin = plan;
      P.from = from || plan.legs[0].from;
      P.to = to || plan.legs[plan.legs.length - 1].to;
      P.plan.from = P.from;
      P.plan.to = P.to;
      P.data = new Map();
      P.req++;
      $('plSummary').innerHTML = '';
      $('plLegs').innerHTML = '<div class="pl-loading"><span class="spin"></span>正在获取分段实时公交…</div>';
      syncHeader();
      ZJ.UI.openFull('page-plan');
      render();
      loadAll();
      startPoll();
    },
    close() {
      stopPoll();
      P.req++;
      ZJ.UI.closeFull('page-plan');
    },
    refresh() { ZJ.Api.resetHealth(); loadAll(); },
    /* 数据版本更新后：按当前起终点重新规划并保持详情页打开 */
    afterData() {
      if (!$('page-plan').classList.contains('on')) return;
      const res = ZJ.Planner.search(P.from, P.to, 'fast');
      const next = res.plans[0];
      if (!next) { Plan.close(); ZJ.toast('线路数据已更新，请重新查询'); return; }
      P.plan = next;
      P.origin = next;
      P.data = new Map();
      P.req++;
      syncHeader();
      render();
      loadAll();
    },
    state() { return P; }
  };
  ZJ.Plan = Plan;

  /* 就地改上/下车站：同一条线路内改站，立即重算，不跳独立线路页 */
  function changeHop(i, kind, name) {
    const p = P.plan;
    const origin = P.origin;
    const leg = p.legs[i];
    if (!leg) return;
    const order = leg.dir.stops.findIndex((s) => s.name === name) + 1;
    if (!order) { ZJ.toast('该站不在本线路'); return; }
    if (kind === 'board') {
      if (order >= leg.toOrder) { ZJ.toast('上车站必须在第 ' + leg.toOrder + ' 站之前'); return; }
    } else if (order <= leg.fromOrder) {
      ZJ.toast('下车站必须在第 ' + leg.fromOrder + ' 站之后'); return;
    }
    const next = ZJ.Planner.makeLeg(leg.dir, kind === 'board' ? order : leg.fromOrder, kind === 'alight' ? order : leg.toOrder);
    p.legs[i] = next;
    const rebuilt = ZJ.Planner.rebuild(p);
    rebuilt.from = P.from;
    rebuilt.to = P.to;
    P.plan = rebuilt;
    P.origin = rebuilt;
    if (i === 0 && kind === 'board') {
      P.from = name;
      ZJ.Go.setEndpoints(name, P.to, { noHistory: true });
    } else if (i === p.legs.length - 1 && kind === 'alight') {
      P.to = name;
      ZJ.Go.setEndpoints(P.from, name, { noHistory: true });
    } else {
      ZJ.Go.replacePlan(origin, rebuilt);
    }
    syncHeader();
    render();
    loadAll();
    ZJ.toast('已改为「' + name + '」，路线已重新计算');
  }

  ZJ.act('plan-back', () => Plan.close());
  ZJ.act('plan-refresh', () => { ZJ.Api.resetHealth(); loadAll(); ZJ.toast('正在重新获取实时数据…'); });
  ZJ.act('pl-hop', (el) => {
    const i = +el.dataset.leg, kind = el.dataset.kind;
    const leg = P.plan.legs[i];
    if (!leg) return;
    ZJ.Picker.open(kind === 'board' ? '改上车站' : '改下车站', { line: leg.line, dirKey: leg.dir.key }, (name) => changeHop(i, kind, name));
  });
  ZJ.act('pl-full-line', (el) => {
    ZJ.Line.open(el.dataset.line, el.dataset.dir, el.dataset.station);
  });
  ZJ.act('pl-bell', (el) => {
    ZJ.Reminder.openSheet({ line: el.dataset.line, dirKey: el.dataset.dir, station: el.dataset.station }, () => {
      render(true);
      if (ZJ.Home) ZJ.Home.renderReminders();
    });
  });
  ZJ.act('pl-hl', (el) => {
    const i = Number(el.dataset.idx) || 0;
    const card = document.querySelectorAll('#plLegs .pl-leg')[i];
    if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
})();
