// Depth palette for the shader. Colours come from the art kit (art/js/depth.js,
// paletteAt in OKLCH with the art thread's depth stops); this file only derives
// the extra shades the engraving needs (paper, ink, glowing line colour).

import { paletteAt as artPaletteAt } from '../../art/js/depth.js';

export type RGB = [number, number, number];

export interface Palette {
  paper: RGB; // bone paper of the surface plate
  ink: RGB; // ink of the surface plate
  ground: RGB; // the water of the deep plate
  line: RGB; // the glowing engraved lines in the deep
  glow: RGB; // bioluminescence, glyphs on stone
  accent: RGB; // lures, danger, the iris of the eye
  fog: RGB; // haze tint
  iris: RGB;
}

interface ArtPalette {
  rgb: { water: RGB; fog: RGB; glow: RGB; accent: RGB };
}

export function hex(h: string): RGB {
  const s = h.replace('#', '');
  const n = parseInt(s.length === 3 ? s.replace(/./g, (c) => c + c) : s, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const mixRGB = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const PAPER = hex('#e7ddc6');
const INK = hex('#1d1813');
const scratch = { rgb: {}, lin: {} };

export function paletteAt(depth: number): Palette {
  const a = artPaletteAt(Math.max(0, depth), scratch) as ArtPalette;
  const { water, fog, glow, accent } = a.rgb;
  return {
    paper: mixRGB(PAPER, fog, 0.35),
    ink: INK,
    ground: [water[0] * 0.55, water[1] * 0.55, water[2] * 0.55],
    line: mixRGB(glow, fog, 0.3),
    glow: [...glow] as RGB,
    accent: [...accent] as RGB,
    fog: [...fog] as RGB,
    iris: [...accent] as RGB,
  };
}

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** How far the plate has inverted from ink-on-paper to glowing lines (art kit's curve). */
export const invertAt = (depth: number): number => smoothstep(110, 340, depth);

/** How far the great Eye has opened at a depth (art kit: from 6,650 m). */
export const eyeAt = (depth: number): number => Math.max(0, Math.min(1, (depth - 6650) / 350));

export function cssColor(c: RGB, a = 1): string {
  const [r, g, b] = c.map((v) => Math.round(v * 255));
  return a >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${a})`;
}
