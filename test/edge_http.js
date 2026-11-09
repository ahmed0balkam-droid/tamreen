// Black-box test of the deployed-style edge function (Deno) over HTTP
const assert = require('assert');
const U = process.env.API || 'http://localhost:8000';
const call = async (fn, arg) => { const r = await fetch(U, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, arg }) }); return { status: r.status, j: await r.json() }; };
(async () => {
  let n = 0; const ok = (m) => { n++; console.log('✓', m); };
  const o = await fetch(U, { method: 'OPTIONS' }); assert.strictEqual(o.headers.get('access-control-allow-origin'), '*'); ok('CORS preflight');
  const s2 = await call('setup'); assert.ok(/مسبقاً/.test(s2.j.error)); ok('setup refused the second time (PIN never revealed again)');
  const u = await call('dropTables'); assert.strictEqual(u.status, 400); ok('unknown function rejected');
  const t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => call('register', { device: 'h' + i, name: 'لاعب ' + (i + 1), pos: 'ANY' })));
  const good = rs.filter((r) => r.j.data).length, full = rs.filter((r) => r.j.error).length;
  assert.strictEqual(good, 18); assert.strictEqual(full, 2);
  ok(`20 simultaneous sign-ups → 18 accepted, 2 told the list is full (${Date.now() - t0} ms)`);
  const st = (await call('getState', {})).j.data;
  assert.strictEqual(st.list.length, 18); assert.strictEqual(new Set(st.list.map((x) => x.name)).size, 18); ok('list has 18 unique names');
  const bad = await call('checkPin', { pin: '000000' }); assert.ok(/غير صحيح/.test(bad.j.error)); ok('wrong PIN gives Arabic error');
  const crash = await call('register', { device: 'x', name: '' }); assert.ok(crash.j.error && /[؀-ۿ]/.test(crash.j.error)); ok('invalid input → Arabic message, no crash');
  const times = []; for (let i = 0; i < 10; i++) { const a = Date.now(); await call('getState', {}); times.push(Date.now() - a); }
  ok('getState latency (local): ' + Math.round(times.reduce((a, b) => a + b) / times.length) + ' ms average');
  console.log(`\n${n} edge-function checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
