// End-to-end: the real PWA page in Chromium, talking over HTTP to the real server logic on Postgres (PGlite)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { start } = require('./pgserver');
const PORT = 8790;

const F = path.join(__dirname, '../../fonts/node_modules/@fontsource');
const fontCss = [
  ...['500','700','800'].flatMap(w => ['arabic','latin'].map(sub => `@font-face{font-family:Tajawal;font-weight:${w};src:url(/__fonts/tajawal/files/tajawal-${sub}-${w}-normal.woff2)}`)),
  ...['500','700'].map(w => `@font-face{font-family:"El Messiri";font-weight:${w};src:url(/__fonts/el-messiri/files/el-messiri-arabic-${w}-normal.woff2)}`),
  ...['500','700'].map(w => `@font-face{font-family:Oswald;font-weight:${w};src:url(/__fonts/oswald/files/oswald-latin-${w}-normal.woff2)}`)
].join('\n');
(async () => {
  const SV = await start(PORT, { static: path.join(__dirname, '../docs') });
  const G = SV.call;
  const pin = (await G('setup', {})).match(/(\d{6})/)[1];
  const ist = ms => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
  const L = ist(Date.now() + 600e3), S = ist(Date.now() + 900e3), E = ist(Date.now() + 1500e3);
  // use next Saturday for nicer display, lock far ahead
  const sat = (await G('getState', {})).session.date;
  await G('adminSaveSession', { pin, data: { date: sat, lock: '20:00', start: '21:00', end: '22:00', pitch: 'SERDİVAN HALI SAHA', fee: 300, map: 'https://maps.app.goo.gl/LXMVQoQtZKKKL2tj9' } });
  const names = ['خالد', 'محمد جلال', 'أكرم الورد', 'عبدالرحمن السعودي', 'أحمد نعامة', 'بشير', 'البرو', 'عبدالرحمن النظاري',
    'أحمد الجعدبي', 'مظفر', 'ممدوح', 'عمار ياسر', 'عدنان', 'عثمان', 'لاعب 15'];
  const pos = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'ANY', 'DEF'];
  for (let i = 0; i < names.length; i++) await G('register', { device: 'seed' + i, name: names[i], pos: pos[i] });

  const browser = await chromium.launch();
  const errors = [];
  async function open(device, adminPin) {
    const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    await ctxB.addInitScript(([d, p]) => { localStorage.setItem('tsb_device', d); if (p) localStorage.setItem('tsb_pin', p); }, [device, adminPin || '']);
    const pg = await ctxB.newPage();
    pg.on('pageerror', e => errors.push(String(e)));
    pg.on('console', m => { if (m.type() === 'error' && !/ERR_|Failed to load/.test(m.text())) errors.push(m.text()); });
    await pg.route('**/fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: fontCss }));
    await pg.route('**/__fonts/**', (r) => r.fulfill({ path: path.join(F, decodeURIComponent(new URL(r.request().url()).pathname.replace('/__fonts/', ''))) }));
    await pg.goto('http://localhost:' + PORT + '/');
    await pg.waitForSelector('#app:not([hidden])');
    await pg.evaluate(() => document.fonts.ready);
    return pg;
  }

  // 1) a new player signs up from the page
  const p1 = await open('phone-new');
  await p1.fill('#name', 'سامي');
  await p1.check('input[name=pos][value=FWD]');
  await p1.click('#submit');
  await p1.waitForFunction(() => document.getElementById('msg').textContent.includes('تم تسجيل'));
  const m1 = await p1.textContent('#msg');
  const formAfterFirst = await p1.isVisible('#formCard');
  const friendTitle = await p1.textContent('#formTitle');
  // edit name + position, place must stay 16
  await p1.click('.benchslot.me');
  await p1.fill('#editName', 'سامي العلي');
  await p1.selectOption('#editPos', 'DEF');
  await p1.click('text=حفظ التعديل');
  await p1.waitForFunction(() => document.getElementById('listMsg').textContent.includes('تم تعديل'));
  const editMsg = await p1.textContent('#listMsg');
  const editedSlot = await p1.textContent('#resList .benchslot.me');
  // register a friend from the same phone
  await p1.fill('#name', 'رامي');
  await p1.click('#submit');
  await p1.waitForFunction(() => document.querySelectorAll('.me').length === 2);
  const formHidden = await p1.isHidden('#formCard');
  await p1.screenshot({ path: path.join(__dirname, 'shot_player.png'), fullPage: true });
  // withdraw myself (first of my two)
  await p1.click('#resList .benchslot.me >> nth=0');
  await p1.click('text=انسحاب من القائمة');
  await p1.click('text=تأكيد الانسحاب');
  await p1.waitForFunction(() => document.getElementById('listMsg').textContent.includes('تم الانسحاب'));
  const afterW = await p1.$$eval('#resList .benchslot.on', l => l.length);
  await p1.fill('#name', 'سامي العلي'); await p1.click('#submit');
  await p1.waitForFunction(() => document.querySelectorAll('.me').length === 2);

  // 2) organizer: lock passes, teams, bib, result
  const past = ist(Date.now() - 60e3);
  await G('adminSaveSession', { pin, data: { date: past.date, lock: past.hm, start: S.hm, end: E.hm, pitch: 'SERDİVAN HALI SAHA', fee: 300, map: 'https://maps.app.goo.gl/LXMVQoQtZKKKL2tj9' } });
  const a = await open('phone-admin');
  await a.click('#adminOpen');
  await a.fill('#pin', '111'); await a.click('#adminForm button[type=submit]');
  await a.waitForFunction(() => document.getElementById('pinMsg').textContent.length > 0);
  const badPin = await a.textContent('#pinMsg');
  await a.fill('#pin', pin); await a.click('#adminForm button[type=submit]');
  await a.waitForSelector('#orgCard:not([hidden])');
  await a.click('.vc.a >> nth=0');
  await a.click('text=انقله إلى الفريق B');
  await a.waitForFunction(() => (document.getElementById('teamMsg') || {}).textContent && document.getElementById('teamMsg').textContent.includes('تم نقل'));
  const moved = await a.$$eval('.vc.b:not(.empty)', l => l.length);
  await a.click('text=رجّع التوزيع التلقائي');
  const resetArmed = await a.isVisible('text=تأكيد: يمسح كل التعديلات اليدوية');
  await a.click('text=تأكيد: يمسح كل التعديلات اليدوية');
  await a.waitForFunction(() => document.getElementById('teamMsg').textContent.includes('رجع التوزيع'));
  const back = await a.$$eval('.vc.b:not(.empty)', l => l.length);
  const before = await a.$$eval('.vc.b .nm', l => l.map(x => x.textContent).sort().join(','));
  const target = await a.$$eval('.vc.b .nm', l => l[2].textContent);
  await a.click('.vc.b >> nth=2');
  await a.selectOption('#posChange', 'GK');
  await a.waitForFunction(() => document.getElementById('teamMsg').textContent.includes('تم تغيير مركز'));
  const posMsg = await a.textContent('#teamMsg');
  const after = await a.$$eval('.vc.b .nm', l => l.map(x => x.textContent).sort().join(','));
  const posChanged = await a.$$eval('.vc.b', (l, t) => (l.find(x => x.querySelector('.nm') && x.querySelector('.nm').textContent === t) || {}).textContent, target);
  const posKeepsSplit = before === after;
  await a.click('.vc.a >> nth=1');
  await a.click('text=اجعله كابتن الفريق A');
  await a.waitForFunction(() => document.querySelectorAll('.vc.a .cap').length === 1);
  await a.click('.vc.b >> nth=0');
  await a.click('text=اجعله كابتن الفريق B');
  await a.waitForFunction(() => document.querySelectorAll('.vs .cap').length === 2);
  const capNames = await a.$$eval('.vs .cap', l => l.map(c => c.parentElement.textContent));
  await a.click('#bibGo');
  await a.waitForFunction(() => /الفريق/.test(document.getElementById('bibVerdict').textContent), null, { timeout: 8000 });
  const verdict = await a.textContent('#bibVerdict');
  await a.fill('#scA', '5'); await a.fill('#scB', '3');
  const plus = await a.$$('#scorers .step button:last-child');
  await plus[0].click(); await plus[0].click(); await plus[8].click(); await plus[3].click();
  await a.click('#saveResult');
  await a.waitForFunction(() => document.getElementById('resMsg').textContent.includes('تم حفظ'));
  await a.waitForSelector('#voteSec:not([hidden])');
  const reportTxt = await a.textContent('#resultView .report');
  // colors
  await a.selectOption('#colA', 'green');
  await a.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--ta').trim() === '#3ddc84');
  await a.selectOption('#colB', 'white');
  await a.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--tb').trim() === '#f2f2f2');
  const pickOpts = await a.$$eval('#pick_def option', o => o.map(x => x.value).filter(Boolean));
  await a.selectOption('#pick_def', pickOpts[3]);
  await a.waitForFunction(() => document.getElementById('voteMsg').textContent.includes('اختيار المنظّم'));
  const pickReport = await a.textContent('#resultView .report');
  await a.click('#voteToggle');
  await a.waitForFunction(() => document.getElementById('voteMsg').textContent.includes('قفل'));
  const lockedNote = await a.textContent('#voteSec');
  await a.click('#voteToggle');
  await a.waitForFunction(() => document.getElementById('voteMsg').textContent.includes('فتح'));
  await a.click('#bibB');
  await a.waitForFunction(() => document.getElementById('bibVerdict').textContent.includes('اختيار المنظّم'));
  const bibManual = await a.textContent('#bibVerdict');
  await a.click('#imgBtn');
  const dlTarget = await a.getAttribute('#imgDl', 'target');
  await a.waitForSelector('#imgPreview:not([hidden])');
  const img = await a.getAttribute('#imgPreview', 'src');
  fs.writeFileSync(path.join(__dirname, 'shot_poster.png'), Buffer.from(img.split(',')[1], 'base64'));
  const wa = await a.evaluate(() => decodeURIComponent(document.getElementById('waBtn').href.split('text=')[1]));
  fs.writeFileSync(path.join(__dirname, 'wa.txt'), wa);
  // admin removes a no-show from the page
  await a.click('#mainList .shirt:nth-child(13)');
  await a.click('text=غاب بدون عذر');
  const armedTxt = await a.textContent('.act .btn.danger');
  await a.click('text=تأكيد: غاب بدون عذر');
  await a.waitForFunction(() => document.getElementById('listMsg').textContent.includes('غياب'));
  await a.screenshot({ path: path.join(__dirname, 'shot_admin.png'), fullPage: true });
  await a.click('#resList .benchslot.on >> nth=0');
  await a.click('text=رفعه للأساسي');
  const benchName = await a.$eval('#resList .benchslot.on', e => e.textContent);
  await a.selectOption('select[id^=swap_]', { index: 2 });
  await a.click('.act >> text=تبديل');
  await a.waitForFunction(() => document.getElementById('listMsg').textContent.includes('تم تبديل'));
  const swapMsg = await a.textContent('#listMsg');
  await a.click('#tabCommit');
  const commitRows = await a.$$eval('#statsBody tbody tr', r => r.length);

  // 3) a regular viewer after lock: votes (result secret), organizer closes, results announced
  await a.selectOption('#pick_def', '');
  await a.waitForFunction(() => document.getElementById('voteMsg').textContent.includes('حسب التصويت'));
  const EX = p => path.join(__dirname, 'shots', p);
  async function shot(pg, sel, file) { await pg.locator(sel).scrollIntoViewIfNeeded(); const bb = await pg.locator(sel).boundingBox(); const sy = await pg.evaluate(() => window.scrollY); await pg.screenshot({ path: EX(file), clip: { x: Math.max(0, bb.x - 14), y: bb.y + sy - 14, width: Math.min(390, bb.width + 28), height: bb.height + 28 }, fullPage: true }); }
  const v = await open('seed3');
  const canVote = await v.isVisible('#v_mvp');
  await shot(v, '#voteSec', '1_vote_before.png');
  const opt = await v.$$eval('#v_mvp option', o => o.map(x => x.value).filter(Boolean));
  await v.selectOption('#v_mvp', opt[1]);
  await v.click('#voteSec .vblock >> nth=0 >> button');
  await v.waitForFunction(() => document.getElementById('voteMsg').textContent.length > 0);
  const voteMsg = await v.textContent('#voteMsg');
  await v.selectOption('#v_def', opt[9]);
  await v.click('#voteSec .vblock >> nth=1 >> button');
  await v.waitForFunction(() => document.getElementById('voteMsg').textContent.includes('تم'));
  const secret = await v.textContent('#voteSec');
  await shot(v, '#voteSec', '2_vote_after_secret.png');
  // more friends vote from their phones
  const M0 = (await G('getState', {})).match, ids = M0.teamA.concat(M0.teamB).map(p => p.player_id);
  const voters = ['seed0','seed1','seed2','seed4','seed5','seed6','seed7','seed8','seed9','seed10'];
  for (let k = 0; k < voters.length; k++) { const d = voters[k];
    try { await G('castVote', { device: d, category: 'mvp', player_id: k < 6 ? opt[1] : ids[k % 14] }); } catch (e) {}
    try { await G('castVote', { device: d, category: 'def', player_id: k < 5 ? opt[9] : ids[(k * 3) % 14] }); } catch (e) {}
  }
  // organizer closes voting from his page
  await a.context().addInitScript(p => { if (!localStorage.getItem('tsb_pin')) localStorage.setItem('tsb_pin', p); }, pin); await a.reload(); await a.waitForSelector('#app:not([hidden])'); await a.waitForTimeout(800); await a.waitForSelector('#voteToggle', { timeout: 8000 }).catch(async e => { console.error('DBG', await a.evaluate(() => JSON.stringify({ ls: localStorage.getItem('tsb_pin'), org: !document.getElementById('orgCard').hidden, adm: !document.getElementById('adminOpen').hidden, vs: document.getElementById('voteSec').hidden, html: document.getElementById('voteSec').innerHTML.slice(0, 300), res: document.getElementById('resultSec').hidden, msg: (document.getElementById('resMsg')||{}).textContent }))); throw e; });
  await shot(a, '#voteSec', '3_organizer_live_count.png');
  await a.click('#voteToggle');
  await a.waitForFunction(() => document.getElementById('voteMsg').textContent.includes('قفل'));
  await a.click('#resImgBtn');
  await a.waitForSelector('#resPreview:not([hidden])');
  const rimg = await a.getAttribute('#resPreview', 'src');
  fs.writeFileSync(EX('5_result_image.png'), Buffer.from(rimg.split(',')[1], 'base64'));
  await a.click('text=نسخ التقرير للواتساب'); const repText = await a.$eval('#copyArea', e => e.value);
  fs.writeFileSync(EX('6_whatsapp_report.txt'), repText);
  await v.reload(); await v.waitForSelector('#app:not([hidden])'); await v.evaluate(() => document.fonts.ready);
  await shot(v, '#resultSec', '4_week_report_announced.png');
  const teamColorName = await v.textContent('.vh.a small');
  await v.click('#tabWins');
  await shot(v, 'section[aria-label="إحصائيات الموسم"]', '7_wins_tab.png');
  await v.click('#tabScorers');
  const scorerRows = await v.$$eval('#statsBody tbody tr', r => r.length);
  await v.click('#tabMonth');
  const awards = await v.$$eval('#statsBody .award b', b => b.map(x => x.textContent));
  await shot(v, 'section[aria-label="إحصائيات الموسم"]', '8_month_awards.png');
  const outsider = await open('phone-x');
  const outsiderVote = await outsider.isVisible('#v_mvp');
  await v.click('#tabRank');
  await v.screenshot({ path: path.join(__dirname, 'shot_viewer_locked.png'), fullPage: true });
  const viewerNoAdmin = await v.isHidden('#orgCard');
  const viewerForm = await v.isHidden('#formCard');
  const overflow = await v.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  console.log(JSON.stringify({ resetArmed, dlTarget, armedTxt, posMsg, posKeepsSplit, posChanged, capNames, lockedNote: lockedNote.slice(0, 80), bibManual, benchName, swapMsg, pickReport, reportTxt, secret: secret.slice(0,160), canVote, voteMsg, teamColorName, scorerRows, awards, outsiderVote, moved, back, m1, formAfterFirst, friendTitle, editMsg, editedSlot, formHidden, afterW, badPin, verdict, commitRows, viewerNoAdmin, viewerForm, overflow, errors }, null, 1));
  await browser.close(); await SV.close(); process.exit(errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
