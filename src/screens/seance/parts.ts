// The pieces the Séance's scenes are built from: marks, the circle's line of
// glyphs, the night's candles (the burning one is the clock), the answer form,
// the voices as they surface, the standings, the water column and the table.

import { tierDef } from '../../game/theme';
import type { ThemeCopy } from '../../game/types';
import { paletteAt } from '../../../art/js/depth.js';
import { icon, markSvg, sealSvg } from '../../ui/art';
import { fmtMetres, h } from '../../ui/dom';
import type { Voice } from '../../party/types';
import { candleSvg, glyphSvg, tableSvg } from './art';
import { burnt, columnScale, sameWords, seatAngle, seatOf, SEATS, secondsLeft, tableWords, tintOf, voiceNote, type SeatState, type Standing, type TableSeat } from './model';
import type { Seat } from './types';

// ------------------------------------------------------------------ storage

/** localStorage, guarded: private windows and blocked site data simply forget. */
export function readStore(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing kept; the séance still plays */
  }
}

export function dropStore(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* nothing to drop */
  }
}

export function readJson<T>(key: string): T | null {
  const raw = readStore(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const NAME_KEY = 'cthulhoo.v1.sitterName';
export const loadName = (): string => readStore(NAME_KEY) ?? '';
export const saveName = (name: string): void => (name ? writeStore(NAME_KEY, name) : dropStore(NAME_KEY));

// ------------------------------------------------------------------ small things

/** On mousedown: tapping a button beside the answer keeps the keyboard up. */
export const keepFocus = (e: Event) => e.preventDefault();

export const sitterStyle = (mark: number) => `--sitter: var(--color-tier-${tintOf(mark)})`;

/** A sitter's glyph, hung from its waterline and tinted. Decorative: name it nearby. */
export const markEl = (mark: number, cls = 'sc-mark') => h('span', { class: cls, 'aria-hidden': 'true', style: sitterStyle(mark), html: glyphSvg(mark) });

/** A tier's seal (the closed eye for silence), in its tier's colour. */
export const sealEl = (tier: number, cls = 'seal') =>
  h('span', { class: cls, 'aria-hidden': 'true', style: `--tier-color: ${tier ? `var(--color-tier-${tier})` : 'var(--color-refused)'}`, html: sealSvg(tier || 'refused') });

export const tierName = (theme: ThemeCopy, tier: number) => (tier ? (tierDef(theme, tier)?.name ?? '') : '');

/** The sign, set large in the log face, read aloud as words. */
export function signEl(sign: string, spoken: string, cls = 'sc-sign'): HTMLElement {
  const [word, num] = sign.split('-');
  return h(
    'p',
    { class: cls },
    h('span', { class: 'visually-hidden' }, `The sign is ${spoken}.`),
    h('span', { class: 'sc-sign-text', 'aria-hidden': 'true' }, h('span', { class: 'w' }, word), h('span', { class: 'd' }, '-'), h('span', { class: 'n' }, num ?? '')),
  );
}

/** A row of choices that reads as one control (candles, seconds). */
export function choiceRow(label: string, name: string, values: readonly number[], current: number, unit: (n: number) => string, onPick: (n: number) => void, disabled = false): { el: HTMLElement; set(n: number): void } {
  const id = `sc-${name}-${Math.random().toString(36).slice(2, 7)}`;
  const inputs: HTMLInputElement[] = [];
  const opts = h('div', { class: 'sc-choice-opts' });
  for (const v of values) {
    const input = h('input', { type: 'radio', name: id, value: v, class: 'visually-hidden', disabled }) as HTMLInputElement;
    input.checked = v === current;
    input.addEventListener('change', () => input.checked && onPick(v));
    inputs.push(input);
    opts.append(h('label', { class: 'sc-choice' }, input, h('span', { class: 'v' }, String(v)), h('span', { class: 'u' }, unit(v))));
  }
  const el = h('fieldset', { class: 'sc-choices' }, h('legend', { class: 'sc-choices-k' }, label), opts);
  return {
    el,
    set(n: number) {
      for (const i of inputs) i.checked = Number(i.value) === n;
    },
  };
}

// ------------------------------------------------------------------ the circle's line

/**
 * The circle as a line of the Drowned Script: each sitter's glyph hangs from one
 * shared waterline, unlit until they seal, then lit in their colour.
 */
export class CircleLine {
  el: HTMLElement;
  private cells = new Map<string, HTMLElement>();
  private said: HTMLElement;
  private count: HTMLElement;
  private line: HTMLElement;

  constructor(
    private seats: Seat[],
    sealed: Iterable<string>,
    cls = 'sc-line',
  ) {
    this.line = h('span', { class: 'sc-line-glyphs', 'aria-hidden': 'true' });
    this.count = h('span', { class: 'sc-line-count', 'aria-hidden': 'true' });
    this.said = h('span', { class: 'visually-hidden' });
    this.el = h('div', { class: cls }, this.line, this.count, this.said);
    this.build();
    this.set(sealed);
  }

  private build() {
    this.line.textContent = '';
    this.cells.clear();
    for (const s of this.seats) {
      const cell = h('span', { class: `sc-line-g${s.you ? ' is-you' : ''}${s.online ? '' : ' is-away'}`, style: sitterStyle(s.mark), title: s.name, html: glyphSvg(s.mark).replace('viewBox="0 0 20 32"', 'viewBox="0 4 20 28"') });
      this.cells.set(s.id, cell);
      this.line.append(cell);
    }
  }

  /** New sitters, or someone stepped away. */
  setSeats(seats: Seat[], sealed: Iterable<string>) {
    const same = seats.length === this.seats.length && seats.every((s, i) => s.id === this.seats[i].id && s.online === this.seats[i].online);
    this.seats = seats;
    if (!same) this.build();
    this.set(sealed, false);
  }

  /** Light the glyphs of those who have sealed. Returns the ones lit just now. */
  set(sealed: Iterable<string>, bloom = true): string[] {
    const on = new Set(sealed);
    const fresh: string[] = [];
    for (const [id, cell] of this.cells) {
      const was = cell.classList.contains('is-sealed');
      const now = on.has(id);
      if (now && !was) {
        fresh.push(id);
        if (bloom) cell.classList.add('is-new');
      }
      cell.classList.toggle('is-sealed', now);
    }
    const n = this.seats.filter((s) => on.has(s.id)).length;
    this.count.textContent = `${n} of ${this.seats.length} sealed`;
    const done = this.seats.filter((s) => on.has(s.id)).map((s) => s.name);
    const todo = this.seats.filter((s) => !on.has(s.id)).map((s) => s.name);
    this.said.textContent = `${done.length ? `Sealed: ${done.join(', ')}.` : 'Nobody has sealed yet.'}${todo.length ? ` Still to seal: ${todo.join(', ')}.` : ''}`;
    return fresh;
  }
}

// ------------------------------------------------------------------ the candles

export interface CandleOpts {
  now: () => number;
  litAt: number;
  deadline: number;
  reduced: boolean;
  /** How many candles the night has, and which of them burns now (from 0). */
  count: number;
  index: number;
  /** The table's size, for the whole room. */
  grand?: boolean;
  /** Each new whole second left, once the candle has caught. */
  onSecond?(secs: number): void;
  /** Once, when it goes out by itself. */
  onOut?(): void;
}

/**
 * The night's candles in a row, one for each question: the spent ones burnt
 * down and out, the one burning now (the clock, and larger), the rest waiting
 * unlit. The seconds left stand beside them.
 */
export class CandleRow {
  el: HTMLElement;
  private burning: HTMLElement;
  private num: HTMLElement;
  private raf = 0;
  private last = -1;
  private lastSec = -1;
  private out = false;
  private stopped = false;

  constructor(private o: CandleOpts) {
    const row = h('ol', { class: 'sc-candle-row', 'aria-hidden': 'true' });
    const count = Math.max(1, o.count);
    const at = Math.min(Math.max(0, o.index), count - 1);
    for (let i = 0; i < count; i++) row.append(h('li', { class: 'sc-cdl', 'data-state': i < at ? 'spent' : i === at ? 'burning' : 'waiting', html: candleSvg() }));
    this.burning = row.children[at] as HTMLElement;
    this.num = h('span', { class: 'sc-secs-n' }, String(Math.max(0, Math.round((o.deadline - o.litAt) / 1000))));
    const readout = h('p', { class: 'sc-secs', role: 'timer', 'aria-label': 'Seconds of candle left' }, this.num, h('span', { class: 'sc-secs-u', 'aria-hidden': 'true' }, 's'));
    this.el = h('div', { class: `sc-candles${o.grand ? ' is-grand' : ''}` }, row, readout);
    // Drawn now, but nothing is said until start(): the scene is still being built.
    this.paint(false);
  }

  start() {
    this.stopped = false;
    const step = () => {
      if (this.stopped) return;
      this.paint();
      if (!this.out) this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  stop() {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
  }

  /** Put it out now: the time is up, or the answers are surfacing. */
  snuff() {
    if (this.out) return;
    this.out = true;
    this.stop();
    this.el.classList.add('is-out');
    this.el.classList.remove('is-low', 'is-lit');
    this.burning.style.setProperty('--seance-burn', '1');
    this.burning.dataset.state = 'out';
  }

  get isOut() {
    return this.out;
  }

  /** The seconds left, as the readout shows them. */
  get seconds() {
    return Math.max(0, this.lastSec);
  }

  private paint(speak = true) {
    const now = this.o.now();
    const f = burnt(now, this.o.litAt, this.o.deadline);
    if (Math.abs(f - this.last) > 0.0004) {
      this.last = f;
      this.burning.style.setProperty('--seance-burn', f.toFixed(4));
    }
    const lit = now >= this.o.litAt && now < this.o.deadline;
    this.el.classList.toggle('is-lit', lit);
    const secs = secondsLeft(now, this.o.litAt, this.o.deadline);
    if (secs !== this.lastSec) {
      this.num.textContent = String(secs);
      if (speak) {
        this.lastSec = secs;
        if (lit) this.o.onSecond?.(secs);
      }
    }
    this.el.classList.toggle('is-low', lit && secs <= 5);
    if (speak && now >= this.o.deadline && !this.out) {
      this.snuff();
      this.o.onOut?.();
    }
  }
}

// ------------------------------------------------------------------ the answer form

export interface FormParts {
  form: HTMLFormElement;
  input: HTMLInputElement;
  button: HTMLButtonElement;
  feedback: HTMLElement;
  tries: HTMLElement;
}

/** The daily's answer line, sealing instead of speaking. */
export function answerForm(describedBy: string, onKey?: () => void): FormParts {
  const input = h('input', {
    class: 'answer',
    type: 'text',
    name: 'answer',
    autocomplete: 'off',
    autocapitalize: 'words',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'send',
    maxlength: 60,
    placeholder: 'Speak a name…',
    'aria-label': 'Your answer',
    'aria-describedby': describedBy,
  }) as HTMLInputElement;
  if (onKey) input.addEventListener('input', onKey);
  const button = h('button', { class: 'btn primary', type: 'submit', onmousedown: keepFocus }, 'Seal') as HTMLButtonElement;
  const form = h('form', { class: 'answer-form sc-form', autocomplete: 'off' }, input, button) as HTMLFormElement;
  const feedback = h('p', { class: 'feedback' });
  const tries = h('ul', { class: 'tries', 'aria-label': 'Refused answers' });
  return { form, input, button, feedback, tries };
}

/** Add a refused try to the list once, however it was capitalised. */
export function addTry(list: HTMLElement, text: string): boolean {
  const t = text.trim();
  if (!t || [...list.children].some((li) => li.textContent?.toLowerCase() === t.toLowerCase())) return false;
  list.append(h('li', {}, t));
  return true;
}

// ------------------------------------------------------------------ voices

/** One voice as it surfaces: who, what they said, how rare, how alone, how deep. */
export function voiceCard(theme: ThemeCopy, v: Voice, seat: Seat | undefined, cls = 'sc-voice'): HTMLElement {
  const name = seat?.name ?? 'Someone';
  const mark = seat?.mark ?? 0;
  const silent = v.input === null;
  const tier = silent ? 0 : v.tier;
  const tname = tierName(theme, tier);
  const said = silent
    ? h('span', { class: 'sc-voice-said is-silent' }, 'The candle went out.')
    : h(
        'span',
        { class: 'sc-voice-said' },
        h('q', {}, v.input ?? ''),
        v.answer && v.input && !sameWords(v.input, v.answer) ? h('span', { class: 'sc-voice-taken' }, ` taken as ${v.answer}`) : null,
      );
  return h(
    'li',
    { class: `${cls}${silent ? ' is-silent' : ''}${seat?.you ? ' is-you' : ''}`, 'data-tier': silent ? 'none' : String(tier), style: `${sitterStyle(mark)}; --tier-color: ${tier ? `var(--color-tier-${tier})` : 'var(--color-refused)'}` },
    h('span', { class: 'sc-voice-who' }, markEl(mark), h('span', { class: 'sc-voice-name' }, name)),
    said,
    silent
      ? null
      : h('span', { class: 'sc-voice-meta' }, sealEl(tier, 'seal sc-voice-seal'), h('span', { class: 'sc-voice-tier' }, tname), h('span', { class: 'sc-voice-note' }, voiceNote(v))),
    h('span', { class: 'sc-voice-depth' }, `+${fmtMetres(v.depth)}`, h('span', { class: 'u' }, ' m')),
  );
}

/** What the deep knew: the rarest answers nobody gave. */
export function unsaidList(theme: ThemeCopy, unsaid: Array<{ answer: string; tier: number }>): HTMLElement {
  return h(
    'ul',
    { class: 'sc-unsaid-list' },
    ...unsaid.map((u) =>
      h(
        'li',
        { style: `--tier-color: var(--color-tier-${u.tier})`, 'data-tier': String(u.tier) },
        sealEl(u.tier, 'seal sc-unsaid-seal'),
        h('span', { class: 'a' }, u.answer),
        h('span', { class: 't' }, tierName(theme, u.tier)),
      ),
    ),
  );
}

// ------------------------------------------------------------------ standings

export function standingsList(rows: Standing[], seats: Map<string, Seat>, opts: { gains?: boolean; deepest?: number } = {}): HTMLElement {
  const max = Math.max(1, opts.deepest ?? Math.max(0, ...rows.map((r) => r.total)));
  const list = h('ol', { class: 'sc-standings' });
  for (const r of rows) {
    const s = seats.get(r.id);
    const share = Math.max(0, Math.min(1, r.total / max));
    list.append(
      h(
        'li',
        { class: `sc-stand${s?.you ? ' is-you' : ''}${r.rank === 1 && r.total > 0 ? ' is-first' : ''}`, style: sitterStyle(s?.mark ?? 0) },
        h('span', { class: 'sc-stand-rank', 'aria-hidden': 'true' }, `${r.tied ? '=' : ''}${r.rank}`),
        markEl(s?.mark ?? 0),
        h('span', { class: 'sc-stand-name' }, s?.name ?? 'Someone', s?.you ? h('span', { class: 'sc-you' }, ' · you') : null),
        opts.gains && r.gain ? h('span', { class: 'sc-stand-gain' }, `+${fmtMetres(r.gain)}`) : null,
        h('span', { class: 'sc-stand-total' }, fmtMetres(r.total), h('span', { class: 'u' }, ' m')),
        h('span', { class: 'sc-stand-line', 'aria-hidden': 'true' }, h('span', { style: `width:${(share * 100).toFixed(1)}%` })),
        h('span', { class: 'visually-hidden' }, `, ${r.tied ? 'tied ' : ''}${r.rank === 1 ? 'deepest' : `place ${r.rank}`}${opts.gains && r.gain ? `, ${fmtMetres(r.gain)} metres this candle` : ''}.`),
      ),
    );
  }
  return list;
}

// ------------------------------------------------------------------ the water column

/** The zone the column's water is themed as: the page's own once below the wash, the Gloaming above it. */
export const columnZone = (depth: number): string => (depth < 200 ? 'twilight' : (paletteAt(depth).zone.key as string));

/**
 * A tall column of water with each sitter's diver on its cable, sunk to their
 * running total, the deepest lowest. Totals change with a slow descent.
 */
export class WaterColumn {
  el: HTMLElement;
  private water: HTMLElement;
  private marks: HTMLElement;
  private lanes: HTMLElement;
  private divers = new Map<string, HTMLElement>();
  private scale = 1000;
  private frame = 0;
  private watch: ResizeObserver | null = null;

  constructor(
    private seats: Seat[],
    totals: Record<string, number>,
    depth: number,
  ) {
    this.water = h('div', { class: 'sc-col-water', 'aria-hidden': 'true' });
    this.marks = h('ol', { class: 'sc-col-marks', 'aria-hidden': 'true' });
    const lanes = h('ul', { class: 'sc-col-divers', style: `--lanes:${Math.max(1, seats.length)}`, 'aria-hidden': 'true' });
    seats.forEach((s, i) => {
      const tag = h('span', { class: 'sc-diver-tag' }, h('span', { class: 'sc-diver-g', html: glyphSvg(s.mark) }), h('span', { class: 'sc-diver-name' }, s.name), h('span', { class: 'sc-diver-m' }, '0 m'));
      const li = h('li', { class: `sc-diver${s.you ? ' is-you' : ''}`, style: `${sitterStyle(s.mark)}; --lane:${i}; --at:0` }, h('span', { class: 'sc-diver-cable' }), h('span', { class: 'sc-diver-body', html: markSvg('diver', 'sc-diver-svg') }), tag);
      this.divers.set(s.id, li);
      lanes.append(li);
    });
    this.lanes = lanes;
    this.el = h('figure', { class: 'sc-column', 'data-zone': columnZone(depth) }, this.water, this.marks, lanes, h('figcaption', { class: 'visually-hidden' }));
    this.set(totals, depth, true);
    try {
      this.watch = new ResizeObserver(() => this.arrangeSoon());
      this.watch.observe(this.el);
    } catch {
      /* the names stay where they fall */
    }
  }

  destroy() {
    cancelAnimationFrame(this.frame);
    this.watch?.disconnect();
    this.watch = null;
  }

  /** Sink each diver to their total. Without `instant`, they ease down like a cable paying out. */
  set(totals: Record<string, number>, depth: number, instant = false) {
    const max = Math.max(0, ...this.seats.map((s) => totals[s.id] ?? 0));
    const scale = columnScale(max);
    if (scale !== this.scale || !this.marks.childElementCount) {
      this.scale = scale;
      this.paintWater();
    }
    this.el.dataset.zone = columnZone(depth);
    this.el.classList.toggle('is-instant', instant);
    for (const s of this.seats) {
      const li = this.divers.get(s.id);
      if (!li) continue;
      const t = totals[s.id] ?? 0;
      li.style.setProperty('--at', String(Math.min(1, t / scale)));
      li.classList.toggle('is-deepest', max > 0 && t === max);
      const m = li.querySelector('.sc-diver-m');
      if (m) m.textContent = `${fmtMetres(t)} m`;
    }
    const cap = this.el.querySelector('figcaption');
    if (cap) {
      const order = [...this.seats].sort((a, b) => (totals[b.id] ?? 0) - (totals[a.id] ?? 0));
      cap.textContent = `The circle in the water: ${order.map((s) => `${s.name} at ${fmtMetres(totals[s.id] ?? 0)} metres`).join(', ')}.`;
    }
    this.arrangeSoon();
  }

  /** Sink one diver alone, as their voice surfaces. */
  sinkOne(id: string, total: number) {
    const li = this.divers.get(id);
    if (!li) return;
    this.el.classList.remove('is-instant');
    li.style.setProperty('--at', String(Math.min(1, total / this.scale)));
    const m = li.querySelector('.sc-diver-m');
    if (m) m.textContent = `${fmtMetres(total)} m`;
    this.arrangeSoon();
  }

  private arrangeSoon() {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.arrange());
  }

  /**
   * A name may be wider than its lane. Where two would overlap (neighbours at
   * about the same depth), the later one steps down below the other.
   */
  private arrange() {
    if (!this.el.isConnected) return;
    const usable = this.marks.clientHeight;
    const width = this.lanes.clientWidth;
    const lane = width / Math.max(1, this.seats.length);
    const placed: Array<{ x: number; top: number; bottom: number; half: number }> = [];
    this.seats.forEach((s, i) => {
      const li = this.divers.get(s.id);
      const tag = li?.querySelector<HTMLElement>('.sc-diver-tag');
      if (!li || !tag) return;
      const y = (Number(li.style.getPropertyValue('--at')) || 0) * usable;
      const height = tag.offsetHeight;
      const half = tag.offsetWidth / 2;
      // Under its diver, but never past the column's edge.
      const mid = (i + 0.5) * lane;
      const x = Math.min(Math.max(mid, half + 2), width - half - 2);
      let dy = 0;
      for (let tries = 0; tries < 8; tries++) {
        const top = y + dy;
        const hit = placed.find((p) => Math.abs(p.x - x) < p.half + half + 6 && top < p.bottom + 4 && top + height > p.top - 4);
        if (!hit) break;
        dy = hit.bottom + 4 - y;
      }
      li.style.setProperty('--tag-dx', `${Math.round(x - mid)}px`);
      li.style.setProperty('--tag-dy', `${Math.round(dy)}px`);
      placed.push({ x, top: y + dy, bottom: y + dy + height, half });
    });
  }

  private paintWater() {
    // The sea as it is at each depth, from the art kit's palette: light dies as you go down.
    const stops: string[] = [];
    const at = [0, 200, 1000, 2000, 4000, 5500, 6000, 7000].filter((d) => d <= this.scale);
    if (at[at.length - 1] !== this.scale) at.push(this.scale);
    for (const d of at) stops.push(`${paletteAt(Math.max(200, d)).water} ${((d / this.scale) * 100).toFixed(2)}%`);
    this.water.style.setProperty('--water', `linear-gradient(to bottom, ${stops.join(', ')})`);
    this.marks.textContent = '';
    const step = this.scale <= 2000 ? 250 : this.scale <= 5000 ? 500 : 1000;
    for (let d = step; d < this.scale; d += step) {
      const major = d % (step * 2) === 0 || step >= 1000;
      this.marks.append(h('li', { class: major ? 'is-major' : '', style: `--at:${(d / this.scale).toFixed(4)}` }, major ? `${fmtMetres(d)} m` : ''));
    }
  }
}

// ------------------------------------------------------------------ the table

/** How far each chair's hand shows: nobody in it, or its sitter here, away, waiting, sealed, out of the light or in it. */
const SEAT_OPACITY: Record<SeatState, number> = { empty: 0.16, seated: 1, away: 0.3, waiting: 0.4, sealed: 1, dim: 0.26, lit: 1 };

/**
 * The séance table from above (the art thread's #seance): a sitter's hand lies
 * at their own mark in their colour, lit when they seal, and empty chairs stay
 * dim. Its glass can hold one line (the sign, the seconds, a name) and lights
 * up at the reveal. With names, they stand round the rim for a whole room to read.
 */
export class SeanceTable {
  el: HTMLElement;
  private art: HTMLElement;
  private glassEl: HTMLElement;
  private namesEl: HTMLElement | null;
  private caption: HTMLElement;
  private states = new Map<string, SeatState>();

  constructor(seats: TableSeat[], opts: { names?: boolean; cls?: string } = {}) {
    this.glassEl = h('div', { class: 'sc-glass', 'aria-hidden': 'true' });
    this.namesEl = opts.names ? h('ol', { class: 'sc-table-names', 'aria-hidden': 'true' }) : null;
    this.caption = h('figcaption', { class: 'visually-hidden' });
    this.art = h('div', { class: 'sc-table-art', html: tableSvg() }, this.glassEl, this.namesEl);
    this.el = h('figure', { class: `sc-table${opts.names ? ' has-names' : ''}${opts.cls ? ` ${opts.cls}` : ''}` }, this.art, this.caption);
    this.set(seats, false);
  }

  /** Seat the circle as it is now. Returns the ids that have sealed since the last time. */
  set(seats: TableSeat[], bloom = true): string[] {
    const chairs = new Map<number, TableSeat>();
    for (const s of seats) {
      const n = seatOf(s.mark);
      // Two sitters on one mark (a circle that has turned over more than twelve): the one in the light keeps the chair.
      const had = chairs.get(n);
      if (n && (!had || SEAT_OPACITY[s.state] > SEAT_OPACITY[had.state])) chairs.set(n, s);
    }
    const style = this.art.style;
    for (let n = 1; n <= SEATS; n++) {
      const s = chairs.get(n);
      style.setProperty(`--seance-seat-${n}`, String(SEAT_OPACITY[s?.state ?? 'empty']));
      if (s && s.state !== 'empty') style.setProperty(`--seance-hand-${n}`, `var(--color-tier-${tintOf(s.mark)})`);
      else style.removeProperty(`--seance-hand-${n}`);
    }
    const fresh = seats.filter((s) => s.state === 'sealed' && this.states.has(s.id) && this.states.get(s.id) !== 'sealed').map((s) => s.id);
    this.states = new Map(seats.map((s) => [s.id, s.state]));
    if (this.namesEl) {
      this.namesEl.textContent = '';
      for (const [n, s] of chairs) {
        if (s.state === 'empty') continue;
        const { cos, sin } = seatAngle(n);
        this.namesEl.append(
          h(
            'li',
            { class: `sc-tname is-${s.state}${bloom && fresh.includes(s.id) ? ' is-new' : ''}`, style: `${sitterStyle(s.mark)}; --cos:${cos.toFixed(4)}; --sin:${sin.toFixed(4)}` },
            s.name,
          ),
        );
      }
    }
    this.caption.textContent = tableWords(seats);
    return fresh;
  }

  /** One line in the glass. Its size follows its length, so a long name still fits on one line. */
  glass(text: string | null, kind = '') {
    this.glassEl.textContent = '';
    this.glassEl.dataset.kind = kind;
    if (!text) return;
    // Two names share the glass a line each: "Wren", "& Harrow".
    const lines = text.split(/ (?=& )/);
    this.glassEl.style.setProperty('--chars', String(Math.max(5, ...lines.map((l) => [...l].length))));
    this.glassEl.style.setProperty('--lines', String(lines.length));
    this.glassEl.append(h('span', { class: 'sc-glass-t' }, ...lines.flatMap((l, i) => (i ? [h('br'), l] : [l]))));
  }

  /** Light the porthole's glass (the reveal), or let it go dark. */
  light(on: boolean) {
    this.el.classList.toggle('is-lit', on);
  }

  /** What a screen reader hears of the table, when a scene says it better than the seats do. */
  describe(text: string) {
    this.caption.textContent = text;
  }
}

/** The circle at the table, each sitter's chair as the scene wants it shown. */
export const tableSeats = (seats: Seat[], state: (s: Seat) => SeatState): TableSeat[] => seats.map((s) => ({ id: s.id, name: s.name, mark: s.mark, state: state(s) }));

// ------------------------------------------------------------------ sharing

export type ShareOutcome = 'shared' | 'copied' | 'shown' | 'cancelled';

/** Share a link: the phone's own share sheet, or the clipboard, or failing both, show it to copy. */
export async function shareLinkText(title: string, text: string, url: string): Promise<ShareOutcome> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void>; canShare?: (d: ShareData) => boolean };
  const data: ShareData = { title, text, url };
  if (typeof nav.share === 'function' && (!nav.canShare || nav.canShare(data))) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (e) {
      if ((e as DOMException)?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    return 'copied';
  } catch {
    return 'shown';
  }
}

/** The share button with its quiet note underneath (and the link to copy by hand, if it comes to that). */
export function shareButton(label: string, get: () => { title: string; text: string; url: string }, onClick?: () => void, announce?: (m: string) => void): HTMLElement {
  const note = h('p', { class: 'sc-share-note', role: 'status' });
  const btn = h('button', { class: 'btn sc-share', type: 'button', html: `${icon('share')}<span>${label}</span>` }) as HTMLButtonElement;
  btn.addEventListener('click', async () => {
    onClick?.();
    const d = get();
    const out = await shareLinkText(d.title, d.text, d.url);
    note.textContent = '';
    if (out === 'copied') {
      note.textContent = 'Copied. Paste it anywhere.';
      announce?.('Copied the sign. Paste it anywhere.');
    } else if (out === 'shown') {
      const field = h('input', { class: 'sc-share-url', type: 'text', readonly: true, 'aria-label': 'The link to share', value: d.url }) as HTMLInputElement;
      note.append('Copy this link: ', field);
      field.focus();
      field.select();
    }
  });
  return h('div', { class: 'sc-share-wrap' }, btn, note);
}
