/* 路线规划引擎：出行页与 AI 助手共用（全部本地静态数据计算） */
(function () {
  const ZJ = window.ZJ;
  const Data = ZJ.Data;

  const PREFS = {
    fast: { key: 'fast', label: '最快到达', hint: '优先总耗时最短' },
    transfer: { key: 'transfer', label: '少换乘', hint: '优先直达与换乘次数少' },
    walk: { key: 'walk', label: '少走路', hint: '优先步行距离短' }
  };

  function walkMetersOf(transfers) {
    /* 官方数据没有站间步行路径，按每次换乘 150 米、起终点接驳 0 米估算 */
    return Math.max(0, transfers) * 150;
  }

  function makeLeg(dir, fromOrder, toOrder) {
    return {
      line: dir.line,
      dir: dir,
      fromOrder: fromOrder,
      toOrder: toOrder,
      from: dir.stops[fromOrder - 1].name,
      to: dir.stops[toOrder - 1].name,
      stops: toOrder - fromOrder,
      meters: Math.max(0, dir.stops[toOrder - 1].cum - dir.stops[fromOrder - 1].cum),
      minutes: Data.rideMinutes(dir, fromOrder, toOrder),
      key: dir.id + ':' + fromOrder + '-' + toOrder
    };
  }

  function buildPlan(legs) {
    const transfers = Math.max(0, legs.length - 1);
    const ride = legs.reduce((s, l) => s + l.minutes, 0);
    const total = ride + transfers * 5;
    const meters = legs.reduce((s, l) => s + l.meters, 0);
    const stops = legs.reduce((s, l) => s + l.stops, 0);
    return {
      legs: legs,
      transfers: transfers,
      total: total,
      ride: ride,
      meters: meters,
      stops: stops,
      walkMeters: walkMetersOf(transfers),
      key: legs.map((l) => l.key).join('>')
    };
  }

  function annotate(p) {
    p.svcs = p.legs.map((l) => ZJ.Service.info(l.dir, l.fromOrder));
    p.closed = p.svcs.some((s) => s.state === 'closed');
    p.before = p.svcs.some((s) => s.state === 'before');
    p.off = p.closed || p.before;
    p.lastGone = !p.off && p.svcs.some((s) => s.state === 'lastGone');
    p.offInfo = p.svcs.filter((s) => s.off)[0] || null;
    p.state = p.closed ? 'closed' : p.before ? 'before' : p.lastGone ? 'lastGone' : 'running';
    p.walkMeters = p.walkMeters == null ? walkMetersOf(p.transfers) : p.walkMeters;
    return p;
  }

  function rebuild(plan) {
    const next = buildPlan(plan.legs.slice());
    next.from = plan.from;
    next.to = plan.to;
    return annotate(next);
  }

  function dedupe(list, limit) {
    const map = new Map();
    list.forEach((p) => {
      const old = map.get(p.key);
      if (!old || p.total < old.total) map.set(p.key, p);
    });
    return [...map.values()].sort((a, b) => a.transfers - b.transfers || a.total - b.total).slice(0, limit || 8);
  }

  function findDirect(from, to) {
    const out = [];
    const a = Data.stationMap.get(from), b = Data.stationMap.get(to);
    if (!a || !b) return out;
    a.entries.forEach((x) => b.entries.forEach((y) => {
      if (x.dir === y.dir && y.order > x.order) out.push(buildPlan([makeLeg(x.dir, x.order, y.order)]));
    }));
    return dedupe(out);
  }

  function endReach(to) {
    const map = new Map();
    const best = new Map();
    const t = Data.stationMap.get(to);
    if (!t) return { map: map, best: best };
    t.entries.forEach((e) => {
      const d = e.dir;
      for (let o = 1; o < e.order; o++) {
        if (!map.has(d.id)) map.set(d.id, new Map());
        const m = Data.rideMinutes(d, o, e.order);
        const old = map.get(d.id).get(o);
        if (!old || m < old.minutes) map.get(d.id).set(o, { entry: e, minutes: m });
      }
    });
    map.forEach((orders, dirId) => {
      const d = Data.dirs.get(dirId);
      orders.forEach((v, order) => {
        const name = d.stops[order - 1].name;
        const old = best.get(name);
        if (!old || v.minutes < old.minutes) best.set(name, { dir: d, boardOrder: order, entry: v.entry, minutes: v.minutes });
      });
    });
    return { map: map, best: best };
  }

  function findTransfer(from, to, reach) {
    const out = [];
    const a = Data.stationMap.get(from);
    if (!a) return out;
    a.entries.forEach((x) => {
      const d = x.dir;
      for (let o = x.order + 1; o <= d.stops.length; o++) {
        const tName = d.stops[o - 1].name;
        if (tName === to) continue;
        const hub = Data.stationMap.get(tName);
        if (!hub) continue;
        hub.entries.forEach((y) => {
          if (y.dir === d) return;
          const next = (reach.map.get(y.dir.id) || new Map()).get(y.order);
          if (!next) return;
          out.push(buildPlan([makeLeg(d, x.order, o), makeLeg(y.dir, y.order, next.entry.order)]));
        });
      }
    });
    return dedupe(out);
  }

  function findTwoTransfer(from, to, reach) {
    const out = [];
    const a = Data.stationMap.get(from);
    if (!a) return out;
    let stopped = false;
    a.entries.forEach((x) => {
      if (stopped) return;
      const d1 = x.dir;
      for (let o1 = x.order + 1; o1 <= d1.stops.length && !stopped; o1++) {
        const h1 = d1.stops[o1 - 1].name;
        if (h1 === to) continue;
        const s1 = Data.stationMap.get(h1);
        if (!s1) continue;
        s1.entries.forEach((y) => {
          if (stopped || y.dir === d1) return;
          const d2 = y.dir;
          for (let o2 = y.order + 1; o2 <= d2.stops.length; o2++) {
            const h2 = d2.stops[o2 - 1].name;
            if (h2 === from || h2 === to || h2 === h1) continue;
            const c = reach.best.get(h2);
            if (!c || c.entry.dir === d2) continue;
            out.push(buildPlan([makeLeg(d1, x.order, o1), makeLeg(d2, y.order, o2), makeLeg(c.dir, c.boardOrder, c.entry.order)]));
            if (out.length > 200) { stopped = true; return; }
          }
        });
      }
    });
    return dedupe(out);
  }

  function walkInfo(from, to) {
    const a = Data.stationOf(from), b = Data.stationOf(to);
    if (!a || !b || !a.lat || !b.lat) return null;
    const meters = Math.round(ZJ.hav(a.lat, a.lng, b.lat, b.lng));
    if (!(meters > 0) || meters > 1200) return null;
    return { meters: meters, minutes: Math.max(1, Math.round(meters / 70)) };
  }

  function sortBy(plans, pref) {
    const arr = plans.slice();
    if (pref === 'transfer') arr.sort((a, b) => a.transfers - b.transfers || a.total - b.total);
    else if (pref === 'walk') arr.sort((a, b) => a.walkMeters - b.walkMeters || a.total - b.total);
    else arr.sort((a, b) => a.total - b.total || a.transfers - b.transfers);
    return arr;
  }

  /* 统一入口：直达优先，其次 1 次换乘，最后 2 次换乘；按偏好排序；收班过滤 */
  function search(from, to, pref) {
    const out = { from: from, to: to, pref: pref || 'fast', plans: [], walk: null, allClosed: false };
    if (!from || !to || from === to) return out;
    let plans = findDirect(from, to);
    if (plans.length < 4) {
      const reach = endReach(to);
      plans = dedupe(plans.concat(findTransfer(from, to, reach)), 8);
      if (!plans.length) plans = findTwoTransfer(from, to, reach);
    }
    plans = plans.map(annotate);
    const avail = plans.filter((p) => !p.off);
    out.allClosed = plans.length > 0 && avail.length === 0;
    const picked = avail.length ? avail : plans;
    out.plans = sortBy(picked, out.pref).slice(0, 6);
    out.walk = walkInfo(from, to);
    out.hasClosed = plans.some((p) => p.off);
    return out;
  }

  ZJ.Planner = {
    PREFS: PREFS,
    makeLeg: makeLeg,
    buildPlan: buildPlan,
    rebuild: rebuild,
    annotate: annotate,
    dedupe: dedupe,
    walkInfo: walkInfo,
    walkMetersOf: walkMetersOf,
    sortBy: sortBy,
    search: search
  };
})();
