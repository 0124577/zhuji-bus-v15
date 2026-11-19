import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8899/index.html';
const OUT = process.env.SHOT_DIR || 'assets/screenshots';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--lang=zh-CN'] });
const ctx = browser.defaultBrowserContext();
await ctx.overridePermissions('http://127.0.0.1:8899', ['geolocation']);
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.setGeolocation({ latitude: 29.7136, longitude: 120.2362 });
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));

await page.goto(BASE, { waitUntil: 'networkidle2' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2200);
/* 截图流程里不弹通知权限引导，避免遮挡页面 */
await page.evaluate(() => { if (ZJ && ZJ.Settings) ZJ.Settings.promptPermIfNeeded = () => {}; });
/* 固定到 09:00（运营时段内），否则夜间截图全是「已收班」 */
await page.evaluate(() => ZJ.Clock.setFixed(9 * 60));
await sleep(300);
await page.screenshot({ path: `${OUT}/01-home.png` });

/* 模拟实时车辆：等车站第 11 站，最近车辆在第 10 站驶向第 11 站，剩 1 站 */
await page.evaluate(() => {
  const dir = ZJ.Data.lineOf('23路').dirs[0];
  const st = dir.stops[10];
  window.__st = st.name;
  const v = (order, distance, arrived, plate) => ({ vehicleOrder: order, distance, isArriveStation: arrived ? 1 : 0, plateNumber: plate, gpsTime: '2026-11-18 20:20:00' });
  ZJ.Api.vehicles = async () => ({ busAverageSpeed: 240, list: [v(12, 380, 0, '浙D08578D'), v(26, 60, 1, '浙D06666D')], startTime: '', static: false });
  ZJ.Api.lineDetail = async () => ({ lineName: '23路', up: { totalPrice: 1.0 } });
  ZJ.Api.plan = async () => ['06:20', '06:37', '07:00', '07:25', '08:05', '17:30', '18:00'];
  window.__vibrate = [];
  navigator.vibrate = (p) => { window.__vibrate.push(p); return true; };
  ZJ.Line.open('23路', 'up', st.name);
});
await sleep(1400);
await page.screenshot({ path: `${OUT}/02-line-live.png` });

/* 竖向时间轴（大字版） */
await page.evaluate(() => { document.querySelector('#page-line').scrollTop = 700; });
await sleep(600);
await page.screenshot({ path: `${OUT}/03-line-vertical.png` });

/* 提醒弹层 + 触发弹窗 */
await page.evaluate(() => { document.querySelector('#page-line').scrollTop = 0; });
await sleep(300);
await page.evaluate(() => document.querySelector('[data-act="line-remind"]').click());
await sleep(800);
await page.screenshot({ path: `${OUT}/04-alert-sheet.png` });
await page.evaluate(() => document.querySelector('.rm-mode[data-mode="one"]').click());
await sleep(200);
await page.evaluate(() => document.querySelector('[data-act="rm-save"]').click());
await sleep(1500);
await page.screenshot({ path: `${OUT}/05-alert.png` });
await page.evaluate(() => { const b = document.getElementById('rmGo'); if (b) b.click(); });

/* 站点页（真实接口） */
await page.evaluate(() => { ZJ.Line.close(); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(400);
await page.evaluate(() => ZJ.Station.open('火车站'));
await sleep(3600);
await page.screenshot({ path: `${OUT}/06-station.png` });

/* 去哪：真实交互选站 */
await page.evaluate(() => { ZJ.Station.close(); ZJ.setTab('go'); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(500);
await page.evaluate(() => document.querySelector('[data-act="pick-from"]').click());
await sleep(400);
await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
await sleep(300);
await page.type('#pkQ', '火车站');
await sleep(450);
await page.screenshot({ path: `${OUT}/07-picker.png` });
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(600);
await page.evaluate(() => document.querySelector('[data-act="pick-to"]').click());
await sleep(400);
await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
await sleep(300);
await page.type('#pkQ', '草塔停车场');
await sleep(450);
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(2600);
await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('on'); });
await sleep(200);
await page.screenshot({ path: `${OUT}/08-go-plans.png` });

/* 方案详情（分段实时 + 竖向时间轴） */
await page.evaluate(() => document.querySelector('.trip-card').click());
await sleep(1700);
await page.screenshot({ path: `${OUT}/09-plan-live.png` });
await page.evaluate(() => { document.querySelector('#page-plan').scrollTop = 620; });
await sleep(600);
await page.screenshot({ path: `${OUT}/10-plan-vertical.png` });

/* 收班态（23:30）：不再显示剩余站数与到达时间 */
await page.evaluate(() => { ZJ.Plan.close(); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(500);
await page.evaluate(() => { ZJ.Clock.setFixed(23 * 60 + 30); ZJ.Go.tick(); });
await sleep(700);
await page.screenshot({ path: `${OUT}/15-go-closed.png` });
await page.evaluate(() => { ZJ.Clock.setFixed(9 * 60); ZJ.Go.tick(); });
await sleep(400);

/* 近距离起终点：步行提示 */
await page.evaluate(() => ZJ.setTab('go'));
await sleep(400);
await page.evaluate(() => document.querySelector('[data-act="pick-from"]').click());
await sleep(400);
await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
await sleep(300);
await page.type('#pkQ', '西施殿公交首末站');
await sleep(450);
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(500);
await page.evaluate(() => document.querySelector('[data-act="pick-to"]').click());
await sleep(400);
await page.evaluate(() => document.querySelector('.sheet-tab[data-tab="search"]').click());
await sleep(300);
await page.type('#pkQ', '西施殿');
await sleep(450);
await page.evaluate(() => document.querySelector('#pkList .pick-stop').click());
await sleep(2600);
await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('on'); });
await sleep(200);
await page.screenshot({ path: `${OUT}/16-go-walk.png` });

/* 首页提醒卡片 */
await page.evaluate(() => { ZJ.Plan.close(); ZJ.setTab('home'); });
await page.waitForFunction(() => !document.querySelector('.fullpage.on'));
await sleep(700);
await page.screenshot({ path: `${OUT}/11-home-remind.png` });

/* 设置页 */
await page.evaluate(() => { if (ZJ.UI.closeAlert) ZJ.UI.closeAlert(); ZJ.Settings.promptPermIfNeeded = () => {}; });
await sleep(500);
await page.evaluate(() => ZJ.setTab('settings'));
await page.evaluate(() => { ZJ.Notify.status = async () => 'granted'; ZJ.Settings.render(); });
await sleep(900);
await page.screenshot({ path: `${OUT}/12-settings.png` });

/* 主题切换（天空蓝） */
await page.evaluate(() => document.querySelectorAll('.theme-dot')[1].click());
await sleep(1400);
await page.screenshot({ path: `${OUT}/13-settings-theme.png` });
await page.evaluate(() => document.querySelectorAll('.theme-dot')[0].click());
await sleep(600);

/* 通知权限引导弹窗 */
await page.evaluate(() => {
  ZJ.Notify.status = async () => 'denied';
  ZJ.Settings.render();
});
await sleep(400);
await page.evaluate(() => document.getElementById('btnReqNotify').click());
await sleep(700);
await page.screenshot({ path: `${OUT}/14-perm-alert.png` });
await page.evaluate(() => { const b = document.querySelector('[data-act="permalert-close"]'); if (b) b.click(); });
await sleep(400);

/* AI 助手 */
await page.evaluate(() => { ZJ.setTab('assistant'); });
await sleep(500);
await page.evaluate(() => {
  const i = document.getElementById('aiQ');
  i.value = '从火车站到草塔停车场少走路';
  document.getElementById('aiForm').dispatchEvent(new Event('submit', { cancelable: true }));
});
await sleep(1500);
await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.classList.remove('on'); });
await page.screenshot({ path: `${OUT}/17-assistant.png` });
await page.evaluate(() => document.querySelector('.ai-plan').click());
await sleep(1600);
await page.screenshot({ path: `${OUT}/18-detail-edit.png` });
await page.evaluate(() => ZJ.Plan.close());
await sleep(400);

console.log('shots done →', OUT);
await browser.close();
