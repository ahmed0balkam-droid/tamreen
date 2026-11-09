// Badges, records, events in the weekly report, shareable card image, teams poster with photos
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs'); const assert = require('assert'); const { start } = require('./pgserver');
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
(async () => {
  const S = await start(8795, { static: path.join(__dirname, '../docs') }); const G = S.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const names = ['أحمد', 'خالد', 'سامي', 'مؤيد', 'عدنان', 'فهد', 'يوسف', 'عمر', 'زياد', 'حسن', 'علي', 'ماجد', 'نايف', 'باسل'];
  const t = Date.now(), L = ist(t - 60e3), St = ist(t + 3600e3), E = ist(t + 7200e3);
  const weeks = ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', L.date];
  const ids = {};
  for (let w = 0; w < weeks.length; w++) {
    await G('adminSaveSession', { pin, data: { date: weeks[w], lock: L.hm, start: St.hm, end: E.hm, pitch: 'ملعب', fee: 300, map: '' } });
    for (let i = 0; i < 14; i++) { const r = await G('register', { pin, device: 'w' + w + 'd' + i, name: names[i], pos: i < 4 ? 'DEF' : 'ANY' }); }
    const st = await G('getState', { pin }); const A = st.teams[0].list, B = st.teams[1].list;
    A.concat(B).forEach((p) => (ids[p.name] = p.player_id));
    const ahmedA = A.find((p) => p.name === 'أحمد'); const star = ahmedA || A[0];
    const g = w === 4 ? 4 : w === 2 ? 3 : 2;                      // week 3: hat-trick, last week: new record (4)
    const goals = { [star.player_id]: g, [B[0].player_id]: 1 }; const sa = g + 1, sb = 1;
    goals[A.find((p) => p !== star).player_id] = 1;
    await G('adminSaveResult', { pin, sa, sb, goals, assists: { [A.find((p) => p !== star).player_id]: 2 } });
    await G('adminPickAward', { pin, category: 'mvp', player_id: star.player_id });
    if (w < weeks.length - 1) await G('adminNewWeek', { pin });
  }
  // photos for a few players (organizer)
  const jpg = fs.readFileSync(path.join(__dirname, 'face.png'));
  const b = await chromium.launch(); const errs = [];
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript((pin) => { localStorage.setItem('tsb_device', 'org'); localStorage.setItem('tsb_pin', pin); }, pin);
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));
  await p.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await p.goto('http://localhost:8795/'); await p.waitForSelector('#app:not([hidden])');
  for (const nm of ['أحمد', 'خالد', 'مؤيد']) {
    await p.click('#tabRank'); await p.locator('#statsBody .plink', { hasText: nm }).first().click(); await p.waitForSelector('.pcard');
    await p.setInputFiles('#photoIn', path.join(__dirname, 'face.png')); await p.waitForSelector('.pava img', { timeout: 15000 }); await p.keyboard.press('Escape');
  }
  // result events of this week
  const ev = await p.$$eval('#resultView .events p', (x) => x.map((e) => e.textContent));
  console.log('this week events:', ev);
  assert.ok(ev.some((t) => t.includes('رقم قياسي جديد')), 'record broken announced');
  // report text includes events
  const rep = decodeURIComponent((await p.getAttribute('#resultView a.btn.wa', 'href')).split('text=')[1]);
  assert.ok(rep.includes('🚨')); console.log('✓ weekly report includes records/badges');
  // records tab
  await p.click('#tabRecords'); await p.waitForTimeout(200);
  console.log('records:', (await p.$$eval('#statsBody .rec', (x) => x.map((e) => e.innerText.replace(/\s+/g, ' ')))).join(' | '));
  await (await p.$('#statsBody')).screenshot({ path: path.join(__dirname, 'shots/records.png') });
  // card with badges + share image
  await p.click('#tabRank'); await p.locator('#statsBody .plink', { hasText: 'أحمد' }).first().click(); await p.waitForSelector('.pcard');
  console.log('badges:', (await p.$$eval('.pcard .badge:not(.off) b', (x) => x.map((e) => e.textContent))).join(' | '));
  await (await p.$('.pcard')).screenshot({ path: path.join(__dirname, 'shots/card_badges.png') });
  await p.click('text=🃏 شارك الكرت كصورة'); await p.waitForSelector('.pcard .hpic', { timeout: 15000 });
  const cardPng = await p.evaluate(() => document.querySelector('.pcard .hpic').src.split(',')[1]); fs.writeFileSync(path.join(__dirname, 'shots/card_image.png'), Buffer.from(cardPng, 'base64'));
  console.log('✓ card image', await p.textContent('#cardMsg'));
  await p.keyboard.press('Escape');
  // teams poster with photos
  await p.click('#imgBtn'); await p.waitForSelector('#imgPreview:not([hidden])', { timeout: 15000 });
  const tp = await p.evaluate(() => document.getElementById('imgPreview').src.split(',')[1]); fs.writeFileSync(path.join(__dirname, 'shots/teams_photos.png'), Buffer.from(tp, 'base64'));
  console.log('✓ teams poster', await p.textContent('#shareMsg'));
  console.log('overflow', await p.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'errors', errs);
  await b.close(); await S.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
