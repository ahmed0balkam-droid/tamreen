// ---- database layer: load every table into memory, run the logic, write back only what changed ----
// Works with any driver that offers q(text, params) -> rows inside one transaction.

const TABLES = {
  settings:      { table: 'settings',      cols: { key: 'text', value: 'text' } },
  sessions:      { table: 'sessions',      cols: { id: 'text', date: 'date', start: 'text', end: 'text', lock: 'text', pitch: 'text', map: 'text', fee: 'numeric', seed: 'integer', published: 'smallint', created_at: 'bigint' } },
  players:       { table: 'players',       cols: { id: 'text', name: 'text', pos: 'text', created_at: 'bigint' } },
  regs:          { table: 'registrations', cols: { id: 'text', session_id: 'text', player_id: 'text', pos: 'text', created_at: 'bigint', status: 'text', reason: 'text', removed_at: 'bigint', device: 'text', by_admin: 'smallint' } },
  bib:           { table: 'bib_draws',     cols: { id: 'text', session_id: 'text', n: 'integer', team: 'text', at: 'bigint' } },
  matches:       { table: 'matches',       cols: { session_id: 'text', sa: 'integer', sb: 'integer', saved_at: 'bigint' } },
  match_players: { table: 'match_players', cols: { session_id: 'text', player_id: 'text', team: 'text', goals: 'integer', assists: 'integer' } },
  votes:         { table: 'votes',         cols: { id: 'text', session_id: 'text', device: 'text', category: 'text', player_id: 'text', at: 'bigint' } }
};
const qi = (s) => '"' + s + '"';

// one round trip: every table as JSON, every value as text ('' for null) — exactly what the sheet code expects
function loadSql() {
  const parts = Object.keys(TABLES).map((k) => {
    const d = TABLES[k];
    const fields = ["'_row', seq"].concat(Object.keys(d.cols).map((c) => `'${c}', coalesce(${qi(c)}::text, '')`));
    return `'${k}', (select coalesce(json_agg(json_build_object(${fields.join(', ')}) order by seq), '[]'::json) from ${qi(d.table)})`;
  });
  return `select json_build_object(${parts.join(', ')}) as db`;
}

async function loadAll(q) {
  const rows = await q(loadSql(), []);
  let db = rows[0].db;
  if (typeof db === 'string') db = JSON.parse(db);
  const tables = {};
  Object.keys(TABLES).forEach((k) => {
    tables[k] = (db[k] || []).map((r) => { const o = { _row: Number(r._row) }; Object.keys(TABLES[k].cols).forEach((c) => { o[c] = r[c] == null ? '' : String(r[c]); }); return o; });
  });
  return tables;
}

function snapshot(tables) {
  const s = {};
  Object.keys(tables).forEach((k) => { s[k] = new Map(tables[k].map((r) => [r._row, JSON.stringify(r)])); });
  return s;
}

// compare the tables after the logic ran with the snapshot taken at load time
function diff(snap, tables) {
  const del = [], up = [];
  Object.keys(TABLES).forEach((k) => {
    const before = snap[k] || new Map(), now = new Map((tables[k] || []).map((r) => [r._row, r]));
    before.forEach((_, row) => { if (!now.has(row)) del.push({ k, row }); });
    now.forEach((r, row) => { if (before.get(row) !== JSON.stringify(r)) up.push({ k, r }); });
  });
  return { del, up };
}

async function flush(q, snap, tables) {
  const { del, up } = diff(snap, tables);
  const byTable = {};
  del.forEach((d) => { (byTable[d.k] = byTable[d.k] || []).push(d.row); });
  for (const k of Object.keys(byTable)) await q(`delete from ${qi(TABLES[k].table)} where seq = any($1::bigint[])`, [byTable[k]]);
  for (const u of up) {
    const d = TABLES[u.k], cols = Object.keys(d.cols);
    const vals = [String(u.r._row)].concat(cols.map((c) => (u.r[c] === '' || u.r[c] == null ? null : String(u.r[c]))));
    const ph = ['$1::bigint'].concat(cols.map((c, i) => `$${i + 2}::${d.cols[c]}`));
    await q(`insert into ${qi(d.table)} (seq, ${cols.map(qi).join(', ')}) values (${ph.join(', ')})
             on conflict (seq) do update set ${cols.map((c) => `${qi(c)} = excluded.${qi(c)}`).join(', ')}`, vals);
  }
  return { deleted: del.length, written: up.length };
}

const READ_ONLY = ['getState'];

// run one API call: lock, load, run, write back — all in one transaction
async function runCall(tx, createCore, fn, arg) {
  const res = await tx(async (q) => {
    await q('select pg_advisory_xact_lock(7777)', []);
    const tables = await loadAll(q);
    const snap = snapshot(tables);
    const TX = { tables, seq: {}, log: [], writing: false };
    const core = createCore(TX);
    if (!core.api[fn]) return { err: new Error('unknown function') };
    try {
      const out = core.api[fn](arg || {});
      if (TX.writing || READ_ONLY.indexOf(fn) < 0) await flush(q, snap, TX.tables);
      return { out };
    } catch (e) {
      // a failed action changes nothing, except the wrong-PIN counter
      if (TX.persistOnError) await flush(q, snap, TX.tables);
      return { err: e };
    }
  });
  if (res.err) throw res.err;
  return res.out;
}

// ---- one-time import from the Google Sheet (CSV export of every tab). Only works on an empty database. ----
const SHEET_TABS = { settings: 'Settings', sessions: 'Sessions', players: 'Players', regs: 'Registrations', bib: 'BibDraws', matches: 'Matches', match_players: 'MatchPlayers', votes: 'Votes' };
function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}
function sheetsToTables(csv) {
  const tables = {};
  Object.keys(SHEET_TABS).forEach((k) => {
    const text = csv[SHEET_TABS[k]];
    if (typeof text !== 'string') throw new Error('ناقص تبويب ' + SHEET_TABS[k]);
    const rows = parseCsv(text), head = rows.shift() || [], cols = Object.keys(TABLES[k].cols);
    cols.forEach((c) => { if (head.indexOf(c) < 0) throw new Error('عمود ناقص ' + c + ' في ' + SHEET_TABS[k]); });
    tables[k] = rows.filter((r) => String(r[0] || '').trim() !== '').map((r, i) => {
      const o = { _row: i + 2 };                                   // same number as the sheet row
      cols.forEach((c) => { o[c] = String(r[head.indexOf(c)] ?? ''); });
      return o;
    });
  });
  return tables;
}
async function importSheets(tx, csv) {
  return tx(async (q) => {
    await q('select pg_advisory_xact_lock(7777)', []);
    const cur = await loadAll(q);
    if (Object.keys(cur).some((k) => cur[k].length)) throw new Error('قاعدة البيانات فيها بيانات، النقل يصير مرة وحدة بس.');
    const tables = sheetsToTables(csv);
    const empty = snapshot(Object.fromEntries(Object.keys(TABLES).map((k) => [k, []])));
    await flush(q, empty, tables);
    return Object.fromEntries(Object.keys(tables).map((k) => [k, tables[k].length]));
  });
}

if (typeof module !== 'undefined') module.exports = { TABLES, loadAll, flush, diff, snapshot, runCall, loadSql, parseCsv, sheetsToTables, importSheets };
