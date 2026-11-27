#!/usr/bin/env node
// Regenerates art/tokens/tokens.css and art/js/tokens.js from art/tokens/tokens.json.
// Usage: node art/tools/build-tokens.mjs
// Plain Node, no dependencies.

import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const src = new URL('tokens/tokens.json', root);
const t = JSON.parse(readFileSync(src, 'utf8'));

const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
const banner = (what) =>
  `/* ${what}\n * GENERATED from art/tokens/tokens.json by art/tools/build-tokens.mjs. Do not edit by hand.\n * Style: ${t.meta.style} · v${t.meta.version}\n */\n`;

// ---------------------------------------------------------------- CSS
const css = [];
css.push(banner('Cthulhoo design tokens (CSS custom properties)'));

// Register the zone colours so a change of data-zone can be transitioned smoothly.
const colourKeys = Object.keys(t.zones[0].ui);
const surface = t.zones[0];
for (const k of [...colourKeys, 'water', 'fog']) {
  const initial = k === 'water' || k === 'fog' ? t.depthStops[0][k] : surface.ui[k];
  css.push(`@property --color-${kebab(k)} { syntax: '<color>'; inherits: true; initial-value: ${initial}; }`);
}
css.push('');

css.push(':root {');
css.push('  /* Type families. Fonts are self-hosted in art/fonts (see art/css/fonts.css). */');
for (const [k, v] of Object.entries(t.type.families)) css.push(`  --font-${kebab(k)}: ${v};`);
css.push('');
css.push('  /* Fluid type scale: --step-0 is body text. */');
for (const [k, v] of Object.entries(t.type.scale).sort((a, b) => Number(a[0]) - Number(b[0]))) css.push(`  --step-${k}: ${v};`);
for (const [k, v] of Object.entries(t.type.leading)) css.push(`  --leading-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(t.type.tracking)) css.push(`  --tracking-${kebab(k)}: ${v};`);
css.push('');
css.push('  /* Space, radius, rules */');
for (const [k, v] of Object.entries(t.space)) css.push(`  --space-${k}: ${v};`);
for (const [k, v] of Object.entries(t.radius)) css.push(`  --radius-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(t.rule)) css.push(`  --rule-${kebab(k)}: ${v};`);
css.push('');
css.push('  /* Motion. Nothing bounces in deep water: no overshoot easings. */');
for (const [k, v] of Object.entries(t.motion.ease)) css.push(`  --ease-${kebab(k)}: ${v};`);
for (const [k, v] of Object.entries(t.motion.duration)) css.push(`  --dur-${kebab(k)}: ${v};`);
css.push('');
css.push('  /* Layers */');
for (const [k, v] of Object.entries(t.z)) css.push(`  --z-${kebab(k)}: ${v};`);
css.push('');
css.push('  /* Live depth, written by depth.js applyDepth(): 0 at the surface, 1 at the floor. */');
css.push('  --depth: 0;');
css.push(`  --depth-m: 0;`);
css.push('');
css.push('  /* Rarity tiers on dark water (re-mapped for paper inside the Shallows). */');
for (const tier of t.tiers) css.push(`  --color-tier-${tier.n}: ${tier.onDark};`);
css.push('');
css.push('  /* Default theme = the Shallows. */');
for (const [k, v] of Object.entries(surface.ui)) css.push(`  --color-${kebab(k)}: ${v};`);
css.push(`  --color-water: ${t.depthStops[0].water};`);
css.push(`  --color-fog: ${t.depthStops[0].fog};`);
css.push('  color-scheme: light;');
css.push('}');
css.push('');

const stopAt = (d) => {
  // the stop at (or just below) depth d
  let s = t.depthStops[0];
  for (const st of t.depthStops) if (st.depth <= d) s = st;
  return s;
};

for (const z of t.zones) {
  css.push(`/* ${z.name} · ${z.from}–${z.to} m · ${z.subtitle} */`);
  css.push(`[data-zone="${z.key}"] {`);
  for (const [k, v] of Object.entries(z.ui)) css.push(`  --color-${kebab(k)}: ${v};`);
  const st = stopAt(z.from);
  css.push(`  --color-water: ${st.water};`);
  css.push(`  --color-fog: ${st.fog};`);
  if (z.scheme === 'paper') {
    for (const tier of t.tiers) css.push(`  --color-tier-${tier.n}: ${tier.onPaper};`);
  } else {
    for (const tier of t.tiers) css.push(`  --color-tier-${tier.n}: ${tier.onDark};`);
  }
  css.push(`  color-scheme: ${z.scheme === 'paper' ? 'light' : 'dark'};`);
  css.push('}');
  css.push('');
}

css.push('/* Derived tokens. Declared on every themed element so they follow its zone. */');
css.push(':root, [data-zone] {');
css.push('  --color-ink-faint: color-mix(in oklab, var(--color-ink) 38%, transparent);');
css.push('  --color-rule-soft: color-mix(in oklab, var(--color-rule) 55%, transparent);');
css.push('  --color-plate-veil: color-mix(in oklab, var(--color-plate) 82%, transparent);');
css.push('  --color-glow-soft: color-mix(in oklab, var(--color-glow) 34%, transparent);');
css.push('  --color-glow-faint: color-mix(in oklab, var(--color-glow) 14%, transparent);');
css.push('  --color-accent-soft: color-mix(in oklab, var(--color-accent) 34%, transparent);');
css.push('  --shadow-plate: 0 1px 0 var(--color-rule-soft), 0 18px 40px -24px color-mix(in oklab, var(--color-water) 80%, black);');
css.push('  --glow-line: 0 0 6px var(--color-glow-soft), 0 0 22px var(--color-glow-faint);');
css.push('}');
css.push('');
css.push('/* Zone changes ink-wash across the page instead of snapping. */');
css.push('[data-zone] {');
css.push('  transition-property: ' + [...colourKeys, 'water', 'fog'].map((k) => `--color-${kebab(k)}`).join(', ') + ';');
css.push('  transition-duration: var(--dur-ink);');
css.push('  transition-timing-function: var(--ease-descent);');
css.push('}');
css.push('@media (prefers-reduced-motion: reduce) {');
css.push('  [data-zone] { transition-duration: 1ms; }');
css.push('}');
css.push('');

writeFileSync(new URL('tokens/tokens.css', root), css.join('\n'));

// ---------------------------------------------------------------- JS module
const js = [];
js.push(banner('Cthulhoo design tokens (ES module)').replace(/^\/\*/, '/**'));
js.push(`export const META = ${JSON.stringify(t.meta, null, 2)};`);
js.push(`export const ZONES = ${JSON.stringify(t.zones, null, 2)};`);
js.push(`export const FLOOR = ${JSON.stringify(t.floor, null, 2)};`);
js.push(`export const DEPTH_STOPS = ${JSON.stringify(t.depthStops, null, 2)};`);
js.push(`export const INTERPOLATION = ${JSON.stringify(t.interpolation, null, 2)};`);
js.push(`export const TIERS = ${JSON.stringify(t.tiers, null, 2)};`);
js.push(`export const REFUSED = ${JSON.stringify(t.refused, null, 2)};`);
js.push(`export const TYPE = ${JSON.stringify(t.type, null, 2)};`);
js.push(`export const MOTION = ${JSON.stringify(t.motion, null, 2)};`);
js.push('export default { META, ZONES, FLOOR, DEPTH_STOPS, INTERPOLATION, TIERS, REFUSED, TYPE, MOTION };');
js.push('');
writeFileSync(new URL('js/tokens.js', root), js.join('\n'));

console.log('Wrote art/tokens/tokens.css and art/js/tokens.js');
