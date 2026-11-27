// One scene of the Séance (the entry, a lobby, a burning candle, a reveal…): its
// element, where focus goes when it arrives, and everything it must stop when it
// leaves (timers, frames, madness).

import { calm, madden } from '../../ui/art';
import { h } from '../../ui/dom';
import type { SeanceEnv } from './types';

export interface Ctx {
  env: SeanceEnv;
  /** env.reduced or the device's own setting. */
  reduced: boolean;
  /** The scrolling screen the scenes live in. */
  screen: HTMLElement;
  /** The deepest total so far, for how far the deep has got into the lettering. */
  depth(): number;
  /** The clock the candles burn by (the relay's, online). */
  now(): number;
  /** Tell the app how deep the circle has gone, so its abyss can sink with it. */
  sink(metres: number): void;
}

type Mad = ReturnType<typeof madden>;

export abstract class Scene {
  abstract readonly key: string;
  el!: HTMLElement;
  /** Focused when the scene arrives (a heading by default). */
  focus: HTMLElement | null = null;
  /** Wait this long before focusing (the words are still rising). */
  focusDelay = 0;
  protected mads: Mad[] = [];
  protected timers: number[] = [];
  protected frames: number[] = [];
  protected stops: Array<() => void> = [];
  private dead = false;

  constructor(protected ctx: Ctx) {}

  protected get env(): SeanceEnv {
    return this.ctx.env;
  }

  protected get gone(): boolean {
    return this.dead;
  }

  protected click() {
    this.ctx.env.sound?.click?.();
  }

  /** Let the deep into a short label (headings, categories): never questions, answers, buttons, names or numbers. */
  protected mad(el: HTMLElement | null) {
    if (!el) return;
    const m = madden(el, this.ctx.depth(), this.ctx.reduced);
    if (m) this.mads.push(m);
  }

  protected later(fn: () => void, ms: number): number {
    const id = window.setTimeout(() => !this.dead && fn(), ms);
    this.timers.push(id);
    return id;
  }

  /** The scene's heading, which takes focus when it arrives so a screen reader starts there. */
  protected heading(tag: 'h2' | 'h3', text: string | Node, cls: string, id?: string): HTMLElement {
    const el = h(tag, { class: cls, tabindex: '-1', id }, text);
    this.focus ??= el;
    return el;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    for (const m of this.mads) calm(m);
    for (const t of this.timers) clearTimeout(t);
    for (const f of this.frames) cancelAnimationFrame(f);
    for (const s of this.stops) s();
    this.mads = [];
    this.timers = [];
    this.frames = [];
    this.stops = [];
  }
}

let seq = 0;
/** Ids that stay unique however many scenes come and go. */
export const uniq = (stem: string) => `${stem}-${++seq}`;
