const { chromium } = require('playwright'); const path = require('path'); const { start } = require('./pgserver');
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
(async () => {
  const S = await start(8792, { static: path.join(__dirname, '../docs') }); const G = S.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const names = ['أحمد', 'خالد', 'سامي', 'مؤيد', 'عدنان', 'فهد', 'يوسف', 'عمر', 'زياد', 'حسن', 'علي', 'ماجد', 'نايف', 'باسل'];
  for (let i = 0; i < 14; i++) await G('register', { device: 'd' + i, name: names[i], pos: 'ANY' });
  const t = Date.now(), L = ist(t - 60e3), St = ist(t + 3600e3), E = ist(t + 7200e3);
  await G('adminSaveSession', { pin, data: { date: L.date, lock: L.hm, start: St.hm, end: E.hm, pitch: 'X', fee: 300, map: '' } });
  const st = await G('getState', { pin }); const A = st.teams[0].list, B = st.teams[1].list;
  await G('adminSaveResult', { pin, sa: 4, sb: 2, goals: { [A[0].player_id]: 3, [B[0].player_id]: 2, [A[1].player_id]: 1 }, assists: { [A[2].player_id]: 3, [A[0].player_id]: 1, [B[1].player_id]: 1 } });
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));  // local server, not production
  await p.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8792/'); await p.waitForSelector('#app:not([hidden])');
  console.log('rank header:', (await p.$$eval('#statsBody th', (t) => t.map((x) => x.textContent))).join(' | '));
  await p.click('#tabAssists'); await p.waitForTimeout(200);
  console.log('assists rows:', await p.$$eval('#statsBody tbody tr', (t) => t.map((x) => x.textContent.replace(/\s+/g, ' ').trim())));
  console.log('copy text:\n' + decodeURIComponent((await p.getAttribute('#statsBody a.btn.wa', 'href')).split('text=')[1]));
  await (await p.$('#statsBody')).screenshot({ path: path.join(__dirname, 'shots/assists.png') });
  console.log('overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'errors', errs);
  await b.close(); await S.close(); process.exit(0);
})();
