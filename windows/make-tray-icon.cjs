// Draws windows/Tray.ico sizes: Phosphor "hand-pointing" (fill, MIT license) in orange.
// Run from the repo root with Playwright available, then pack the PNGs with make-ico.py.
const { chromium } = require('/Users/lotus/Documents/github/proxylang-web/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright'); const fs = require('fs');
const path = 'M224,104v50.93c0,46.2-36.85,84.55-83,85.06A83.71,83.71,0,0,1,80.6,215.4C58.79,192.33,34.15,136,34.15,136a16,16,0,0,1,6.53-22.23c7.66-4,17.1-.84,21.4,6.62l21,36.44a6.09,6.09,0,0,0,6,3.09l.12,0A8.19,8.19,0,0,0,96,151.74V32a16,16,0,0,1,16.77-16c8.61.4,15.23,7.82,15.23,16.43V104a8,8,0,0,0,8.53,8,8.17,8.17,0,0,0,7.47-8.25V88a16,16,0,0,1,16.77-16c8.61.4,15.23,7.82,15.23,16.43V112a8,8,0,0,0,8.53,8,8.17,8.17,0,0,0,7.47-8.25v-7.28c0-8.61,6.62-16,15.23-16.43A16,16,0,0,1,224,104Z';
// Phosphor "hand-pointing" (fill), MIT license, turned 90 degrees to point right. Thin dark edge
// so it stays crisp on both the light and the dark Windows taskbar.
const svg = s => '<svg xmlns="http://www.w3.org/2000/svg" width="'+s+'" height="'+s+'" viewBox="10 10 236 236"><g transform="rotate(90 128 128)"><path d="'+path+'" fill="#F26B3A" stroke="#A8401C" stroke-width="10" stroke-linejoin="round" paint-order="stroke"/></g></svg>';
(async () => { const b = await chromium.launch();
  for (const s of [16, 20, 24, 32, 40, 48, 64, 256]) {
    const p = await b.newPage({ viewport: { width: s, height: s } });
    await p.setContent('<html><body style="margin:0;background:transparent">' + svg(s) + '</body></html>');
    await p.screenshot({ path: '/private/tmp/claude-501/-Users-lotus-Documents-github-WORKING-DOCS/dac764c6-5995-4014-8071-b74a06fff15b/scratchpad/tray/tray-' + s + '.png', omitBackground: true });
  }
  // Preview: real sizes on light and dark taskbar colors, then 8x zoom of the 20 px version.
  const p = await b.newPage({ viewport: { width: 520, height: 260 } });
  const img = s => '<img src="file:///private/tmp/claude-501/-Users-lotus-Documents-github-WORKING-DOCS/dac764c6-5995-4014-8071-b74a06fff15b/scratchpad/tray/tray-' + s + '.png" style="margin:6px">';
  await p.setContent('<html><body style="margin:0;font:12px sans-serif">' +
    '<div style="background:#f3f3f3;padding:10px">' + [16,20,24,32].map(img).join('') + ' light taskbar</div>' +
    '<div style="background:#202020;padding:10px;color:#fff">' + [16,20,24,32].map(img).join('') + ' dark taskbar</div>' +
    '<div style="padding:10px;background:#202020"><img src="file:///private/tmp/claude-501/-Users-lotus-Documents-github-WORKING-DOCS/dac764c6-5995-4014-8071-b74a06fff15b/scratchpad/tray/tray-20.png" style="width:160px;height:160px;image-rendering:pixelated"></div></body></html>');
  await p.waitForTimeout(300); await p.screenshot({ path: '/private/tmp/claude-501/-Users-lotus-Documents-github-WORKING-DOCS/dac764c6-5995-4014-8071-b74a06fff15b/scratchpad/tray/preview.png', fullPage: true });
  await b.close(); })();
