const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  await p.goto('file://' + __dirname + '/icon.html');
  const out = __dirname + '/../docs/icons/';
  const shot = async (size, name, opts = {}) => {
    await p.evaluate(({ size, opts }) => {
      const s = document.getElementById('s'); s.setAttribute('width', size); s.setAttribute('height', size);
      document.getElementById('bg').setAttribute('rx', opts.square ? 0 : 112);
      document.getElementById('art').setAttribute('transform', opts.pad ? 'translate(51.2 51.2) scale(.8)' : '');
    }, { size, opts });
    await (await p.$('#s')).screenshot({ path: out + name, omitBackground: true });
  };
  await shot(192, 'icon-192.png'); await shot(512, 'icon-512.png');
  await shot(512, 'maskable-512.png', { square: true, pad: true });
  await shot(180, 'apple-touch-icon.png', { square: true });
  await b.close(); console.log('icons ok');
})();
