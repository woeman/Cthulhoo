// The art kit (art/), wired into the app.
//
// The sprites are inlined into the page once, so every <use href="#…"> works without
// another request: offline, inside the claude.ai preview, and on any host.

import tiersSprite from '../../art/glyphs/tiers-sprite.svg?raw';
import iconSprite from '../../art/icons/sprite.svg?raw';
import scriptSprite from '../../art/glyphs/script-sprite.svg?raw';
import marksSprite from '../../art/glyphs/marks-sprite.svg?raw';
import sigilsSprite from '../../art/glyphs/sigils-sprite.svg?raw';
import wordmarkSvg from '../../art/logo/wordmark.svg?raw';
import { createMadness, madnessForDepth } from '../../art/js/madness.js';

export type IconName =
  | 'close' | 'back' | 'menu' | 'descend' | 'share' | 'settings' | 'info' | 'sound-on' | 'sound-off'
  | 'streak' | 'daily' | 'leaderboard' | 'timer' | 'stats' | 'hint' | 'depth' | 'help' | 'check'
  | 'career' | 'drift' | 'ward' | 'riddle' | 'seance' | 'cult';

/** The career marks: the ward (a hag stone), a spent ward, the benchmark and the diver. */
export type MarkName = 'ward' | 'ward-spent' | 'milestone' | 'diver';

// Titles inside symbols turn into hover tooltips wherever a symbol is used; the app
// names every icon and seal itself.
const untitled = (svg: string) => svg.replace(/<title>[\s\S]*?<\/title>/g, '');

let installed = false;

/** Put the kit's sprites into the page. Call once, before the first screen. */
export function installArt(doc: Document = document): void {
  if (installed) return;
  installed = true;
  const holder = (id: string, markup: string) => {
    const el = doc.createElement('div');
    el.id = id;
    el.hidden = true;
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = markup;
    return el;
  };
  // madness.js looks for its Drowned Script sprite under this id, and fetches it otherwise.
  doc.body.prepend(holder('cth-sprites', untitled(tiersSprite) + untitled(iconSprite) + untitled(marksSprite) + untitled(sigilsSprite)), holder('cth-mad-sprite', scriptSprite));
}

/** An interface icon from the kit, as markup for a button. Decorative: label the button. */
export const icon = (name: IconName, cls = 'icon'): string =>
  `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${name}"/></svg>`;

/** A rarity seal (tier 1–6, or the closed eye for an answer the deep refused), as markup. */
export const sealSvg = (tier: number | 'refused', cls = 'seal'): string =>
  `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><use href="#${tier === 'refused' || tier < 1 ? 'refused' : `tier-${Math.min(6, tier)}`}"/></svg>`;

/** A career mark (ward, spent ward, benchmark, diver), as markup. Decorative: label it nearby. */
export const markSvg = (name: MarkName, cls = 'mark', attrs = ''): string =>
  `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true" focusable="false"${attrs ? ` ${attrs}` : ''}><use href="#${name}"/></svg>`;

/** The wordmark: CTHULHOO with the double O drawn as two porthole eyes. Inherits currentColor. */
export function wordmarkMarkup(cls = 'wordmark-art'): string {
  return wordmarkSvg
    .replace(/<title>[\s\S]*?<\/title>/, '')
    .replace(/<desc>[\s\S]*?<\/desc>/, '')
    .replace(/<svg([^>]*?)\swidth="[^"]*"\sheight="[^"]*"/, '<svg$1')
    .replace('<svg', `<svg class="${cls}" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet"`);
}

/** The wordmark as a self-contained SVG in one colour, for drawing onto a canvas. */
export function wordmarkImageSrc(color: string): string {
  const svg = wordmarkSvg.replace(/currentColor/g, color);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** One seal as a self-contained SVG in one colour, for drawing onto a canvas. */
export function sealImageSrc(tier: number | 'refused', color: string): string {
  const id = tier === 'refused' || tier < 1 ? 'refused' : `tier-${Math.min(6, tier)}`;
  const m = new RegExp(`<symbol id="${id}" viewBox="([^"]+)">([\\s\\S]*?)</symbol>`).exec(tiersSprite);
  const body = m ? untitled(m[2]).replace(/currentColor/g, color) : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${m ? m[1] : '0 0 32 32'}" width="128" height="128">${body}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---------------------------------------------------------------- madness

type Madness = ReturnType<typeof createMadness>;
const live = new Set<Madness>();

export { madnessForDepth };

/**
 * Let the deep get into a short label (a heading, a zone name, a tier name). Never the
 * question, the answer field, buttons or numbers. Does nothing above 2,500 m, where the
 * sea is still sane, unless `floor` (from a failing sanity) says otherwise. Screen
 * readers always get the real text.
 */
export function madden(el: HTMLElement, depth: number, reducedMotion = false, floor = 0): Madness | null {
  const level = Math.max(floor, madnessForDepth(depth));
  if (level <= 0 || reducedMotion) return null;
  const mad = createMadness(el, { level });
  live.add(mad);
  return mad;
}

/** Stop every madness effect (when a screen is replaced, so no timers outlive it). */
export function calmAll(): void {
  for (const mad of live) mad.destroy();
  live.clear();
}

/** Stop one madness effect and restore its text. */
export function calm(mad: Madness | null | undefined): void {
  if (!mad) return;
  mad.destroy();
  live.delete(mad);
}

/**
 * A label that lives on (like the HUD's zone name): its text and its madness level
 * change over time, and the effect is rebuilt whenever the text does.
 */
export class MadText {
  private mad: Madness | null = null;
  private level = 0;

  constructor(
    private el: HTMLElement,
    private reduced: () => boolean,
  ) {}

  setText(text: string): void {
    if (this.mad) this.mad.destroy();
    this.mad = null;
    this.el.textContent = text;
    this.apply();
  }

  setLevel(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    if (Math.abs(v - this.level) < 0.04 && v > 0 === this.level > 0) return;
    this.level = v;
    this.apply();
  }

  pulse(): void {
    if (this.mad && this.level > 0) this.mad.pulse();
  }

  private apply(): void {
    if (this.level <= 0 || this.reduced()) {
      if (this.mad) this.mad.destroy();
      this.mad = null;
      return;
    }
    if (this.mad) this.mad.set(this.level);
    else this.mad = createMadness(this.el, { level: this.level });
  }
}
