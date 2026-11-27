# Cthulhoo art kit

Everything the game needs to look like Cthulhoo. The reasons behind it are in the
[style bible](../docs/art/README.md); this page is the practical guide.

Nothing here needs a build step to use: plain CSS, plain ES modules, SVG and PNG.

```
art/
  tokens/     tokens.json (the source of truth), tokens.css, and js/tokens.js generated from it
  js/         depth.js (colour at any depth), madness.js (text that goes wrong), tokens.js
  css/        fonts.css, base.css (page defaults), components.css (plates, buttons, tags, gauge…)
  fonts/      IM Fell English (+ SC), EB Garamond, Special Elite, with their licences
  logo/       wordmark, lockup, mark, app icon (plus maskable and monochrome ones), favicon; png/ with the icon PNGs
  glyphs/     rarity seals tier-1…6 + refused, marks (ward, milestone, diver), the Drowned Script (script/), and sprites
  icons/      24 interface icons and sprite.svg
  bestiary/   24 specimen plates (plates/), their silhouettes (silhouettes/), two sprites, bestiary.json
  seance/     the séance table for party mode, and its sprite
  textures/   paper, foxing, film grain, murk, hatch tiles; silhouettes/ (SVG) and silhouettes/png/
  tools/      the scripts that generate all of the above
```

## Use it in a page

```html
<link rel="stylesheet" href="/art/css/fonts.css">
<link rel="stylesheet" href="/art/tokens/tokens.css">
<link rel="stylesheet" href="/art/css/base.css">
<link rel="stylesheet" href="/art/css/components.css">

<script type="module">
  import { applyDepth } from '/art/js/depth.js';
  applyDepth(document.documentElement, 4312);   // the whole page is now in the Cthulhoo Abyss
</script>
```

Paths inside the CSS are relative (for example `../textures/paper-grain.png`), so keep the
folder structure together, or let your bundler copy it.

## Tokens

[`tokens/tokens.json`](tokens/tokens.json) holds every colour, size and timing. Do not edit
`tokens.css` or `js/tokens.js` by hand; change the JSON and run:

```sh
node art/tools/build-tokens.mjs
```

CSS variables you will use most: `--color-ground`, `--color-plate`, `--color-ink`,
`--color-ink-muted`, `--color-rule`, `--color-glow`, `--color-accent`, `--color-action`,
`--color-on-action`, `--color-refused`, `--color-focus`, `--color-tier-1` … `--color-tier-6`,
`--font-display`, `--font-display-caps`, `--font-text`, `--font-log`, `--step--2` … `--step-6`,
`--space-1` … `--space-9`, `--ease-surface`, `--ease-sink`, `--ease-descent`, `--ease-drift`,
`--dur-quick` … `--dur-breath`. Set `data-zone="surface" | "twilight" | "midnight" | "abyss" |
"hadal"` on any element to theme it and everything inside it.

## depth.js

```js
import {
  paletteAt, applyDepth, zoneForDepth, zoneProgress, depthProgress,
  tierColor, pearlAt, formatDepth, pressureAt, temperatureAt, mixOklch,
  ZONES, FLOOR, TIERS, REFUSED, MAX_DEPTH,
} from '/art/js/depth.js';

paletteAt(4312);
// → { depth, progress (0..1), zone: { key, name, … }, water, fog, glow, accent (hex),
//     rgb: { water: [r,g,b], … } (sRGB 0..1), lin: { … } (linear 0..1, for shaders) }
paletteAt(m, reuse);           // pass an object to reuse it every frame, no garbage
applyDepth(el, m);             // data-zone, data-floor, --depth, --depth-m, --zone-progress, --live-*
zoneForDepth(m);               // the zone object, with index and atFloor
tierColor(3, 'dark');          // '#58d3ea'   ('paper' for the surface version)
pearlAt(seconds, phase);       // [r,g,b] shimmer for the Unspeakable tier
formatDepth(4312);             // '4,312 m' (thin no-break space)
pressureAt(4312);              // ≈ 430 atm
temperatureAt(4312);           // ≈ 2.6 °C
```

## madness.js

```js
import { createMadness, madnessForDepth } from '/art/js/madness.js';
const mad = createMadness(headingElement, { level: 0, sprite: '/art/glyphs/script-sprite.svg' });
mad.set(madnessForDepth(depthInMetres));   // 0 until 2,500 m … 1 at 7,000 m
mad.pulse();                               // one sharp episode
mad.destroy();                             // restore the original markup
```

Short text only (headings, labels, log lines). Never the question, inputs, buttons or
numbers. Screen readers always get the original text; reduced motion stops all rewriting.

## Glyphs and icons

Use the sprites with `<use>`; everything is drawn in `currentColor`.

```html
<svg viewBox="0 0 32 32" width="40" height="40" style="color: var(--color-tier-5)">
  <use href="/art/glyphs/tiers-sprite.svg#tier-5"/>
</svg>
<svg viewBox="0 0 20 32" width="20" height="32"><use href="/art/glyphs/script-sprite.svg#g-eye"/></svg>
<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><use href="/art/icons/sprite.svg#i-share"/></svg>
```

Sprite ids: `tier-1` … `tier-6`, `refused` (tiers-sprite); `ward`, `ward-spent`, `milestone`, `diver`
(marks-sprite); `g-eye`, `g-coil`, `g-gate`, `g-sleeper`, `g-tide`,
`g-fang`, `g-anchor`, `g-talon`, `g-sounding`, `g-maw`, `g-root`, `g-veil`, `g-spire`, `g-knot`,
`g-hand`, `g-void`; `i-close`, `i-back`, `i-menu`, `i-descend`, `i-share`, `i-settings`, `i-info`,
`i-sound-on`, `i-sound-off`, `i-streak`, `i-daily`, `i-leaderboard`, `i-timer`, `i-stats`, `i-hint`,
`i-depth`, `i-help`, `i-check`, `i-career`, `i-drift`, `i-ward`, `i-riddle`, `i-seance`, `i-cult`;
`b-<id>` (bestiary-sprite) and `b-<id>-sil` (silhouettes-sprite) for the 24 creatures; `seance`,
`seance-hand`, `seance-candle`, `seance-flame`, `seance-porthole` (seance-sprite).

## App icons

`app-icon` is full bleed, for iOS and stores, which cut their own rounded corners.
`app-icon-maskable` keeps the portholes inside the middle 80 % circle, for Android launchers,
which cut circles and squircles. `app-icon-monochrome` is the same mark in white on transparent,
for Android's themed icons, which keep only its shape and paint it in the person's colours.
In the page and the web app manifest:

```html
<link rel="icon" href="/art/logo/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/art/logo/png/app-icon-180.png">
```

```json
"icons": [
  { "src": "/art/logo/png/app-icon-192.png", "sizes": "192x192", "type": "image/png" },
  { "src": "/art/logo/png/app-icon-512.png", "sizes": "512x512", "type": "image/png" },
  { "src": "/art/logo/png/app-icon-maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable" },
  { "src": "/art/logo/png/app-icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" },
  { "src": "/art/logo/png/app-icon-monochrome-512.png", "sizes": "512x512", "type": "image/png", "purpose": "monochrome" }
]
```

## Silhouettes for the renderer

`textures/silhouettes/*.svg` are filled with `currentColor`; `textures/silhouettes/png/*.png`
are the same shapes in white on transparent, at native size, ready to upload as alpha masks.
The city comes as one image and as `drowned-city-far.png` / `drowned-city-near.png` for
parallax; the Eye comes as five layers (`great-eye-lid`, `-folds`, `-iris`, `-pupil`, `-glint`).

## Bestiary and séance

```html
<svg viewBox="0 0 240 240" role="img" aria-label="Barreleye"><use href="/art/bestiary/bestiary-sprite.svg#b-barreleye"/></svg>
<svg viewBox="0 0 240 240" aria-hidden="true"><use href="/art/bestiary/silhouettes-sprite.svg#b-barreleye-sil"/></svg>
<svg viewBox="0 0 240 240" role="img" aria-label="A séance table: four of twelve chairs taken"><use href="/art/seance/seance-sprite.svg#seance"/></svg>
<svg width="34" height="57" aria-hidden="true" style="--seance-burn: 0.4"><use href="/art/seance/seance-sprite.svg#seance-candle"/></svg>
```

The plates are engravings, so they are heavier than the icons: the plates sprite is 646 KB
(168 KB gzipped). Load it only on the bestiary screen; for a single creature, fetch its file
from `bestiary/plates/` (27 KB on average). Names, zones and notes are in
`bestiary/bestiary.json`. Set `--beast-body` to the ground colour behind a plate; the full list
of custom properties is in [Creatures and glyphs](../docs/art/05-creatures-and-glyphs.md#the-bestiary)
and [Interface](../docs/art/06-interface.md#the-séance). The séance table has twelve seats, one
for each of the twelve marks, and its candle burns down as a question's timer
(`--seance-burn` from 0 to 1).

## Regenerating

Every asset is drawn by a script, from fixed random seeds, so the output is repeatable.

| What | Command | Needs |
|---|---|---|
| tokens.css, tokens.js | `node art/tools/build-tokens.mjs` | Node 18+ |
| logo and app icon (SVG) | `python3 art/tools/draw_logo.py` | Python 3, fontTools and brotli (it reads the IM Fell SC letter shapes from `fonts/`) |
| seals, marks and the Drowned Script | `python3 art/tools/draw_glyphs.py` | Python 3 |
| icons | `python3 art/tools/draw_icons.py` | Python 3 |
| silhouettes | `python3 art/tools/draw_silhouettes.py` | Python 3 |
| bestiary plates, silhouettes, sprites and bestiary.json | `python3 art/tools/draw_bestiary.py` | Python 3 (uses `bestiary_kit.py`) |
| the séance table | `python3 art/tools/draw_seance.py` | Python 3 (uses `bestiary_kit.py`) |
| paper, grain, murk, hatching | `python3 art/tools/make_textures.py` | Python 3, numpy, Pillow |
| all PNGs (app icon sizes, silhouette masks) | `node art/tools/render-pngs.cjs` | Node, Playwright with Chromium |

## Licences

The fonts are under the SIL Open Font License 1.1 (IM Fell English, EB Garamond) and the
Apache License 2.0 (Special Elite); their licence files are in `fonts/`. Everything else in this
folder was made for Cthulhoo.
