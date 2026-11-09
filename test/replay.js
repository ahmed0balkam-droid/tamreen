// Replays every committed change from test.js + sim.js into a real Postgres (PGlite) through db.js,
// and checks that what Postgres gives back is exactly what the logic wrote.
const fs = require('fs'), path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const db = require('../src/db.js');
const { HIST } = require('./mock2');
const which = process.argv[2] || 'both';
if (which !== 'sim') require('./test.js');
const n1 = HIST.length;
if (which !== 'test') { const saved = HIST.splice(0); require('./sim.js'); HIST.unshift(...saved); }
(async () => {
  const runOne = async (list, label) => {
    const pg = new PGlite();
    await pg.exec(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
    const q = async (t, p) => (await pg.query(t, p)).rows;
    let bad = 0, ops = 0;
    for (const h of list) {
      const now = await loadClean(q);
      if (!same(now, norm(h.before))) { console.log('✗ before-state mismatch at', h.fn); bad++; break; }
      await pg.transaction(async (t) => { const tq = async (s, p) => (await t.query(s, p)).rows; await db.flush(tq, db.snapshot(norm(h.before)), norm(h.after)); });
      const after = await loadClean(q);
      ops++;
      if (!same(after, norm(h.after))) { console.log('✗ after-state mismatch at', h.fn); showDiff(after, norm(h.after)); bad++; break; }
    }
    console.log(`${label}: ${ops} transactions replayed into Postgres, ${bad ? 'FAILED' : 'all identical ✓'}`);
    return bad;
  };
  const a = await runOne(HIST.slice(0, n1), 'test.js');
  const b = HIST.length > n1 ? await runOne(HIST.slice(n1), 'sim.js') : 0;
  process.exit(a + b ? 1 : 0);
})();
function norm(t) { const o = {}; Object.keys(db.TABLES).forEach((k) => { o[k] = (t[k] || []).map((r) => { const x = { _row: r._row }; Object.keys(db.TABLES[k].cols).forEach((c) => { x[c] = r[c] == null ? '' : String(r[c]); }); return x; }); }); return o; }
async function loadClean(q) { return norm(await db.loadAll(q)); }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function showDiff(a, b) { Object.keys(a).forEach((k) => { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) { console.log('table', k); const A = a[k], B = b[k]; for (let i = 0; i < Math.max(A.length, B.length); i++) if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) { console.log(' pg :', JSON.stringify(A[i])); console.log(' mem:', JSON.stringify(B[i])); break; } } }); }
