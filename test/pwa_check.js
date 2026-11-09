const { chromium, devices } = require('playwright');
const path = require('path');
const { start } = require('./pgserver');
(async () => {
  const S = await start(8791, { static: path.join(__dirname, '../docs') });
  await S.call('setup', {});
  const b = await chromium.launch();
  const c = await b.newContext({ ...devices['iPhone 13'] });
  const p = await c.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**/config.js', (r) => r.fulfill({ contentType: 'text/javascript', body: 'window.TAMREEN_CONFIG={api:"/api"};' }));  // local server, not production
  await p.goto('http://localhost:8791/'); await p.waitForSelector('#app:not([hidden])');
  console.log('install hint:', await p.textContent('#installBox'));
  await p.screenshot({ path: path.join(__dirname, 'shots/pwa_iphone.png') });
  const man = await (await p.request.get('http://localhost:8791/manifest.webmanifest')).json();
  console.log('manifest:', man.name, man.display, man.icons.length, 'icons');
  await p.click('#installBox .no'); await p.reload(); await p.waitForSelector('#app:not([hidden])');
  console.log('hidden after dismiss:', await p.isHidden('#installBox'));
  console.log('appUrl fallback:', await p.evaluate(() => S && S.appUrl));
  console.log('errors', errs); await b.close(); await S.close(); process.exit(0);
})();
