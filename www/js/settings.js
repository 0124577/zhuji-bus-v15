/* 设置页：主题色 / 提示音 / 震动 / 音量 / 通知权限 / 轮询间隔 / 清除缓存 / 关于 */
(function () {
  const ZJ = window.ZJ;
  const $ = ZJ.$;
  const Prefs = ZJ.Prefs;

  const HIST_KEY = 'zjbus.history.v1';
  let permState = 'prompt'; /* granted | prompt | denied | unsupported */
  let permChecked = false;
  let permPrompted = false;

  /* ---------------- 渲染 ---------------- */
  function renderTheme() {
    const cur = Prefs.get('theme');
    $('themeRow').innerHTML = Prefs.THEMES.map((t) =>
      '<button class="theme-dot' + (t.key === cur ? ' on' : '') + '" data-act="set-theme" data-v="' + t.key + '">' +
      '<i style="background:' + t.color + '"></i><span>' + t.name + '</span></button>').join('');
    const now = Prefs.THEMES.find((t) => t.key === cur) || Prefs.THEMES[0];
    $('themeNow').textContent = now.name;
  }

  function renderSwitches() {
    const s = $('swSound'), v = $('swVibrate');
    s.classList.toggle('on', !!Prefs.get('sound'));
    s.setAttribute('aria-checked', String(!!Prefs.get('sound')));
    v.classList.toggle('on', !!Prefs.get('vibrate'));
    v.setAttribute('aria-checked', String(!!Prefs.get('vibrate')));
    const vol = Number(Prefs.get('volume')) || 0;
    $('volTxt').textContent = vol + '%';
    $('volRange').value = String(vol);
    [...document.querySelectorAll('#pollSeg .seg-b')].forEach((b) => {
      b.classList.toggle('on', Number(b.dataset.v) === Number(Prefs.get('poll')));
    });
  }

  function renderPerm() {
    const badge = $('permBadge'), note = $('permNote'), btn = $('btnReqNotify');
    const map = {
      granted: ['已开启', 'ok', '系统通知已开启，到站时会响铃并震动，锁屏也能收到。'],
      prompt: ['未开启', 'warn', '还没有开启通知权限。点下面按钮开启后，锁屏或切到后台也能收到到站提醒。'],
      denied: ['已关闭', 'bad', '通知权限被关闭了。需要到系统设置里手动打开，才能响铃和震动。'],
      unsupported: ['不支持', '', '当前环境不支持系统通知，到站时只在 App 内弹窗提示。']
    };
    const m = map[permState] || map.prompt;
    badge.textContent = m[0];
    badge.className = 'badge ' + m[1];
    note.textContent = m[2];
    if (permState === 'granted') {
      btn.textContent = '通知已开启';
      btn.disabled = false;
    } else if (permState === 'unsupported') {
      btn.textContent = '当前环境不支持';
      btn.disabled = true;
    } else {
      btn.textContent = '开启通知权限';
      btn.disabled = false;
    }
  }

  /* 数据版本：只做状态展示，不弹窗、不置红点 */
  function renderSync() {
    const boxV = $('dataVer'), boxH = $('dataHint');
    if (!boxV || !boxH || !ZJ.DataSync) return;
    const st = ZJ.DataSync.status();
    boxV.textContent = 'v' + st.version;
    boxH.textContent = ZJ.DataSync.hint() + (st.lastFull ? ' · 最近全量校准 ' + ZJ.clock(new Date(st.lastFull)).slice(0, 5) : '');
  }

  async function checkPerm() {
    try { permState = await ZJ.Notify.status(); } catch (e) { permState = 'prompt'; }
    permChecked = true;
    renderPerm();
    return permState;
  }

  /* 音量滑块：滑动只改显示，松手才落库并试听 */
  let volBound = false;
  function bindVol() {
    if (volBound) return;
    const r = $('volRange');
    if (!r) return;
    volBound = true;
    r.addEventListener('input', () => {
      $('volTxt').textContent = r.value + '%';
    });
    r.addEventListener('change', () => {
      Prefs.set('volume', Number(r.value));
      ZJ.Sound.chime();
      ZJ.toast('音量 ' + r.value + '%');
    });
  }

  const Settings = {
    render() {
      bindVol();
      renderTheme();
      renderSwitches();
      $('verTxt').textContent = '诸暨公交 v' + ZJ.CFG.VERSION;
      renderSync();
      checkPerm();
    },
    renderSync: renderSync,
    perm() { return permState; },
    permChecked() { return permChecked; },
    /* 提醒开启后调用：没有通知权限时给明确提示（每个会话只提示一次） */
    async promptPermIfNeeded() {
      const s = await ZJ.Notify.status();
      permState = s;
      renderPerm();
      if (s === 'granted' || permPrompted) return false;
      permPrompted = true;
      showPermAlert(s, true);
      return true;
    }
  };
  ZJ.Settings = Settings;

  /* ---------------- 通知权限弹窗 ---------------- */
  function showPermAlert(state, afterReminder) {
    const denied = state === 'denied';
    const unsupported = state === 'unsupported';
    const html = '<div class="perm-alert">' +
      '<h3>' + (denied ? '通知权限被关闭了' : '开启通知，锁屏也能提醒') + '</h3>' +
      '<p>' + (afterReminder
        ? '提醒已经开好了。但如果没有通知权限，手机锁屏或 App 切到后台时就收不到响铃和震动。'
        : '开启通知权限后，车辆快到站时手机会响铃并震动，即使锁屏也不会错过。') + '</p>' +
      (denied || unsupported
        ? '<ol><li>打开手机的「设置」</li><li>找到「应用」→「诸暨公交」</li><li>点「通知」，允许通知、允许响铃与震动</li></ol>'
        : '<p class="tip-line">点下面的按钮，系统会弹出「允许通知」的询问，选「允许」即可。</p>') +
      '<div class="alert-btns">' +
      (denied || unsupported
        ? '<button class="ghost" data-act="permalert-close">知道了</button><button class="primary" data-act="open-notify-set">去系统设置</button>'
        : '<button class="ghost" data-act="permalert-close">暂不开启</button><button class="primary" data-act="perm-request">开启通知</button>') +
      '</div></div>';
    ZJ.UI.alert(html);
  }

  /* ---------------- 动作 ---------------- */
  ZJ.act('set-theme', (el) => {
    Prefs.set('theme', el.dataset.v);
    renderTheme();
    ZJ.toast('已切换主题');
  });
  ZJ.act('sw-sound', () => {
    const v = !Prefs.get('sound');
    Prefs.set('sound', v);
    renderSwitches();
    if (v) ZJ.Sound.chime();
  });
  ZJ.act('sw-vibrate', () => {
    const v = !Prefs.get('vibrate');
    Prefs.set('vibrate', v);
    renderSwitches();
    if (v) ZJ.UI.vibrate([120, 80, 120]);
  });
  ZJ.act('test-sound', () => {
    if (!Prefs.get('sound')) { ZJ.toast('提示音已关闭，先打开开关'); return; }
    ZJ.Sound.chime();
    ZJ.toast('音量 ' + Prefs.get('volume') + '%');
  });
  ZJ.act('set-poll', (el) => {
    Prefs.set('poll', Number(el.dataset.v));
    renderSwitches();
    if (ZJ.Reminder && ZJ.Reminder.start) ZJ.Reminder.start();
    ZJ.toast('提醒间隔改为 ' + el.dataset.v + ' 秒');
  });
  ZJ.act('req-notify', async () => {
    const s = await ZJ.Notify.status();
    permState = s;
    if (s === 'granted') { renderPerm(); ZJ.toast('通知权限已开启'); return; }
    showPermAlert(s, false);
  });
  ZJ.act('perm-request', async () => {
    const r = await ZJ.Notify.request();
    permState = r;
    renderPerm();
    ZJ.UI.closeAlert();
    if (r === 'granted') {
      ZJ.toast('通知已开启，到站会响铃并震动');
      ZJ.Sound.chime();
      ZJ.UI.vibrate([120, 80, 120]);
    } else {
      showPermAlert(r, false);
    }
  });
  ZJ.act('permalert-close', () => ZJ.UI.closeAlert());
  ZJ.act('open-notify-set', async () => {
    const ok = await ZJ.Notify.openSettings();
    ZJ.UI.closeAlert();
    ZJ.toast(ok ? '已打开系统设置，请允许通知' : '请到手机设置 → 应用 → 诸暨公交 → 通知 中开启');
  });
  ZJ.act('clear-cache', () => {
    const hist = (ZJ.Store.get(HIST_KEY, []) || []).length;
    const html = '<div class="perm-alert"><h3>清除缓存</h3>' +
      '<p>将清除：查询记录（' + hist + ' 条）、临时页面状态。<br>不会删除：收藏、到站提醒、你的设置。</p>' +
      '<div class="alert-btns"><button class="ghost" data-act="permalert-close">取消</button>' +
      '<button class="primary" data-act="clear-cache-do">确认清除</button></div></div>';
    ZJ.UI.alert(html);
  });
  ZJ.act('clear-cache-do', () => {
    ZJ.Store.set(HIST_KEY, []);
    ZJ.Store.del('zjbus.tip.v1');
    ZJ.UI.closeAlert();
    if (ZJ.Go && ZJ.Go.render) ZJ.Go.render();
    if (ZJ.Home && ZJ.Home.renderAll) ZJ.Home.renderAll();
    ZJ.toast('缓存已清除（收藏与提醒保留）');
  });
  ZJ.act('data-check', async () => {
    ZJ.toast('正在检查数据版本…');
    const ok = await ZJ.DataSync.check();
    renderSync();
    const st = ZJ.DataSync.status();
    ZJ.toast(ok ? (st.version ? '已是最新数据 v' + st.version : '数据已是最新') : '暂时连不上官方数据，继续使用本地版本');
  });
  ZJ.act('data-calibrate', async () => {
    ZJ.toast('正在全量校准…');
    const ok = await ZJ.DataSync.calibrate(true);
    renderSync();
    ZJ.toast(ok ? '校准完成，数据一致' : '校准未完成，稍后自动重试');
  });
  ZJ.act('about', () => {
    const lines = ZJ.Data.lines.length;
    const stations = ZJ.Data.stations.length;
    ZJ.UI.sheet(
      '<div class="sheet-h"><b>关于诸暨公交</b><button class="sheet-x" data-act="close-sheet"><svg class="ico"><use href="#i-close"/></svg></button></div>' +
      '<div class="sheet-body">' +
      '<div class="about-row"><span>版本</span><b>v' + ZJ.CFG.VERSION + '（Android 包 1.4.0）</b></div>' +
      '<div class="about-row"><span>包名</span><b>com.zhuji.bus.lite</b></div>' +
      '<div class="about-row"><span>数据</span><b>' + lines + ' 条线路 · ' + stations + ' 个站点</b></div>' +
      '<div class="about-row"><span>数据版本</span><b>v' + (ZJ.Data.version || '—') + ' · ' + ZJ.esc(ZJ.Data.generated || '—') + '</b></div>' +
      '<div class="about-row"><span>实时数据</span><b>诸暨公交官方接口</b></div>' +
      '<div class="about-row"><span>定位</span><b>仅用于“我的位置”，不上传</b></div>' +
      '<div class="about-row"><span>数据同步</span><b>版本增量同步 · 每 2 天全量校准</b></div>' +
      '<div class="about-row"><span>许可</span><b>MIT</b></div>' +
      '<p class="sheet-note" style="margin-top:12px">本应用为便民工具，非官方发布。换乘与耗时为本地估算，实际以运营为准。到站提醒依赖实时接口，接口中断时提醒会暂停。</p>' +
      '</div>'
    );
  });
})();
