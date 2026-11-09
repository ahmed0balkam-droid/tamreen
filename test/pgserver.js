// Local stand-in for the Supabase Edge Function: same runCall + core, real Postgres (PGlite), HTTP on :PORT.
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
const { PGlite } = require('@electric-sql/pglite');
const { runCall } = require('../src/db.js');
async function start(port, opts = {}) {
  const pg = new PGlite();
  await pg.exec(fs.readFileSync(path.join(__dirname, '../src/schema.sql'), 'utf8'));
  const src = fs.readFileSync(path.join(__dirname, '../dist/core_factory.js'), 'utf8').replace('module.exports = { createCore };', '');
  const sb = { console, Intl, crypto: { randomUUID: require('crypto').randomUUID }, JSON, Math };
  vm.createContext(sb);
  if (process.env.SHIFT_MS) vm.runInContext('(function(S){var RD=Date,rn=RD.now;Date=function(){var a=[].slice.call(arguments);return a.length?new (Function.prototype.bind.apply(RD,[null].concat(a)))():new RD(rn()+S)};Date.now=function(){return rn()+S};Date.UTC=RD.UTC;Date.parse=RD.parse;Date.prototype=RD.prototype;})(' + Number(process.env.SHIFT_MS) + ')', sb);
  vm.runInContext('"use strict";\n' + src + '\nthis.createCore = createCore;', sb);
  // PGlite runs one transaction at a time; queue them like the advisory lock would
  let chain = Promise.resolve();
  const tx = (fn) => { const p = chain.then(() => pg.transaction(async (t) => fn(async (s, prm) => (await t.query(s, prm)).rows))); chain = p.catch(() => {}); return p; };
  const call = (fn, arg) => runCall(tx, sb.createCore, fn, arg);
  const srv = http.createServer(async (req, res) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
    if (req.method === 'OPTIONS') { res.writeHead(200, cors); return res.end('ok'); }
    if (req.method === 'GET' && /[?&]photo=/.test(req.url)) {
      const pid = new URL(req.url, 'http://x').searchParams.get('photo');
      const ph = await tx((q) => require('../src/db.js').getPhoto(q, pid));
      if (!ph) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': ph.mime, 'Cache-Control': 'public, max-age=31536000' }); return res.end(Buffer.from(ph.b64, 'base64'));
    }
    if (req.method === 'GET' && opts.static) {           // serve the PWA files too
      const f = path.join(opts.static, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        const ct = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' }[path.extname(f)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': ct }); return res.end(fs.readFileSync(f));
      }
      res.writeHead(404); return res.end();
    }
    let body = ''; req.on('data', (c) => (body += c)); await new Promise((r) => req.on('end', r));
    let j; try { j = JSON.parse(body); } catch { res.writeHead(400, cors); return res.end('{}'); }
    try {
      if (opts.delay) await new Promise((r) => setTimeout(r, opts.delay));
      const data = await call(j.fn, j.arg || {});
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ data }));
    } catch (e) {
      const user = /[؀-ۿ]/.test(e.message);
      if (!user) console.error('server error', j.fn, e);
      res.writeHead(user ? 200 : 500, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: user ? e.message : 'صار خطأ في الخادم، حاول مرة ثانية.' }));
    }
  });
  await new Promise((r) => srv.listen(port, r));
  return { srv, pg, call, close: () => new Promise((r) => srv.close(r)) };
}
module.exports = { start };
if (require.main === module) start(Number(process.env.PORT || 8787), { static: process.env.STATIC }).then(() => console.log('listening'));
