/* 接口层：官方实时接口（预留）+ 静态数据兜底模式 */
(function () {
  const ZJ = window.ZJ;
  const CFG = ZJ.CFG;
  const modeParam = (location.search.match(/[?&]mode=(static|api)/) || [])[1];
  let mode = modeParam || ZJ.Store.get('zjbus.datamode', 'api');
  if (mode !== 'static') mode = 'api';

  const cache = new Map();
  const planCache = new Map();

  function checkJson(j) {
    const code = String(j.code || j.returnFlag || '');
    if (code !== '200') throw new Error(j.msg || j.returnInfo || '接口返回异常');
    return j.data || {};
  }

  function post(path, body) {
    return new Promise((resolve, reject) => {
      if (!navigator.onLine) return reject(new Error('设备未联网'));
      const xhr = new XMLHttpRequest();
      xhr.open('POST', CFG.API_BASE + path, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.timeout = 12000;
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('服务暂不可用（' + xhr.status + '）'));
        try { resolve(checkJson(JSON.parse(xhr.responseText))); } catch (e) {
          reject(new Error('数据解析失败'));
        }
      };
      xhr.onerror = () => reject(new Error('网络异常，请检查网络'));
      xhr.ontimeout = () => reject(new Error('网络超时，请重试'));
      xhr.onabort = () => reject(new Error('请求已取消'));
      xhr.send(JSON.stringify({ h: CFG.API_H, b: body }));
    });
  }

  /* 接口健康度：连续失败即视为实时能力不可用，页面据此自动降级为静态数据 */
  const health = { fails: 0, lastError: '', degraded: false, lastOk: 0, lastFail: 0 };
  function markOk() {
    if (health.fails || health.degraded) health.lastOk = Date.now();
    health.fails = 0;
    health.degraded = false;
    health.lastError = '';
  }
  function markFail(e) {
    health.fails++;
    health.lastError = (e && e.message) || '网络异常';
    health.lastFail = Date.now();
    if (health.fails >= 2) health.degraded = true;
  }

  async function postRetry(path, body) {
    try {
      const r = await post(path, body);
      markOk();
      return r;
    } catch (e) {
      if (/未联网|网络异常|超时/.test(e.message)) {
        await new Promise((r) => setTimeout(r, 350));
        try {
          const r2 = await post(path, body);
          markOk();
          return r2;
        } catch (e2) {
          markFail(e2);
          throw e2;
        }
      }
      markFail(e);
      throw e;
    }
  }

  const Api = {
    get mode() { return mode; },
    /* 实时接口是否已降级（连续 2 次请求失败） */
    get degraded() { return health.degraded; },
    /* 实时预估能力整体不可用：只展示时刻表，不再给「还有几站 / 几分钟」 */
    get liveOff() { return mode === 'static' || health.degraded; },
    get health() { return { fails: health.fails, lastError: health.lastError, degraded: health.degraded, lastOk: health.lastOk }; },
    resetHealth() { health.fails = 0; health.degraded = false; health.lastError = ''; },
    setMode(m) {
      mode = m === 'static' ? 'static' : 'api';
      ZJ.Store.set('zjbus.datamode', mode);
      if (mode === 'api') Api.resetHealth();
    },
    /* 线路详情（含站点序列、首末班、票价）—— 官方接口按 lineId 查询 */
    async lineDetail(dirId) {
      if (mode === 'static') return null;
      if (cache.has(dirId)) return cache.get(dirId);
      const data = await postRetry('/gzcx-busServer/client/busLine/queryLine', { lineId: dirId });
      cache.set(dirId, data);
      return data;
    },
    /* 全天发车时刻表
       该接口部分线路会返回 500，属于单条线路缺时刻表，不应影响实时车辆能力：
       所以这里不走健康度统计，失败只记录本条线路为空。 */
    async plan(dirId) {
      if (mode === 'static') return null;
      if (planCache.has(dirId)) return planCache.get(dirId);
      try {
        const data = await post('/gzcx-busServer/client/busLine/getBusLinePlanSimpleTime', { lineId: dirId });
        const list = Array.isArray(data) ? data : [];
        planCache.set(dirId, list);
        return list;
      } catch (e) {
        planCache.set(dirId, []);
        throw e;
      }
    },
    /* 线路实时车辆 */
    async vehicles(dirId) {
      if (mode === 'static') return { list: [], busAverageSpeed: CFG.AVG_SPEED, static: true };
      const data = await postRetry('/gzcx-busServer/client/bus/vehicle/dynamic/line/details', { lineId: dirId });
      return {
        list: Array.isArray(data.list) ? data.list : [],
        busAverageSpeed: Number(data.busAverageSpeed) || CFG.AVG_SPEED,
        startTime: data.startTime || '',
        static: false
      };
    }
  };
  ZJ.Api = Api;

  /* ================= 实时数据加工 ================= */
  const RT = {
    /* 把接口车辆列表标准化 */
    normalize(dir, data) {
      const speed = Number(data.busAverageSpeed) > 0 ? Number(data.busAverageSpeed) : CFG.AVG_SPEED;
      const n = dir.stops.length;
      const out = [];
      (data.list || []).forEach((b) => {
        const order = Number(b.vehicleOrder) || 0;
        if (order < 1 || order > n) return;
        const segLen = dir.stops[order - 1].seg || 0;
        const distNext = Math.max(0, Number(b.distance) || 0);
        const progress = segLen > 0 ? Math.max(0, Math.min(1, 1 - distNext / segLen)) : 0;
        const arrived = Number(b.isArriveStation) === 1;
        out.push({
          raw: b,
          order: order,
          plate: b.plateNumber || '',
          gps: b.gpsTime || '',
          lat: (Number(b.lat) || 0),
          lng: (Number(b.lng) || 0),
          segLen: segLen,
          distNext: distNext,
          progress: progress,
          arrived: arrived,
          /* 时间轴上的连续位置：0 基站点索引 + 行进比例 */
          pos: (order - 1) + (arrived ? 0 : progress),
          speed: speed
        });
      });
      return out;
    },
    /* 车辆到某站（1 基序号）的剩余站数 / 距离 / 分钟；已过站返回 null */
    etaTo(dir, v, targetOrder) {
      if (v.order > targetOrder) return null;
      if (v.order === targetOrder) {
        if (!v.arrived) return null; // 已离站，驶向下一站
        return { remain: 0, meters: 0, minutes: 0, atStation: true };
      }
      let meters = v.distNext;
      for (let i = v.order - 1; i < targetOrder - 1; i++) meters += dir.stops[i].seg || 0;
      const remain = targetOrder - v.order;
      const minutes = Math.max(1, Math.round(meters / v.speed + remain * CFG.DWELL));
      return { remain: remain, meters: meters, minutes: minutes, atStation: false };
    },
    /* 车辆当前位置文案 */
    positionText(dir, v) {
      const n = dir.stops.length;
      const cur = dir.stops[v.order - 1];
      if (v.arrived || v.order >= n) return '停靠「' + cur.name + '」';
      const next = dir.stops[v.order];
      return '「' + cur.name + '」→「' + next.name + '」之间 · 距 ' + next.name + ' ' + Math.round(v.distNext) + ' 米';
    },
    /* 该方向所有车辆到目标站的预计到达（按分钟升序） */
    arrivalsTo(dir, list, targetOrder) {
      const arr = [];
      list.forEach((v) => {
        const e = RT.etaTo(dir, v, targetOrder);
        if (e) arr.push({ v: v, remain: e.remain, meters: e.meters, minutes: e.minutes, atStation: e.atStation });
      });
      arr.sort((a, b) => a.minutes - b.minutes || a.meters - b.meters);
      return arr;
    }
  };
  ZJ.RT = RT;

  /* 并发受限的批量查询 */
  ZJ.batch = async function (items, size, fn) {
    const out = [];
    for (let i = 0; i < items.length; i += size) {
      const part = await Promise.all(items.slice(i, i + size).map(fn));
      out.push(...part);
    }
    return out;
  };
})();
