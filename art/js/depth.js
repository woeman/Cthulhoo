/**
 * depth.js — the one place that knows how colour and mood change with depth.
 *
 *   import { paletteAt, zoneForDepth, applyDepth } from '../art/js/depth.js';
 *
 *   const p = paletteAt(4312);
 *   p.water      // '#050c15'  (hex strings)
 *   p.rgb.glow   // [0.71, 0.92, 0.40]  (0..1 sRGB, ready for a vec3 uniform)
 *   p.lin.glow   // same colour in linear RGB, if your shader works in linear light
 *   p.zone.name  // 'The Cyclopean Abyss'
 *
 *   applyDepth(document.documentElement, 4312);  // sets data-zone and --depth vars
 *
 * Plain ES module, no dependencies. Colours interpolate in OKLCH with a smoothstep
 * ease and a "murk dip": between zones the light dies before the next light appears.
 */
import { ZONES, FLOOR, DEPTH_STOPS, INTERPOLATION, TIERS, REFUSED } from './tokens.js';

export { ZONES, FLOOR, DEPTH_STOPS, TIERS, REFUSED };
export const MAX_DEPTH = FLOOR.depth;
const KEYS = ['water', 'fog', 'glow', 'accent'];

/* ------------------------------------------------------------------ colour maths */

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex(rgb) {
  return '#' + rgb.map((v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0')).join('');
}

function rgbToOklab([r, g, b]) {
  r = toLinear(r); g = toLinear(g); b = toLinear(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    clamp01(toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)),
    clamp01(toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)),
    clamp01(toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)),
  ];
}

export function hexToOklch(hex) {
  const [L, a, b] = rgbToOklab(hexToRgb(hex));
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
}

export function oklchToRgb([L, C, H]) {
  const h = (H * Math.PI) / 180;
  return oklabToRgb([L, C * Math.cos(h), C * Math.sin(h)]);
}

/** Mix two colours in OKLCH (shorter hue). `dip` (0..1) sinks chroma mid-way. */
export function mixOklch(a, b, t, dip = 0) {
  const A = typeof a === 'string' ? hexToOklch(a) : a;
  const B = typeof b === 'string' ? hexToOklch(b) : b;
  let [L1, C1, H1] = A;
  let [L2, C2, H2] = B;
  if (C1 < 0.02) H1 = H2; // greys have no meaningful hue
  if (C2 < 0.02) H2 = H1;
  const dh = ((H2 - H1 + 540) % 360) - 180;
  const d = dip * Math.min(1, Math.abs(dh) / 60);
  const C = (C1 + (C2 - C1) * t) * (1 - d * 4 * t * (1 - t));
  return oklchToRgb([L1 + (L2 - L1) * t, C, H1 + dh * t]);
}

/* ------------------------------------------------------------------ depth → zone */

const clampDepth = (m) => (m < 0 ? 0 : m > MAX_DEPTH ? MAX_DEPTH : m);

/** The zone object for a depth in metres. 7,000 m and beyond is the floor of the last zone. */
export function zoneForDepth(m) {
  const d = clampDepth(m);
  for (let i = 0; i < ZONES.length; i++) {
    if (d < ZONES[i].to) return { ...ZONES[i], index: i, atFloor: false };
  }
  const last = ZONES.length - 1;
  return { ...ZONES[last], index: last, atFloor: true };
}

/** 0..1 across the whole descent. */
export const depthProgress = (m) => clampDepth(m) / MAX_DEPTH;

/** 0..1 within the current zone. */
export function zoneProgress(m) {
  const z = zoneForDepth(m);
  return (clampDepth(m) - z.from) / (z.to - z.from);
}

/* ------------------------------------------------------------------ depth → palette */

// Pre-convert stops once.
const STOPS = DEPTH_STOPS.map((s) => ({
  depth: s.depth,
  lch: Object.fromEntries(KEYS.map((k) => [k, hexToOklch(s[k])])),
}));
const DIP = INTERPOLATION.chromaDip || {};
const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Colours of the sea at a depth. Returns hex, sRGB (0..1) and linear RGB (0..1).
 * Pass `out` to reuse an object every frame (no allocations in a render loop).
 */
export function paletteAt(m, out) {
  const d = clampDepth(m);
  let i = 0;
  while (i < STOPS.length - 2 && d > STOPS[i + 1].depth) i++;
  const a = STOPS[i];
  const b = STOPS[i + 1];
  const t = smooth(clamp01((d - a.depth) / (b.depth - a.depth || 1)));
  const o = out || { rgb: {}, lin: {} };
  o.depth = d;
  o.progress = d / MAX_DEPTH;
  o.zone = zoneForDepth(d);
  for (const k of KEYS) {
    const rgb = mixOklch(a.lch[k], b.lch[k], t, DIP[k] || 0);
    o.rgb[k] = rgb;
    o.lin[k] = rgb.map(toLinear);
    o[k] = rgbToHex(rgb);
  }
  return o;
}

/**
 * Pearl iridescence for the Unspeakable tier and the Drowned City.
 * `time` in seconds; returns sRGB 0..1. Slow (one cycle per breath, 7 s).
 */
export function pearlAt(time, phase = 0) {
  const h = (((time / 7 + phase) % 1) + 1) % 1;
  return oklchToRgb([0.9, 0.07, 300 + 120 * Math.sin(h * Math.PI * 2)]);
}

/* ------------------------------------------------------------------ DOM */

/**
 * Write depth onto an element: data-zone (discrete UI theme) plus continuous
 * custom properties for effects that want to follow the exact depth:
 *   --depth (0..1)  --depth-m (metres)  --zone-progress (0..1)
 *   --live-water  --live-fog  --live-glow  --live-accent
 */
export function applyDepth(el, m, opts = {}) {
  const p = paletteAt(m);
  const s = el.style;
  if (opts.zone !== false && el.dataset.zone !== p.zone.key) el.dataset.zone = p.zone.key;
  el.toggleAttribute('data-floor', p.zone.atFloor);
  s.setProperty('--depth', p.progress.toFixed(4));
  s.setProperty('--depth-m', String(Math.round(p.depth)));
  s.setProperty('--zone-progress', zoneProgress(m).toFixed(4));
  for (const k of KEYS) s.setProperty(`--live-${k}`, p[k]);
  return p;
}

/* ------------------------------------------------------------------ tiers & readouts */

/** Colour of a rarity tier (1..6) on 'dark' water or on 'paper'. */
export function tierColor(n, scheme = 'dark') {
  const tier = TIERS[Math.max(1, Math.min(6, n)) - 1];
  return scheme === 'paper' ? tier.onPaper : tier.onDark;
}

/** "4,312 m". Uses a thin no-break space before the unit. */
export function formatDepth(m, { unit = 'm', locale = 'en-GB' } = {}) {
  const v = unit === 'fathoms' ? m / 1.8288 : m;
  return `${Math.round(v).toLocaleString(locale)} ${unit === 'fathoms' ? 'fathoms' : 'm'}`;
}

/** Water pressure in atmospheres, for log flavour text ("433 atm"). */
export const pressureAt = (m) => 1 + clampDepth(m) / 10.06;

/** Rough water temperature in °C, for log flavour text. */
export function temperatureAt(m) {
  const d = clampDepth(m);
  if (d < 200) return 15 - (d / 200) * 5;
  if (d < 1000) return 10 - ((d - 200) / 800) * 6;
  return 4 - Math.min(1, (d - 1000) / 6000) * 2.6;
}
