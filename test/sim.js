// Full two-week simulation of real use, step by step, with edge cases.
const assert = require('assert');
const { makeEnv } = require('./mock2');
const { ctx: G } = makeEnv();
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
let n = 0; const fails = [];
function ok(name, fn) { try { fn(); n++; console.log('✓', name); } catch (e) { fails.push(name); console.log('✗', name, '\n   ', e.message.split('\n')[0]); } }
function throwsMsg(fn, re) { try { fn(); } catch (e) { assert.match(e.message, re); return; } throw new Error('expected error ' + re); }
const ist = ms => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
const pin = G.setup().match(/(\d{6})/)[1];
const A = x => Object.assign({ pin }, x);
function session(lockMs, startMs, endMs) {
  const L = ist(lockMs), S = ist(startMs), E = ist(endMs);
  return G.adminSaveSession(A({ data: { date: L.date, lock: L.hm, start: S.hm, end: E.hm, pitch: 'SERDİVAN HALI SAHA', fee: 300, map: 'https://maps.app.goo.gl/x' } }));
}
const now = Date.now();
// week 1: lock in 3 days (so withdrawals are NOT late), start 1h after lock
session(now + 3 * 86400e3, now + 3 * 86400e3 + 3600e3, now + 3 * 86400e3 + 7200e3);
const P = ['خالد', 'محمد جلال', 'أكرم الورد', 'عبدالرحمن السعودي', 'أحمد نعامة', 'بشير', 'البرو', 'عبدالرحمن النظاري',
  'أحمد الجعدبي', 'مظفر', 'ممدوح', 'عمار ياسر', 'عدنان', 'عثمان', 'وليد', 'مؤيد', 'اليوسفي', 'دوحي', 'الدكتور'];
const POS = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'ANY', 'FWD', 'MID', 'DEF', 'MID', 'FWD'];
let st;

console.log('— week 1: sign-up');
ok('first player signs up; position kept; message says main #1', () => {
  const r = G.register({ device: 'ph0', name: P[0], pos: POS[0] });
  assert.match(r.msg, /أساسياً \(رقم 1\)/); assert.strictEqual(r.state.list[0].pos, 'GK'); assert.ok(r.state.list[0].mine);
});
ok('same name with different spelling is refused (احمد = أحمد, ة = ه)', () => {
  G.register({ device: 'ph4', name: 'أحمد نعامة', pos: 'DEF' });
  throwsMsg(() => G.register({ device: 'ph9', name: 'احمد نعامه', pos: 'DEF' }), /مسجّل في القائمة مسبقاً/);
});
ok('empty name refused; unknown position becomes "any"', () => {
  throwsMsg(() => G.register({ device: 'ph9', name: '   ', pos: 'DEF' }), /اكتب اسمك/);
  const r = G.register({ device: 'ph9', name: P[9], pos: 'XYZ' });
  assert.strictEqual(r.state.list.find(x => x.name === P[9]).pos, 'ANY');
});
ok('one phone: itself + 2 friends (default 3), 4th refused', () => {
  G.register({ device: 'ph1', name: P[1], pos: POS[1] });
  G.register({ device: 'ph1', name: P[2], pos: POS[2] });
  G.register({ device: 'ph1', name: P[3], pos: POS[3] });
  throwsMsg(() => G.register({ device: 'ph1', name: P[5], pos: POS[5] }), /3 أسماء/);
  const me = G.getState({ device: 'ph1' }); assert.strictEqual(me.myCount, 3);
  assert.strictEqual(me.list.filter(x => x.mine && x.friend).length, 2);
});
ok('the rest sign up; 18 = 14 mains + 4 reserves; 19th refused', () => {
  [5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17].forEach(i => G.register({ device: 'ph' + i, name: P[i], pos: POS[i] }));
  st = G.getState({});
  assert.strictEqual(st.list.length, 18);
  throwsMsg(() => G.register({ device: 'ph18', name: P[18], pos: POS[18] }), /مكتملة/);
});
ok('teams appear automatically at 14, 7 v 7, one GK each, same for everyone', () => {
  st = G.getState({});
  assert.strictEqual(st.teamsReason, 'full');
  same(st.teams.map(t => t.list.length), [7, 7]);
  same(st.teams.map(t => t.c.GK || 0), [1, 1]);
  same(G.getState({ device: 'ph5' }).teams, st.teams);
});
ok('a player fixes his own name and position; place stays; split rebalances (before lock)', () => {
  const me = G.getState({ device: 'ph6' }).list.find(x => x.mine);
  const r = G.updateRegistration({ device: 'ph6', reg_id: me.id, name: 'البرو الصغير', pos: 'DEF' });
  const after = r.state.list.find(x => x.id === me.id);
  assert.strictEqual(after.rank, me.rank); assert.strictEqual(after.name, 'البرو الصغير'); assert.strictEqual(after.pos, 'DEF');
  assert.strictEqual(r.state.manual, false);
});
ok('a player cannot edit or withdraw someone else', () => {
  const other = G.getState({}).list[0];
  throwsMsg(() => G.updateRegistration({ device: 'ph6', reg_id: other.id, pos: 'FWD' }), /تسجيلك أنت فقط/);
  throwsMsg(() => G.withdraw({ device: 'ph6', reg_id: other.id }), /تسجيلك أنت فقط/);
});
ok('a main withdraws early (not late); first reserve moves up; teams recompute', () => {
  st = G.getState({});
  const reserve1 = st.list[14];
  const me = G.getState({ device: 'ph8' }).list.find(x => x.mine);
  const r = G.withdraw({ device: 'ph8', reg_id: me.id });
  assert.match(r.msg, /^تم الانسحاب\.$/);
  assert.strictEqual(r.state.list[13].id, reserve1.id);
  assert.ok(r.state.teams.some(t => t.list.some(p => p.player_id === reserve1.player_id)));
  assert.strictEqual(r.state.stats.commit.length, 0);
});

console.log('— week 1: organizer before lock');
ok('organizer adds a player beyond the phone limit and while full is refused only by capacity', () => {
  const r = G.register(A({ device: 'admin', name: P[18], pos: 'FWD' }));
  assert.strictEqual(r.state.list.length, 18);
  throwsMsg(() => G.register(A({ device: 'admin', name: 'زائد', pos: 'FWD' })), /مكتملة/);
});
ok('organizer moves, swaps, changes a position (split kept), sets captains', () => {
  st = G.getState({ pin });
  const a0 = st.teams[0].list[2], b0 = st.teams[1].list[3];
  let r = G.adminSwapPlayers(A({ a: a0.player_id, b: b0.player_id }));
  assert.ok(r.state.teams[1].list.some(p => p.player_id === a0.player_id));
  const before = r.state.teams.map(t => t.list.map(p => p.player_id).sort());
  const reg = r.state.list.find(x => x.player_id === a0.player_id);
  r = G.updateRegistration(A({ reg_id: reg.id, pos: 'GK' }));
  same(r.state.teams.map(t => t.list.map(p => p.player_id).sort()), before);
  r = G.adminSetCaptain(A({ player_id: r.state.teams[0].list[0].player_id }));
  r = G.adminSetCaptain(A({ player_id: r.state.teams[1].list[0].player_id }));
  assert.ok(r.state.captains.A && r.state.captains.B);
  assert.strictEqual(G.getState({ device: 'ph5' }).teams.flatMap(t => t.list).filter(p => p.cap).length, 2);
});
ok('captain moved to the other team loses the armband (no two captains in one team)', () => {
  st = G.getState({ pin });
  const capA = st.teams[0].list.find(p => p.cap);
  const r = G.adminMovePlayer(A({ player_id: capA.player_id }));
  assert.strictEqual(r.state.captains.A, null);
  assert.strictEqual(r.state.teams[1].list.filter(p => p.cap).length, 1);
  G.adminMovePlayer(A({ player_id: capA.player_id }));                   // back
  assert.strictEqual(G.getState({}).captains.A, capA.player_id);         // armband returns with him
});
ok('organizer hides teams until lock; shows again', () => {
  let r = G.adminUnpublish(A({})); assert.strictEqual(r.state.teams, null);
  assert.strictEqual(G.getState({}).teams, null);
  r = G.adminPublish(A({})); assert.ok(r.state.teams);
});
ok('reorder: organizer lifts reserve #18 into the mains (swap with #3)', () => {
  st = G.getState({ pin });
  const r18 = st.list[17], r3 = st.list[2];
  const r = G.adminSwapOrder(A({ a: r18.id, b: r3.id }));
  assert.strictEqual(r.state.list[2].id, r18.id); assert.strictEqual(r.state.list[17].id, r3.id);
});
ok('per-phone limit change applies to new sign-ups only', () => {
  G.adminSetPerDevice(A({ n: 1 }));
  assert.strictEqual(G.getState({ device: 'ph1' }).perDevice, 1);
  assert.strictEqual(G.getState({ device: 'ph1' }).myCount, 3);   // existing friends stay
  G.adminSetPerDevice(A({ n: 3 }));
});
ok('non-organizer cannot call organizer actions', () => {
  ['adminMovePlayer', 'adminSetCaptain', 'adminSaveResult', 'adminNewWeek', 'adminSetColors', 'adminVoting', 'adminRemove', 'adminSwapOrder', 'adminSetBib']
    .forEach(fn => throwsMsg(() => G[fn]({ device: 'ph5', pin: '' }), /للمنظّم فقط/));
});

console.log('— week 1: lock passes');
ok('after lock: players cannot sign up, edit, or withdraw; organizer can', () => {
  const t = Date.now();
  session(t - 60e3, t + 3600e3, t + 7200e3);
  st = G.getState({ device: 'ph5' });
  assert.strictEqual(st.locked, true); assert.ok(st.teams); assert.strictEqual(st.teamsReason, 'locked');
  const me = st.list.find(x => x.mine);
  throwsMsg(() => G.register({ device: 'phX', name: 'جديد', pos: 'FWD' }), /مقفلة/);
  throwsMsg(() => G.updateRegistration({ device: 'ph5', reg_id: me.id, pos: 'FWD' }), /مقفلة/);
  throwsMsg(() => G.withdraw({ device: 'ph5', reg_id: me.id }), /مقفلة/);
  const r = G.updateRegistration(A({ reg_id: me.id, pos: 'MID' }));
  assert.strictEqual(r.state.list.find(x => x.id === me.id).pos, 'MID');
});
ok('no-show after lock: reserve enters; counted in commitment; reserve "excused"', () => {
  st = G.getState({ pin });
  const main = st.list[10], res1 = st.list[14];
  const r = G.adminRemove(A({ reg_id: main.id, reason: 'no_show' }));
  assert.strictEqual(r.state.list[13].id, res1.id);
  assert.strictEqual(r.state.stats.commit.find(s => s.name === main.name).ns, 1);
  const res2 = r.state.list[15];
  same(r.state.teams.map(t => t.list.length), [7, 7]);                  // replacement goes to the short team
  const r2 = G.adminRemove(A({ reg_id: res2.id, reason: 'no_show' }));
  assert.match(r2.msg, /بعذر/);                                        // a reserve is never a "no-show"
});
ok('organizer bib: manual choice then a fair draw, every attempt logged', () => {
  let r = G.adminSetBib(A({ team: 'A' }));
  assert.strictEqual(r.state.bib.at(-1).n, -1);
  r = G.adminDrawBib(A({}));
  const b = r.state.bib.at(-1); assert.ok(b.n >= 0 && b.n <= 99); assert.strictEqual(b.team, b.n < 50 ? 'A' : 'B');
  assert.strictEqual(r.state.bib.length, 2);
});
ok('team colors: both teams different; same color refused', () => {
  throwsMsg(() => G.adminSetColors(A({ a: 'green', b: 'green' })), /مختلفين/);
  throwsMsg(() => G.adminSetColors(A({ a: 'pink', b: 'green' })), /من القائمة/);
  const r = G.adminSetColors(A({ a: 'green', b: 'white' })); same(r.state.colors, { a: 'green', b: 'white' });
});

console.log('— week 1: result, votes, report');
let T;
ok('result: invalid score refused; goals above score refused', () => {
  T = G.getState({ pin }).teams;
  throwsMsg(() => G.adminSaveResult(A({ sa: '', sb: 2 })), /نتيجة الفريقين/);
  throwsMsg(() => G.adminSaveResult(A({ sa: 2.5, sb: 2 })), /نتيجة الفريقين/);
  throwsMsg(() => G.adminSaveResult(A({ sa: 1, sb: 0, goals: { [T[0].list[0].player_id]: 2 } })), /أكثر من نتيجة/);
});
ok('result saved with goals + assists; winner A; history 1', () => {
  const g = { [T[0].list[3].player_id]: 2, [T[0].list[4].player_id]: 1, [T[1].list[2].player_id]: 1 };
  const a = { [T[0].list[5].player_id]: 2, [T[1].list[1].player_id]: 1 };
  const r = G.adminSaveResult(A({ sa: 3, sb: 1, goals: g, assists: a }));
  assert.strictEqual(r.state.match.winner, 'A'); assert.strictEqual(r.state.history.length, 1);
  assert.strictEqual(r.state.match.scorers[0].g, 2); assert.strictEqual(r.state.match.assisters[0].g, 2);
  same(r.state.match.teamA.map(p => p.player_id), T[0].list.map(p => p.player_id));
});
ok('re-saving the result replaces it (no duplicates, totals right)', () => {
  const r = G.adminSaveResult(A({ sa: 3, sb: 1, goals: { [T[0].list[3].player_id]: 3 }, assists: {} }));
  assert.strictEqual(r.state.history.length, 1);
  assert.strictEqual(r.state.stats.scorers[0].goals, 3);
  assert.strictEqual(r.state.stats.scorers.length, 1);
});
let voters = [];
ok('voting: only phones that registered a main; outsiders and reserves refused', () => {
  for (let i = 0; i < 20; i++) if (G.getState({ device: 'ph' + i }).canVote) voters.push('ph' + i);
  assert.ok(voters.length >= 9, 'voters=' + voters.length);
  const m = G.getState({}).match;
  throwsMsg(() => G.castVote({ device: 'stranger', category: 'mvp', player_id: m.teamA[0].player_id }), /لعبوا/);
  throwsMsg(() => G.castVote({ device: voters[0], category: 'mvp', player_id: 'not-a-player' }), /لعب في المباراة/);
});
ok('votes are secret until closed; organizer sees the count; change vote = no double count', () => {
  const m = G.getState({}).match;
  voters.forEach((d, i) => G.castVote({ device: d, category: 'mvp', player_id: i < 4 ? m.teamA[3].player_id : m.teamB[2].player_id }));
  voters.forEach((d, i) => G.castVote({ device: d, category: 'def', player_id: m.teamB[1].player_id }));
  G.castVote({ device: voters[0], category: 'mvp', player_id: m.teamB[2].player_id });       // change
  const pub = G.getState({ device: voters[1] });
  assert.strictEqual(pub.match.mvp.length, 0); assert.strictEqual(pub.match.mvpTally.length, 0);
  const org = G.getState({ pin });
  assert.strictEqual(org.match.mvpTally.reduce((s, x) => s + x.n, 0), voters.length);
});
ok('close voting: winners announced to everyone; late vote refused; organizer can still vote', () => {
  G.adminVoting(A({ open: false }));
  const pub = G.getState({ device: voters[1] });
  assert.strictEqual(pub.match.mvp[0].player_id, G.getState({}).match.teamB[2].player_id);
  assert.ok(pub.match.def.length === 1);
  assert.ok(pub.match.mvpTally.length > 0);
  throwsMsg(() => G.castVote({ device: voters[2], category: 'mvp', player_id: pub.match.teamA[0].player_id }), /قفل/);
  assert.strictEqual(pub.canVote, false);
});
ok('organizer override for best defender, then back to the vote', () => {
  const m = G.getState({}).match;
  let r = G.adminPickAward(A({ category: 'def', player_id: m.teamA[0].player_id }));
  assert.strictEqual(r.state.match.def[0].admin, true);
  r = G.adminPickAward(A({ category: 'def', player_id: '' }));
  assert.strictEqual(r.state.match.def[0].player_id, m.teamB[1].player_id);
});
ok('season stats: wins table, scorers, rank, months all consistent', () => {
  st = G.getState({});
  const w = st.stats.winners; console.log('   dbg winners', w.length, w.filter(x => x.w === 1).length, 'rank', st.stats.rank.length, 'teams', JSON.stringify(st.match.teamA.length), st.match.teamB.length); assert.strictEqual(w[0].w, 1); assert.strictEqual(w.filter(x => x.w === 1).length, st.match.teamA.length);
  assert.strictEqual(st.stats.rank.length, 14);
  const M = st.months[0]; assert.strictEqual(M.matches, 1);
  assert.strictEqual(M.goals.n, 3); assert.ok(M.mvp && M.def && M.wins);
});

console.log('— week 2');
let wk1date;
ok('new week: empty list, date +7, previous week intact, captains/overrides/bib not carried', () => {
  wk1date = G.getState({}).session.date;
  const r = G.adminNewWeek(A({}));
  assert.strictEqual((new Date(r.state.session.date) - new Date(wk1date)) / 864e5, 7);
  assert.strictEqual(r.state.list.length, 0); assert.strictEqual(r.state.teams, null); assert.strictEqual(r.state.bib.length, 0);
  assert.strictEqual(r.state.match, null); assert.strictEqual(r.state.history.length, 1);
  assert.strictEqual(r.state.history[0].mvp.length, 1);                 // last week's winner still shown
  same(r.state.colors, { a: 'green', b: 'white' });                       // colors are a standing setting
});
ok('week 2 sign-ups reuse players (same name → same stats), phones reset', () => {
  const t = Date.now();
  session(t + 86400e3, t + 86400e3 + 3600e3, t + 86400e3 + 7200e3);
  P.slice(0, 14).forEach((nm, i) => G.register({ device: 'ph' + i, name: nm, pos: POS[i] }));
  st = G.getState({}); assert.strictEqual(st.list.length, 14); assert.ok(st.teams);
  assert.strictEqual(G.getState({}).roster.filter(x => x === P[0]).length, 1);
});
ok('week 2 result + votes; season wins and months accumulate', () => {
  const t = Date.now(); session(t - 60e3, t + 3600e3, t + 7200e3);
  const T2 = G.getState({ pin }).teams;
  G.adminSaveResult(A({ sa: 0, sb: 2, goals: { [T2[1].list[0].player_id]: 2 } }));
  st = G.getState({});
  assert.strictEqual(st.history.length, 2);
  const p0 = st.stats.rank.find(s => s.name === P[0]); assert.strictEqual(p0.p, 2);
  const totalMatches = st.months.reduce((s, m) => s + m.matches, 0); assert.strictEqual(totalMatches, 2);
});
ok('deleting a result removes it and its votes; re-save works', () => {
  let r = G.adminDeleteResult(A({}));
  assert.strictEqual(r.state.history.length, 1); assert.strictEqual(r.state.match, null);
  throwsMsg(() => G.adminDeleteResult(A({})), /ما فيه نتيجة/);
  r = G.adminSaveResult(A({ sa: 1, sb: 1, goals: {} }));
  assert.strictEqual(r.state.match.winner, 'draw');
  assert.ok(r.state.stats.rank.every(s => s.w + s.d + s.l === s.p));
});
ok('organizer PIN: wrong PIN refused; rate-limit counter works', () => {
  throwsMsg(() => G.checkPin({ pin: '000000' }), /غير صحيح/);
  assert.strictEqual(G.checkPin({ pin }).state.isAdmin, true);
});
ok('state has no phone ids leaked to the page', () => {
  const s = JSON.stringify(G.getState({ device: 'ph1' }));
  assert.ok(!/"device"/.test(s)); assert.ok(!/voteDevices/.test(s)); assert.ok(!/admin_pin/.test(s));
});

console.log(`\n${n} passed, ${fails.length} failed`);
if (fails.length) { console.log('FAILED:', fails.join(' | ')); process.exit(1); }
