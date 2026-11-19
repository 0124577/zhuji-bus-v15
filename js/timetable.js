/* 发车时刻表缓存：实时车辆接口不可用时，用时刻表替代「预计到站」 */
(function () {
  const ZJ = window.ZJ;
  const T = { cache: new Map(), loading: new Map() };

  function toMin(t) {
    const m = String(t || '').match(/(\d{1,2}):(\d{2})/);
    return m ? +m[1] * 60 + +m[2] : null;
  }

  async function load(dirId) {
    if (ZJ.Api.mode === 'static') return [];
    const hit = T.cache.get(dirId);
    if (hit && Date.now() - hit.at < 30 * 60 * 1000) return hit.list;
    if (T.loading.has(dirId)) return T.loading.get(dirId);
    const p = (async () => {
      try {
        const list = await ZJ.Api.plan(dirId);
        const out = (Array.isArray(list) ? list : []).map((x) => String(x)).filter((x) => toMin(x) != null);
        T.cache.set(dirId, { at: Date.now(), list: out });
        return out;
      } catch (e) {
        T.cache.set(dirId, { at: Date.now(), list: [] });
        return [];
      } finally {
        T.loading.delete(dirId);
      }
    })();
    T.loading.set(dirId, p);
    return p;
  }

  function pick(list, dir, order, count) {
    const now = ZJ.nowMin();
    const ride = order && order > 1 ? ZJ.Data.rideMinutes(dir, 1, order) : 0;
    const out = [];
    (list || []).forEach((t) => {
      const dep = toMin(t);
      if (dep == null) return;
      const atBoard = dep + ride;
      if (atBoard + 1 < now) return;
      out.push({ dep: t.length > 5 ? t.slice(0, 5) : t, atBoard: atBoard });
    });
    out.sort((a, b) => a.atBoard - b.atBoard);
    return out.slice(0, count || 3);
  }

  const Timetable = {
    load: load,
    /* 同步读取已缓存时刻表；没有缓存返回 null（界面据此显示「时刻表获取中」） */
    cached(dir, order, count) {
      const hit = dir && T.cache.get(dir.id);
      if (!hit || !hit.list.length) return null;
      return pick(hit.list, dir, order, count);
    },
    async next(dir, order, count) {
      const list = await load(dir.id);
      return pick(list, dir, order, count);
    },
    /* 给界面用的一行文字：07:15 · 07:35 · 07:55 */
    line(dir, order, count) {
      const arr = Timetable.cached(dir, order, count);
      if (!arr) return '';
      return arr.map((x) => x.dep).join(' · ');
    },
    text(dir, order) {
      if (ZJ.Api.mode === 'static') return '静态模式 · 仅首末班';
      const arr = Timetable.cached(dir, order, 3);
      if (!arr) return '暂不可用';
      if (!arr.length) return '今日班次已发完';
      return arr.map((x) => x.dep).join(' · ');
    }
  };
  ZJ.Timetable = Timetable;
})();
