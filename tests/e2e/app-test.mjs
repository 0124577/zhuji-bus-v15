/**
 * 诸暨公交 · 轻量版 E2E 自测（v1.1）
 * 覆盖：基础加载 / 首页栏目精简 / Tab 切换 / 定位 / 线路搜索 / 线路实时页 /
 *      竖屏横向站点列表 / 上下行切换 / 收藏 / 时刻表 / 到站提醒（含震动）/
 *      站点实时页 / 换乘规划 / 方案详情（分段实时 + 站点提醒）/ 历史 /
 *      边界场景（定位失败 / 搜索无结果 / 网络异常降级 / 无方案）/ 移动端适配
 *
 * 运行：node tests/e2e/app-test.mjs
 * 环境变量：BASE_URL、CHROME_PATH
 */
import puppeteer from 'puppeteer-core';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899/index.html';
const ORIGIN = new URL(BASE).origin;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
const fails = [];
function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fails.push(name + (extra ? ' :: ' + extra : '')); console.log('  ✗ ' + name + (extra ? ' :: ' + extra : '')); }
}
function section(t) { console.log('\n== ' + t + ' =='); }

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN']
});

const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions(ORIGIN, ['geolocation', 'notifications']);

const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setGeolocation({ latitude: 29.7136, longitude: 120.2362 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

const txt = (sel) => page.$eval(sel, (el) => el.textContent.trim()).catch(() => '');
const cnt = (sel) => page.$$eval(sel, (els) => els.length).catch(() => 0);
const has = (sel) => page.$(sel).then((x) => !!x);
const clickAct = (act) => page.evaluate((a) => {
  const el = document.querySelector('[data-act="' + a + '"]');
  if (!el) throw new Error('no element for act ' + act);
  el.click();
}, act);
const overflow = () => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));

/* 选择一个站点（走真实 picker 交互） */
async function pickStation(act, name) {
  await clickAct(act);
  await sleep(350);
  await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
  await sleep(200);
  await page.type('#pkQ', name);
  await sleep(500);
  await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
  await sleep(450);
}

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.line-row', { timeout: 8000 });
await sleep(1200);
await page.evaluate(() => { window.__chimeOrig = ZJ.Sound.chime.bind(ZJ.Sound); });
/* 固定时钟到 09:00：首末班校验在正常运营时段下运行，避免夜间跑测试全被判为已收班 */
await page.evaluate(() => ZJ.Clock.setFixed(9 * 60));
await sleep(1600);

/* ---------------- 1. 基础加载 ---------------- */
section('基础加载与静态数据');
ok('页面标题正确', (await page.title()).indexOf('诸暨公交') > -1, await page.title());
ok('底部有 4 个 Tab', (await cnt('.tab')) === 4, 'count=' + (await cnt('.tab')));
const tabTexts = await page.$$eval('.tab', (els) => els.map((e) => e.textContent.trim()));
ok('Tab 为「首页 / 出行 / 助手 / 设置」', tabTexts.join('/') === '首页/出行/助手/设置', tabTexts.join('/'));
const meta = await page.evaluate(() => ({
  lines: ZJ.Data.lines.length,
  stations: ZJ.Data.stations.length,
  dirs: ZJ.Data.dirs.size,
  stops: ZJ.Data.stopCount,
  generated: ZJ.Data.generated
}));
ok('静态线路数据 395 条', meta.lines === 395, JSON.stringify(meta));
ok('站点数量 > 3000', meta.stations > 3000, String(meta.stations));
ok('线路方向 > 700 个', meta.dirs > 700, String(meta.dirs));
ok('首页默认展示', await page.$eval('#page-home', (el) => el.classList.contains('on')));
ok('线路列表已渲染', (await cnt('.line-row')) > 10, String(await cnt('.line-row')));
ok('无公告 Tab', !tabTexts.some((t) => t.indexOf('公告') > -1));
ok('助手 Tab 为 AI 入口', tabTexts.indexOf('助手') > -1, tabTexts.join('/'));
ok('无我的 Tab', !tabTexts.some((t) => t.indexOf('我的') > -1));

/* ---------------- 2. 首页栏目精简 + 定位 ---------------- */
section('首页栏目精简与定位');
ok('附近站点栏目已移除', !(await has('#nearbyCard')), '#nearbyCard 不存在');
ok('页面无附近站点列表', (await cnt('.nb-row')) === 0, 'nb-row=' + (await cnt('.nb-row')));
ok('无定位胶囊', !(await has('#homeLoc')));
const homeOrder = await page.evaluate(() => {
  const body = document.querySelector('.home-body');
  return [...body.children].map((e) => e.id || e.className);
});
ok('首页依次为 收藏 / 提醒 / 线路列表', homeOrder[0] === 'favCard', homeOrder.join(' > '));
ok('搜索框仍在页头', await has('.home-hdr #lineQ'));
await page.waitForFunction(() => window.ZJ && ZJ.Geo && ZJ.Geo.state !== 'locating', { timeout: 12000 });
ok('定位能力仍可用（供去哪「我的位置」）', (await page.evaluate(() => ZJ.Geo.state)) === 'ok', await page.evaluate(() => ZJ.Geo.state));

/* ---------------- 3. 线路搜索 ---------------- */
section('线路搜索');
await page.click('#lineQ');
await page.type('#lineQ', '23');
await sleep(400);
const searchRows = await page.$$eval('.line-row', (els) => els.map((e) => e.dataset.name));
ok('输入 23 命中 23路', searchRows.indexOf('23路') > -1, searchRows.slice(0, 6).join(','));
ok('搜索时显示结果计数', (await txt('#lineCount')).indexOf('匹配') > -1, await txt('#lineCount'));
await page.evaluate(() => { const i = document.getElementById('lineQ'); i.value = 'zzzz'; i.dispatchEvent(new Event('input', { bubbles: true })); });
await sleep(350);
ok('无结果时有空态提示', (await txt('#lineList')).indexOf('没有找到') > -1, (await txt('#lineList')).slice(0, 40));
await clickAct('clear-q');
await sleep(300);
ok('清空搜索恢复全部线路', (await cnt('.line-row')) > 20);
ok('清空后隐藏清除按钮', await page.$eval('#lineQClear', (el) => el.hidden));

/* ---------------- 4. 线路实时页 ---------------- */
section('线路实时页（实时车辆 / 剩余站 / 预计到站）');
await page.evaluate(() => {
  const dir = ZJ.Data.lineOf('23路').dirs[0];
  const st = dir.stops[10];
  window.__testStation = st.name;
  window.__mock = { speed: 240, list: [
    { vehicleOrder: 10, distance: 300, isArriveStation: 0, plateNumber: '浙D00001D', gpsTime: '2026-11-18 18:40:00' },
    { vehicleOrder: 30, distance: 60, isArriveStation: 1, plateNumber: '浙D00002D', gpsTime: '2026-11-18 18:40:00' }
  ] };
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: window.__mock.speed, list: window.__mock.list, static: false });
  ZJ.Api.lineDetail = async () => ({ lineName: '23路', up: { totalPrice: 1.0 } });
  ZJ.Api.plan = async () => ['06:20', '07:00', '17:30', '18:00', '19:10'];
  document.querySelector('.line-row[data-name="23路"]').click();
});
await page.waitForFunction(() => document.getElementById('page-line').classList.contains('on'), { timeout: 4000 });
await sleep(1100);
ok('进入线路详情页', await page.$eval('#page-line', (el) => el.classList.contains('on')));
ok('标题为 23路', (await txt('#lnName')) === '23路', await txt('#lnName'));
ok('方向信息包含首末站', (await txt('#lnDir')).indexOf('双福村') > -1, await txt('#lnDir'));
ok('站点序列 38 站', (await cnt('.vt-row')) === 38, String(await cnt('.vt-row')));
ok('横向站点列表 38 站', (await cnt('#tl .tl-item')) === 38, String(await cnt('#tl .tl-item')));
ok('时间轴渲染车辆标记', (await cnt('.tl-bus')) === 2, String(await cnt('.tl-bus')));
ok('实时信息卡显示车牌', (await txt('#lineStat')).indexOf('浙D00001D') > -1, (await txt('#lineStat')).slice(0, 80));
ok('信息卡有实时标记', (await txt('#lineStat')).indexOf('实时') > -1);
ok('票价来自接口', (await txt('#lineInfo')).indexOf('票价') > -1, await txt('#lineInfo'));

await page.evaluate(() => {
  const name = window.__testStation;
  document.querySelector('.vt-row[data-station="' + name + '"]').click();
});
await sleep(500);
const statTxt = await txt('#lineStat');
ok('选择等车站后剩余站数为 1', (await page.$eval('.stat-num', (el) => el.textContent.trim())) === '1', statTxt.slice(0, 60));
ok('显示预计到达分钟', /约 \d+ 分钟/.test(statTxt), statTxt.slice(0, 80));
ok('显示剩余距离', /(\d+ 米|\d+\.\d 公里)/.test(statTxt), statTxt.slice(0, 80));
const myStopTxt = await txt('#myStopBar');
ok('等车站条显示所选站', myStopTxt.indexOf(await page.evaluate(() => window.__testStation)) > -1, myStopTxt);
ok('站点列表显示实时倒计时', (await cnt('.vt-eta.live')) > 0, String(await cnt('.vt-eta.live')));

/* ---------------- 5. 竖屏横向站点列表 ---------------- */
section('竖屏横向站点列表（左右滑动浏览整条线路）');
const tlInfo = await page.evaluate(() => {
  const sc = document.getElementById('tlScroll');
  const nm = document.querySelector('#tl .tl-nm');
  const cs = getComputedStyle(nm);
  const before = sc.scrollLeft;
  sc.scrollLeft = 300;
  const after = sc.scrollLeft;
  sc.scrollLeft = 600;
  const after2 = sc.scrollLeft;
  return {
    sw: sc.scrollWidth, cw: sc.clientWidth, before, after, after2,
    writing: cs.writingMode, overflowX: getComputedStyle(sc).overflowX,
    hint: document.getElementById('tlHint').textContent
  };
});
ok('站点条可横向滚动（内容宽 > 可视宽）', tlInfo.sw > tlInfo.cw, tlInfo.sw + '/' + tlInfo.cw);
ok('横向容器 overflow-x 可滚动', tlInfo.overflowX === 'auto' || tlInfo.overflowX === 'scroll', tlInfo.overflowX);
ok('可滚动到右侧站点', tlInfo.after2 > tlInfo.before, JSON.stringify([tlInfo.before, tlInfo.after2]));
ok('站名为竖排文字', tlInfo.writing === 'vertical-rl', tlInfo.writing);
ok('显示滑动提示且含站数', /共 38 站/.test(tlInfo.hint), tlInfo.hint);
const tlTapOk = await page.evaluate(() => {
  const items = document.querySelectorAll('#tl .tl-item');
  const target = items[items.length - 1];
  target.click();
  return document.getElementById('myStopBar').textContent.indexOf(target.dataset.station) > -1;
});
ok('点击站点条可设为等车站', tlTapOk);
const tlOverflow = await overflow();
ok('线路页无横向溢出', tlOverflow.sw <= tlOverflow.iw + 1, JSON.stringify(tlOverflow));

/* 竖向时间轴（大字版，老年友好） */
const vt = await page.evaluate(() => {
  const rows = document.querySelectorAll('#stopList .vt-row');
  const name = document.querySelector('#stopList .vt-name');
  const bell = document.querySelector('#stopList .vt-bell');
  const axis = document.querySelector('#stopList .vt-axis');
  const tlCard = document.querySelector('.tl-card');
  const vtBox = document.getElementById('stopList');
  return {
    rows: rows.length,
    font: parseFloat(getComputedStyle(name).fontSize),
    bell: bell ? Math.round(bell.getBoundingClientRect().width) : 0,
    minH: parseFloat(getComputedStyle(rows[0]).minHeight),
    axisLine: parseFloat(getComputedStyle(axis, '::before').width),
    bus: document.querySelectorAll('#stopList .vt-bus').length,
    title: document.querySelector('.stop-sec .sec-h b').textContent,
    afterHorizontal: !!(tlCard.compareDocumentPosition(vtBox) & Node.DOCUMENT_POSITION_FOLLOWING)
  };
});
ok('线路页有竖向时间轴', vt.rows === 38, String(vt.rows));
ok('竖向时间轴位于横向时间轴下方', vt.afterHorizontal);
ok('竖向时间轴标题标注大字', vt.title.indexOf('竖向') > -1, vt.title);
ok('竖向站名 >= 15px（老年友好）', vt.font >= 15, String(vt.font));
ok('竖向行高 >= 56px', vt.minH >= 56, String(vt.minH));
ok('竖向有连续轴线', vt.axisLine >= 3, String(vt.axisLine));
ok('竖向时间轴提醒按钮 >= 40px', vt.bell >= 40, String(vt.bell));
ok('竖向时间轴标记车辆位置', vt.bus > 0, String(vt.bus));
await page.evaluate(() => {
  const name = window.__testStation;
  document.querySelector('.vt-row[data-station="' + name + '"]').click();
});
await sleep(400);

/* ---------------- 6. 上下行切换 ---------------- */
section('上下行切换');
const beforeDir = await txt('#lnDir');
await clickAct('line-swap');
await sleep(700);
const afterDir = await txt('#lnDir');
ok('切换方向后文案变化', beforeDir !== afterDir, beforeDir + ' -> ' + afterDir);
ok('切换后站点列表仍完整', (await cnt('.vt-row')) > 30, String(await cnt('.vt-row')));
ok('切换后出现提示', (await txt('#toast')).indexOf('方向') > -1, await txt('#toast'));
await clickAct('line-swap');
await sleep(600);

/* ---------------- 7. 收藏 ---------------- */
section('收藏');
await clickAct('line-fav');
await sleep(200);
ok('收藏线路写入本地', await page.evaluate(() => ZJ.Fav.hasLine('23路')));
await clickAct('line-back');
await sleep(600);
const favHtml = await txt('#favBody');
ok('首页收藏区显示 23路', favHtml.indexOf('23路') > -1, favHtml.slice(0, 40));
await page.evaluate(() => document.querySelector('.chip-line[data-name="23路"]').click());
await sleep(700);
ok('点击收藏线路可再次进入详情', (await txt('#lnName')) === '23路');
await clickAct('line-fav');
await sleep(200);
await clickAct('line-back');
await sleep(600);
ok('取消收藏后首页不再显示', (await txt('#favBody')).indexOf('23路') === -1);

/* ---------------- 8. 发车时刻表 ---------------- */
section('发车时刻表');
await page.evaluate(() => document.querySelector('.line-row[data-name="23路"]').click());
await sleep(1200);
await clickAct('open-tt');
await sleep(700);
const sheetTxt = await txt('#sheet');
ok('时刻表弹层打开', sheetTxt.indexOf('发车时刻表') > -1, sheetTxt.slice(0, 40));
ok('时刻表显示班次', sheetTxt.indexOf('06:20') > -1);
ok('时刻表标注班次数', /共 \d+ 班/.test(sheetTxt), sheetTxt.slice(0, 60));
await clickAct('close-sheet');
await sleep(500);

/* ---------------- 9. 到站提醒（线路页） ---------------- */
section('本地到站提醒（弹窗 + 震动）');
await page.evaluate(() => {
  window.__vibrate = [];
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  const name = window.__testStation;
  document.querySelector('.vt-row[data-station="' + name + '"] .vt-bell').click();
});
await sleep(700);
const rmSheet = await txt('#sheet');
ok('提醒弹层包含三种方式', rmSheet.indexOf('到站提醒') > -1 && rmSheet.indexOf('下一站提醒') > -1 && rmSheet.indexOf('提前 2 站') > -1);
ok('提醒弹层说明响铃与震动', rmSheet.indexOf('响铃') > -1 && rmSheet.indexOf('震动') > -1, rmSheet.slice(-80));
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
ok('可切换到「下一站提醒」', await page.$eval('.rm-mode[data-mode="one"]', (el) => el.classList.contains('on')));
await clickAct('rm-save');
await sleep(900);
ok('提醒已写入本地', await page.evaluate(() => ZJ.Reminder.list().length === 1));
ok('等车站条显示提醒中', (await txt('#myStopBar')).indexOf('提醒中') > -1, await txt('#myStopBar'));
const alertShown = await page.$eval('#alertMask', (el) => !el.hidden);
ok('车辆剩 1 站时触发弹窗', alertShown, 'alert hidden');
if (alertShown) {
  const alertTxt = await txt('#alertCard');
  ok('弹窗说明车辆即将到站', alertTxt.indexOf('即将到站') > -1, alertTxt.slice(0, 60));
  ok('弹窗含车牌与站名', alertTxt.indexOf('浙D00001D') > -1 && alertTxt.indexOf(await page.evaluate(() => window.__testStation)) > -1, alertTxt.slice(0, 80));
  ok('触发时调用震动 API', (await page.evaluate(() => window.__vibrate.length)) > 0);
  await page.evaluate(() => document.getElementById('rmGo').click());
  await sleep(400);
  ok('弹窗可关闭', await page.$eval('#alertMask', (el) => el.hidden));
}
ok('提醒完成后标记为已提醒', await page.evaluate(() => ZJ.Reminder.list()[0].done === true));
await page.evaluate(() => { ZJ.Line.close(); ZJ.setTab('home'); });
await sleep(700);
ok('首页显示提醒记录卡片', await page.$eval('#remindCard', (el) => !el.hidden));
ok('提醒记录显示已提醒状态', (await txt('#remindBody')).indexOf('已提醒') > -1, await txt('#remindBody'));
await page.evaluate(() => document.querySelector('[data-act="reminder-list"]').click());
await sleep(600);
ok('提醒管理弹层可打开', (await txt('#sheet')).indexOf('到站提醒') > -1, (await txt('#sheet')).slice(0, 40));
ok('管理弹层列出记录', (await cnt('.rm-item')) === 1, String(await cnt('.rm-item')));
await page.evaluate(() => { const b = document.querySelector('.rm-item .r-del'); if (b) b.click(); });
await sleep(500);
ok('可删除提醒记录', await page.evaluate(() => ZJ.Reminder.list().length === 0));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

/* ---------------- 10. 站点实时页 ---------------- */
section('站点实时页');
await page.evaluate(() => ZJ.Station.open('火车站'));
await page.waitForFunction(() => document.getElementById('page-station').classList.contains('on'), { timeout: 3000 });
await sleep(3200);
ok('站点页标题正确', (await txt('#stName')) === '火车站', await txt('#stName'));
ok('站点页显示途经方向数', /途经本站/.test(await txt('#stSub')), await txt('#stSub'));
ok('站点页显示距离', /距我/.test(await txt('#stSub')), await txt('#stSub'));
ok('站点页线路卡片 >= 10', (await cnt('.st-line')) >= 10, String(await cnt('.st-line')));
const stSummary = await txt('#stSummary');
ok('汇总显示有车方向数', /方向有车|暂无车辆/.test(stSummary), stSummary);
const busInfo = await page.$eval('.st-line', (el) => el.textContent.replace(/\s+/g, ' '));
ok('线路卡片含预计到站', /(约 \d+ 分|已到站|—)/.test(busInfo), busInfo.slice(0, 60));
await page.evaluate(() => document.getElementById('stFav').click());
await sleep(300);
ok('收藏站点写入本地', await page.evaluate(() => ZJ.Fav.hasStation('火车站')));
const stOverflow = await overflow();
ok('站点页无横向溢出', stOverflow.sw <= stOverflow.iw + 1, JSON.stringify(stOverflow));
await page.evaluate(() => document.querySelector('.st-line').click());
await sleep(900);
ok('从站点页进入线路页', await page.$eval('#page-line', (el) => el.classList.contains('on')));
ok('线路页等车站为所选站点', (await txt('#myStopBar')).indexOf('火车站') > -1, await txt('#myStopBar'));
await page.evaluate(() => ZJ.Line.close());
await sleep(500);
await page.evaluate(() => ZJ.Station.close());
await sleep(700);
ok('首页收藏区显示收藏站点', (await txt('#favBody')).indexOf('火车站') > -1, (await txt('#favBody')).slice(0, 40));
await page.evaluate(() => document.querySelector('.fav-st[data-name="火车站"]').click());
await sleep(900);
ok('点击收藏站点可进入站点页', (await txt('#stName')) === '火车站');
await page.evaluate(() => ZJ.Station.close());
await sleep(600);

/* ---------------- 11. 去哪 / 换乘 ---------------- */
section('换乘规划与历史');
await page.evaluate(() => ZJ.setTab('go'));
await sleep(500);
ok('切到出行页', await page.$eval('#page-go', (el) => el.classList.contains('on')));
ok('出行页显示起终点选择', (await txt('#fromName')).indexOf('起点') > -1, await txt('#fromName'));

await pickStation('pick-from', '火车站');
ok('起点已选择', (await txt('#fromName')) === '火车站', await txt('#fromName'));
await pickStation('pick-to', '草塔停车场');
await sleep(1200);
const planCount = await cnt('.trip-card');
ok('生成多套出行方案卡片', planCount >= 2, 'cards=' + planCount);
const planTxt = await txt('#planResult');
ok('列表卡显示总时长', /方案\s*1[\s\S]{0,30}\d+\s*分钟/.test(planTxt), planTxt.slice(0, 80));
ok('列表卡显示步行距离', /步行\s*[\d.]+\s*(米|公里)|无需步行换乘/.test(planTxt), planTxt.slice(0, 120));
ok('列表卡显示公交线路', /\d+路/.test(planTxt), planTxt.slice(0, 120));
ok('列表卡显示车辆实时状态', /(还有\s*\d+\s*站|车已到站|暂无在线车辆|已收班|实时不可用)/.test(planTxt), planTxt.slice(0, 160));
ok('页脚含免责说明', (await txt('#page-go .foot-note')).indexOf('仅供参考') > -1, (await txt('#page-go .foot-note')).slice(0, 40));
ok('列表页不再展开分段明细', (await cnt('#planResult .plan-body')) === 0 && (await cnt('#planResult .tl-item')) === 0);
ok('列表页不再跳独立线路页', !(await has('#planResult .pl-open-line')) && !(await has('#planResult [data-act="pl-full-line"]')));
ok('首套方案标为推荐', (await txt('.plan-tag.rec')).indexOf('推荐') > -1, await txt('.plan-tag.rec'));
ok('历史记录已保存', await page.evaluate(() => (ZJ.Store.get('zjbus.history.v1', []) || []).length === 1));
ok('历史列表已渲染', (await cnt('.hist-row')) === 1, String(await cnt('.hist-row')));

/* 点方案卡 → 换乘详情页（列表页不再有展开或独立线路入口） */
await page.evaluate(() => document.querySelector('.trip-card').click());
await page.waitForFunction(() => document.getElementById('page-plan').classList.contains('on'), { timeout: 4000 });
await sleep(1400);
ok('点方案卡进入换乘详情页', await page.$eval('#page-plan', (el) => el.classList.contains('on')));

/* ---------------- 12. 方案详情页 ---------------- */
section('方案详情页（分段实时公交 + 站点提醒）');
await sleep(600);
ok('点击方案卡片进入详情页', await page.$eval('#page-plan', (el) => el.classList.contains('on')));
ok('详情页标题区分直达与换乘', ['直达方案', '换乘方案'].indexOf(await txt('#plTitle')) > -1, await txt('#plTitle'));
ok('副标题含起终点', (await txt('#plSub')).indexOf('火车站') > -1 && (await txt('#plSub')).indexOf('草塔停车场') > -1, await txt('#plSub'));

/* 定向 mock：每段固定给一辆「距上车站 4 站」的车，确保高亮条可断言 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async (dirId) => {
    const leg = (ZJ.Plan.state().plan?.legs || []).find((l) => l.dir.id === dirId);
    const order = leg ? Math.max(1, leg.fromOrder - 4) : 1;
    return { busAverageSpeed: 240, list: [{ vehicleOrder: order, distance: 120, isArriveStation: 0, plateNumber: '浙D00088D' }], static: false };
  };
  ZJ.Plan.refresh();
});
await sleep(1400);
ok('展示分段卡片', (await cnt('.pl-leg')) >= 1, String(await cnt('.pl-leg')));
ok('顶部大字显示到目的地站数', /到目的地还有\s*\d+\s*站/.test(await txt('.pl-hl')), await txt('.pl-hl'));
ok('大字旁显示耗时与到达时间', /约 \d+ 分钟/.test(await txt('.pl-hl')) && /到达/.test(await txt('.pl-hl')), await txt('.pl-hl'));
const legLive = await txt('.pl-live');
ok('分段展示实时车辆信息', legLive.length > 0, legLive.slice(0, 60));
ok('实时块含剩余站或收班说明', /(\d+\s*站|已收班|暂无|实时数据)/.test(legLive), legLive.slice(0, 60));

/* 顶部「还剩几站」高亮条（有在线车辆时出现） */
const hl = await page.evaluate(() => {
  const el = document.querySelector('.pl-hl');
  if (!el) return null;
  const num = el.querySelector('.pl-hl-num');
  const lay = el.getBoundingClientRect();
  return {
    txt: el.innerText.replace(/\s+/g, ' ').trim(),
    font: parseFloat(getComputedStyle(num).fontSize),
    bg: getComputedStyle(el).backgroundImage,
    num: parseInt(num.textContent, 10),
    h: Math.round(lay.height),
    above: !!(el.compareDocumentPosition(document.querySelector('.pl-leg')) & Node.DOCUMENT_POSITION_FOLLOWING),
    caps: !!document.querySelector('.pl-remain'),
    capFont: document.querySelector('.pl-remain b') ? parseFloat(getComputedStyle(document.querySelector('.pl-remain b')).fontSize) : 0
  };
});
if (hl) {
  ok('详情页顶部突出「到目的地还有 N 站」', /到目的地还有\s*\d+\s*站/.test(hl.txt), hl.txt.slice(0, 60));
  ok('剩余站数字 >= 28px 大字', hl.font >= 28, String(hl.font));
  ok('高亮条为高对比渐变底且在汇总卡之上', /gradient/.test(hl.bg) && hl.above, 'h=' + hl.h);
  ok('分段剩余站为白字粉底胶囊且数字 >= 22px', hl.caps && hl.capFont >= 22, 'capFont=' + hl.capFont);
} else {
  ok('无在线车辆时大字条改为静态口径', !hl && /(已收班|暂无|实时数据)/.test(legLive), legLive.slice(0, 40));
  ok('无在线车辆时汇总改为静态口径', /(暂无在线车辆|静态数据)/.test(await txt('#plSummary')), (await txt('#plSummary')).slice(0, 40));
  ok('无在线车辆时分段卡片与站点条仍完整', (await cnt('.pl-leg')) >= 1 && (await cnt('.pl-strip .tl-item')) > 5);
  ok('无在线车辆时提醒铃铛仍可用', (await cnt('.pl-bell')) > 3);
}
ok('展示上下车站', (await cnt('.pl-hop')) >= 2, String(await cnt('.pl-hop')));
const hopEdit = await page.evaluate(() => {
  const b = document.querySelector('.pl-hop[data-kind="board"]');
  return { tag: b.tagName, act: b.dataset.act, hint: b.innerText.indexOf('改') > -1 };
});
ok('上下车站可点击修改', hopEdit.tag === 'BUTTON' && hopEdit.act === 'pl-hop' && hopEdit.hint, JSON.stringify(hopEdit));
ok('展示该段线路站点条', (await cnt('.pl-strip .tl-item')) > 5, String(await cnt('.pl-strip .tl-item')));
const plStrip = await page.evaluate(() => {
  const sc = document.getElementById('plSc0');
  const nm = document.querySelector('.pl-strip .tl-nm');
  sc.scrollLeft = 320;
  return { sw: sc.scrollWidth, cw: sc.clientWidth, left: sc.scrollLeft, writing: getComputedStyle(nm).writingMode };
});
ok('详情页站点条可横向滚动', plStrip.sw > plStrip.cw && plStrip.left > 0, JSON.stringify(plStrip));
ok('详情页站名竖排', plStrip.writing === 'vertical-rl', plStrip.writing);
ok('详情页站点行带提醒铃铛', (await cnt('.pl-bell')) > 3, String(await cnt('.pl-bell')));
ok('详情页站点行显示到站时间', /(\d+ 站|分|已到站|已过站|—)/.test(await txt('.vt-eta')), await txt('.vt-eta'));

/* 详情页竖向时间轴（大字版） */
const vtPlan = await page.evaluate(() => {
  const rows = document.querySelectorAll('.vt-plan .vt-row');
  const name = document.querySelector('.vt-plan .vt-name');
  const tile = document.querySelector('.pl-strip');
  const vert = document.querySelector('.vt-plan');
  return {
    rows: rows.length,
    font: parseFloat(getComputedStyle(name).fontSize),
    bell: Math.round(document.querySelector('.vt-plan .pl-bell').getBoundingClientRect().width),
    board: !!document.querySelector('.vt-plan .vt-row.board'),
    alight: !!document.querySelector('.vt-plan .vt-row.alight'),
    tags: [...document.querySelectorAll('.vt-plan .vt-tag')].map((e) => e.textContent),
    afterHorizontal: !!(tile.compareDocumentPosition(vert) & Node.DOCUMENT_POSITION_FOLLOWING)
  };
});
ok('详情页有竖向时间轴', vtPlan.rows > 5, String(vtPlan.rows));
ok('详情页竖向时间轴位于横向站点条下方', vtPlan.afterHorizontal);
ok('详情页竖向站名 >= 16px', vtPlan.font >= 16, String(vtPlan.font));
ok('详情页竖向提醒按钮 >= 38px', vtPlan.bell >= 38, String(vtPlan.bell));
ok('详情页竖向标记上车站', vtPlan.board && vtPlan.tags.some((t) => t.indexOf('上车') > -1), vtPlan.tags.join(','));
ok('详情页竖向标记下车站', vtPlan.alight && vtPlan.tags.some((t) => t.indexOf('下车') > -1), vtPlan.tags.join(','));
const plOverflow = await overflow();
ok('详情页无横向溢出', plOverflow.sw <= plOverflow.iw + 1, JSON.stringify(plOverflow));

/* 开启提醒 */
await page.evaluate(() => document.querySelector('.pl-bell').click());
await sleep(700);
const plSheet = await txt('#sheet');
ok('详情页铃铛打开提醒弹层', plSheet.indexOf('到站提醒') > -1 && plSheet.indexOf('下一站提醒') > -1, plSheet.slice(0, 60));
const bellStation = await page.evaluate(() => document.querySelector('.pl-bell').dataset.station);
const bellLine = await page.evaluate(() => document.querySelector('.pl-bell').dataset.line);
ok('提醒弹层含线路与站点', plSheet.indexOf(bellLine) > -1 && plSheet.indexOf(bellStation) > -1, bellLine + '/' + bellStation);
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
await clickAct('rm-save');
await sleep(800);
ok('详情页可开启「下一站提醒」', await page.evaluate((a) => ZJ.Reminder.list().some((r) => r.station === a.station && r.mode === 'one'), { station: bellStation }));
ok('开启后铃铛高亮', (await cnt('.pl-bell.on')) > 0, String(await cnt('.pl-bell.on')));
ok('提醒写入 localStorage', await page.evaluate(() => (ZJ.Store.get('zjbus.reminders.v1', []) || []).length === 1));

/* 关闭提醒 */
await page.evaluate(() => document.querySelector('.pl-bell.on').click());
await sleep(600);
ok('再次点击可打开关闭入口', await has('[data-act="rm-cancel"]'));
await clickAct('rm-cancel');
await sleep(700);
ok('详情页可关闭提醒', await page.evaluate(() => ZJ.Reminder.list().length === 0));
ok('关闭后铃铛取消高亮', (await cnt('.pl-bell.on')) === 0, String(await cnt('.pl-bell.on')));

/* 跳转该线路实时页 */
const fullLineBtn = await page.evaluate(() => {
  const b = document.querySelector('[data-act="pl-full-line"]');
  return b ? { txt: b.innerText.replace(/\s+/g, ' ').trim(), count: document.querySelectorAll('[data-act="pl-full-line"]').length } : null;
});
ok('详情页提供「查看完整线路」次要入口', fullLineBtn && fullLineBtn.txt.indexOf('查看完整线路') > -1, JSON.stringify(fullLineBtn));
await page.evaluate(() => document.querySelector('[data-act="pl-full-line"]').click());
await sleep(1200);
ok('点「查看完整线路」进入独立线路页', await page.$eval('#page-line', (el) => el.classList.contains('on')));
await page.evaluate(() => ZJ.Line.close());
await sleep(600);

/* 降级：实时接口失效 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => { throw new Error('网络异常，请检查网络'); };
  ZJ.Plan.refresh();
});
await sleep(1400);
ok('接口失效显示降级提示条', (await txt('#plSummary')).indexOf('已关闭到站预估') > -1, (await txt('#plSummary')).slice(0, 60));
ok('降级提示提供重试', await has('.degrade-banner [data-act="plan-refresh"]'));
ok('降级后仍展示分段卡片', (await cnt('.pl-leg')) >= 1, String(await cnt('.pl-leg')));
ok('降级后站点条仍可用', (await cnt('.pl-strip .tl-item')) > 5);
ok('降级后站点提醒仍可操作', (await cnt('.pl-bell')) > 3);
/* 恢复接口 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: 240, list: [{ vehicleOrder: 3, distance: 120, isArriveStation: 0, plateNumber: '浙D00031D' }] });
  ZJ.Plan.refresh();
});
await sleep(1200);
ok('恢复后实时数据回来', (await txt('#plSummary')).indexOf('已关闭到站预估') === -1, (await txt('#plSummary')).slice(0, 60));
/* 安卓实体返回键 = history.back()，应先关详情页而不是退出 */
await page.goBack();
await sleep(900);
ok('安卓返回键可关闭详情页', await page.$eval('#page-plan', (el) => !el.classList.contains('on')));
ok('返回后仍停留在去哪页', await page.$eval('#page-go', (el) => el.classList.contains('on')));

/* 历史 */
await page.evaluate(() => document.querySelector('.hist-row').click());
await sleep(900);
ok('点击历史可重新查询', (await cnt('.trip-card')) >= 1, 'cards=' + (await cnt('.trip-card')));
await page.evaluate(() => document.querySelector('.hist-row .hist-del').click());
await sleep(500);
const histDbg = await page.evaluate(() => ({ store: ZJ.Store.get('zjbus.history.v1', []).length, rows: document.querySelectorAll('.hist-row').length }));
ok('可删除单条历史', histDbg.rows === 0, JSON.stringify(histDbg));

/* 相同起终点 */
await pickStation('pick-to', '火车站');
await sleep(800);
ok('起终点相同时给出提示', (await txt('#toast')).indexOf('不能') > -1, await txt('#toast'));

/* ---------------- 13. 首末班校验与多方案（v1.4.0） ---------------- */
section('首末班校验（收班后不显示剩余站数与到达时间）');
await pickStation('pick-from', '火车站');
await pickStation('pick-to', '草塔停车场');
await sleep(1400);
const goBase = await page.evaluate(() => ({
  cards: document.querySelectorAll('#planResult .trip-card').length,
  dur: (document.querySelector('#planResult .trip-dur') || {}).innerText || '',
  firstTag: document.querySelector('#planResult .plan-tag').innerText.trim(),
  transfers: ZJ.Go.state().plans[0] ? ZJ.Go.state().plans[0].transfers : -1,
  stops: ZJ.Go.state().plans[0] ? ZJ.Go.state().plans[0].stops : -1,
  sorted: ZJ.Go.state().plans.every((p, i, a) => i === 0 || a[i - 1].transfers <= p.transfers),
}));
ok('正常运营时段列表显示总时长', /\d+/.test(goBase.dur), goBase.dur);
ok('直达方案优先展示', goBase.firstTag === '直达' && goBase.transfers === 0, JSON.stringify({ tag: goBase.firstTag, tf: goBase.transfers }));
ok('方案保留剩余站数用于详情页', goBase.stops > 0, String(goBase.stops));
ok('方案按换乘次数升序排列', goBase.sorted, 'cards=' + goBase.cards);

/* 收班过滤：把首套方案的首段末班改到很早，应被过滤掉 */
const filterTest = await page.evaluate(() => {
  const G = ZJ.Go.state();
  const before = G.plans.length;
  const dir = G.plans[0].legs[0].dir;
  const old = dir.last;
  dir.last = '06:10';
  ZJ.Go.render();
  const after = document.querySelectorAll('#planResult .trip-card').length;
  const offShown = document.querySelectorAll('#planResult .trip-card.off').length;
  dir.last = old;
  ZJ.Go.render();
  return { before: before, after: after, offShown: offShown, restored: document.querySelectorAll('#planResult .trip-card').length };
});
ok('收班方案被过滤或明确标注为已收班', filterTest.after < filterTest.before || filterTest.offShown === filterTest.after, JSON.stringify(filterTest));
ok('恢复运营后方案重新出现', filterTest.restored === filterTest.before, JSON.stringify(filterTest));

/* 切到 23:30：模拟定时刷新，全部方案应判为已收班 */
const closedGo = await page.evaluate(() => {
  ZJ.Clock.setFixed(23 * 60 + 30);
  ZJ.Go.tick();
  const res = document.getElementById('planResult');
  const cards = [...res.querySelectorAll('.trip-card')];
  return {
    cards: cards.length,
    off: cards.filter((c) => c.classList.contains('off')).length,
    hero: cards[0] ? cards[0].innerText.replace(/\s+/g, ' ').trim() : '',
    tag: cards[0] ? cards[0].querySelector('.plan-tag').innerText.trim() : '',
    hasRemain: /到目的地还有\s*\d+\s*站/.test(res.innerText),
    hasEta: /\d+:\d+\s*到达/.test(res.innerText),
    banner: (res.querySelector('.degrade-banner') || {}).innerText ? res.querySelector('.degrade-banner').innerText.replace(/\s+/g, ' ').trim() : '',
  };
});
ok('收班后整卡标记为已收班', closedGo.off === closedGo.cards && closedGo.cards > 0, JSON.stringify(closedGo));
ok('收班后不再渲染剩余站数', !closedGo.hasRemain, closedGo.hero);
ok('收班后不再渲染预估到达时间', !closedGo.hasEta, closedGo.hero);
ok('收班卡显示末班已发出', /已收班/.test(closedGo.hero) && /末班/.test(closedGo.hero), closedGo.hero);
ok('收班卡提示明日首班', (await txt('#planResult')).indexOf('明日首班') > -1, (await txt('#planResult')).slice(0, 60));
ok('全部收班时给出今日末班已过提示', closedGo.banner.indexOf('今日末班已过') > -1, closedGo.banner);

/* 详情页收班态 */
await page.evaluate(() => document.querySelector('#planResult .trip-card').click());
await page.waitForFunction(() => document.getElementById('page-plan').classList.contains('on'), { timeout: 4000 });
await sleep(1200);
const closedDetail = await page.evaluate(() => {
  const sum = document.getElementById('plSummary');
  return {
    hl: sum.innerText.replace(/\s+/g, ' ').trim(),
    numOff: !!document.querySelector('.pl-hl-num.off'),
    num: !!document.querySelector('.pl-hl-num:not(.off)'),
    hasEta: /\d+:\d+\s*到达/.test(sum.innerText),
    live: (document.querySelector('.pl-live') || {}).innerText || '',
    vt: (document.querySelector('#plLegs .vt-eta') || {}).innerText || '',
    strips: document.querySelectorAll('.pl-strip .tl-item').length,
  };
});
ok('详情页收班态大字条显示已收班', /已收班/.test(closedDetail.hl) && closedDetail.numOff, closedDetail.hl);
ok('详情页收班态不渲染剩余站数', !closedDetail.num, closedDetail.hl);
ok('详情页收班态不渲染到达时间', !closedDetail.hasEta, closedDetail.hl);
ok('详情页收班态分段显示已收班说明', /已收班/.test(closedDetail.live) && /运营时段/.test(closedDetail.live), closedDetail.live.slice(0, 60));
ok('详情页收班态竖向时间轴不显示到站时间', /已收班/.test(closedDetail.vt), closedDetail.vt);
await page.evaluate(() => ZJ.Plan.close());
await sleep(700);

/* 首班前 */
const beforeGo = await page.evaluate(() => {
  ZJ.Clock.setFixed(5 * 60);
  ZJ.Go.tick();
  const c = document.querySelector('#planResult .trip-card');
  return {
    hero: c ? c.innerText.replace(/\s+/g, ' ').trim() : '',
    tags: c ? [...c.querySelectorAll('.plan-tag')].map((x) => x.innerText.trim()) : [],
    hasRemain: /到目的地还有\s*\d+\s*站/.test(document.getElementById('planResult').innerText),
  };
});
ok('首班前显示「首班未发」', /首班未发/.test(beforeGo.hero) && beforeGo.tags.indexOf('首班未发') > -1, JSON.stringify(beforeGo));
ok('首班前提示今日首班时间', /首班\s*\d{1,2}:\d{2}/.test(beforeGo.hero), beforeGo.hero);
ok('首班前不渲染剩余站数', !beforeGo.hasRemain, beforeGo.hero);

/* 线路页 / 站点页收班态 */
await page.evaluate(() => { ZJ.Clock.setFixed(23 * 60 + 30); ZJ.Line.open('1路'); });
await sleep(1400);
const lineClosed = await page.evaluate(() => ({
  stat: (document.getElementById('lineStat') || {}).innerText.replace(/\s+/g, ' ').trim(),
  tag: document.querySelector('#lineInfo .tag').innerText.trim(),
  vt: (document.querySelector('#stopList .vt-eta') || {}).innerText || '',
  hint: document.getElementById('stopHint').innerText,
}));
ok('线路页收班后统计区显示已收班', /已收班/.test(lineClosed.stat), lineClosed.stat.slice(0, 50));
ok('线路页收班后不显示剩余站数', !/还剩|\d+\s*站.*分钟/.test(lineClosed.stat), lineClosed.stat.slice(0, 50));
ok('线路页运营状态标签为已收班', lineClosed.tag === '已收班', lineClosed.tag);
ok('线路页竖向时间轴不显示到站时间', /已收班/.test(lineClosed.vt), lineClosed.vt);
ok('线路页站点提示改为已过运营时段', lineClosed.hint.indexOf('已过运营时段') > -1, lineClosed.hint);
await page.evaluate(() => ZJ.Line.close());
await sleep(600);

await page.evaluate(() => ZJ.Station.open('火车站'));
await sleep(1600);
const stClosed = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('#stLines .st-line')].map((r) => {
    const dir = ((ZJ.Data.lineMap.get(r.dataset.line) || { dirs: [] }).dirs.find((d) => d.key === r.dataset.dir));
    const ord = (r.querySelector('.rt span').textContent.match(/第 (\d+) 站/) || [])[1];
    const svc = dir ? ZJ.Service.info(dir, Number(ord)) : null;
    return { off: !!r.querySelector('.eta.off'), state: svc ? svc.state : 'unknown' };
  });
  const offRows = [...document.querySelectorAll('#stLines .st-line')].filter((r) => r.querySelector('.eta.off'));
  const isOff = (x) => x.state === 'closed' || x.state === 'before';
  return {
    rows: rows.length,
    off: rows.filter((x) => x.off).length,
    mismatch: rows.filter((x) => x.off !== isOff(x)).length,
    offTxt: offRows.map((r) => r.innerText.replace(/\s+/g, ' ')).join(' | '),
  };
});
ok('站点页运营状态与服务判定一致', stClosed.mismatch === 0 && stClosed.off > 0, JSON.stringify(stClosed).slice(0, 120));
ok('站点页收班方向不显示剩余站数', stClosed.offTxt.indexOf('已收班') > -1 && !/\d+\s*站\s*·\s*\d+\s*分/.test(stClosed.offTxt), stClosed.offTxt.slice(0, 80));
await page.evaluate(() => ZJ.Station.close());
await sleep(600);

/* 恢复时钟，验证步行提示（1.2 公里内） */
await page.evaluate(() => { ZJ.Clock.setFixed(9 * 60); ZJ.setTab('go'); });
await sleep(400);
await pickStation('pick-from', '西施殿公交首末站');
await pickStation('pick-to', '西施殿');
await sleep(1400);
const walk = await page.evaluate(() => ({
  card: (document.querySelector('.walk-card') || {}).innerText ? document.querySelector('.walk-card').innerText.replace(/\s+/g, ' ').trim() : '',
  cards: document.querySelectorAll('#planResult .trip-card').length,
}));
ok('近距离起终点给出步行提示', /步行约\s*\d+\s*分钟/.test(walk.card), walk.card);
ok('步行提示含直线距离', /两地相距\s*[\d.]+\s*(米|公里)/.test(walk.card), walk.card);
ok('步行提示不影响公交方案展示', walk.cards >= 1, 'cards=' + walk.cards);

/* ---------------- 13. 边界场景 ---------------- */
section('AI 出行助手（自然语言 → 方案 → 详情）');
await page.evaluate(() => { ZJ.setTab('assistant'); ZJ.Clock.setFixed(9 * 60); });
await sleep(500);
ok('助手页可打开', await page.$eval('#page-assistant', (el) => el.classList.contains('on')));
ok('助手给出欢迎语与示例', (await txt('#aiMsgs')).indexOf('从哪到哪') > -1 && (await cnt('.ai-chip')) >= 2, (await txt('#aiMsgs')).slice(0, 40));

const aiSend = async (q) => {
  await page.evaluate((t) => {
    const i = document.getElementById('aiQ');
    i.value = t;
    document.getElementById('aiForm').dispatchEvent(new Event('submit', { cancelable: true }));
  }, q);
  await sleep(1100);
};
await aiSend('从火车站到草塔停车场');
const aiRes = await page.evaluate(() => ({
  txt: document.getElementById('aiMsgs').innerText.replace(/\s+/g, ' '),
  cards: document.querySelectorAll('.ai-plan').length,
  chips: [...document.querySelectorAll('.ai-chip')].map((x) => x.innerText.trim()),
  first: (document.querySelector('.ai-plan') || {}).innerText ? document.querySelector('.ai-plan').innerText.replace(/\s+/g, ' ') : '',
}));
ok('助手识别起终点并给出文字总结', aiRes.txt.indexOf('火车站') > -1 && aiRes.txt.indexOf('草塔停车场') > -1 && /方案/.test(aiRes.txt), aiRes.txt.slice(-120));
ok('助手返回可点击方案卡', aiRes.cards >= 1, String(aiRes.cards));
ok('方案卡含时长与线路', /\d+\s*分钟/.test(aiRes.first) && /\d+路/.test(aiRes.first), aiRes.first.slice(0, 80));
ok('方案卡标注运营/收班状态', /(运营中|已收班|首班未发)/.test(aiRes.first), aiRes.first.slice(0, 60));
ok('助手提供偏好快捷项', ['最快', '少换乘', '少走路'].every((k) => aiRes.chips.indexOf(k) > -1), aiRes.chips.join('/'));

await page.evaluate(() => document.querySelector('.ai-chip[data-act="ai-pref"][data-v="walk"]').click());
await sleep(1000);
ok('助手可按「少走路」重新推荐', (await txt('#aiMsgs')).indexOf('少走路排序') > -1, (await txt('#aiMsgs')).slice(-90));

await page.evaluate(() => document.querySelector('.ai-plan').click());
await page.waitForFunction(() => document.getElementById('page-plan').classList.contains('on'), { timeout: 4000 });
await sleep(900);
ok('点助手方案卡进入换乘详情页', await page.$eval('#page-plan', (el) => el.classList.contains('on')));
await page.evaluate(() => ZJ.Plan.close());
await sleep(500);
await page.evaluate(() => ZJ.setTab('assistant'));
await sleep(300);

await aiSend('1路首末班几点');
const aiLine = await txt('#aiMsgs');
ok('助手可查线路首末班', /1路/.test(aiLine) && /首班\s*\d{1,2}:\d{2}/.test(aiLine) && /末班\s*\d{1,2}:\d{2}/.test(aiLine), aiLine.slice(-120));
ok('助手给出收班状态', /(运营中|已收班|首班未发)/.test(aiLine), aiLine.slice(-80));
ok('助手提供打开完整线路入口', await has('.ai-btn[data-act="ai-line"]'));

const notifyCount = await page.evaluate(() => {
  window.__aiNotify = 0;
  ZJ.Notify.fire = async () => { window.__aiNotify++; return true; };
  return window.__aiNotify;
});
await aiSend('帮我看看有没有车');
ok('助手不发送系统推送', (await page.evaluate(() => window.__aiNotify)) === notifyCount, String(await page.evaluate(() => window.__aiNotify)));
ok('助手对无法识别的问题给出引导', (await txt('#aiMsgs')).indexOf('还没听懂') > -1 || (await txt('#aiMsgs')).indexOf('再试') > -1, (await txt('#aiMsgs')).slice(-80));

section('数据同步与降级自愈（版本增量 / 2 天校准 / 过期提示）');
const syncBase = await page.evaluate(async () => {
  const m = await (await fetch('data/manifest.json')).json();
  const st = ZJ.DataSync.status();
  return { version: m.version, hash: m.totalHash, chunks: m.chunks.length, dataV: ZJ.Data.version, state: st.state, same: m.version === ZJ.Data.version };
});
ok('版本清单可读取且与内置数据同版本', syncBase.same && syncBase.chunks >= 4, JSON.stringify(syncBase));
ok('清单含每个分片的哈希', await page.evaluate(async () => {
  const m = await (await fetch('data/manifest.json')).json();
  return m.chunks.every((c) => /^[0-9a-f]{8}$/.test(c.hash) && c.url && c.bytes > 0);
}));

const cal = await page.evaluate(async () => {
  const ok = await ZJ.DataSync.calibrate(true);
  return { ok: ok, meta: ZJ.Store.get('zjbus.sync.v1', {}).lastFull || 0, state: ZJ.DataSync.status().state };
});
ok('可执行全量校准并记录时间', cal.ok && cal.meta > 0, JSON.stringify(cal));

const applied = await page.evaluate(async () => {
  const m = await (await fetch('data/manifest.json')).json();
  m.version = m.version + 1;
  const ok = await ZJ.DataSync.applyManifest(m);
  return { ok: ok, v: ZJ.DataSync.status().version, dataV: ZJ.Data.version, lines: ZJ.Data.lines.length };
});
ok('版本号更高时自动增量同步', applied.ok && applied.dataV === applied.v && applied.lines === 395, JSON.stringify(applied));
ok('同步后数据版本与清单一致', applied.dataV === syncBase.version + 1, JSON.stringify(applied));

const repair = await page.evaluate(async () => {
  const cache = ZJ.Store.get('zjbus.ds.v1', null);
  if (!cache) return { skipped: true };
  const bad = JSON.parse(JSON.stringify(cache));
  bad.chunks[0].data = '{"id":"c00","lines":[]}';
  ZJ.Store.set('zjbus.ds.v1', bad);
  const ok = await ZJ.DataSync.calibrate(true);
  const fresh = ZJ.Store.get('zjbus.ds.v1', null);
  const good = fresh && fresh.chunks && fresh.chunks[0] && ZJ.DataSync.fnv1a(fresh.chunks[0].data) === fresh.chunks[0].hash;
  return { ok: ok, repaired: !!good, lines: ZJ.Data.lines.length };
});
ok('本地分片被改动后可自愈修复', repair.skipped || (repair.ok && repair.repaired && repair.lines === 395), JSON.stringify(repair));

const stale = await page.evaluate(() => {
  const meta = ZJ.Store.get('zjbus.sync.v1', {});
  meta.lastCheck = Date.now() - 30 * 86400000;
  ZJ.Store.set('zjbus.sync.v1', meta);
  const st = ZJ.DataSync.status();
  ZJ.setTab('go');
  ZJ.Go.render();
  const hint = document.getElementById('goDataHint');
  return { state: st.state, hint: ZJ.DataSync.hint(), visible: hint ? !hint.hidden : false, txt: hint ? hint.innerText : '' };
});
ok('超过校准周期判为过期', stale.state === 'stale', JSON.stringify(stale));
ok('数据过期给出一行静态提示', stale.visible && stale.txt.length > 4, stale.txt);
ok('过期提示不是弹窗或红点', await page.evaluate(() => document.getElementById('alertMask').hidden && !document.querySelector('.dot-badge,.red-dot')));

await page.evaluate(() => { ZJ.Store.set('zjbus.sync.v1', { lastCheck: Date.now(), lastOk: Date.now(), lastFull: Date.now() }); ZJ.Go.render(); });
ok('校准后过期提示自动消失', await page.evaluate(() => document.getElementById('goDataHint').hidden));

section('设置页（主题 / 提醒方式 / 通知权限 / 数据）');
await page.evaluate(() => ZJ.setTab('settings'));
await sleep(500);
ok('切到设置页', await page.$eval('#page-settings', (el) => el.classList.contains('on')));
ok('提供 4 种主题色', (await cnt('.theme-dot')) === 4, String(await cnt('.theme-dot')));
await page.evaluate(() => document.querySelectorAll('.theme-dot')[1].click());
await sleep(300);
const themeState = await page.evaluate(() => ({
  attr: document.documentElement.getAttribute('data-theme'),
  saved: ZJ.Prefs.get('theme'),
  on: document.querySelectorAll('.theme-dot.on').length,
  meta: document.querySelector('meta[name="theme-color"]').content
}));
ok('切换主题后立即生效', themeState.attr === 'sky' && themeState.saved === 'sky', JSON.stringify(themeState));
ok('主题选择高亮唯一', themeState.on === 1, String(themeState.on));
ok('主题色同步系统状态栏色', themeState.meta.toLowerCase() === '#2e7bf6', themeState.meta);
await page.evaluate(() => document.querySelectorAll('.theme-dot')[0].click());
await sleep(250);
ok('可切回玫瑰粉', (await page.evaluate(() => document.documentElement.getAttribute('data-theme'))) === 'rose');

await page.evaluate(() => document.getElementById('swSound').click());
await sleep(250);
ok('可关闭提示音', await page.evaluate(() => ZJ.Prefs.get('sound') === false));
ok('关闭后不再响铃', await page.evaluate(() => window.__chimeOrig() === false));
await page.evaluate(() => document.getElementById('swSound').click());
await sleep(250);
ok('可重新开启提示音', await page.evaluate(() => ZJ.Prefs.get('sound') === true));

await page.evaluate(() => document.getElementById('swVibrate').click());
await sleep(250);
ok('可关闭震动', await page.evaluate(() => ZJ.Prefs.get('vibrate') === false));
ok('关闭后震动不触发', await page.evaluate(() => ZJ.UI.vibrate([10]) === false));
await page.evaluate(() => document.getElementById('swVibrate').click());
await sleep(250);
ok('可重新开启震动', await page.evaluate(() => ZJ.Prefs.get('vibrate') === true));

const volSet = await page.evaluate(() => {
  const r = document.getElementById('volRange');
  r.value = '40';
  r.dispatchEvent(new Event('input', { bubbles: true }));
  r.dispatchEvent(new Event('change', { bubbles: true }));
  return { pref: ZJ.Prefs.get('volume'), label: document.getElementById('volTxt').textContent };
});
ok('可调节提示音音量', volSet.pref === 40 && volSet.label === '40%', JSON.stringify(volSet));
ok('音量滑块存在且范围 0-100', await page.$eval('#volRange', (el) => el.min === '0' && el.max === '100'));

await page.evaluate(() => document.querySelector('[data-act="set-poll"][data-v="30"]').click());
await sleep(300);
const pollState = await page.evaluate(() => ({ pref: ZJ.Prefs.get('poll'), on: document.querySelector('#pollSeg .seg-b.on').dataset.v }));
ok('提醒轮询间隔可设置', pollState.pref === 30 && pollState.on === '30', JSON.stringify(pollState));
await page.evaluate(() => document.querySelector('[data-act="set-poll"][data-v="15"]').click());
await sleep(200);

const permBadge = await txt('#permBadge');
ok('展示通知权限状态', ['已开启', '未开启', '已关闭', '不支持'].indexOf(permBadge) > -1, permBadge);
await page.evaluate(() => { ZJ.Notify.status = async () => 'prompt'; ZJ.Settings.render(); });
await sleep(400);
await page.evaluate(() => document.getElementById('btnReqNotify').click());
await sleep(600);
const permAlert = await txt('#alertCard');
ok('无权限时弹窗给出明确说明', permAlert.indexOf('通知') > -1 && permAlert.indexOf('响铃') > -1, permAlert.slice(0, 80));
ok('弹窗可一键开启通知', await has('[data-act="perm-request"]'));
ok('弹窗提供去系统设置入口', await has('[data-act="open-notify-set"]'));
await clickAct('permalert-close');
await sleep(400);
ok('弹窗可关闭', await page.$eval('#alertMask', (el) => el.hidden));

await page.evaluate(() => { ZJ.Notify.status = async () => 'denied'; ZJ.Settings.render(); });
await sleep(400);
ok('权限被关闭时状态为「已关闭」', (await txt('#permBadge')) === '已关闭', await txt('#permBadge'));
await page.evaluate(() => document.getElementById('btnReqNotify').click());
await sleep(600);
const deniedAlert = await txt('#alertCard');
ok('已关闭时给出设置步骤', deniedAlert.indexOf('设置') > -1 && deniedAlert.indexOf('应用') > -1, deniedAlert.slice(0, 90));
await clickAct('permalert-close');
await sleep(300);
await page.evaluate(() => { ZJ.Notify.status = async () => 'granted'; ZJ.Settings.render(); });
await sleep(300);
ok('已开启时状态为「已开启」', (await txt('#permBadge')) === '已开启', await txt('#permBadge'));

/* 清除缓存 */
await page.evaluate(() => document.querySelector('[data-act="clear-cache"]').click());
await sleep(500);
ok('清除缓存前有确认弹窗', (await txt('#alertCard')).indexOf('清除') > -1, (await txt('#alertCard')).slice(0, 50));
await page.evaluate(() => document.querySelector('[data-act="clear-cache-do"]').click());
await sleep(600);
const afterClear = await page.evaluate(() => ({
  hist: (ZJ.Store.get('zjbus.history.v1', []) || []).length,
  fav: (ZJ.Store.get('zjbus.fav.lines.v1', []) || []).length,
  theme: ZJ.Prefs.get('theme')
}));
ok('清除缓存清空查询记录', afterClear.hist === 0, JSON.stringify(afterClear));
ok('清除缓存不影响收藏与设置', afterClear.theme === 'rose', JSON.stringify(afterClear));

/* 数据版本卡 */
const syncCard = await page.evaluate(() => ({
  ver: document.getElementById('dataVer').textContent.trim(),
  hint: document.getElementById('dataHint').textContent.trim(),
  btns: document.querySelectorAll('[data-act="data-check"],[data-act="data-calibrate"]').length,
}));
ok('设置页展示数据版本', /^v\d+/.test(syncCard.ver), syncCard.ver);
ok('设置页展示校准状态', syncCard.hint.length > 6, syncCard.hint);
ok('设置页提供手动检查与校准', syncCard.btns === 2, String(syncCard.btns));

/* 关于 */
await page.evaluate(() => document.querySelector('[data-act="about"]').click());
await sleep(500);
const about = await txt('#sheet');
ok('关于页显示版本号', about.indexOf('v' + (await page.evaluate(() => ZJ.CFG.VERSION))) > -1, about.slice(0, 60));
ok('关于页说明数据来源', about.indexOf('官方接口') > -1);
ok('关于页可关闭', await has('#sheet [data-act="close-sheet"]'));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

section('到站提醒（响铃 + 震动 + 系统通知）');
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: 240, list: [
    { vehicleOrder: 10, distance: 120, isArriveStation: 0, plateNumber: '浙D00001D' }
  ], static: false });
  ZJ.Api.lineDetail = async () => ({ lineName: '23路', up: { totalPrice: 1.0 } });
  ZJ.setTab('home');
  ZJ.Line.open('23路', 'up', window.__testStation);
});
await page.waitForFunction(() => document.getElementById('page-line').classList.contains('on'), { timeout: 4000 });
await sleep(1200);
await page.evaluate(() => {
  window.__vibrate = [];
  window.__chime = 0;
  window.__notified = 0;
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  ZJ.Sound.chime = () => { window.__chime++; return true; };
  ZJ.Notify.fire = async () => { window.__notified++; return true; };
  document.querySelector('.vt-row[data-station="' + window.__testStation + '"] .vt-bell').click();
});
await sleep(700);
ok('提醒弹层包含三种方式', (await txt('#sheet')).indexOf('到站提醒') > -1);
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
await clickAct('rm-save');
await sleep(1200);
ok('提醒已写入本地', await page.evaluate(() => ZJ.Reminder.list().length === 1));
const fired = await page.$eval('#alertMask', (el) => !el.hidden);
ok('车辆剩 1 站时弹出到站提醒', fired, 'alert hidden');
if (fired) {
  ok('提醒触发时响铃', (await page.evaluate(() => window.__chime)) > 0, String(await page.evaluate(() => window.__chime)));
  ok('提醒触发时震动', (await page.evaluate(() => window.__vibrate.length)) > 0, String(await page.evaluate(() => window.__vibrate.length)));
  ok('有通知权限时发送系统通知', (await page.evaluate(() => window.__notified)) > 0, String(await page.evaluate(() => window.__notified)));
  ok('弹窗含车牌与站名', (await txt('#alertCard')).indexOf('浙D00001D') > -1, (await txt('#alertCard')).slice(0, 70));
  await page.evaluate(() => document.getElementById('rmGo').click());
  await sleep(400);
  ok('弹窗可关闭', await page.$eval('#alertMask', (el) => el.hidden));
}
await page.evaluate(() => { ZJ.Line.close(); ZJ.setTab('home'); });
await sleep(600);
ok('首页显示提醒记录卡片', await page.$eval('#remindCard', (el) => !el.hidden));
ok('提醒记录显示已提醒状态', (await txt('#remindBody')).indexOf('已提醒') > -1, await txt('#remindBody'));
await page.evaluate(() => document.querySelector('[data-act="reminder-list"]').click());
await sleep(600);
ok('提醒管理弹层可打开', (await txt('#sheet')).indexOf('到站提醒') > -1);
ok('管理弹层列出记录', (await cnt('.rm-item')) === 1, String(await cnt('.rm-item')));
await page.evaluate(() => { const b = document.querySelector('.rm-item .r-del'); if (b) b.click(); });
await sleep(500);
ok('可删除提醒记录', await page.evaluate(() => ZJ.Reminder.list().length === 0));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

section('边界场景');

/* 13.1 站点搜索无结果 */
await page.evaluate(() => ZJ.setTab('go'));
await clickAct('pick-from');
await sleep(400);
await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
await sleep(300);
await page.type('#pkQ', '不存在的地名XYZ');
await sleep(400);
ok('站名搜索无结果有提示', (await txt('#pkList')).indexOf('没有找到') > -1, (await txt('#pkList')).slice(0, 50));
await page.evaluate(() => ZJ.UI.closeSheet());
await sleep(400);

/* 13.2 无直达线路：应给出换乘方案，或给出友好空态 */
const noDirect = await page.evaluate(() => {
  const sts = ZJ.Data.stations;
  const hasDirect = (a, b) => a.entries.some((x) => b.entries.some((y) => x.dir === y.dir && y.order > x.order));
  for (let i = 0; i < sts.length; i++) {
    const a = sts[i];
    if (!a.entries.length || a.entries.length > 4) continue;
    for (let j = i + 1; j < Math.min(sts.length, i + 400); j++) {
      const b = sts[j];
      if (b.name === a.name || !b.entries.length) continue;
      if (!hasDirect(a, b) && !hasDirect(b, a)) return { from: a.name, to: b.name };
    }
  }
  return null;
});
if (noDirect) {
  await pickStation('pick-from', noDirect.from);
  await pickStation('pick-to', noDirect.to);
  await sleep(1400);
  const resTxt = await txt('#planResult');
  const kind = resTxt.indexOf('暂无可用方案') > -1 ? '空态' : /换乘/.test(resTxt) ? '换乘方案' : '未知';
  ok('无直达线路时有换乘方案或空态提示', kind !== '未知', noDirect.from + '→' + noDirect.to + ' :: ' + kind + ' :: ' + resTxt.slice(0, 40));
} else {
  ok('无直达线路时有换乘方案或空态提示', false, '未找到无直达站点对');
}

/* 13.3 网络异常：线路页降级为静态数据 */
await page.evaluate(() => {
  ZJ.Api.vehicles = async () => { throw new Error('网络异常，请检查网络'); };
  ZJ.Api.lineDetail = async () => { throw new Error('网络异常'); };
  ZJ.Api.plan = async () => { throw new Error('网络异常'); };
  ZJ.setTab('home');
  document.querySelector('.line-row[data-name="1路"]').click();
});
await sleep(1600);
const errStat = await txt('#lineStat');
ok('网络异常时显示错误卡', errStat.indexOf('实时车辆不可用') > -1, errStat.slice(0, 60));
ok('错误卡提供重试按钮', await has('[data-act="line-refresh"]'));
ok('顶部显示降级提示条', (await txt('#lineBanner')).indexOf('自动降级') > -1, (await txt('#lineBanner')).slice(0, 60));
ok('静态站序仍可用', (await cnt('.vt-row')) > 10, String(await cnt('.vt-row')));
ok('静态站点条仍可横向滑动', (await page.evaluate(() => {
  const sc = document.getElementById('tlScroll');
  return sc.scrollWidth > sc.clientWidth;
})));
ok('页脚说明时刻表兜底', (await txt('#lineNote')).indexOf('时刻表') > -1, await txt('#lineNote'));
await page.evaluate(() => ZJ.Line.close());
await sleep(500);

/* 13.4 定位失败：新页面拒绝定位权限 */
const page2 = await browser.newPage();
await page2.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
await page2.evaluateOnNewDocument(() => {
  navigator.geolocation.getCurrentPosition = (s, e) => setTimeout(() => e({ code: 1, message: 'User denied Geolocation' }), 60);
});
await page2.goto(BASE, { waitUntil: 'networkidle2' });
await sleep(1600);
ok('定位失败不影响首页渲染', (await page2.$$eval('.line-row', (e) => e.length)) > 10);
ok('定位失败状态被记录', (await page2.evaluate(() => ZJ.Geo.state)) === 'fail', await page2.evaluate(() => ZJ.Geo.state));
ok('定位失败无附近站点残留', (await page2.$$('#nearbyList, .nb-row')).length === 0);
const failScroll = await page2.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
ok('定位失败页无横向溢出', failScroll.sw <= failScroll.iw + 1, JSON.stringify(failScroll));
await page2.close();

/* ---------------- 14. 移动端适配 & 需求剔除 ---------------- */
section('移动端适配与功能边界');
await page.evaluate(() => { ZJ.setTab('home'); });
await sleep(400);
for (const tab of ['home', 'go', 'assistant']) {
  await page.evaluate((t) => ZJ.setTab(t), tab);
  await sleep(350);
  const m = await overflow();
  ok(tab + ' 页无横向溢出', m.sw <= m.iw + 1, JSON.stringify(m));
}
const forbidden = await page.evaluate(() => {
  const html = document.documentElement.innerHTML;
  return {
    mapSdk: /amap|qq\.map|BMap|AMap|mapbox|leaflet/i.test(html),
    mapEl: !!document.querySelector('#map,.map-container,.amap-container'),
    notice: /公告/.test(document.body.innerText),
    mine: /乘车码|意见反馈|消息推送|到站订阅/.test(document.body.innerText),
    mapApi: !!(window.AMap || window.qq || window.TMap || window.BMap)
  };
});
ok('未引入任何地图 SDK', !forbidden.mapSdk && !forbidden.mapApi, JSON.stringify(forbidden));
ok('没有地图容器', !forbidden.mapEl);
ok('页面无公告入口', !forbidden.notice);
ok('无乘车码/反馈/推送/订阅入口', !forbidden.mine, JSON.stringify(forbidden));

section('数据更新联动（首末班校验随新数据刷新）');
const linkage = await page.evaluate(async () => {
  ZJ.Clock.setFixed(9 * 60);
  ZJ.setTab('go');
  const G = ZJ.Go.state();
  G.from = '火车站'; G.to = '草塔停车场';
  ZJ.Go.plan({ silent: true, noHistory: true });
  await new Promise((r) => setTimeout(r, 400));
  const before = ZJ.Go.state().plans.length;
  const dir = ZJ.Go.state().plans[0].legs[0].dir;
  const oldFirst = dir.first;
  dir.first = '05:00';
  dir.last = '05:30';
  const lateOpen = ZJ.Service.info(dir, 1).state;
  const m = await (await fetch('data/manifest.json')).json();
  m.version = m.version + 2;
  await ZJ.DataSync.applyManifest(m);
  const after = ZJ.Go.state().plans.length;
  const newDir = ZJ.Data.lineMap.get(dir.line).dirs.find((d) => d.key === dir.key);
  return { before: before, after: after, lateOpen: lateOpen, oldFirst: oldFirst, restoredFirst: newDir ? newDir.first : '', lines: ZJ.Data.lines.length };
});
ok('收班判定随数据即时变化', linkage.lateOpen === 'closed', JSON.stringify(linkage));
ok('数据更新后自动重建索引并重新规划', linkage.after > 0 && linkage.lines === 395, JSON.stringify(linkage));
ok('更新后首末班恢复为官方数据', linkage.restoredFirst === linkage.oldFirst, JSON.stringify(linkage));

section('控制台');
const jsErrors = errors.filter((e) => !/Failed to load resource|net::ERR|ERR_/i.test(e));
ok('运行期无 JS 错误', jsErrors.length === 0, jsErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n================================');
console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项');
if (fails.length) {
  console.log('失败明细：');
  fails.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('全部测试通过 ✅');
