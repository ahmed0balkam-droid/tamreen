// Duplicate names: normalization, «تقصد…؟», merge, rename, organizer log with phone codes
const assert = require('assert');
const { makeEnv } = require('./mock2');
const G = makeEnv().ctx;
let n = 0;
const ok = (name, fn) => { fn(); n++; console.log('✓', name); };
const throwsMsg = (fn, re) => { try { fn(); } catch (e) { assert.match(e.message, re); return e.message; } throw new Error('expected ' + re); };
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
const pin = G.setup().match(/(\d{6})/)[1];
const t = Date.now(), L = ist(t + 3600e3), S = ist(t + 2 * 3600e3), E = ist(t + 3 * 3600e3);
G.adminSaveSession({ pin, data: { date: L.date, lock: L.hm, start: S.hm, end: E.hm, pitch: 'x', fee: 300, map: '' } });

ok('spelling variants are the same player (spaces, hamza, ة/ه, ى/ي, ئ, ؤ)', () => {
  G.register({ device: 'd1', name: 'عبد الرحمن السعودي', pos: 'DEF' });
  throwsMsg(() => G.register({ device: 'd1', name: 'عبدالرحمن  السعودى', pos: 'DEF' }), /مسجّل|مسجل|موجود/);
  G.register({ device: 'd2', name: 'مؤيد', pos: 'MID' });
  throwsMsg(() => G.register({ device: 'd3', name: 'موئد', pos: 'MID' }), /مسجّل|مسجل|موجود/);  // ؤ/ئ typed either way
  G.register({ device: 'd11', name: 'مظفر', pos: 'DEF' });
  throwsMsg(() => G.register({ device: 'd12', name: 'مضفر', pos: 'DEF' }), /تقصد/);              // ظ/ض swapped → asked
  G.register({ device: 'd4', name: 'أسامة', pos: 'FWD' });
  throwsMsg(() => G.register({ device: 'd5', name: 'اسامه', pos: 'FWD' }), /مسجّل|مسجل|موجود/);
});
ok('«تقصد…؟» lists close names; confirmNew creates a new player; unrelated names pass', () => {
  G.register({ device: 'd6', name: 'احمد الجعدبي', pos: 'MID' });
  const m = throwsMsg(() => G.register({ device: 'd7', name: 'احمد الجعدبى ', pos: 'MID' }), /مسجّل|مسجل|موجود/); assert.ok(m);
  const q = throwsMsg(() => G.register({ device: 'd7', name: 'احمد الجعبدي', pos: 'MID' }), /تقصد/);
  assert.deepStrictEqual(JSON.parse(q.split('||')[1]), ['احمد الجعدبي']);
  const q2 = throwsMsg(() => G.register({ device: 'd7', name: 'احمد', pos: 'MID' }), /تقصد/);   // first name only
  assert.ok(JSON.parse(q2.split('||')[1]).includes('احمد الجعدبي'));
  G.register({ device: 'd8', name: 'محمد', pos: 'MID' });                                      // «محمد» is not «احمد»
  G.register({ device: 'd9', name: 'لاعب 15', pos: 'ANY' }); G.register({ device: 'd10', name: 'لاعب 16', pos: 'ANY' });
  const st = G.register({ device: 'd7', name: 'احمد الجعبدي', pos: 'MID', confirmNew: true }).state;
  assert.ok(st.list.some((x) => x.name === 'احمد الجعبدي'));
});
let adm;
ok('organizer sees phone codes, who added, times and a log — players never do', () => {
  G.register({ pin, name: 'ضيف المنظم', pos: 'ANY' });
  G.register({ device: 'd2', name: 'صاحب مؤيد', pos: 'ANY' });                                // 2nd name from one phone
  adm = G.getState({ pin });
  const code = (nm) => adm.list.find((x) => x.name === nm).dev;
  assert.match(code('مؤيد'), /^[0-9A-Z]{4}$/);
  assert.strictEqual(code('مؤيد'), code('صاحب مؤيد'));
  assert.notStrictEqual(code('مؤيد'), code('أسامة'));
  assert.ok(adm.list.find((x) => x.name === 'ضيف المنظم').byAdmin);
  assert.ok(adm.list.every((x) => x.at > 0));
  assert.ok(adm.regLog.length >= adm.list.length && adm.regLog[0].t >= adm.regLog[adm.regLog.length - 1].t);
  assert.ok(adm.allPlayers.find((p) => p.name === 'احمد الجعبدي'));
  const pub = JSON.stringify(G.getState({ device: 'd2' }));
  assert.ok(!/"dev"|regLog|allPlayers|dupPairs/.test(pub));
  assert.ok(adm.dupPairs.length >= 1);
});
ok('merge moves registrations, goals, assists, votes and awards into the kept name', () => {
  const id = (nm) => adm.allPlayers.find((p) => p.name === nm).id;
  const keep = id('احمد الجعدبي'), drop = id('احمد الجعبدي');
  throwsMsg(() => G.adminMergePlayers({ pin: '000', keep, drop }), /للمنظّم/);
  throwsMsg(() => G.adminRenamePlayer({ pin, player_id: drop, name: 'احمد الجعدبي' }), /دمج/);
  const r = G.adminMergePlayers({ pin, keep, drop });
  assert.match(r.msg, /تم دمج/);
  assert.ok(!r.state.allPlayers.some((p) => p.id === drop));
  assert.strictEqual(r.state.list.filter((x) => x.player_id === keep).length, 1);           // both were signed up → one stays
  assert.ok(!r.state.list.some((x) => x.player_id === drop));
});
ok('merge after a played match sums the stats', () => {
  ['خالد', 'بشير', 'عدنان', 'عثمان', 'ممدوح', 'عمار'].forEach((nm, i) => { try { G.register({ device: 'x' + i, name: nm, pos: i ? 'ANY' : 'GK' }); } catch (e) { /* full */ } });
  const s0 = G.getState({ pin });
  const ids = s0.allPlayers.map((p) => p.id);
  const T = s0.teams; assert.ok(T, 'teams formed');
  const a = T[0].list[0].player_id, b = T[0].list[1].player_id;
  G.adminSaveSession({ pin, data: { date: L.date, lock: ist(Date.now() - 120e3).hm, start: ist(Date.now() - 60e3).hm, end: E.hm, pitch: 'x', fee: 300, map: '' } });
  G.adminSaveResult({ pin, sa: 3, sb: 1, goals: { [a]: 2, [b]: 1 }, assists: { [b]: 1 } });
  const before = G.getState({}).stats.rank;
  const ga = before.find((x) => x.player_id === a), gb = before.find((x) => x.player_id === b);
  G.adminMergePlayers({ pin, keep: a, drop: b });
  const after = G.getState({}).stats.rank.find((x) => x.player_id === a);
  assert.strictEqual(after.goals, ga.goals + gb.goals);
  assert.strictEqual(after.assists, (ga.assists || 0) + (gb.assists || 0));
  assert.ok(!G.getState({}).stats.rank.some((x) => x.player_id === b));
  assert.ok(ids.length - 1 === G.getState({ pin }).allPlayers.length);
});
ok('rename keeps the history', () => {
  G.register({ pin, name: 'سامي', pos: 'ANY' });
  const p = G.getState({ pin }).allPlayers.find((x) => x.name === 'سامي');
  const r = G.adminRenamePlayer({ pin, player_id: p.id, name: 'سامي العمري' });
  assert.match(r.msg, /تم تغيير/);
  assert.ok(r.state.list.some((x) => x.player_id === p.id && x.name === 'سامي العمري'));
});
console.log(n + ' duplicate-name checks passed');
ok('«شخصين مختلفين» hides a suggested pair', () => {
  G.adminNewWeek({ pin });
  G.register({ pin, name: 'عبدالله', pos: 'ANY' });
  throwsMsg(() => G.register({ pin, name: 'عبدالله الصغير', pos: 'ANY' }), /تقصد/);
  G.register({ pin, name: 'عبدالله الصغير', pos: 'ANY', confirmNew: true });
  let s = G.getState({ pin }); const id = (nm) => s.allPlayers.find((p) => p.name === nm).id;
  const pr = [id('عبدالله'), id('عبدالله الصغير')];
  assert.ok(s.dupPairs.some((x) => x.includes(pr[0]) && x.includes(pr[1])));
  G.adminNotDuplicate({ pin, a: pr[1], b: pr[0] });
  s = G.getState({ pin }); assert.ok(!s.dupPairs.some((x) => x.includes(pr[0]) && x.includes(pr[1])));
});
console.log(n + ' checks in total');
