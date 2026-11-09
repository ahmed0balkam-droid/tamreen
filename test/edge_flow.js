// Full week through the real Deno function: session, teams, result (insert, replace = delete+insert), votes, delete, new week
const assert = require('assert');
const U = 'http://localhost:8000', PIN = process.argv[2];
const call = async (fn, arg) => { const r = await fetch(U, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, arg }) }); const j = await r.json(); if (j.error) throw new Error(fn + ': ' + j.error); return j.data; };
const ist = (ms) => { const d = new Date(ms + 3 * 3600e3); return { date: d.toISOString().slice(0, 10), hm: d.toISOString().slice(11, 16) }; };
(async () => {
  const t = Date.now(), L = ist(t - 120e3), S = ist(t - 60e3), E = ist(t + 3600e3);
  await call('adminSaveSession', { pin: PIN, data: { date: L.date, lock: L.hm, start: S.hm, end: E.hm, pitch: 'ملعب', fee: 300, map: '' } });
  let st = await call('getState', { pin: PIN }); const A = st.teams[0].list, B = st.teams[1].list;
  console.log('✓ locked, teams', A.length, 'v', B.length);
  await call('adminSaveResult', { pin: PIN, sa: 3, sb: 1, goals: { [A[0].player_id]: 2, [A[1].player_id]: 1, [B[0].player_id]: 1 }, assists: { [A[2].player_id]: 1 } });
  await call('adminSaveResult', { pin: PIN, sa: 4, sb: 1, goals: { [A[0].player_id]: 3, [A[1].player_id]: 1, [B[0].player_id]: 1 }, assists: {} });
  st = await call('getState', { pin: PIN });
  assert.strictEqual(st.match.sa, 4); assert.strictEqual(st.stats.rank.length, 14);
  assert.strictEqual(st.match.scorers.reduce((s, x) => s + x.g, 0), 5); console.log('✓ result saved then corrected (old rows deleted, no duplicates)');
  await call('castVote', { device: 'h0', category: 'mvp', player_id: A[0].player_id }).catch((e) => console.log('  vote note:', e.message));
  await call('adminPickAward', { pin: PIN, category: 'def', player_id: B[1].player_id });
  await call('adminDeleteResult', { pin: PIN });
  st = await call('getState', { pin: PIN }); assert.ok(!st.match); console.log('✓ result deleted');
  await call('adminSaveResult', { pin: PIN, sa: 2, sb: 2, goals: { [A[0].player_id]: 2, [B[0].player_id]: 2 }, assists: {} });
  const nw = await call('adminNewWeek', { pin: PIN }); assert.ok(/اعتماد/.test(nw.msg));
  st = await call('getState', {}); assert.strictEqual(st.list.length, 0); assert.strictEqual(st.history.length, 1);
  assert.strictEqual(st.history[0].sa, 2); console.log('✓ week approved, new week open, history kept:', st.session.date);
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
