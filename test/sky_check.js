// Visual check of design 9 on the real flow: full page, card, teams poster, result image, player card image
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const { start } = require('./pgserver');
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
const F = process.env.FONTS;
(async () => {
  const S = await start(8796, { static: path.join(__dirname, '../docs') }); const G = S.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const names = ['احمد الجعدبي', 'خالد الكوكباني', 'الدكتور', 'مظفر', 'عدنان حميدان', 'بشير العمري', 'ابو صالح', 'مؤيد', 'دوحي', 'اليوسفي', 'محمد جلال', 'محمد الجديد', 'عبدالرحمن العمار', 'عبدالرحمن النظاري', 'سامي', 'رامي'];
  const pos = ['DEF', 'MID', 'FWD', 'DEF', 'DEF', 'FWD', 'MID', 'MID', 'MID', 'FWD', 'MID', 'FWD', 'MID', 'DEF', 'ANY', 'ANY'];
  const t = Date.now(), L = ist(t + 3 * 86400e3), St = ist(t + 3 * 86400e3 + 3600e3), E = ist(t + 3 * 86400e3 + 7200e3);
  await G('adminSaveSession', { pin, data: { date: L.date, lock: '20:00', start: '21:00', end: '22:00', pitch: 'SERDİVAN HALI SAHA', fee: 300, map: 'https://maps.app.goo.gl/x' } });
  for (let i = 0; i < 11; i++) await G('register', { device: 'd' + i, name: names[i], pos: pos[i] });
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { localStorage.setItem('tsb_device', 'd0'); localStorage.setItem('tsb_noinstall', '1'); });
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));
  const css = F ? ['cairo/700', 'cairo/900', 'barlow-condensed/800'].map((f) => '') : [];
  await p.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8796/'); await p.waitForSelector('#app:not([hidden])'); await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(__dirname, 'shots/sky_top.png') });
  await p.screenshot({ path: path.join(__dirname, 'shots/sky_full.png'), fullPage: true });
  console.log('errors', errs, 'overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth));
  await b.close(); await S.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
