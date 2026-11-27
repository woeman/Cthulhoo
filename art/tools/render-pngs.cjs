/**
 * Renders the PNG versions of Cthulhoo's SVG art, for places that cannot use SVG
 * (app stores, home-screen icons, WebGL textures).
 *
 *   node art/tools/render-pngs.cjs
 *
 * Needs Playwright with Chromium (npm i -D playwright && npx playwright install chromium).
 * Outputs:
 *   art/logo/png/app-icon-{1024,512,192,180,48}.png    full bleed, no transparency
 *   art/textures/silhouettes/png/<name>.png             white on transparent, at native size,
 *                                                       for use as alpha masks in a shader
 *   art/textures/silhouettes/png/drowned-city-{far,near}.png   the two parallax layers apart
 *   art/textures/silhouettes/png/great-eye-{lid,folds,iris,pupil,glint}.png   the Eye's layers apart
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ART = path.resolve(__dirname, '..');
const SIL = path.join(ART, 'textures', 'silhouettes');

function sizeOf(svgText) {
  const vb = /viewBox="([\d.\s-]+)"/.exec(svgText);
  const [, , w, h] = vb[1].trim().split(/\s+/).map(Number);
  return { w, h };
}

async function renderSvg(page, svgText, out, { width, height, css = '', transparent = true }) {
  const html = `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    #wrap { width: ${width}px; height: ${height}px; color: #fff; }
    #wrap > svg { width: 100%; height: 100%; display: block; }
    ${css}
  </style><div id="wrap">${svgText}</div>`;
  await page.setViewportSize({ width: Math.ceil(width), height: Math.ceil(height) });
  await page.setContent(html, { waitUntil: 'load' });
  await page.locator('#wrap').screenshot({ path: out, omitBackground: transparent });
  console.log('wrote', path.relative(path.resolve(ART, '..'), out));
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  // App icon
  const iconDir = path.join(ART, 'logo', 'png');
  fs.mkdirSync(iconDir, { recursive: true });
  const icon = fs.readFileSync(path.join(ART, 'logo', 'app-icon.svg'), 'utf8');
  for (const n of [1024, 512, 192, 180, 48]) {
    await renderSvg(page, icon, path.join(iconDir, `app-icon-${n}.png`), { width: n, height: n, transparent: false });
  }

  // Silhouettes, white on transparent
  const pngDir = path.join(SIL, 'png');
  fs.mkdirSync(pngDir, { recursive: true });
  for (const file of fs.readdirSync(SIL).filter((f) => f.endsWith('.svg'))) {
    const svgText = fs.readFileSync(path.join(SIL, file), 'utf8');
    const { w, h } = sizeOf(svgText);
    const name = file.replace(/\.svg$/, '');
    if (name === 'great-eye') {
      for (const layer of ['lid', 'folds', 'iris', 'pupil', 'glint']) {
        await renderSvg(page, svgText, path.join(pngDir, `great-eye-${layer}.png`), {
          width: w, height: h,
          css: `#wrap svg > :not(#${layer}):not(defs):not(title):not(desc) { display: none; }
                #${layer}, #${layer} * { opacity: 1 !important; fill: #fff !important; }`,
        });
      }
      continue;
    }
    await renderSvg(page, svgText, path.join(pngDir, `${name}.png`), { width: w, height: h, css: '#wrap { --porthole: none; }' });
    if (name === 'drowned-city') {
      await renderSvg(page, svgText, path.join(pngDir, 'drowned-city-far.png'), { width: w, height: h, css: '#near { display: none; } #far { opacity: 1; }' });
      await renderSvg(page, svgText, path.join(pngDir, 'drowned-city-near.png'), { width: w, height: h, css: '#far { display: none; }' });
    }
  }
  await browser.close();
})();
