// Browser + Postgres: «تقصد…؟», one-tap «سجّلني», organizer phone codes / log / merge (photo follows)
const path = require('path'); const assert = require('assert'); const { chromium } = require('playwright'); const { start } = require('./pgserver');
(async () => {
  const S = await start(8799, { static: path.join(__dirname, '../docs') }); const G = S.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const sat = (await G('getState', {})).session.date;
  await G('adminSaveSession', { pin, data: { date: sat, lock: '20:00', start: '21:00', end: '22:00', pitch: 'x', fee: 300, map: '' } });
  // last week's player «احمد الجعدبي» with a photo, then removed from this week's list
  await G('register', { device: 'old', name: 'احمد الجعدبي', pos: 'MID' });
  await G('register', { device: 'two', name: 'خالد', pos: 'GK' }); await G('register', { device: 'two', name: 'بشير', pos: 'DEF' });
  let st = await G('getState', { pin }); const aj = st.list.find((x) => x.name === 'احمد الجعدبي');
  await G('adminRemove', { pin, reg_id: aj.id, reason: 'mistake' });
  const b = await chromium.launch(); const errs = [];
  async function page(dev, admin) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(([d, p]) => { localStorage.setItem('tsb_device', d); if (p) localStorage.setItem('tsb_pin', p); }, [dev, admin || '']);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));
    await p.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
    await p.goto('http://localhost:8799/'); await p.waitForSelector('#app:not([hidden])'); return p;
  }
  const u = await page('u1');
  assert.ok(await u.isHidden('#quick'), 'no quick button before first sign-up');
  await u.fill('#name', 'احمد الجعبدي'); await u.click('label.pos:has(input[value=MID])'); await u.click('#submit');
  await u.waitForSelector('#suggest:not([hidden])');
  assert.match(await u.textContent('#suggest'), /تقصد/); assert.ok(!/\|\|/.test(await u.textContent('#msg')));
  await (await u.$('#formCard')).screenshot({ path: path.join(__dirname, 'shots/dup_suggest.png') });
  await u.click('#suggest >> text=✅ أنا احمد الجعدبي'); await u.waitForSelector('.shirt.me');
  assert.strictEqual(await u.evaluate(() => localStorage.getItem('tsb_name')), 'احمد الجعدبي');
  assert.strictEqual(await u.evaluate(() => localStorage.getItem('tsb_pos')), 'MID');
  console.log('✓ «تقصد…؟» → picks the existing player (same stats), remembers name + position');
  st = await G('getState', { device: 'u1' }); const mine = st.list.find((x) => x.mine);
  await G('withdraw', { device: 'u1', reg_id: mine.id }); await u.reload(); await u.waitForSelector('#app:not([hidden])');
  await u.waitForSelector('#quick:not([hidden])'); assert.match(await u.textContent('#quick'), /سجّلني: احمد الجعدبي · وسط/);
  await (await u.$('#formCard')).screenshot({ path: path.join(__dirname, 'shots/dup_quick.png') });
  await u.click('#quick'); await u.waitForSelector('.shirt.me'); assert.ok(await u.isHidden('#quick'));
  console.log('✓ one tap «⚡ سجّلني» registers the remembered name');
  // a new person who really is new
  const n = await page('u2'); await n.fill('#name', 'احمد'); await n.click('#submit'); await n.waitForSelector('#suggest:not([hidden])');
  await n.click('#suggest >> text=لا، أنا شخص جديد'); await n.waitForSelector('.shirt.me');
  console.log('✓ «لا، أنا شخص جديد» creates the new name');
  // the organizer
  const dupId = (await G('getState', { pin })).allPlayers.find((x) => x.name === 'احمد').id;
  const keepId = (await G('getState', { pin })).allPlayers.find((x) => x.name === 'احمد الجعدبي').id;
  await G('setPhoto', { pin, player_id: dupId, data: require('fs').readFileSync(path.join(__dirname, 'face.jpg')).toString('base64') });
  assert.strictEqual((await S.pg.query('select count(*)::int n from photos')).rows[0].n, 1);
  const a = await page('org', pin); await a.waitForSelector('#orgCard:not([hidden])');
  assert.match(await a.textContent('#devSummary'), /سجّل 2 أسماء: خالد، بشير/);
  assert.ok(await a.$('.shirt .dv.multi'), 'shared phone highlighted on the shirts');
  await a.click('#regLog >> xpath=..'); assert.ok((await a.$$('#regLog div')).length >= 6);
  assert.match(await a.textContent('#regLog'), /حُذف \(خطأ إدخال\): احمد الجعدبي/);
  await a.click('.shirt.can >> nth=0'); await a.waitForSelector('#mainAct .note');
  assert.match(await a.textContent('#mainAct'), /📱 جوال|👤/); assert.match(await a.textContent('#mainAct'), /نفس الجوال سجّل كمان: بشير/);
  await (await a.$('#mainAct')).screenshot({ path: path.join(__dirname, 'shots/dup_admin_panel.png') });
  console.log('✓ organizer sees phone codes, time, same-phone names and the log');
  const row = await a.waitForSelector('.duprow:has-text("«احمد»")');
  await a.waitForTimeout(300);
  const box = await a.evaluate(() => { const r1 = [...document.querySelectorAll('#orgCard h3')].find((h) => /مين سجّل/.test(h.textContent)).getBoundingClientRect(), r2 = document.getElementById('renameBtn').getBoundingClientRect(); return { y: r1.top + scrollY, h: r2.bottom - r1.top }; });
  await a.screenshot({ path: path.join(__dirname, 'shots/dup_admin_tools.png'), fullPage: true, clip: { x: 0, y: box.y - 10, width: 390, height: box.h + 20 } });
  const btn = await row.$('button:has-text("ادمج في «احمد الجعدبي»")'); await btn.click(); await btn.click();
  await a.waitForFunction(() => /تم دمج/.test(document.getElementById('mergeMsg').textContent));
  st = await G('getState', { pin });
  assert.ok(!st.allPlayers.some((x) => x.id === dupId)); assert.strictEqual(st.list.filter((x) => x.player_id === keepId).length, 1);
  const ph = await S.pg.query('select player_id from photos'); assert.deepStrictEqual(ph.rows.map((r) => r.player_id), [keepId]);
  console.log('✓ merge in Postgres: duplicate gone, one registration kept, photo moved to the kept name');
  await a.selectOption('#rnSel', keepId); await a.fill('#rnName', 'أحمد الجعدبي'); await a.click('#renameBtn');
  await a.waitForFunction(() => /تم تغيير|موجود/.test(document.getElementById('mergeMsg').textContent));
  console.log('  rename msg:', await a.textContent('#mergeMsg'));
  const pub = JSON.stringify(await G('getState', { device: 'u1' })); assert.ok(!/"dev"|regLog|allPlayers/.test(pub));
  console.log('✓ players never receive phone codes or the log');
  console.log('errors', errs); await b.close(); await S.close(); process.exit(errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
