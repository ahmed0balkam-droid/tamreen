// Transaction behaviour against real Postgres: commit, rollback on error, PIN counter, concurrency
const assert = require('assert');
const { start } = require('./pgserver');
(async () => {
  const S = await start(0);
  const { call, pg } = S; let n = 0; const ok = async (name, f) => { await f(); n++; console.log('✓', name); };
  const pin = (await call('setup', {})).match(/(\d{6})/)[1];
  await ok('setup once; second time refused', async () => { await assert.rejects(call('setup', {}), /مسبقاً/); });
  await ok('getState works and writes nothing', async () => {
    const before = (await pg.query('select count(*)::int c from settings')).rows[0].c;
    const st = await call('getState', {}); assert.ok(st.session && st.session.date);
    assert.strictEqual((await pg.query('select count(*)::int c from settings')).rows[0].c, before);
  });
  await ok('register commits a row', async () => {
    const r = await call('register', { device: 'dv1', name: 'أحمد', pos: 'DEF' });
    assert.ok(r.state.list.some((x) => x.name === 'أحمد'));
    assert.strictEqual((await pg.query('select count(*)::int c from registrations')).rows[0].c, 1);
  });
  await ok('failed action rolls back completely', async () => {
    await assert.rejects(call('adminSaveSession', { pin, data: { date: 'bad' } }), /التاريخ/);
    await assert.rejects(call('adminPublish', { pin: '000' }), /للمنظّم فقط/);
    assert.strictEqual((await pg.query('select count(*)::int c from registrations')).rows[0].c, 1);
  });
  await ok('wrong PIN counter survives the error (persisted)', async () => {
    await assert.rejects(call('checkPin', { pin: '999999' }), /غير صحيح/);
    const v = (await pg.query("select value from settings where key='pinfail'")).rows[0].value;
    assert.ok(/^1\|\d+$/.test(v), v);
  });
  await ok('20 concurrent sign-ups: exactly fills 18 places (14 + 4 reserve), no lost writes, no duplicates', async () => {
    const names = Array.from({ length: 20 }, (_, i) => 'لاعب ' + (i + 1));
    const rs = await Promise.allSettled(names.map((nm, i) => call('register', { device: 'c' + i, name: nm, pos: 'ANY' })));
    assert.strictEqual(rs.filter((r) => r.status === 'fulfilled').length, 17);
    rs.filter((r) => r.status === 'rejected').forEach((r) => assert.ok(/[\u0600-\u06FF]/.test(r.reason.message), r.reason.message));
    const c = (await pg.query("select count(*)::int c from registrations where status='active'")).rows[0].c;
    assert.strictEqual(c, 18);
    const seqs = (await pg.query('select count(distinct seq)::int d, count(*)::int c from registrations')).rows[0];
    assert.strictEqual(seqs.d, seqs.c);
  });
  await ok('stored types are real types (date, bigint, smallint)', async () => {
    const r = (await pg.query("select pg_typeof(date)::text d, pg_typeof(created_at)::text c, pg_typeof(published)::text p from sessions limit 1")).rows[0];
    assert.deepStrictEqual(r, { d: 'date', c: 'bigint', p: 'smallint' });
  });
  console.log(`\n${n} transaction checks passed`); await S.close(); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
