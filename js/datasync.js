/* 数据同步 / 降级自愈
   1. 版本号增量同步：清单含版本号与每个分片哈希，只下载哈希变化的分片
   2. 每 2 天全量校准：本地分片哈希与官方清单逐个比对，不一致的分片自动重下修复
   3. 官方接口不可用 → 使用本地最后一份有效快照（内置基线或本地缓存）
   4. 全程静默：不弹窗、不通知、不置红点；数据过期只在界面上给一行静态提示
   5. 数据更新后自动重建索引，首末班 / 收班校验随新数据立即生效
*/
(function () {
  const ZJ = window.ZJ;
  const NS = 'zjbus.ds.v1';
  const META = 'zjbus.sync.v1';
  const DAY = 86400000;

  function fnv1a(str) {
    let h = 0x811c9dc5;
    const bytes = new TextEncoder().encode(String(str));
    for (let i = 0; i < bytes.length; i++) {
      h ^= bytes[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  const base = window.SNAPSHOT || { lines: [] };
  const BASE_VERSION = Number(base.version) || 0;

  const S = {
    busy: false,
    state: 'fresh',
    lastError: '',
    listeners: [],
    manifest: null,
    version: BASE_VERSION,
    generated: base.generated || '',
    source: 'bundled'
  };

  function meta() { return ZJ.Store.get(META, {}) || {}; }
  function saveMeta(patch) {
    ZJ.Store.set(META, Object.assign(meta(), patch));
  }
  function cache() { return ZJ.Store.get(NS, null); }

  function ageDays(dateStr) {
    const m = String(dateStr || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return 0;
    const t = new Date(+m[1], +m[2] - 1, +m[3]).getTime();
    return Math.max(0, Math.floor((Date.now() - t) / DAY));
  }

  function datasetFrom(chunks) {
    const lines = [];
    let generated = S.generated;
    chunks.forEach((c) => {
      try {
        const body = JSON.parse(c.data);
        if (Array.isArray(body.lines)) lines.push(...body.lines);
        if (body.generated) generated = body.generated;
      } catch (e) { /* 单个分片损坏时由调用方走修复流程 */ }
    });
    return { version: S.version, generated: generated, source: 'cache', lines: lines };
  }

  function baseDataset() {
    return { version: BASE_VERSION, generated: base.generated || '', source: 'bundled', names: base.names, lines: base.lines };
  }

  /* 本地缓存可用性：版本、分片哈希、整体哈希全部自洽才采用 */
  function validCache(c) {
    if (!c || !Array.isArray(c.chunks) || !c.chunks.length) return false;
    if (!(Number(c.version) > 0)) return false;
    if (c.hash && c.hash !== fnv1a(c.chunks.map((x) => x.hash).join('|'))) return false;
    return true;
  }

  function applyDataset(ds, state) {
    ZJ.Data.rebuild(ds);
    S.version = ds.version;
    S.generated = ds.generated || '';
    S.source = ds.source || 'cache';
    S.state = state || 'fresh';
    S.listeners.forEach((fn) => { try { fn(S); } catch (e) {} });
  }

  function boot() {
    const c = cache();
    if (validCache(c) && Number(c.version) > BASE_VERSION) {
      applyDataset(datasetFrom(c.chunks), 'fresh');
    } else {
      ZJ.Data.rebuild(baseDataset());
    }
  }

  function fetchText(url, ms) {
    return new Promise((resolve, reject) => {
      let done = false;
      const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        if (ctl) ctl.abort();
        reject(new Error('请求超时'));
      }, ms || 8000);
      fetch(url + (url.indexOf('?') > -1 ? '&' : '?') + '_t=' + Date.now(), {
        cache: 'no-store',
        signal: ctl ? ctl.signal : undefined
      }).then((r) => {
        if (!r.ok) throw new Error('服务返回 ' + r.status);
        return r.text();
      }).then((t) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(t);
      }).catch((e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(e);
      });
    });
  }

  async function getManifest() {
    const url = ZJ.CFG.MANIFEST_URL || 'data/manifest.json';
    const text = await fetchText(url, 6000);
    const m = JSON.parse(text);
    if (!m || !m.version || !Array.isArray(m.chunks) || !m.chunks.length) throw new Error('清单格式异常');
    S.manifest = m;
    return m;
  }

  /* 下载分片并逐个校验哈希；任何一个对不上都不应用，避免半套数据 */
  async function pullChunks(manifest, want) {
    const out = [];
    for (const ch of manifest.chunks) {
      if (!want.has(ch.id)) { continue; }
      const text = await fetchText(ch.url, 12000);
      const hash = fnv1a(text);
      if (hash !== ch.hash) throw new Error('分片 ' + ch.id + ' 校验失败');
      out.push({ id: ch.id, hash: hash, data: text });
    }
    return out;
  }

  async function applyManifest(manifest, opts) {
    opts = opts || {};
    if (S.busy) return false;
    S.busy = true;
    S.state = 'updating';
    try {
      const c = cache();
      const have = new Map();
      if (validCache(c) && Number(c.version) === Number(manifest.version)) {
        c.chunks.forEach((x) => have.set(x.id, x));
      }
      const want = new Set();
      manifest.chunks.forEach((ch) => {
        const old = have.get(ch.id);
        if (!old || old.hash !== ch.hash) want.add(ch.id);
      });
      if (oldVersion(c) > Number(manifest.version)) {
        /* 官方版本回退：以官方为准，清掉本地缓存重新全量取 */
        ZJ.Store.del(NS);
        manifest.chunks.forEach((ch) => want.add(ch.id));
      }

      let pulled = await pullChunks(manifest, want);
      let map = new Map();
      if (have.size) have.forEach((v, k) => map.set(k, v));
      pulled.forEach((x) => map.set(x.id, x));
      /* 缺分片或整体哈希不符 → 全量重取一次（自愈） */
      const totalHash = fnv1a(manifest.chunks.map((ch) => (map.get(ch.id) || {}).hash || '').join('|'));
      if (totalHash !== manifest.totalHash) {
        map = new Map();
        const all = await pullChunks(manifest, new Set(manifest.chunks.map((x) => x.id)));
        all.forEach((x) => map.set(x.id, x));
        const h2 = fnv1a(manifest.chunks.map((ch) => map.get(ch.id).hash).join('|'));
        if (h2 !== manifest.totalHash) throw new Error('整体校验失败');
      }

      const chunks = manifest.chunks.map((ch) => map.get(ch.id));
      S.version = Number(manifest.version);
      S.generated = manifest.generated || S.generated;
      const ds = datasetFrom(chunks);
      const counts = {
        lines: ds.lines.length,
        stops: ds.lines.reduce((a, l) => a + (l.d || []).reduce((b, d) => b + (d.s || []).length, 0), 0)
      };
      if (manifest.counts && (counts.lines !== manifest.counts.lines || counts.stops !== manifest.counts.stops)) {
        throw new Error('数据条数与清单不符');
      }
      ZJ.Store.set(NS, { version: S.version, generated: S.generated, hash: manifest.totalHash, chunks: chunks });
      saveMeta({ lastCheck: Date.now(), lastOk: Date.now(), lastError: '', version: S.version });
      applyDataset(ds, 'fresh');
      return true;
    } catch (e) {
      S.lastError = (e && e.message) || '同步失败';
      S.state = navigator.onLine === false ? 'offline' : 'error';
      saveMeta({ lastCheck: Date.now(), lastError: S.lastError });
      return false;
    } finally {
      S.busy = false;
    }
  }

  function oldVersion(c) {
    const m = c && Number(c.version);
    if (m) return m;
    return BASE_VERSION;
  }

  async function check(opts) {
    opts = opts || {};
    if (S.busy) return false;
    if (navigator.onLine === false) {
      S.state = 'offline';
      return false;
    }
    try {
      const m = await getManifest();
      const local = oldVersion(cache());
      if (Number(m.version) === local) {
        S.version = local;
        S.generated = m.generated || S.generated;
        S.state = 'fresh';
        saveMeta({ lastCheck: Date.now(), lastOk: Date.now(), lastError: '' });
        return true;
      }
      return await applyManifest(m, opts);
    } catch (e) {
      S.lastError = (e && e.message) || '清单获取失败';
      S.state = navigator.onLine === false ? 'offline' : 'error';
      saveMeta({ lastCheck: Date.now(), lastError: S.lastError });
      return false;
    }
  }

  /* 全量校准：逐个重算本地分片哈希，与官方清单比对，不一致就重下修复 */
  async function calibrate(force) {
    const mt = meta();
    if (!force && mt.lastFull && Date.now() - mt.lastFull < ZJ.CFG.CALIBRATE_INTERVAL) return false;
    if (S.busy || navigator.onLine === false) return false;
    let m;
    try { m = await getManifest(); } catch (e) {
      S.state = navigator.onLine === false ? 'offline' : 'error';
      saveMeta({ lastCheck: Date.now(), lastError: (e && e.message) || '' });
      return false;
    }
    const c = cache();
    const local = new Map();
    (validCache(c) ? c.chunks : []).forEach((x) => local.set(x.id, x));
    const bad = new Set();
    m.chunks.forEach((ch) => {
      const x = local.get(ch.id);
      if (!x || fnv1a(x.data) !== ch.hash) bad.add(ch.id);
    });
    const same = Number(m.version) === oldVersion(c);
    /* 本地没有缓存且官方版本就是内置基线：基线本身即官方数据，无需下载 */
    if (!bad.size && same) {
      saveMeta({ lastFull: Date.now(), lastCheck: Date.now(), lastOk: Date.now(), lastError: '' });
      S.state = 'fresh';
      return true;
    }
    if (!local.size && same) {
      saveMeta({ lastFull: Date.now(), lastCheck: Date.now(), lastOk: Date.now(), lastError: '' });
      S.state = 'fresh';
      return true;
    }
    const ok = await applyManifest(m, { repair: [...bad] });
    if (ok) saveMeta({ lastFull: Date.now() });
    return ok;
  }

  function status() {
    const mt = meta();
    const age = ageDays(S.generated);
    let state = S.state;
    if (state !== 'updating') {
      if (navigator.onLine === false) state = 'offline';
      else if (age > (ZJ.CFG.DATA_STALE_DAYS || 30)) state = 'stale';
      else if (mt.lastCheck && Date.now() - mt.lastCheck > 7 * DAY) state = 'stale';
      else if (state === 'error') state = 'stale';
      else state = 'fresh';
    }
    return {
      state: state,
      busy: S.busy,
      version: S.version,
      generated: S.generated,
      ageDays: age,
      source: S.source,
      lastSync: mt.lastOk || 0,
      lastFull: mt.lastFull || 0,
      lastCheck: mt.lastCheck || 0,
      error: S.lastError || mt.lastError || ''
    };
  }

  function hint() {
    const st = status();
    if (st.state === 'updating') return '数据校验中…';
    if (st.state === 'offline') return '离线使用本地数据（' + (st.generated || '内置版本') + '）';
    if (st.state === 'stale') {
      return st.ageDays > 0
        ? '本地数据为 ' + st.ageDays + ' 天前版本，联网后会自动校准'
        : '数据较久未校准，联网后会自动校准';
    }
    return '数据版本 ' + (st.generated || st.version) + ' · 已校准';
  }

  function start() {
    if (S.started) return;
    S.started = true;
    setTimeout(() => { check(); }, 1500);
    setInterval(() => { check(); }, ZJ.CFG.SYNC_INTERVAL || 6 * 3600 * 1000);
    setTimeout(() => { calibrate(); }, 4000);
    setInterval(() => { calibrate(); }, 12 * 3600 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') calibrate();
    });
  }

  const DataSync = {
    BASE_VERSION: BASE_VERSION,
    boot: boot,
    start: start,
    check: check,
    calibrate: calibrate,
    applyManifest: applyManifest,
    status: status,
    hint: hint,
    on(fn) { if (typeof fn === 'function') S.listeners.push(fn); },
    reset() {
      ZJ.Store.del(NS);
      ZJ.Store.del(META);
      S.state = 'fresh';
      S.version = BASE_VERSION;
      S.generated = base.generated || '';
      applyDataset(baseDataset(), 'fresh');
    },
    fnv1a: fnv1a
  };
  ZJ.DataSync = DataSync;

  boot();
})();
