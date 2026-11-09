// Test stand-in: runs the Postgres-version core in memory with transaction semantics (commit / rollback)
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const HIST = [];   // committed (before, after) table snapshots — replayed into a real Postgres by replay.js

function makeEnv() {
  const src = fs.readFileSync(path.join(__dirname, '../dist/core_factory.js'), 'utf8').replace('module.exports = { createCore };', '');
  const sandbox = { console, Intl, crypto: require('crypto').webcrypto, JSON, Math };
  sandbox.crypto.randomUUID = require('crypto').randomUUID;
  vm.createContext(sandbox);
  if (process.env.SHIFT_MS) vm.runInContext('(function(S){var RD=Date,rn=RD.now;Date=function(){var a=[].slice.call(arguments);return a.length?new (Function.prototype.bind.apply(RD,[null].concat(a)))():new RD(rn()+S)};Date.now=function(){return rn()+S};Date.UTC=RD.UTC;Date.parse=RD.parse;Date.prototype=RD.prototype;})(' + Number(process.env.SHIFT_MS) + ')', sandbox);
  vm.runInContext('"use strict";\n' + src + '\nthis.createCore = createCore;', sandbox);
  let tables = {};
  const clone = (t) => JSON.parse(JSON.stringify(t));
  const ctx = {};
  const probe = sandbox.createCore({ tables: {}, seq: {}, log: [] });
  Object.keys(probe.api).forEach((fn) => {
    ctx[fn] = (arg) => {
      const before = clone(tables);
      const TX = { tables: clone(tables), seq: {}, log: [], writing: false };
      const core = sandbox.createCore(TX);
      try {
        const out = core.api[fn](arg || {});
        if (TX.writing || fn !== 'getState') { tables = TX.tables; HIST.push({ fn, before, after: clone(tables) }); }
        return JSON.parse(JSON.stringify(out));
      } catch (e) {
        if (TX.persistOnError) { tables = TX.tables; HIST.push({ fn, before, after: clone(tables) }); }
        throw e;
      }
    };
  });
  ctx.fair100_ = () => probe.fair100_();
  ctx.setting_ = (k) => { const r = (tables.settings || []).find((x) => x.key === k); return r ? r.value : ''; };
  const cache = { delete: (k) => { if (k === 'pinfail') { const before = clone(tables); tables.settings = (tables.settings || []).filter((x) => x.key !== 'pinfail'); HIST.push({ fn: 'resetPinfail', before, after: clone(tables) }); } } };
  return { ctx, cache, tables: () => tables };
}
module.exports = { makeEnv, HIST };
