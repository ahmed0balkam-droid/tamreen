const assert = require('assert');
const { makeEnv } = require('./mock2');
const { ctx, cache } = makeEnv();
const G = ctx;
let passed = 0;
const same = (a, b) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b));
function ok(name, fn) { fn(); passed++; console.log('✓', name); }
function throwsMsg(fn, re) { try { fn(); } catch (e) { assert.match(e.message, re); return; } throw new Error('expected error ' + re); }
function ist(ms) { // HH:mm and date in Istanbul
  const d = new Date(ms + 3 * 3600e3);
  return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) };
}

const setupMsg = G.setup();
const pin = setupMsg.match(/(\d{6})/)[1];
ok('setup creates sheets, PIN and first session (Saturday)', () => {
  const st = G.getState({});
  assert.ok(st.session);
  assert.strictEqual(new Date(st.session.date + 'T12:00:00+03:00').getUTCDay(), 6);
  assert.strictEqual(st.session.lock, '20:00');
  assert.strictEqual(st.isAdmin, false);
  assert.strictEqual(G.getState({ pin }).isAdmin, true);
  assert.throws(() => G.setup(), /مسبقاً/); // public setup works only once (never reveals the PIN again)
  assert.strictEqual(G.getState({ pin }).isAdmin, true);
});

// session: lock in 1h, start in 2h (so late-withdraw window applies)
const now = Date.now();
const L = ist(now + 3600e3), Sx = ist(now + 2 * 3600e3), E = ist(now + 3 * 3600e3);
ok('admin saves session', () => {
  const r = G.adminSaveSession({ pin, data: { date: L.date, lock: L.hm, start: Sx.hm, end: E.hm, pitch: 'SERDİVAN HALI SAHA', fee: 300, map: 'https://maps.app.goo.gl/LXMVQoQtZKKKL2tj9' } });
  assert.match(r.msg, /تم حفظ/);
  throwsMsg(() => G.adminSaveSession({ pin: '000', data: {} }), /للمنظّم فقط/);
  throwsMsg(() => G.adminSaveSession({ pin, data: { date: L.date, lock: '22:00', start: '21:00', end: '23:00' } }), /قبل بداية/);
});

const names = ['خالد', 'محمد جلال', 'أكرم الورد', 'عبدالرحمن السعودي', 'أحمد نعامة', 'بشير', 'البرو', 'عبدالرحمن النظاري',
  'أحمد الجعدبي', 'مظفر', 'ممدوح', 'عمار ياسر', 'عدنان', 'عثمان', 'لاعب 15', 'لاعب 16', 'لاعب 17', 'لاعب 18'];
const pos = ['GK', 'GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD', 'FWD', 'ANY', 'DEF', 'MID', 'ANY', 'FWD'];
let st;
ok('18 players register from 18 phones; ranks follow sign-up order', () => {
  names.forEach((n, i) => { st = G.register({ device: 'dev' + i, name: n, pos: pos[i] }).state; });
  assert.strictEqual(st.list.length, 18);
  same(st.list.map(x => x.name), names);
  assert.strictEqual(st.list[13].rank, 14);
});
ok('19th sign-up is refused (14 + 4 cap)', () => throwsMsg(() => G.register({ device: 'dev99', name: 'زائد', pos: 'ANY' }), /مكتملة/));
ok('one phone registers itself + one friend, never a third', () => {
  G.withdraw({ device: 'dev17', reg_id: G.getState({ device: 'dev17' }).list[17].id });
  let s2 = G.register({ device: 'dev0', name: 'صديق خالد', pos: 'ANY' }).state;
  const mine = s2.list.filter(x => x.mine);
  assert.strictEqual(mine.length, 2); assert.strictEqual(mine[0].friend, false); assert.strictEqual(mine[1].friend, true);
  G.withdraw({ device: 'dev0', reg_id: mine[1].id });
  G.register({ device: 'dev0', name: 'صديق 1', pos: 'ANY' });
  G.withdraw({ device: 'dev0', reg_id: G.getState({ device: 'dev0' }).list.filter(x => x.friend)[0].id });
});
ok('per-phone limit: default 3, organizer can change it', () => {
  ['dev14', 'dev15', 'dev16'].forEach(d => G.withdraw({ device: d, reg_id: G.getState({ device: d }).list.find(x => x.mine).id }));
  G.register({ device: 'devF', name: 'ف1', pos: 'ANY' }); G.register({ device: 'devF', name: 'ف2', pos: 'ANY' }); G.register({ device: 'devF', name: 'ف3', pos: 'ANY' });
  throwsMsg(() => G.register({ device: 'devF', name: 'ف4', pos: 'ANY' }), /وصلت للحد: تقدر تسجّل 3/);
  G.getState({ device: 'devF' }).list.filter(x => x.mine).forEach(x => G.withdraw({ device: 'devF', reg_id: x.id }));
  // organizer lowers the limit to 1
  G.adminSetPerDevice({ pin, n: 1 });
  assert.strictEqual(G.getState({}).perDevice, 1);
  G.register({ device: 'devG', name: 'ج1', pos: 'ANY' });
  throwsMsg(() => G.register({ device: 'devG', name: 'ج2', pos: 'ANY' }), /اسماً واحداً/);
  G.withdraw({ device: 'devG', reg_id: G.getState({ device: 'devG' }).list.find(x => x.mine).id });
  throwsMsg(() => G.adminSetPerDevice({ pin, n: 9 }), /من 1 إلى 6/);
  G.adminSetPerDevice({ pin, n: 3 });
  G.register({ device: 'dev14', name: 'لاعب 15', pos: 'DEF' }); G.register({ device: 'dev15', name: 'لاعب 16', pos: 'MID' }); G.register({ device: 'dev16', name: 'لاعب 17', pos: 'ANY' });
});
ok('edit keeps the place: position and name fix', () => {
  const s0 = G.getState({ device: 'dev3' });
  const me = s0.list.find(x => x.mine);
  throwsMsg(() => G.updateRegistration({ device: 'dev5', reg_id: me.id, pos: 'FWD' }), /تسجيلك أنت فقط/);
  let r = G.updateRegistration({ device: 'dev3', reg_id: me.id, pos: 'FWD' });
  let after = r.state.list.find(x => x.mine);
  assert.strictEqual(after.rank, me.rank); assert.strictEqual(after.pos, 'FWD');
  r = G.updateRegistration({ device: 'dev3', reg_id: me.id, name: 'عبدالرحمن السعودى', pos: 'FWD' });
  after = r.state.list.find(x => x.mine);
  assert.strictEqual(after.name, 'عبدالرحمن السعودى'); assert.strictEqual(after.rank, me.rank);
  throwsMsg(() => G.updateRegistration({ device: 'dev3', reg_id: me.id, name: 'خالد' }), /مسجّل في القائمة مسبقاً/);
  r = G.updateRegistration({ device: 'dev3', reg_id: me.id, name: 'عبدالرحمن السعودي', pos: 'DEF' });
  assert.match(r.msg, /مكانك/);
});
ok('Arabic spelling variants match the same player (احمد = أحمد)', () => {
  throwsMsg(() => G.register({ device: 'devX', name: '  احمد   نعامه ', pos: 'DEF' }), /مسجّل في القائمة مسبقاً/);
  st = G.register({ device: 'dev17', name: 'لاعب 18', pos: 'FWD' }).state; // re-fill slot 18
  assert.strictEqual(st.list.length, 18);
});
ok('"mine" flag only for the device that registered', () => {
  const s0 = G.getState({ device: 'dev2' });
  same(s0.list.filter(x => x.mine).map(x => x.name), ['أكرم الورد']);
  assert.ok(s0.list.every(x => x.device === undefined), 'device ids must not leak');
});
ok('withdrawing a main player promotes the first reserve; counted as late (<24h)', () => {
  const me = G.getState({ device: 'dev4' }).list.find(x => x.mine);
  throwsMsg(() => G.withdraw({ device: 'dev5', reg_id: me.id }), /تسجيلك أنت فقط/);
  const r = G.withdraw({ device: 'dev4', reg_id: me.id });
  assert.match(r.msg, /متأخراً/);
  assert.strictEqual(r.state.list[13].name, 'لاعب 15');
  assert.strictEqual(r.state.list.length, 17);
  assert.strictEqual(r.state.stats.commit.find(s => s.name === 'أحمد نعامة').late, 1);
  st = G.register({ device: 'dev4', name: 'أحمد نعامة', pos: 'DEF' }).state; // comes back at the end (reserve)
  assert.strictEqual(st.list[17].name, 'أحمد نعامة');
});
ok('teams appear automatically when 14 are in; organizer can hide, show, or switch it off', () => {
  let s1 = G.getState({});
  assert.strictEqual(s1.teamsReason, 'full'); assert.ok(s1.teams);
  G.adminUnpublish({ pin });
  assert.strictEqual(G.getState({}).teams, null);
  G.adminPublish({ pin });
  assert.strictEqual(G.getState({}).teamsReason, 'published');
  G.adminUnpublish({ pin }); G.adminSetAutoFull({ pin, on: false });
  assert.strictEqual(G.getState({}).teams, null);
  G.adminSetAutoFull({ pin, on: true });
  assert.strictEqual(G.getState({}).teams, null);   // still hidden for this week until organizer shows it
  st = G.adminPublish({ pin }).state;
  assert.ok(st.teams);
});

// lock now
ok('after lock: players cannot register or withdraw; organizer can', () => {
  const past = ist(Date.now() - 60e3);
  G.adminSaveSession({ pin, data: { date: L.date, lock: past.hm, start: Sx.hm, end: E.hm, pitch: 'SERDİVAN HALI SAHA', fee: 300, map: '' } });
  const s1 = G.getState({ device: 'dev0' });
  assert.strictEqual(s1.locked, true);
  const mine = s1.list.find(x => x.mine);
  throwsMsg(() => G.withdraw({ device: 'dev0', reg_id: mine.id }), /مقفلة/);
});
ok('teams are 7 v 7, one GK each, and identical for every viewer', () => {
  const a = G.getState({ device: 'dev1' }), b = G.getState({ device: 'dev9' });
  same(a.teams, b.teams);
  assert.strictEqual(a.teams[0].list.length, 7); assert.strictEqual(a.teams[1].list.length, 7);
  assert.strictEqual(a.teams[0].c.GK, 1); assert.strictEqual(a.teams[1].c.GK, 1);
  assert.ok(Math.abs((a.teams[0].c.DEF || 0) - (a.teams[1].c.DEF || 0)) <= 1);
});
ok('organizer moves and swaps players manually, then resets to auto', () => {
  const auto = G.getState({}).teams;
  const a0 = auto[0].list[0], b0 = auto[1].list[0];
  throwsMsg(() => G.adminMovePlayer({ pin: 'x', player_id: a0.player_id }), /للمنظّم فقط/);
  let r = G.adminMovePlayer({ pin, player_id: a0.player_id });
  assert.strictEqual(r.state.manual, true);
  assert.strictEqual(r.state.teams[0].list.length, 6); assert.strictEqual(r.state.teams[1].list.length, 8);
  assert.ok(r.state.teams[1].list.some(p => p.player_id === a0.player_id));
  r = G.adminMovePlayer({ pin, player_id: a0.player_id });           // move back
  r = G.adminSwapPlayers({ pin, a: a0.player_id, b: b0.player_id });
  assert.ok(r.state.teams[1].list.some(p => p.player_id === a0.player_id));
  assert.ok(r.state.teams[0].list.some(p => p.player_id === b0.player_id));
  assert.strictEqual(r.state.teams[0].list.length, 7);
  same(G.getState({ device: 'dev9' }).teams, r.state.teams);       // everyone sees the manual split
  throwsMsg(() => G.adminSwapPlayers({ pin, a: a0.player_id, b: r.state.teams[1].list[1].player_id }), /الفريق الثاني/);
  r = G.adminResetTeams({ pin });
  assert.strictEqual(r.state.manual, false);
  same(r.state.teams, auto);
});
ok('organizer changes a position after teams are out; split stays the same', () => {
  const st = G.getState({ pin });
  const p = st.teams[1].list[0], reg = st.list.find(x => x.player_id === p.player_id);
  const newPos = p.pos === 'GK' ? 'FWD' : 'GK';
  const r = G.updateRegistration({ pin, reg_id: reg.id, pos: newPos });
  same(r.state.teams.map(t => t.list.map(x => x.player_id).sort()), st.teams.map(t => t.list.map(x => x.player_id).sort()));
  assert.strictEqual(r.state.teams[1].list.find(x => x.player_id === p.player_id).pos, newPos);
  G.adminResetTeams({ pin });                                  // back to auto for the next checks
});
ok('organizer picks a captain per team; toggles off; only team members', () => {
  const st = G.getState({ pin });
  const a = st.teams[0].list[2], b = st.teams[1].list[3];
  throwsMsg(() => G.adminSetCaptain({ pin: '000000', player_id: a.player_id }), /.+/);
  throwsMsg(() => G.adminSetCaptain({ pin, player_id: 'nope' }), /التوزيع/);
  G.adminSetCaptain({ pin, player_id: a.player_id });
  let r = G.adminSetCaptain({ pin, player_id: b.player_id });
  same(r.state.captains, { A: a.player_id, B: b.player_id });
  assert.ok(G.getState({ device: 'dev3' }).teams[0].list.find(p => p.player_id === a.player_id).cap);
  const a2 = r.state.teams[0].list[4];
  r = G.adminSetCaptain({ pin, player_id: a2.player_id });                 // replace captain of A
  assert.strictEqual(r.state.captains.A, a2.player_id);
  assert.strictEqual(r.state.teams[0].list.filter(p => p.cap).length, 1);
  r = G.adminSetCaptain({ pin, player_id: a2.player_id });                 // toggle off
  assert.strictEqual(r.state.captains.A, null);
});
ok('organizer marks a no-show; reserve moves up; teams recompute', () => {
  const s1 = G.getState({ pin });
  const target = s1.list.find(x => x.name === 'عدنان');
  const r = G.adminRemove({ pin, reg_id: target.id, reason: 'no_show' });
  assert.match(r.msg, /غياب/);
  assert.ok(r.state.list.slice(0, 14).some(x => x.name === 'لاعب 16'));
  assert.ok(!r.state.teams.some(t => t.list.some(p => p.name === 'عدنان')));
});
ok('reshuffle changes the split but keeps 7 v 7', () => {
  const before = JSON.stringify(G.getState({}).teams);
  const r = G.adminReshuffle({ pin });
  assert.notStrictEqual(JSON.stringify(r.state.teams), before);
  assert.strictEqual(r.state.teams[0].list.length + r.state.teams[1].list.length, 14);
});
ok('bib draw: 0–99, team by range, every attempt logged', () => {
  throwsMsg(() => G.adminDrawBib({ pin: 'x' }), /للمنظّم فقط/);
  G.adminDrawBib({ pin }); const r = G.adminDrawBib({ pin });
  assert.strictEqual(r.state.bib.length, 2);
  r.state.bib.forEach(b => { assert.ok(b.n >= 0 && b.n <= 99); assert.strictEqual(b.team, b.n < 50 ? 'A' : 'B'); });
  const counts = [0, 0]; for (let i = 0; i < 4000; i++) { const n = G.fair100_(); counts[n < 50 ? 0 : 1]++; }
  assert.ok(Math.abs(counts[0] - counts[1]) < 300, 'fair split ' + counts);
});
ok('result saves with scorers; standings and history update', () => {
  const s1 = G.getState({ pin });
  const a0 = s1.teams[0].list[0], b0 = s1.teams[1].list[0];
  const r = G.adminSaveResult({ pin, sa: 5, sb: 3, goals: { [a0.player_id]: 3, [b0.player_id]: 2 } });
  assert.strictEqual(r.state.match.sa, 5);
  assert.strictEqual(r.state.match.scorers[0].name, a0.name);
  const top = r.state.stats.rank[0];
  assert.strictEqual(top.pts, 3 + 3); assert.strictEqual(r.state.stats.rank.length, 14);   // win 3 + 3 goals
  // update result overwrites, no duplicates
  const r2 = G.adminSaveResult({ pin, sa: 4, sb: 4, goals: {} });
  assert.strictEqual(r2.state.history.length, 1);
  assert.ok(r2.state.stats.rank.every(s => s.d === 1 && s.pts === 1));                     // draw, no goals
  const ad = r2.state.stats.commit.find(s => s.name === 'عدنان');
  assert.strictEqual(ad.ns, 1); assert.strictEqual(ad.rate, 0);
});
ok('assists, goals-vs-score check, weekly report data', () => {
  const s1 = G.getState({ pin });
  const A = s1.teams[0].list, B = s1.teams[1].list;
  throwsMsg(() => G.adminSaveResult({ pin, sa: 1, sb: 0, goals: { [A[0].player_id]: 2 } }), /أكثر من نتيجة/);
  const r = G.adminSaveResult({ pin, sa: 3, sb: 1, goals: { [A[0].player_id]: 2, [A[1].player_id]: 1, [B[0].player_id]: 1 }, assists: { [A[2].player_id]: 2, [B[1].player_id]: 1 } });
  const m = r.state.match;
  assert.strictEqual(m.winner, 'A');
  assert.strictEqual(m.scorers[0].name, A[0].name); assert.strictEqual(m.scorers[0].g, 2);
  assert.strictEqual(m.assisters[0].name, A[2].name); assert.strictEqual(m.assisters[0].g, 2);
  assert.strictEqual(m.teamA.length, 7); assert.strictEqual(m.teamB.length, 7);
  const st = r.state.stats.rank.find(x => x.name === A[2].name);
  assert.strictEqual(st.assists, 2);
  assert.strictEqual(r.state.stats.scorers[0].name, A[0].name);
});
ok('voting: only players who played, one vote per phone, vote can be changed', () => {
  let voters = [], outsider = null;
  for (let i = 0; i < 30; i++) { const st = G.getState({ device: 'dev' + i }); if (st.canVote) voters.push('dev' + i); else if (!outsider && st.myCount === 0) outsider = 'dev' + i; }
  assert.ok(voters.length >= 10, 'voters ' + voters.length);
  const m = G.getState({}).match, A = m.teamA, B = m.teamB;
  throwsMsg(() => G.castVote({ device: outsider || 'nobody', category: 'mvp', player_id: A[0].player_id }), /اللي لعبوا|لعب/);
  throwsMsg(() => G.castVote({ device: voters[0], category: 'xx', player_id: A[0].player_id }), /.+/);
  G.castVote({ device: voters[0], category: 'mvp', player_id: A[0].player_id });
  G.castVote({ device: voters[1], category: 'mvp', player_id: A[0].player_id });
  G.castVote({ device: voters[2], category: 'mvp', player_id: B[0].player_id });
  G.castVote({ device: voters[2], category: 'mvp', player_id: A[0].player_id });   // change → no double count
  G.castVote({ device: voters[0], category: 'def', player_id: B[2].player_id });
  const hidden = G.getState({ device: voters[2] });
  assert.strictEqual(hidden.match.mvp.length, 0); assert.strictEqual(hidden.match.mvpTally.length, 0);   // secret until closed
  assert.strictEqual(G.getState({ pin }).match.mvpTally[0].n, 3);                                       // organizer sees live count
  G.adminVoting({ pin, open: false });                                                                   // close & announce
  const st = G.getState({ device: voters[2] });
  assert.strictEqual(st.myVotes.mvp, A[0].player_id);
  assert.strictEqual(st.match.mvpTally[0].n, 3); assert.strictEqual(st.match.mvpTally.length, 1);
  assert.strictEqual(st.match.mvp[0].name, A[0].name);
  assert.strictEqual(st.match.def[0].name, B[2].name);
  assert.strictEqual(st.voteDevices, undefined);
});
ok('organizer pick overrides the vote for best defender, and can be cleared', () => {
  const m = G.getState({}).match;
  const votedDef = m.def[0].player_id, pick = m.teamA[4].player_id;
  throwsMsg(() => G.adminPickAward({ pin: '000000', category: 'def', player_id: pick }), /.+/);
  throwsMsg(() => G.adminPickAward({ pin, category: 'def', player_id: 'nope' }), /لعب/);
  let r = G.adminPickAward({ pin, category: 'def', player_id: pick });
  assert.strictEqual(r.state.match.def.length, 1);
  assert.strictEqual(r.state.match.def[0].player_id, pick); assert.strictEqual(r.state.match.def[0].admin, true);
  assert.strictEqual(r.state.match.defTally[0].player_id, votedDef);          // votes still visible
  assert.strictEqual(r.state.months[0].def.names[0], r.state.match.def[0].name);
  r = G.adminPickAward({ pin, category: 'def', player_id: '' });
  assert.strictEqual(r.state.match.def[0].player_id, votedDef);
  r = G.adminPickAward({ pin, category: 'def', player_id: pick });               // keep pick for month test
  // awards add +2 to the ranking points
  const rk = r.state.stats.rank, me = rk.find(s => s.player_id === pick || s.name === r.state.match.def[0].name);
  assert.strictEqual(me.def, 1); assert.strictEqual(me.pts, me.w * 3 + me.d + me.goals + me.assists * 0.5 + 2);
  assert.ok(rk.every(s => s.pts === s.w * 3 + s.d + s.goals + s.assists * 0.5 + 3 * (s.mvp || 0) + 2 * (s.def || 0)));
  assert.ok(rk.some(s => s.assists) ? rk.every(s => Number.isInteger(s.pts * 2)) : true, 'points are whole or half');
  for (let i = 1; i < rk.length; i++) assert.ok(rk[i - 1].pts >= rk[i].pts, 'rank sorted by points');
});
ok('monthly awards: top scorer, assister, best player, best defender', () => {
  const st = G.getState({});
  const M = st.months[0];
  assert.ok(M.label && M.matches === 1);
  assert.strictEqual(M.goals.names[0], st.match.scorers[0].name); assert.strictEqual(M.goals.n, 2);
  assert.strictEqual(M.assists.n, 2);
  assert.strictEqual(M.mvp.names[0], st.match.mvp[0].name); assert.strictEqual(M.mvp.n, 1);
  assert.ok(M.def && M.def.n === 1 && M.def.names[0] === st.match.def[0].name);
  assert.ok(M.wins && M.wins.n === 1 && M.wins.names.length === 7);
  assert.strictEqual(st.stats.winners[0].w, 1);
  assert.strictEqual(M.scorers.length, 5); assert.strictEqual(M.scorers[0].goals, 2);
});
ok('team colors: organizer picks, everyone sees, same color refused', () => {
  assert.strictEqual(G.getState({}).colors.a, 'red');
  throwsMsg(() => G.adminSetColors({ pin: '000000', a: 'green', b: 'white' }), /.+/);
  throwsMsg(() => G.adminSetColors({ pin, a: 'green', b: 'green' }), /.+/);
  G.adminSetColors({ pin, a: 'green', b: 'white' });
  const st = G.getState({ device: 'dev5' });
  same(st.colors, { a: 'green', b: 'white' });
  assert.ok(st.palette.green.fill);
});
ok('organizer full control: list order, bib, voting lock/clear, delete result', () => {
  // swap a reserve into the main list
  let st = G.getState({ pin });
  const main5 = st.list[4], res = st.list[st.list.length - 1];
  throwsMsg(() => G.adminSwapOrder({ pin: '000000', a: main5.id, b: res.id }), /.+/);
  let r = G.adminSwapOrder({ pin, a: main5.id, b: res.id });
  assert.strictEqual(r.state.list[4].id, res.id);
  assert.strictEqual(r.state.list[r.state.list.length - 1].id, main5.id);
  assert.strictEqual(r.state.list.length, st.list.length);
  // manual bib
  r = G.adminSetBib({ pin, team: 'B' });
  const lb = r.state.bib[r.state.bib.length - 1];
  assert.strictEqual(lb.team, 'B'); assert.strictEqual(lb.n, -1);
  // voting lock
  G.adminVoting({ pin, open: true });
  let voter = null;
  for (let i = 0; i < 30 && !voter; i++) if (G.getState({ device: 'dev' + i }).canVote) voter = 'dev' + i;
  const m = r.state.match;
  G.adminVoting({ pin, open: false });
  assert.strictEqual(G.getState({ device: voter }).canVote, false);
  throwsMsg(() => G.castVote({ device: voter, category: 'mvp', player_id: m.teamA[0].player_id }), /قفل/);
  G.castVote({ device: 'admin-phone', pin, category: 'mvp', player_id: m.teamB[1].player_id });   // organizer still can
  G.adminVoting({ pin, open: true });
  assert.strictEqual(G.getState({ device: voter }).canVote, true);
  r = G.adminVoting({ pin, clear: true });
  assert.strictEqual(r.state.match.votesCount, 0); assert.strictEqual(r.state.match.mvpTally.length, 0);
  // delete result, then save again
  r = G.adminDeleteResult({ pin });
  assert.strictEqual(r.state.match, null); assert.strictEqual(r.state.history.length, 0);
  throwsMsg(() => G.adminDeleteResult({ pin }), /ما فيه نتيجة/);
  r = G.adminSaveResult({ pin, sa: 2, sb: 2, goals: {} });
  assert.strictEqual(r.state.history.length, 1);
  assert.strictEqual(r.state.match.def.length, 0);    // old organizer pick was cleared with the result
});
ok('new week: empty list, date +7, history and stats kept', () => {
  const old = G.getState({}).session.date;
  const prevSid = G.getState({}).session.id;
  const r = G.adminNewWeek({ pin });
  assert.ok(/اعتماد/.test(r.msg));
  assert.strictEqual(G.setting_('vote_closed_' + prevSid), '1');
  assert.strictEqual(r.state.list.length, 0);
  const h0 = r.state.history[0];
  assert.strictEqual((h0.mvp || []).length > 0, (h0.mvpTally || []).length > 0, 'last week winners announced after new week');
  assert.strictEqual(r.state.teams, null);
  assert.strictEqual((new Date(r.state.session.date) - new Date(old)) / 86400000, 7);
  assert.strictEqual(r.state.history.length, 1);
  assert.strictEqual(r.state.stats.rank.length, 14);
  assert.ok(r.state.roster.length >= 18);
});
ok('wrong PIN is refused and attempts are rate-limited', () => {
  throwsMsg(() => G.checkPin({ pin: '1' }), /غير صحيح/);
  for (let i = 0; i < 20; i++) { try { G.checkPin({ pin: 'bad' }); } catch (e) {} }
  throwsMsg(() => G.checkPin({ pin }), /غير صحيح/); // locked out for 10 min
  cache.delete('pinfail');
  assert.ok(G.checkPin({ pin }).state.isAdmin);
});
// (doGet removed: the page is now a static PWA)
console.log(`\n${passed} checks passed`);
module.exports = { pin };
