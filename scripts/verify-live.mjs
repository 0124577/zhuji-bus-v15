// 线上部署校验（v1.5.0）：数据同步 / 出行列表 / 换乘详情 / 助手 / 二级线路入口
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = process.argv[2] || 'https://0124577.github.io/zhuji-bus-navi/';

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
const failed = [];
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/Failed to load resource/i.test(t)) errors.push(t);
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() || {}).errorText));
page.on('response', (r) => {
  if (r.status() >= 400 && !/getBusLinePlanSimpleTime/.test(r.url())) failed.push(r.url() + ' HTTP ' + r.status());
});

const out = [];
const ok = (n, c, extra = '') => out.push(`${c ? 'PASS' : 'FAIL'}  ${n}${extra ? '  ' + extra : ''}`);

await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise((r) => setTimeout(r, 1200));

ok('页面标题', (await page.title()).includes('诸暨'), await page.title());

const stat = await page.evaluate(() => ({
  hasZJ: typeof window.ZJ === 'object',
  lines: (window.ZJ?.Data?.lines || []).length,
  dirs: [...(window.ZJ?.Data?.dirs?.keys?.() || [])].length,
  stations: (window.ZJ?.Data?.stations || []).length,
  tabs: [...document.querySelectorAll('.tabbar .tab')].map((e) => e.textContent.trim()),
  mapRefs: /amap|AMap|BMap|mapbox|leaflet|qq\.map/i.test(document.documentElement.outerHTML),
  dataV: window.ZJ?.Data?.version,
}));
ok('运行环境存在 ZJ', stat.hasZJ);
ok('静态数据加载', stat.lines > 300 && stat.stations > 2000, `${stat.lines} 线/${stat.dirs} 向/${stat.stations} 站`);
ok('Tab 为 首页/出行/助手/设置', stat.tabs.join('/') === '首页/出行/助手/设置', stat.tabs.join(' | '));
ok('无地图 SDK 引用', !stat.mapRefs);
ok('数据带版本号', Number(stat.dataV) > 0, String(stat.dataV));

/* 数据同步：清单、状态、静默（无弹窗） */
const sync = await page.evaluate(async () => {
  const m = await (await fetch('data/manifest.json', { cache: 'no-store' })).json();
  const st = ZJ.DataSync.status();
  const okCal = await ZJ.DataSync.calibrate(true);
  return {
    version: m.version, chunks: m.chunks.length, hash: m.totalHash,
    state: st.state, dataV: ZJ.Data.version, cal: okCal,
    alertHidden: document.getElementById('alertMask').hidden,
    dots: document.querySelectorAll('.red-dot,.dot-badge').length
  };
});
ok('版本清单可读取', sync.version > 0 && sync.chunks >= 4 && /^[0-9a-f]{8}$/.test(sync.hash), JSON.stringify(sync).slice(0, 90));
ok('数据版本与清单一致', sync.dataV === sync.version, `${sync.dataV} / ${sync.version}`);
ok('全量校准可执行', sync.cal === true, String(sync.cal));
ok('数据同步不弹窗、不置红点', sync.alertHidden && sync.dots === 0);

/* 出行 */
await page.evaluate(() => window.ZJ.setTab('go'));
await new Promise((r) => setTimeout(r, 500));
const goState = await page.evaluate(() => ({
  on: !!document.querySelector('#page-go')?.classList.contains('on'),
  title: document.querySelector('#page-go h1')?.textContent.trim(),
  queryBtn: !!document.querySelector('[data-act="plan"]')
}));
ok('切到「出行」', goState.on && goState.title === '出行', JSON.stringify(goState));

/* 设置 */
await page.evaluate(() => window.ZJ.setTab('settings'));
await new Promise((r) => setTimeout(r, 800));
const setState = await page.evaluate(() => ({
  on: !!document.querySelector('#page-settings')?.classList.contains('on'),
  themes: document.querySelectorAll('.theme-dot').length,
  switches: document.querySelectorAll('.switch').length,
  poll: document.querySelectorAll('#pollSeg .seg-b').length,
  perm: (document.getElementById('permBadge') || {}).textContent,
  ver: (document.getElementById('verTxt') || {}).textContent,
  dataVer: (document.getElementById('dataVer') || {}).textContent,
  dataHint: (document.getElementById('dataHint') || {}).textContent
}));
ok('设置页可打开且项目齐全', setState.on && setState.themes === 4 && setState.switches === 2 && setState.poll === 4, JSON.stringify(setState).slice(0, 100));
ok('设置页展示通知权限状态', ['已开启', '未开启', '已关闭', '不支持'].indexOf(setState.perm) > -1, setState.perm);
ok('设置页展示数据版本与校准状态', /^v\d+/.test(setState.dataVer || '') && (setState.dataHint || '').length > 6, `${setState.dataVer} / ${setState.dataHint}`);

/* 助手 */
await page.evaluate(() => { ZJ.Clock.setFixed(9 * 60); ZJ.setTab('assistant'); });
await new Promise((r) => setTimeout(r, 600));
const aiWelcome = await page.evaluate(() => ({
  on: document.querySelector('#page-assistant')?.classList.contains('on'),
  txt: document.getElementById('aiMsgs').innerText.replace(/\s+/g, ' '),
  chips: document.querySelectorAll('.ai-chip').length
}));
ok('助手页可打开并给出引导', aiWelcome.on && /从哪到哪/.test(aiWelcome.txt) && aiWelcome.chips >= 2, aiWelcome.txt.slice(0, 40));

await page.evaluate(() => {
  const i = document.getElementById('aiQ');
  i.value = '从火车站到草塔停车场';
  document.getElementById('aiForm').dispatchEvent(new Event('submit', { cancelable: true }));
});
await new Promise((r) => setTimeout(r, 1400));
const aiRes = await page.evaluate(() => ({
  cards: document.querySelectorAll('.ai-plan').length,
  txt: document.getElementById('aiMsgs').innerText.replace(/\s+/g, ' '),
  first: (document.querySelector('.ai-plan') || {}).innerText || ''
}));
ok('助手识别自然语言并给出方案卡', aiRes.cards >= 1 && /方案/.test(aiRes.txt), String(aiRes.cards));
ok('助手方案卡含时长 / 线路 / 状态', /\d+\s*分钟/.test(aiRes.first) && /\d+路/.test(aiRes.first) && /(运营中|已收班|首班未发)/.test(aiRes.first), aiRes.first.replace(/\s+/g, ' ').slice(0, 70));

await page.evaluate(() => document.querySelector('.ai-plan').click());
await new Promise((r) => setTimeout(r, 1600));
ok('助手方案卡可进入换乘详情', await page.evaluate(() => document.getElementById('page-plan').classList.contains('on')));
ok('详情页提供改站与查看完整线路', await page.evaluate(() =>
  document.querySelectorAll('.pl-hop[data-act="pl-hop"]').length >= 2 && !!document.querySelector('[data-act="pl-full-line"]')));
const hopBefore = await page.evaluate(() => document.querySelector('.pl-hop b').innerText);
await page.evaluate(() => document.querySelector('.pl-hop[data-kind="board"]').click());
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => document.querySelectorAll('#pkList .pick-stop')[2].click());
await new Promise((r) => setTimeout(r, 1400));
const hopAfter = await page.evaluate(() => ({
  name: document.querySelector('.pl-hop b').innerText,
  toast: document.getElementById('toast').innerText,
  stillPlan: document.getElementById('page-plan').classList.contains('on')
}));
ok('详情页可就地改上下车站并重算', hopAfter.stillPlan && hopAfter.name !== hopBefore && /重新计算/.test(hopAfter.toast), JSON.stringify(hopAfter));

await page.evaluate(() => document.querySelector('[data-act="pl-full-line"]').click());
await new Promise((r) => setTimeout(r, 1400));
ok('「查看完整线路」进入独立线路页', await page.evaluate(() => document.getElementById('page-line').classList.contains('on')));

/* 部署产物校验 */
const deploy = await page.evaluate(async () => {
  const txt = async (u) => (await fetch(u, { cache: 'no-store' })).text();
  const [go, plan, ai, ds, theme, css, manifest] = await Promise.all([
    txt('js/go.js'), txt('js/plan.js'), txt('js/ai.js'), txt('js/datasync.js'),
    txt('css/theme.css'), txt('css/app.css'), txt('data/manifest.json')
  ]);
  return {
    trip: go.indexOf('trip-card') > -1 && go.indexOf('vehStatus') > -1,
    hop: plan.indexOf('pl-hop') > -1 && plan.indexOf('pl-full-line') > -1,
    ai: ai.length > 3000 && ai.indexOf('ai-plan') > -1,
    ds: ds.length > 3000 && ds.indexOf('calibrate') > -1,
    css: theme.indexOf('.trip-card') > -1 && theme.indexOf('.ai-bub') > -1 && css.indexOf('.pl-hl') > -1,
    manifest: JSON.parse(manifest).chunks.length >= 4
  };
});
ok('线上已部署精简方案列表', deploy.trip);
ok('线上已部署详情页改站与完整线路入口', deploy.hop);
ok('线上已部署 AI 助手脚本', deploy.ai);
ok('线上已部署数据同步模块', deploy.ds);
ok('线上已部署新版样式与大字条', deploy.css);
ok('线上数据清单含分片', deploy.manifest);

/* 首末班与收班 */
const svc = await page.evaluate(() => {
  const dir = ZJ.Data.lineOf('1路').dirs[0];
  ZJ.Clock.setFixed(9 * 60);
  const open = ZJ.Service.info(dir, 1);
  ZJ.Clock.setFixed(23 * 60 + 30);
  const closed = ZJ.Service.info(dir, 1);
  return { openState: open.state, closedState: closed.state, off: closed.off, first: dir.first, last: dir.last };
});
ok('首末班判定：运营时段内为运营中', svc.openState === 'running' || svc.openState === 'lastGone', JSON.stringify(svc));
ok('首末班判定：超过末班后判为已收班', svc.closedState === 'closed' && svc.off, JSON.stringify(svc));

await page.evaluate(() => { ZJ.Line.close(); ZJ.Clock.setFixed(23 * 60 + 30); ZJ.Line.open('1路'); });
await new Promise((r) => setTimeout(r, 2400));
const lc = await page.evaluate(() => ({
  stat: (document.getElementById('lineStat') || {}).innerText.replace(/\s+/g, ' ').trim(),
  tag: (document.querySelector('#lineInfo .tag') || {}).textContent.trim(),
}));
ok('线上收班后线路页显示已收班', /已收班/.test(lc.stat) && lc.tag === '已收班', JSON.stringify(lc).slice(0, 110));
ok('线上收班后不显示剩余站数与到达时间', !/\d+\s*站\s*·\s*\d+\s*分/.test(lc.stat) && !/约\s*\d+\s*分钟/.test(lc.stat), lc.stat.slice(0, 70));
await page.evaluate(() => ZJ.Line.close());
await new Promise((r) => setTimeout(r, 500));

/* 出行列表：精简卡 + 实时状态 + 关闭到站预估 */
await page.evaluate(() => { ZJ.Clock.setFixed(9 * 60); ZJ.setTab('go'); });
await new Promise((r) => setTimeout(r, 400));
const pick = async (act, name) => {
  await page.evaluate((a) => document.querySelector('[data-act="' + a + '"]').click(), act);
  await new Promise((r) => setTimeout(r, 350));
  await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
  await new Promise((r) => setTimeout(r, 200));
  await page.type('#pkQ', name);
  await new Promise((r) => setTimeout(r, 500));
  await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
  await new Promise((r) => setTimeout(r, 500));
};
await pick('pick-from', '火车站');
await pick('pick-to', '草塔停车场');
await new Promise((r) => setTimeout(r, 2800));
const list = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#planResult .trip-card')];
  return {
    cards: cards.length,
    txt: cards[0] ? cards[0].innerText.replace(/\s+/g, ' ') : '',
    veh: cards.map((c) => (c.querySelector('.trip-veh') || {}).innerText || ''),
    body: document.querySelectorAll('#planResult .plan-body').length,
    lineLink: document.querySelectorAll('#planResult [data-act="pl-full-line"]').length
  };
});
ok('线上出行页输出多套方案卡片', list.cards >= 2, String(list.cards));
ok('列表卡含总时长 / 步行 / 线路', /\d+\s*分钟/.test(list.txt) && /(步行|无需步行)/.test(list.txt) && /\d+路/.test(list.txt), list.txt.slice(0, 90));
ok('列表卡含车辆实时状态', list.veh.some((x) => /(还有\s*\d+\s*站|暂无在线车辆|已收班|实时不可用)/.test(x)), list.veh[0] || '');
ok('列表页不再展开分段或跳线路页', list.body === 0 && list.lineLink === 0);

const goClosed = await page.evaluate(() => {
  ZJ.Clock.setFixed(23 * 60 + 30);
  ZJ.Go.tick();
  const res = document.getElementById('planResult');
  const cards = [...res.querySelectorAll('.trip-card')];
  return {
    cards: cards.length,
    off: cards.filter((c) => c.classList.contains('off')).length,
    remain: /到目的地还有\s*\d+\s*站/.test(res.innerText),
    eta: /\d+:\d+\s*到达/.test(res.innerText),
    banner: (res.querySelector('.degrade-banner') || {}).innerText || '',
  };
});
ok('线上收班后整卡标记已收班', goClosed.off > 0 && goClosed.off === goClosed.cards, JSON.stringify(goClosed).slice(0, 90));
ok('线上收班后不再渲染剩余站数', !goClosed.remain);
ok('线上收班后不再渲染到达时间', !goClosed.eta);
ok('线上收班后提示今日末班已过', /今日末班已过/.test(goClosed.banner), goClosed.banner.replace(/\s+/g, ' ').slice(0, 40));

const shotDir = 'C:/work/bus/_tmp/shots';
fs.mkdirSync(shotDir, { recursive: true });
await page.screenshot({ path: `${shotDir}/live-go.png` });

ok('无控制台报错', errors.length === 0, errors.slice(0, 3).join(' || '));
ok('无失败请求', failed.length === 0, failed.slice(0, 3).join(' || '));

console.log(out.join('\n'));
const fails = out.filter((l) => l.startsWith('FAIL')).length;
console.log(`\n合计 ${out.length} 项，失败 ${fails} 项`);
await browser.close();
process.exit(fails ? 1 : 0);
