/* 应用入口：Tab 切换 / 定位 / 启动 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;

  /* ================= 定位（浏览器 / Capacitor WebView） =================
     首页已移除附近站点栏目，定位只用于：去哪「我的位置」、线路页默认等车站 */
  const Geo = {
    state: 'idle',
    lat: 0,
    lng: 0,
    accuracy: 0,
    error: '',
    locate(silent) {
      Geo.state = 'locating';
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          Geo.state = 'fail';
          Geo.error = '设备不支持定位';
          if (!silent) ZJ.toast('当前设备不支持定位');
          reject(new Error(Geo.error));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            Geo.state = 'ok';
            Geo.lat = pos.coords.latitude;
            Geo.lng = pos.coords.longitude;
            Geo.accuracy = pos.coords.accuracy || 0;
            Geo.error = '';
            resolve(Geo);
          },
          (err) => {
            Geo.state = 'fail';
            Geo.error = err && err.code === 1 ? '定位权限被拒绝' : err && err.code === 3 ? '定位超时' : '定位失败';
            if (!silent) ZJ.toast(Geo.error + '，可手动选择站点');
            reject(new Error(Geo.error));
          },
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
        );
      });
    }
  };
  ZJ.Geo = Geo;

  /* ================= Tab ================= */
  const TABS = { home: 1, go: 1, assistant: 1, settings: 1 };
  let tab = 'home';
  function setTab(name) {
    if (!TABS[name]) return;
    tab = name;
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('on', p.id === 'page-' + name));
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    window.scrollTo(0, 0);
    if (name === 'go' && ZJ.Go) ZJ.Go.render();
    if (name === 'assistant' && ZJ.AI) ZJ.AI.render();
    if (name === 'settings' && ZJ.Settings) ZJ.Settings.render();
  }
  ZJ.setTab = setTab;

  let inited = false;
  function init() {
    if (inited) return;
    inited = true;
    setTab('home');
    if (ZJ.Home) ZJ.Home.renderAll();
    if (ZJ.Go) ZJ.Go.render();
    if (ZJ.AI) ZJ.AI.render();
    if (ZJ.Settings) ZJ.Settings.render();

    /* 数据版本同步：静默更新，不弹窗、不通知；更新后自动重建索引并刷新首末班判定 */
    if (ZJ.DataSync) {
      ZJ.DataSync.on(() => {
        if (ZJ.Go) ZJ.Go.afterData();
        if (ZJ.Plan) ZJ.Plan.afterData();
        if (ZJ.Line && document.getElementById('page-line').classList.contains('on')) ZJ.Line.refresh();
        if (ZJ.Station && document.getElementById('page-station').classList.contains('on')) ZJ.Station.refresh();
        if (ZJ.Home) ZJ.Home.renderAll();
        if (ZJ.Settings) ZJ.Settings.render();
      });
      ZJ.DataSync.start();
    }

    const bar = $('tabbar');
    bar.addEventListener('click', (e) => {
      const b = e.target.closest('.tab');
      if (b) setTab(b.dataset.tab);
    });

    /* 首次触摸解锁音频（移动端 WebAudio 需要用户手势） */
    const unlock = () => { ZJ.Sound.unlock(); document.removeEventListener('touchend', unlock); document.removeEventListener('click', unlock); };
    document.addEventListener('touchend', unlock, { once: true });
    document.addEventListener('click', unlock, { once: true });

    /* 到站提醒：只在可见时轮询 */
    ZJ.Reminder.start();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        ZJ.Reminder.tick();
        if (ZJ.Line && $('page-line').classList.contains('on')) ZJ.Line.refresh();
        if (ZJ.Station && $('page-station').classList.contains('on')) ZJ.Station.refresh();
      }
    });

    window.addEventListener('online', () => ZJ.toast('网络已恢复'));
    window.addEventListener('offline', () => ZJ.toast('网络已断开，部分实时数据不可用'));

    /* 定位：静默尝试，失败不打扰 */
    Geo.locate(true).catch(() => {});

    /* 首次打开提示 */
    if (!ZJ.Store.get('zjbus.tip.v1', false)) {
      ZJ.Store.set('zjbus.tip.v1', true);
      setTimeout(() => ZJ.toast('点线路看实时车辆，点站点看途经所有车辆'), 900);
    }
  }

  window.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
})();
