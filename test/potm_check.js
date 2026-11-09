// Player of the month across 3 months: section, hall of fame, month tab, card badge, copy text
const { chromium } = require('playwright'); const path = require('path'); const assert = require('assert'); const { start } = require('./pgserver');
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
(async () => {
  const S = await start(8794, { static: path.join(__dirname, '../docs') }); const G = S.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const names = ['أحمد', 'خالد', 'سامي', 'مؤيد', 'عدنان', 'فهد', 'يوسف', 'عمر', 'زياد', 'حسن', 'علي', 'ماجد', 'نايف', 'باسل'];
  const t = Date.now(), L = ist(t - 60e3), St = ist(t + 3600e3), E = ist(t + 7200e3);
  const weeks = ['2026-09-12', '2026-10-10', '2026-10-17', L.date];
  for (let w = 0; w < weeks.length; w++) {
    await G('adminSaveSession', { pin, data: { date: weeks[w], lock: L.hm, start: St.hm, end: E.hm, pitch: 'ملعب', fee: 300, map: '' } });
    for (let i = 0; i < 14; i++) await G('register', { pin, device: 'w' + w + 'd' + i, name: names[i], pos: 'ANY' });
    const st = await G('getState', { pin }); const A = st.teams[0].list, B = st.teams[1].list;
    const star = w === 0 ? A[0] : w < 3 ? A[1] : A[2];
    await G('adminSaveResult', { pin, sa: 4, sb: 1, goals: { [star.player_id]: 3, [B[0].player_id]: 1, [A[3].player_id]: 1 }, assists: { [A[4].player_id]: 2 } });
    await G('adminPickAward', { pin, category: 'mvp', player_id: star.player_id });
    await G('adminPickAward', { pin, category: 'def', player_id: A[5].player_id });
    if (w < weeks.length - 1) await G('adminNewWeek', { pin });
  }
  const st = await G('getState', {});
  console.log('potm:', st.potm.map((m) => `${m.label}${m.final ? '' : ' (جاري)'}: ${m.winners.map((x) => x.name + ' ' + x.pts).join(' & ')}`).join(' | '));
  assert.ok(st.potm.length >= 3); assert.ok(st.potm.filter((m) => m.final).length >= 2);
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));
  await p.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8794/'); await p.waitForSelector('#app:not([hidden])');
  assert.ok(await p.isVisible('#potmSec')); await (await p.$('#potmSec')).screenshot({ path: path.join(__dirname, 'shots/potm.png') });
  console.log('section:', (await p.textContent('#potmBody')).replace(/\s+/g, ' ').slice(0, 260));
  console.log('copy:\n' + decodeURIComponent((await p.getAttribute('#potmBody a.btn.wa', 'href')).split('text=')[1]));
  const champ = st.potm.find((m) => m.final).winners[0];
  await p.locator('#potmBody .plink', { hasText: champ.name }).first().click(); await p.waitForSelector('.pcard');
  console.log('card badge:', (await p.$$eval('.pcard .prank', (x) => x.map((e) => e.textContent))).join(' | '));
  await p.keyboard.press('Escape'); await p.click('#tabMonth'); await p.waitForTimeout(200);
  console.log('month tab award:', (await p.textContent('#statsBody .awards .award')).replace(/\s+/g, ' '));
  console.log('overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'errors', errs);
  await b.close(); await S.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
