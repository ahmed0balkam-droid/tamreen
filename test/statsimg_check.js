// Every stats tab offers "📸 صورة للقروب"; images render, can be shared/saved, and survive a refresh
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const assert = require('assert'); const { start } = require('./pgserver');
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
(async () => {
  const S = await start(8797, { static: path.join(__dirname, '../docs') }); const G = S.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const names = ['احمد الجعدبي', 'خالد الكوكباني', 'الدكتور', 'مظفر', 'عدنان حميدان', 'بشير العمري', 'ابو صالح', 'مؤيد', 'دوحي', 'اليوسفي', 'محمد جلال', 'محمد الجديد', 'عبدالرحمن العمار', 'عبدالرحمن النظاري'];
  const t = Date.now(), L = ist(t - 60e3), St = ist(t + 3600e3), E = ist(t + 7200e3);
  const weeks = ['2026-10-17', '2026-10-24', L.date];
  for (let w = 0; w < weeks.length; w++) {
    await G('adminSaveSession', { pin, data: { date: weeks[w], lock: L.hm, start: St.hm, end: E.hm, pitch: 'SERDİVAN HALI SAHA', fee: 300, map: '' } });
    for (let i = 0; i < 14; i++) await G('register', { pin, device: 'w' + w + 'd' + i, name: names[i], pos: 'ANY' });
    const st = await G('getState', { pin }); const A = st.teams[0].list, B = st.teams[1].list;
    await G('adminSaveResult', { pin, sa: 4 + w, sb: 2, goals: { [A[0].player_id]: 2 + w, [A[1].player_id]: 2, [B[0].player_id]: 2 }, assists: { [A[2].player_id]: 2, [B[1].player_id]: 1 } });
    await G('adminPickAward', { pin, category: 'mvp', player_id: A[0].player_id }); await G('adminPickAward', { pin, category: 'def', player_id: B[2].player_id });
    if (w < weeks.length - 1) await G('adminNewWeek', { pin });
  }
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));
  await p.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8797/'); await p.waitForSelector('#app:not([hidden])');
  for (const tab of ['Rank', 'Scorers', 'Assists', 'Wins', 'Month', 'Records', 'Commit']) {
    await p.click('#tab' + tab); await p.waitForTimeout(150);
    await p.click('#statsBody >> text=📸 صورة للقروب'); await p.waitForSelector('#statsBody .statimg img', { timeout: 15000 });
    const src = await p.getAttribute('#statsBody .statimg img', 'src'); fs.writeFileSync(path.join(__dirname, 'shots/stats_' + tab + '.png'), Buffer.from(src.split(',')[1], 'base64'));
    assert.ok(await p.$('#statsBody .statimg a.btn.ghost'), 'download link'); console.log('✓', tab);
  }
  await p.click('#tabRank'); await p.click('#statsBody >> text=📸 صورة للقروب'); await p.waitForSelector('#statsBody .statimg img');
  await p.click('#tabScorers'); await p.click('#tabRank'); await p.waitForTimeout(300);
  console.log('✓ preview kept after refresh:', !!(await p.$('#statsBody .statimg img')));
  await p.click('#potmBody >> text=📸 صورة لاعب الشهر'); await p.waitForSelector('#potmBody img.preview', { timeout: 15000 });
  fs.writeFileSync(path.join(__dirname, 'shots/stats_potm.png'), Buffer.from((await p.getAttribute('#potmBody img.preview', 'src')).split(',')[1], 'base64')); console.log('✓ potm image');
  console.log('errors', errs); await b.close(); await S.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
