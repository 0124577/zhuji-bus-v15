/* AI 出行助手：本地语义解析 + 现有路线规划引擎
   - 识别起终点、出行偏好（最快 / 少换乘 / 少走路）、线路首末班与收班状态
   - 回复文字总结 + 可点击方案卡，点卡片进入换乘详情页
   - 不发送系统推送，完全复用数据同步 / 降级逻辑
*/
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const A = { msgs: [], ctx: null, plans: [], prefs: 'fast', welcomed: false, thinking: false };
  let stationCache = null;

  function stations() {
    if (!stationCache || stationCache.n !== ZJ.Data.stations.length) {
      stationCache = {
        n: ZJ.Data.stations.length,
        list: ZJ.Data.stations.slice().sort((a, b) => b.name.length - a.name.length)
      };
    }
    return stationCache.list;
  }

  /* 从一句话里按出现顺序抽出站点（长名优先，避免「西施殿」吃掉「西施殿公交首末站」） */
  function findStations(text) {
    const used = [];
    const hit = [];
    stations().forEach((s) => {
      let from = 0;
      while (from <= text.length) {
        const i = text.indexOf(s.name, from);
        if (i < 0) break;
        const end = i + s.name.length;
        const clash = used.some((u) => i < u.end && end > u.start);
        if (!clash) {
          used.push({ start: i, end: end });
          hit.push({ name: s.name, at: i });
          break;
        }
        from = i + 1;
      }
    });
    hit.sort((a, b) => a.at - b.at);
    return hit.map((x) => x.name);
  }

  function findLine(text) {
    const m = text.match(/([0-9]{1,3}|[A-Za-z]\d{1,3})路/);
    if (m) {
      const line = ZJ.Data.lineOf(m[1] + '路') || ZJ.Data.lineOf(m[0]);
      if (line) return line;
      const hit = ZJ.Data.searchLines(m[1], 1);
      if (hit.length) return hit[0];
    }
    return null;
  }

  function prefOf(text) {
    if (/(少走路|走路少|步行少|不想走|腿脚)/.test(text)) return 'walk';
    if (/(少换乘|不换乘|直达|少倒车)/.test(text)) return 'transfer';
    if (/(最快|赶时间|快一点|时间短|着急)/.test(text)) return 'fast';
    return '';
  }

  function nearestStation() {
    if (!ZJ.Geo || ZJ.Geo.state !== 'ok') return '';
    const list = ZJ.Data.nearby(ZJ.Geo.lat, ZJ.Geo.lng, 1);
    return list.length && list[0].dist < 3000 ? list[0].station.name : '';
  }

  /* ---------------- 解析 ---------------- */
  function parse(raw) {
    const text = String(raw || '').replace(/\s+/g, '');
    const pref = prefOf(text);
    const wantsLineInfo = /(首班|末班|收班|运营时间|几点|发车|时刻表|还有车|有没有车)/.test(text);
    const line = findLine(text);
    if (line && (wantsLineInfo || text.replace(/([0-9]{1,3}|[A-Za-z]\d{1,3})路/, '').length <= 2)) {
      return { type: 'line', line: line, pref: pref };
    }
    const sts = findStations(text);
    if (sts.length >= 2) return { type: 'route', from: sts[0], to: sts[sts.length - 1], pref: pref, text: text };
    if (sts.length === 1) {
      const goThere = /(去|到|往|回)/.test(text);
      if (goThere) return { type: 'route', from: nearestStation(), to: sts[0], pref: pref, needFrom: !nearestStation(), text: text };
      return { type: 'station', station: sts[0], pref: pref };
    }
    if (pref && A.ctx && A.ctx.type === 'route') return { type: 'pref', pref: pref };
    return { type: 'unknown', text: text };
  }

  /* ---------------- 渲染 ---------------- */
  function esc(s) { return ZJ.esc(s); }

  function planCard(p, i) {
    const tag = p.off ? (p.closed ? '已收班' : '首班未发') : '运营中';
    const svc = p.svcs[0];
    return '<button class="ai-plan' + (p.off ? ' off' : '') + '" data-act="ai-open" data-i="' + i + '">' +
      '<span class="ai-plan-h"><b>' + (p.transfers === 0 ? '直达' : p.transfers + ' 次换乘') + '</b>' +
      '<em class="ai-tag ' + (p.off ? 'off' : 'ok') + '">' + tag + '</em>' +
      '<span class="ai-plan-dur">' + (p.off ? '明日参考' : p.total + ' 分钟') + '</span></span>' +
      '<span class="ai-plan-lines">' + p.legs.map((l) => '<i class="leg-badge">' + esc(l.line) + '</i>' + esc(l.from) + '→' + esc(l.to)).join('<i class="ai-sep">›</i>') + '</span>' +
      '<span class="ai-plan-foot">' + (p.off
        ? '运营 ' + esc(svc.firstTxt) + '–' + esc(svc.lastTxt) + ' · 首班 ' + esc(ZJ.Service.resume(svc))
        : '到目的地还有 ' + p.stops + ' 站 · 步行 ' + ZJ.distTxt(p.walkMeters) + ' · 首末 ' + esc(svc.firstTxt) + '/' + esc(svc.lastTxt)) +
      '<i class="ai-go">详情</i></span></button>';
  }

  function routeReply(r) {
    const res = ZJ.Planner.search(r.from, r.to, r.pref || A.prefs);
    A.prefs = r.pref || A.prefs;
    A.ctx = { type: 'route', from: r.from, to: r.to };
    A.plans = res.plans;
    if (!res.plans.length) {
      const near = ZJ.Data.stationOf(r.to) ? ZJ.Data.searchStations(r.to.slice(0, 2), 3).map((s) => s.name).filter((n) => n !== r.to) : [];
      say('没有找到「' + r.from + '」到「' + r.to + '」的公交方案。可以换个邻近站点试试。',
        null, near.length ? near.slice(0, 3).map((n) => ({ label: r.from + ' → ' + n, q: '从' + r.from + '到' + n })) : []);
      return;
    }
    const best = res.plans[0];
    const prefTxt = ZJ.Planner.PREFS[res.pref].label;
    let text = r.from + ' → ' + r.to + '：找到 ' + res.plans.length + ' 套方案（按' + prefTxt + '排序）。';
    text += '推荐 ' + best.legs.map((l) => l.line).join(' 换 ') + '，全程约 ' + best.total + ' 分钟，到目的地还有 ' + best.stops + ' 站。';
    if (best.off) text += '现在已收班，以下班次仅供明日参考。';
    else if (best.lastGone) text += '末班车已发出，出发前请留意。';
    if (res.walk) text += '两地直线 ' + ZJ.distTxt(res.walk.meters) + '，步行约 ' + res.walk.minutes + ' 分钟。';
    if (res.allClosed) text += '今天所有方案都已收班。';
    say(text, res.plans.slice(0, 3).map((p, i) => planCard(p, i)).join(''),
      [
        { label: '最快', act: 'ai-pref', v: 'fast', on: res.pref === 'fast' },
        { label: '少换乘', act: 'ai-pref', v: 'transfer', on: res.pref === 'transfer' },
        { label: '少走路', act: 'ai-pref', v: 'walk', on: res.pref === 'walk' },
        { label: '反向查询', act: 'ai-reverse' }
      ]);
  }

  function lineReply(r) {
    const line = r.line;
    A.ctx = { type: 'line', line: line.name };
    const dirs = line.dirs.map((d) => {
      const svc = ZJ.Service.info(d, 1);
      const st = ZJ.Service.tag(svc);
      const arr = ZJ.Timetable.cached(d, 1, 3);
      const tt = arr && arr.length ? arr.map((x) => x.dep).join(' · ') : '';
      return { dir: d, svc: svc, tag: st, tt: tt };
    });
    const d0 = dirs[0];
    let text = line.name + '：往 ' + d0.dir.end + ' 首班 ' + d0.dir.first + '，末班 ' + d0.dir.last + '，现在' + d0.tag + '。';
    if (d0.svc.state === 'closed') text += '今日末班已发出，' + ZJ.Service.resume(d0.svc) + '。';
    if (d0.svc.state === 'before') text += ZJ.Service.resume(d0.svc) + '。';
    if (d0.tt) text += '最近班次（起点发车）：' + d0.tt + '。';
    if (line.dirs.length > 1) {
      const d1 = dirs[1];
      text += ' 反方向往 ' + d1.dir.end + '：首 ' + d1.dir.first + ' · 末 ' + d1.dir.last + ' · ' + d1.tag + '。';
    }
    say(text, '<button class="ai-btn" data-act="ai-line" data-line="' + esc(line.name) + '">打开「' + esc(line.name) + '」完整线路' +
      '<svg class="ico"><use href="#i-right"/></svg></button>',
      [{ label: '查看途经站点', act: 'ai-line', line: line.name }]);

  }

  function stationReply(r) {
    const st = ZJ.Data.stationOf(r.station);
    A.ctx = { type: 'station', station: r.station };
    if (!st) { say('没有找到「' + r.station + '」这个站点。'); return; }
    const rows = st.entries.slice(0, 5).map((e) => {
      const svc = ZJ.Service.info(e.dir, e.order);
      return '<div class="ai-row"><b>' + esc(e.line) + '</b><span>往 ' + esc(e.dir.end) + ' · 第 ' + e.order + ' 站 · ' +
        ZJ.Service.tag(svc) + '</span></div>';
    }).join('');
    say('「' + r.station + '」共 ' + st.entries.length + ' 个方向途经。点下面按钮看实时到站。',
      '<div class="ai-list">' + rows + '</div>' +
      '<button class="ai-btn" data-act="ai-station" data-name="' + esc(r.station) + '">打开站点实时' +
      '<svg class="ico"><use href="#i-right"/></svg></button>',
      st.entries.slice(0, 2).map((e) => ({ label: '坐 ' + e.line + ' 往 ' + e.dir.end, q: '从' + r.station + '坐' + e.line + '路' })));
  }

  function say(text, html, chips) {
    A.msgs.push({ role: 'bot', text: text, html: html || '', chips: chips || [] });
    render();
  }

  function render() {
    const box = $('aiMsgs');
    if (!box) return;
    if (!A.welcomed) {
      A.welcomed = true;
      A.msgs.push({
        role: 'bot',
        text: '我是出行助手。直接告诉我从哪到哪，或者问某条线路的首末班。',
        html: '',
        chips: [
          { label: '火车站 → 草塔停车场', q: '从火车站到草塔停车场' },
          { label: '1路 首末班', q: '1路首末班几点' },
          { label: '少走路的方案', q: '从火车站到草塔停车场少走路' }
        ]
      });
    }
    box.innerHTML = A.msgs.map((m) => m.role === 'user'
      ? '<div class="ai-msg me"><div class="ai-bub">' + esc(m.text) + '</div></div>'
      : '<div class="ai-msg bot"><div class="ai-ava"><svg class="ico"><use href="#i-ai"/></svg></div>' +
        '<div class="ai-bub">' + esc(m.text) + (m.html || '') + '</div></div>').join('') +
      (A.thinking ? '<div class="ai-msg bot"><div class="ai-ava"><svg class="ico"><use href="#i-ai"/></svg></div>' +
        '<div class="ai-bub typing"><i></i><i></i><i></i></div></div>' : '');
    const last = A.msgs[A.msgs.length - 1];
    const cur = (last && last.chips) ? last.chips : [];
    $('aiChips').innerHTML = cur.map((c, i) =>
      '<button class="ai-chip' + (c.on ? ' on' : '') + '" data-act="' + (c.act || 'ai-chip') + '" data-i="' + i + '"' +
      (c.q ? ' data-q="' + esc(c.q) + '"' : '') + (c.v ? ' data-v="' + esc(c.v) + '"' : '') +
      (c.line ? ' data-line="' + esc(c.line) + '"' : '') + '>' + esc(c.label) + '</button>').join('');
    box.scrollTop = box.scrollHeight;
  }

  function submit(text) {
    const q = String(text || '').trim();
    if (!q || A.thinking) return;
    A.msgs.push({ role: 'user', text: q });
    A.thinking = true;
    render();
    setTimeout(() => {
      let r;
      try { r = parse(q); } catch (e) { r = { type: 'unknown' }; }
      A.thinking = false;
      if (r.type === 'route') {
        if (r.needFrom || !r.from) {
          ZJ.Geo.locate(true).then(() => {
            const near = nearestStation();
            if (near) routeReply(Object.assign({}, r, { from: near, needFrom: false }));
            else say('我还不知道你在哪。可以说「从XX到' + r.to + '」，或先允许定位。', '', [
              { label: '从火车站到' + r.to, q: '从火车站到' + r.to }
            ]);
          }).catch(() => {
            say('我还不知道你在哪。可以说「从XX到' + r.to + '」。', '', [{ label: '从火车站到' + r.to, q: '从火车站到' + r.to }]);
          });
          return;
        }
        routeReply(r);
      } else if (r.type === 'line') lineReply(r);
      else if (r.type === 'station') stationReply(r);
      else if (r.type === 'pref') {
        const c = A.ctx;
        if (c && c.type === 'route') routeReply({ from: c.from, to: c.to, pref: r.pref });
        else say('先告诉我要从哪到哪，我再按「' + ZJ.Planner.PREFS[r.pref].label + '」帮你排。', '', [
          { label: '火车站 → 草塔停车场', q: '从火车站到草塔停车场' }
        ]);
      } else {
        say('我还没听懂。可以这样说：', '', [
          { label: '火车站 → 草塔停车场', q: '从火车站到草塔停车场' },
          { label: '1路 首末班', q: '1路首末班几点' },
          { label: '附近的站', q: '西施殿有哪些线路' }
        ]);
      }
    }, 260);
  }

  const AI = {
    render: render,
    send: submit,
    parse: parse,
    state() { return A; }
  };
  ZJ.AI = AI;

  ZJ.act('ai-chip', (el) => {
    const v = el.dataset.q;
    if (v) submit(v);
  });
  ZJ.act('ai-pref', (el) => {
    const v = el.dataset.v;
    const c = A.ctx;
    if (!c || c.type !== 'route') { submit('从火车站到草塔停车场' + (v === 'walk' ? '少走路' : v === 'transfer' ? '少换乘' : '最快')); return; }
    routeReply({ from: c.from, to: c.to, pref: v });
  });
  ZJ.act('ai-open', (el) => {
    const p = A.plans[+el.dataset.i];
    if (!p) { ZJ.toast('方案已变化，请重新查询'); return; }
    ZJ.Plan.open(p, p.legs[0].from, p.legs[p.legs.length - 1].to);
  });
  ZJ.act('ai-line', (el) => {
    const name = el.dataset.line || (A.ctx && A.ctx.line);
    if (!name) return;
    const line = ZJ.Data.lineOf(name);
    if (line) ZJ.Line.open(name, line.dirs[0].key, line.dirs[0].stops[0].name);
  });
  ZJ.act('ai-station', (el) => {
    const name = el.dataset.name || (A.ctx && A.ctx.station);
    if (name) ZJ.Station.open(name);
  });
  ZJ.act('ai-reverse', () => {
    const c = A.ctx;
    if (c && c.type === 'route') {
      A.msgs.push({ role: 'user', text: '反向：' + c.to + ' → ' + c.from });
      routeReply({ from: c.to, to: c.from, pref: A.prefs });
    }
  });

  let bound = false;
  function boot() {
    if (bound) return;
    bound = true;
    const form = $('aiForm');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const input = $('aiQ');
        const v = input.value;
        input.value = '';
        submit(v);
      });
    }
    render();
  }
  window.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
