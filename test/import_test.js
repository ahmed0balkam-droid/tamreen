// Sheet → Postgres import: export the simulated 2-week data as Google-style CSV, import it, and compare the app state
const assert = require('assert'), fs = require('fs'), path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/db.js');
const mock = require('./mock2');
let env; const orig = mock.makeEnv; mock.makeEnv = () => (env = orig());
require('./sim.js');                                   // builds two weeks of realistic data
(async () => {
  const mem = env.tables();
  const gq = (v) => '"' + String(v).replace(/"/g, '""') + '"';     // gviz quotes every field
  const csv = {};
  const TABS = { settings: 'Settings', sessions: 'Sessions', players: 'Players', regs: 'Registrations', bib: 'BibDraws', matches: 'Matches', match_players: 'MatchPlayers', votes: 'Votes' };
  Object.keys(TABS).forEach((k) => {
    const cols = Object.keys(db.TABLES[k].cols);
    csv[TABS[k]] = [cols.map(gq).join(',')].concat((mem[k] || []).map((r) => cols.map((c) => gq(r[c] ?? '')).join(','))).join('\n');
  });
  csv.Settings += '\n' + gq('note') + ',' + gq('سطر فيه\nسطرين و "اقتباس" و, فاصلة');   // tricky CSV value
  const pg = new PGlite(); await pg.exec(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
  const tx = (fn) => pg.transaction(async (t) => fn(async (s, p) => (await t.query(s, p)).rows));
  const counts = await db.importSheets(tx, csv);
  console.log('imported rows:', JSON.stringify(counts));
  await assert.rejects(db.importSheets(tx, csv), /مرة وحدة/); console.log('✓ second import refused');
  const note = (await pg.query("select value from settings where key='note'")).rows[0].value;
  assert.strictEqual(note, 'سطر فيه\nسطرين و "اقتباس" و, فاصلة'); console.log('✓ quotes, commas and line breaks survive');
  // same state from Postgres as from memory (device + organizer views)
  const vm = require('vm');
  const src = fs.readFileSync(path.join(__dirname, '../dist/core_factory.js'), 'utf8').replace('module.exports = { createCore };', '');
  const sb = { console, Intl, crypto: { randomUUID: require('crypto').randomUUID }, JSON, Math }; vm.createContext(sb);
  vm.runInContext('"use strict";\n' + src + '\nthis.createCore = createCore;', sb);
  const pin = env.ctx.setting_('admin_pin');
  const strip = (o) => { o = JSON.parse(JSON.stringify(o)); delete o.now; delete o.builtAt; delete o.locked; return o; };
  const fromPg = await db.runCall(tx, sb.createCore, 'getState', { device: 'w2dev3', pin });
  const fromMem = env.ctx.getState({ device: 'w2dev3', pin });
  delete fromMem.now; delete fromPg.now;
  assert.deepStrictEqual(strip(fromPg), strip(fromMem));
  console.log('✓ organizer view identical after import: list', fromPg.list.length, '· history', fromPg.history.length, '· ranking', fromPg.stats.rank.length, '· months', fromPg.months.length);
  const v1 = await db.runCall(tx, sb.createCore, 'getState', { device: 'w2dev3' });
  assert.deepStrictEqual(strip(v1), strip(env.ctx.getState({ device: 'w2dev3' }))); console.log('✓ player view identical after import');
  // and the app keeps working on the imported data
  const r = await db.runCall(tx, sb.createCore, 'adminNewWeek', { pin });
  assert.ok(/اعتماد/.test(r.msg)); console.log('✓ new week opens on the imported data');
})().catch((e) => { console.error(e); process.exit(1); });
