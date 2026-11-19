/* 站点实时页：途经线路的车辆位置 / 剩余站 / 预计到站 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Data = ZJ.Data;

  const S = { name: '', at: 0, err: '', loading: false, rows: [], timer: null, req: 0 };

  function renderHeader() {
    const st = Data.stationOf(S.name);
    $('stName').textContent = S.name;
    let sub = (st ? st.entries.length : 0) + ' 个方向途经本站';
    if (ZJ.Geo && ZJ.Geo.state === 'ok' && st && st.lat) {
      sub += ' · 距我 ' + ZJ.distTxt(ZJ.hav(ZJ.Geo.lat, ZJ.Geo.lng, st.lat, st.lng));
    }
    $('stSub').textContent = sub;
    const fav = $('stFav');
    if (fav) fav.classList.toggle('on', ZJ.Fav.hasStation(S.name));
  }

  function renderSummary() {
    const withBus = S.rows.filter((r) => r.best);
    const now = Date.now();
    if (S.err) {
      $('stSummary').innerHTML = '<b>实时数据暂不可用</b><span>' + ZJ.esc(S.err) + '</span><span class="upd" data-act="station-refresh">重试</span>';
      return;
    }
    if (!S.at) {
      $('stSummary').innerHTML = '<b>正在查询车辆…</b><span>共 ' + S.rows.length + ' 个方向</span>';
      return;
    }
    $('stSummary').innerHTML =
      '<b>' + (withBus.length ? withBus.length + ' 个方向有车' : '暂无车辆') + '</b>' +
      '<span>途经 ' + S.rows.length + ' 个方向</span>' +
      '<span class="upd" data-act="station-refresh">更新 ' + ZJ.clock(new Date(S.at)) + '</span>';
  }

  function renderRows() {
    const box = $('stLines');
    if (S.loading && !S.rows.length) {
      box.innerHTML = '<div class="loading"><span class="spin"></span>正在查询途经车辆…</div>';
      return;
    }
    if (!S.rows.length) {
      box.innerHTML = '<div class="plan-empty"><b>该站点暂无线路数据</b>请返回重新选择站点</div>';
      return;
    }
    box.innerHTML = S.rows.map((r) => {
      const d = r.dir;
      const b = r.best;
      /* 首末班校验：收班 / 首班前不显示剩余站数与到站时间 */
      const svc = ZJ.Service.info(d, r.order);
      const ttOff = !svc.off && (ZJ.Api.liveOff || !!S.err);
      let eta = '<span class="eta none">—</span>';
      if (svc.off) eta = '<span class="eta off">' + (svc.state === 'closed' ? '已收班' : '首班未发') + '</span>';
      else if (ttOff) eta = '<span class="eta dim">时刻表</span>';
      else if (b) eta = '<span class="eta">' + (b.atStation ? '已到站' : '约 ' + b.minutes + ' 分') + '</span>';
      const buses = r.arr.slice(0, 3).map((x) =>
        '<div class="st-bus"><span class="live"></span><span class="plate">' + ZJ.esc(x.v.plate || '车辆') + '</span>' +
        '<span class="where">' + ZJ.esc(ZJ.RT.positionText(d, x.v)) + '</span>' +
        '<span class="mins">' + (x.atStation ? '已到站' : x.remain + ' 站 · ' + x.minutes + ' 分') + '</span></div>').join('');
      return '<button class="st-line" data-act="st-open-line" data-line="' + ZJ.esc(r.line) + '" data-dir="' + d.key + '">' +
        '<div class="st-line-h"><span class="leg-badge">' + ZJ.esc(r.line) + '</span>' +
        '<span class="rt"><b>往 ' + ZJ.esc(d.end) + '</b><span>首 ' + ZJ.esc(d.first) + ' · 末 ' + ZJ.esc(d.last) + ' · 本站第 ' + r.order + ' 站</span></span>' +
        eta + '</div>' +
        (svc.off
          ? '<div class="st-buses"><div class="st-bus"><span class="where">' + ZJ.esc(ZJ.Service.note(svc)) +
            ' · ' + ZJ.esc(ZJ.Service.resume(svc)) + '</span><span class="mins none">不在运营时段</span></div></div>'
          : ttOff ? '<div class="st-buses"><div class="st-bus"><span class="where">实时车辆不可用，已关闭到站预估</span><span class="mins none">时刻表 ' +
              ZJ.esc(ZJ.Timetable.text(d, r.order)) + '</span></div></div>'
          : buses ? '<div class="st-buses">' + buses + '</div>'
            : '<div class="st-buses"><div class="st-bus"><span class="where">当前没有开往本站的车辆</span><span class="mins none">' +
              (r.err ? ZJ.esc(r.err) : '稍后刷新') + '</span></div></div>') +
        '</button>';
    }).join('');
  }

  function renderAll() {
    renderHeader();
    renderSummary();
    renderRows();
  }

  async function load() {
    const rid = ++S.req;
    S.loading = true;
    S.err = '';
    renderSummary();
    const st = Data.stationOf(S.name);
    if (!st) {
      S.rows = [];
      S.loading = false;
      renderRows();
      return;
    }
    if (ZJ.Api.mode === 'static') {
      S.rows = st.entries.map((e) => ({ line: e.line, dir: e.dir, order: e.order, arr: [], best: null, err: '静态模式' }));
      S.rows.sort((a, b) => a.line.localeCompare(b.line, 'zh'));
      S.at = Date.now();
      S.loading = false;
      renderAll();
      return;
    }
    const results = await ZJ.batch(st.entries, 4, async (e) => {
      const row = { line: e.line, dir: e.dir, order: e.order, arr: [], best: null, err: '' };
      try {
        const data = await ZJ.Api.vehicles(e.dir.id);
        const list = ZJ.RT.normalize(e.dir, data);
        row.arr = ZJ.RT.arrivalsTo(e.dir, list, e.order);
        row.best = row.arr[0] || null;
      } catch (err) {
        row.err = err.message || '网络异常';
      }
      return row;
    });
    if (rid !== S.req) return;
    const fails = results.filter((r) => r.err).length;
    S.rows = results;
    S.rows.sort((a, b) => {
      const am = a.best ? a.best.minutes : 9999;
      const bm = b.best ? b.best.minutes : 9999;
      return am - bm || a.line.localeCompare(b.line, 'zh');
    });
    S.err = fails === results.length && results.length ? '网络异常，未能获取实时车辆' : '';
    if (S.err || ZJ.Api.liveOff) st.entries.forEach((e) => { if (ZJ.Api.mode !== 'static') ZJ.Timetable.load(e.dir); });
    S.loading = false;
    S.at = Date.now();
    renderAll();
    if (fails && fails < results.length) ZJ.toast(fails + ' 个方向刷新失败');
  }

  function startPoll() {
    stopPoll();
    S.timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, ZJ.CFG.STATION_POLL);
  }
  function stopPoll() {
    if (S.timer) clearInterval(S.timer);
    S.timer = null;
  }

  const Station = {
    open(name) {
      if (!Data.stationOf(name)) { ZJ.toast('站点不存在'); return; }
      S.name = name;
      S.rows = [];
      S.at = 0;
      S.err = '';
      S.loading = true;
      ZJ.UI.openFull('page-station');
      renderAll();
      load();
      startPoll();
    },
    close() {
      stopPoll();
      S.req++;
      ZJ.UI.closeFull('page-station');
    },
    refresh() { load(); }
  };
  ZJ.Station = Station;

  ZJ.act('station-back', () => Station.close());
  ZJ.act('station-refresh', () => load());
  ZJ.act('st-open-line', (el) => {
    ZJ.Line.open(el.dataset.line, el.dataset.dir, S.name);
  });
  ZJ.act('station-fav', () => {
    const on = ZJ.Fav.toggleStation(S.name);
    const fav = $('stFav');
    if (fav) fav.classList.toggle('on', on);
    ZJ.toast(on ? '已收藏站点 ' + S.name : '已取消收藏');
    if (ZJ.Home) ZJ.Home.renderFav();
  });
})();
