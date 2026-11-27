// The career chart: the expedition's survey of one diver (docs/art/06-interface.md,
// "The Logbook"). One long printed sheet that starts on paper and runs down into black
// water, with a single cable paid out across every day of the career.
//
// Depth runs down the sheet and days run left to right. The first 7,000 m use a
// square-root scale, so the shallows where every diver starts get room while the floor
// still fits. Below the floor, where careers spend most of their life, each milestone
// gets the same room, so a career of a million metres reads as well as one of a
// thousand. That is one monotone function of depth (depthY): the water, the labels, the
// plaques and the cable are all placed through it.

import type { Career, CareerPoint } from '../game/career';
import type { MilestoneDef, ZoneDef } from '../game/types';
import { dateKeyForDay, EPOCH_UTC } from '../game/daily';
import { mixOklch, paletteAt, rgbToHex, zoneForDepth, ZONES } from '../../art/js/depth.js';
import { fmtMetres, h } from './dom';

/** The floor of the sea: the end of the square-root scale. */
export const FLOOR = 7000;

// ================================================================== the depth scale

export interface DepthScale {
  /** y of the surface, in px from the top of the sheet. */
  top: number;
  /** px from the surface down to the floor, on a square-root scale. */
  floorH: number;
  /** px given to each band below the floor. */
  band: number;
  /** The depths below the floor that each end a band, ascending, every one past 7,000 m. */
  beyond: number[];
}

/** Only usable depths below the floor, in order, once each. */
export function cleanBeyond(depths: readonly number[]): number[] {
  return [...new Set(depths.filter((d) => Number.isFinite(d) && d > FLOOR))].sort((a, b) => a - b);
}

/**
 * Where a depth sits on the sheet. Monotone: a deeper reading is always lower. Above the
 * floor, y grows with the square root of depth. Below it, each band of `beyond` gets
 * `band` px, linear inside the band; past the last one the last band's rate carries on.
 */
export function depthY(s: DepthScale, metres: number): number {
  const m = Number.isFinite(metres) ? Math.max(0, metres) : 0;
  if (m <= FLOOR) return s.top + s.floorH * Math.sqrt(m / FLOOR);
  const stops = [FLOOR, ...cleanBeyond(s.beyond)];
  for (let i = 1; i < stops.length; i++) {
    if (m <= stops[i]) return s.top + s.floorH + s.band * (i - 1 + (m - stops[i - 1]) / (stops[i] - stops[i - 1]));
  }
  // Past the last stop (or with none below the floor): the last band's rate carries on.
  const last = stops[stops.length - 1];
  const prev = stops.length > 1 ? stops[stops.length - 2] : 0;
  return s.top + s.floorH + s.band * (stops.length - 1 + (m - last) / (last - prev));
}

/** The depth at a height on the sheet: the inverse of depthY. */
export function depthAtY(s: DepthScale, y: number): number {
  const v = (y - s.top) / (s.floorH || 1);
  if (!(v > 0)) return 0;
  if (v <= 1) return FLOOR * v * v;
  const stops = [FLOOR, ...cleanBeyond(s.beyond)];
  const k = (y - s.top - s.floorH) / (s.band || 1);
  const i = Math.floor(k);
  if (i < stops.length - 1) return stops[i] + (k - i) * (stops[i + 1] - stops[i]);
  const last = stops[stops.length - 1];
  const prev = stops.length > 1 ? stops[stops.length - 2] : 0;
  return last + (k - (stops.length - 1)) * (last - prev);
}

/**
 * Round soundings for open water past the last milestone (10,000, 20,000, 50,000 m and
 * so on), clear of `from`, down to the first one past the deepest point reached.
 */
export function soundingsBelow(from: number, deepest: number): number[] {
  const out: number[] = [];
  for (let e = 3; e <= 12; e++) {
    for (const k of [1, 2, 5]) {
      const v = k * 10 ** e;
      if (v < from * 1.25) continue;
      out.push(v);
      if (v > deepest) return out;
    }
  }
  return out;
}

/**
 * The depths below the floor that get a band each: the milestones passed down there and
 * the next one ahead. Past the last milestone, round soundings carry on below the
 * deepest point, so the chart always ends in water the cable has not reached.
 */
export function beyondFloor(career: Pick<Career, 'passed' | 'next' | 'best' | 'depth'>, milestones: readonly MilestoneDef[]): number[] {
  const marks = [...milestones].sort((a, b) => a.depth - b.depth);
  const out = career.passed.map((p) => marks[p.index]?.depth ?? 0);
  const next = career.next >= 0 ? marks[career.next] : undefined;
  if (next) out.push(next.depth);
  else {
    const deepest = Math.max(career.best, career.depth);
    if (deepest > FLOOR) out.push(...soundingsBelow(Math.max(FLOOR, ...out), deepest));
  }
  return cleanBeyond(out);
}

/** The deepest depth the sheet shows: the end of the last band, or the floor. */
export const bottomDepth = (beyond: readonly number[]): number => cleanBeyond(beyond).pop() ?? FLOOR;

/** Depths marked on the left edge: each zone boundary, every 1,000 m, and the end of every band below the floor. */
export function depthMarks(beyond: readonly number[]): number[] {
  return [0, 200, 1000, 2000, 3000, 4000, 5000, 6000, FLOOR, ...cleanBeyond(beyond)];
}

const mix = (a: string, b: string, t: number): string => rgbToHex(mixOklch(a, b, t));
const HADAL = ZONES[ZONES.length - 1].ui;
const FLOOR_FOG: string = paletteAt(FLOOR).fog;

export interface WaterStop {
  depth: number;
  color: string;
  /** A hard edge: this stop starts just below the one before it at the same depth. */
  edge?: boolean;
}

/**
 * The water down the sheet, as gradient stops by depth: the wash from 110 m, a stop at
 * every zone boundary, then the Dreaming Deep below the floor. Each band down there is
 * a room of its own, lit faintly from the milestone at its top and dark again at its foot.
 */
export function waterStops(beyond: readonly number[]): WaterStop[] {
  const out: WaterStop[] = [110, 200, 340, 600, 1000, 1800, 2800, 4000, 5000, 6000, 6600, FLOOR].map((m) => ({ depth: m, color: paletteAt(Math.max(m, 200)).water }));
  const bands = cleanBeyond(beyond);
  if (!bands.length) return out;
  out.push({ depth: FLOOR, color: mix(HADAL.ground, FLOOR_FOG, 0.42), edge: true });
  bands.forEach((m, i) => {
    out.push({ depth: m, color: HADAL.ground });
    if (i < bands.length - 1) out.push({ depth: m, color: mix(HADAL.ground, HADAL.plate, 0.9), edge: true });
  });
  return out;
}

// ================================================================== the day scale

export interface DayScale {
  /** The day before the first dive: the cable leaves the surface there. */
  from: number;
  to: number;
  x0: number;
  x1: number;
}

/** Days across the width: from the surface the day before the first dive, to today at the right. */
export function dayScale(firstDay: number | null, today: number, x0: number, x1: number): DayScale {
  const first = Math.min(firstDay ?? today, today);
  return { from: first - 1, to: today, x0, x1 };
}

export const dayX = (s: DayScale, day: number): number => s.x0 + ((day - s.from) / Math.max(1, s.to - s.from)) * (s.x1 - s.x0);

/** The day nearest a point across the sheet, within the career. */
export function dayAtX(s: DayScale, x: number): number {
  const t = (x - s.x0) / Math.max(1, s.x1 - s.x0);
  return Math.max(s.from + 1, Math.min(s.to, Math.round(s.from + t * (s.to - s.from))));
}

/** Days until a career keeps one tick a week instead of one a day. */
export const DAILY_TICKS = 60;

/**
 * The dives that get a tick across the cable: every one in a short career; past about
 * 60 days, the last dive of each week counted back from today (or of each fortnight or
 * month, where even weekly ticks would sit under 3 px apart).
 */
export function tickDays(points: readonly CareerPoint[], pxPerDay = Infinity): number[] {
  const dives = points.filter((p) => p.kind === 'dive').map((p) => p.day);
  if (points.length <= DAILY_TICKS) return dives;
  const last = points[points.length - 1].day;
  const step = [7, 14, 28, 56].find((s) => s * pxPerDay >= 3) ?? 56;
  const picked = new Map<number, number>();
  for (const d of dives) {
    const block = Math.floor((last - d) / step);
    picked.set(block, Math.max(d, picked.get(block) ?? -Infinity));
  }
  return [...picked.values()].sort((a, b) => a - b);
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_MS = 86_400_000;

/** "27 NOV": a day's date in the log face. The same in every time zone. */
export function dateLabel(day: number): string {
  const [, m, d] = dateKeyForDay(day).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

/** The day number of the first of a month (month 0 is January). */
const firstOfMonth = (year: number, month: number) => Math.round((Date.UTC(year, month, 1) - EPOCH_UTC) / DAY_MS) + 1;

export interface DateTick {
  day: number;
  label: string;
}

/**
 * A few dates along the top edge, at least `gap` px apart. A short career gets a date
 * every week or fortnight from its first dive ("27 NOV"); a long one gets the first of
 * every month, or of every few months ("MAR"), with the year on the first and on January.
 */
export function dateTicks(s: DayScale, gap = 64): DateTick[] {
  const span = s.to - s.from;
  if (span < 1) return [];
  const pxPerDay = (s.x1 - s.x0) / span;
  if (span <= 120) {
    const step = [7, 14, 28, 56].find((d) => d * pxPerDay >= gap) ?? 112;
    const out: DateTick[] = [];
    for (let d = s.from + 1; d <= s.to; d += step) out.push({ day: d, label: dateLabel(d) });
    return out;
  }
  const stride = [1, 2, 3, 6, 12].find((k) => k * 30.4 * pxPerDay >= gap) ?? 24;
  const [y0, m0] = dateKeyForDay(s.from + 1).split('-').map(Number);
  const out: DateTick[] = [];
  for (let i = 0; i < 1200; i++) {
    const year = y0 + Math.floor((m0 - 1 + i) / 12);
    const month = (m0 - 1 + i) % 12;
    const day = firstOfMonth(year, month);
    if (day > s.to) break;
    if (day <= s.from || month % stride !== 0) continue;
    out.push({ day, label: !out.length || month === 0 ? `${MONTHS[month]} ${year}` : MONTHS[month] });
  }
  return out;
}

// ================================================================== the text alternative

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const count = (n: number, one: string, many = `${one}s`) => `${n <= 10 ? WORDS[n] : fmtMetres(n)} ${n === 1 ? one : many}`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Spells of drift: one for each run of missed days that cost depth. */
export const driftCount = (points: readonly CareerPoint[]): number => points.filter((p, i) => p.kind === 'drift' && points[i - 1]?.kind !== 'drift').length;

/**
 * A plain account of the chart, for screen readers: "Career depth 5,580 m over 41 days,
 * 38 dives, with two drifts and one ward. Three milestones passed; next, The Roofs of
 * the Drowned City at 7,000 m."
 */
export function chartSummary(career: Career, milestones: readonly MilestoneDef[], today: number): string {
  const marks = [...milestones].sort((a, b) => a.depth - b.depth);
  const next = career.next >= 0 ? marks[career.next] : undefined;
  if (!career.daysPlayed) {
    return `No dives yet: the cable waits at the surface.${next ? ` The first milestone, ${next.name}, is at ${fmtMetres(next.depth)} m.` : ''}`;
  }
  const days = today - (career.firstDay ?? today) + 1;
  const drifts = driftCount(career.points);
  const wards = career.points.filter((p) => p.kind === 'ward').length;
  const extras = [drifts ? count(drifts, 'drift') : '', wards ? count(wards, 'ward') : ''].filter(Boolean);
  const lines = [`Career depth ${fmtMetres(career.depth)} m over ${count(days, 'day')}, ${count(career.daysPlayed, 'dive')}${extras.length ? `, with ${extras.join(' and ')}` : ''}.`];
  const ahead = next ? `next, ${next.name} at ${fmtMetres(next.depth)} m` : 'none lies ahead';
  lines.push(`${cap(count(career.passed.length, 'milestone'))} passed; ${ahead}.`);
  if (career.best > career.depth) lines.push(`The deepest it has been is ${fmtMetres(career.best)} m.`);
  return lines.join(' ');
}

// ================================================================== the sheet's layout

/** Margins, the floor's height and the band below it, for a sheet of a given width. */
export function sheetLayout(width: number) {
  const narrow = width < 460;
  return { narrow, L: narrow ? 52 : 62, R: narrow ? 60 : 84, T: 34, FOOT: 48, floorH: narrow ? 560 : 640, band: narrow ? 124 : 148 };
}

// ================================================================== drawing

const SVG_NS = 'http://www.w3.org/2000/svg';
type SvgAttrs = Record<string, string | number | null | undefined>;
const r1 = (v: number) => Math.round(v * 10) / 10;

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SvgAttrs = {}, ...kids: Array<SVGElement | null | undefined | false | ''>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) el.setAttribute(k, typeof v === 'number' ? String(r1(v)) : v);
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

type UiTokens = (typeof ZONES)[number]['ui'];
const UI: Record<string, UiTokens> = Object.fromEntries(ZONES.map((z) => [z.key, z.ui]));
/** The interface zone a depth belongs to; everything below the floor is the Dreaming Deep. */
const zoneKey = (m: number): string => zoneForDepth(Math.min(m, FLOOR)).key;
/** The cable's light at a depth: ink on paper, each zone's glow below the wash, the Dreaming Deep's below the floor. */
const glowAt = (m: number): string => (m < 160 ? UI.surface.ink : m > FLOOR ? HADAL.glow : paletteAt(m).glow);

/** Small seeded noise, so the wet edge of the ink wash is the same on every visit. */
function noise(seed: number) {
  let s = seed;
  return () => (s = (s * 48271) % 2147483647) / 2147483647;
}

export interface ChartOptions {
  career: Career;
  milestones: readonly MilestoneDef[];
  zones: readonly ZoneDef[];
  today: number;
  /** Pay the cable out over 2.4 s (the first visit of the day, with motion allowed). */
  payout: boolean;
  /** Motion allowed: a milestone passed today blooms its name. */
  motion: boolean;
  /** Prefix for ids inside this chart, unique on the page. */
  uid: string;
  /** Called after each drawing, once the sheet is laid out (first: true the first time). */
  onDrawn?: (first: boolean) => void;
}

export interface ChartHandle {
  el: HTMLElement;
  /** The lead weight, once drawn. */
  lead(): Element | null;
}

interface Pt {
  x: number;
  y: number;
  p: CareerPoint | null;
}

/**
 * The chart, as a figure. It draws itself once it is laid out (and again whenever its
 * width changes), so it can be built before it is in the page.
 */
export function careerChart(o: ChartOptions): ChartHandle {
  const { career, today } = o;
  const marks = [...o.milestones].sort((a, b) => a.depth - b.depth);
  const sheet = h('div', { class: 'lb-sheet', 'data-zone': 'surface' });
  const hasDrift = career.points.some((p) => p.kind === 'drift');
  const hasWard = career.points.some((p) => p.kind === 'ward');
  const fig = h(
    'figure',
    { class: 'lb-chart' },
    h('figcaption', { class: 'visually-hidden' }, chartSummary(career, marks, today)),
    h('div', { class: 'lb-chart__frame' }, sheet),
    career.daysPlayed ? legend(hasDrift, hasWard, career.passed.length > 0 || career.next >= 0) : null,
  );

  let width = 0;
  let reveal = o.payout ? 0 : 1;
  let drawn = false;
  let leadEl: Element | null = null;
  let layout = sheetLayout(0);
  let cableHits: (r: Rect) => boolean = () => false;

  const showReveal = () => {
    const rect = sheet.querySelector(`#${o.uid}-reveal rect`);
    if (!rect) return;
    const x = -10 + (width + 20) * reveal;
    rect.setAttribute('width', String(r1(Math.max(0, x))));
    sheet.querySelectorAll<HTMLElement | SVGElement>('[data-x]').forEach((el) => el.toggleAttribute('data-hide', Number(el.dataset.x) > x));
  };

  const draw = () => {
    const W = width;
    layout = sheetLayout(W);
    const { narrow, L, R, T, FOOT, floorH, band } = layout;
    const beyond = beyondFloor(career, marks);
    const scale: DepthScale = { top: T, floorH, band, beyond };
    const yOf = (m: number) => depthY(scale, m);
    const deepest = bottomDepth(beyond);
    const deepLine = career.depth >= 4000 ? deepWords(today) : '';
    const H = Math.ceil(yOf(deepest) + FOOT + (deepLine ? 18 : 0));
    sheet.style.height = `${H}px`;
    const days = dayScale(career.firstDay, today, L, W - R);
    const xOf = (d: number) => dayX(days, d);
    const id = (k: string) => `${o.uid}-${k}`;
    const url = (k: string) => `url(#${id(k)})`;

    // ---- the cable: the surface the day before the first dive, then one point a day
    const pts: Pt[] = [];
    if (career.firstDay !== null) pts.push({ x: xOf(days.from), y: yOf(0), p: null });
    for (const p of career.points) pts.push({ x: xOf(p.day), y: yOf(p.depth), p });
    const end: Pt = pts[pts.length - 1] ?? { x: xOf(today), y: yOf(0), p: null };
    const P = (pt: Pt) => `${r1(pt.x)} ${r1(pt.y)}`;
    let dive = '';
    let drift = '';
    let pen = false; // is the descent path's pen down at the previous point?
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].p?.kind === 'drift') {
        drift += `M${P(pts[i - 1])} L${P(pts[i])} `;
        pen = false;
      } else {
        dive += `${pen ? '' : `M${P(pts[i - 1])} `}L${P(pts[i])} `;
        pen = true;
      }
    }
    // Days are small ticks across the cable, square to it wherever it runs.
    const pxPerDay = (days.x1 - days.x0) / Math.max(1, days.to - days.from);
    const tickSet = new Set(tickDays(career.points, pxPerDay));
    let ticks = '';
    pts.forEach((pt, i) => {
      if (!pt.p || !tickSet.has(pt.p.day)) return;
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = (-(b.y - a.y) / len) * 2.8;
      const ny = ((b.x - a.x) / len) * 2.8;
      ticks += `M${r1(pt.x - nx)} ${r1(pt.y - ny)} L${r1(pt.x + nx)} ${r1(pt.y + ny)} `;
    });

    // ---- the water: paper above, the ink wash with a ragged wet edge, then black water
    const rnd = noise(5);
    const washY = yOf(165);
    const edgeMax = yOf(190);
    const edge: Array<[number, number]> = [];
    for (let x = -6; x <= W + 6; x += 5) edge.push([x, Math.min(edgeMax, washY + (rnd() - 0.5) * 8 + Math.sin(x / 41) * 5)]);
    const ragged = (dy: number, jit: number) => edge.map(([x, y]) => `${r1(x)} ${r1(y + dy + (rnd() - 0.5) * jit)}`).join(' L');
    const y0 = yOf(110);
    const span = Math.max(1, H - y0);
    const off = (y: number) => Math.max(0, Math.min(1, (y - y0) / span)).toFixed(4);
    const offH = (y: number) => Math.max(0, Math.min(1, y / H)).toFixed(4);
    const stop = (offset: string, color: string, opacity?: number) => svg('stop', { offset, 'stop-color': color, 'stop-opacity': opacity });
    const water = waterStops(beyond).map((s) => stop(off(yOf(s.depth) + (s.edge ? 0.6 : 0)), s.color));
    water.push(stop('1', beyond.length ? HADAL.ground : paletteAt(FLOOR).water));
    const cableStops = [
      stop(offH(yOf(0)), UI.surface.ink),
      stop(offH(yOf(150)), UI.surface.ink),
      ...[260, 600, 1000, 2500, 4000, 5000, 6000, FLOOR].map((m) => stop(offH(yOf(m)), paletteAt(m).glow)),
      ...beyond.map((m) => stop(offH(yOf(m)), HADAL.glow)),
    ];
    const mutedStops = [
      stop(offH(yOf(0)), UI.surface.inkMuted),
      stop(offH(yOf(150)), UI.surface.inkMuted),
      ...ZONES.slice(1).map((z) => stop(offH(yOf((z.from + Math.min(z.to, FLOOR)) / 2)), z.ui.inkMuted)),
      ...beyond.map((m) => stop(offH(yOf(m)), HADAL.inkMuted)),
    ];

    // ---- survey lines: the milestones passed, and the next one ahead
    // Where the cable crosses a depth. Each day's cable is straight on the sheet, not in
    // metres, so the crossing is found by height.
    const crossAt = (m: number): number | null => {
      const ym = yOf(m);
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        if ((a.p?.depth ?? 0) < m && (b.p?.depth ?? 0) >= m) return a.x + ((b.x - a.x) * (ym - a.y)) / (b.y - a.y || 1);
      }
      return null;
    };
    const next = career.next >= 0 ? marks[career.next] : undefined;
    const shown = [
      ...career.passed.map((p) => ({ mark: marks[p.index], day: p.day as number | null, ahead: false })),
      ...(next ? [{ mark: next, day: null, ahead: true }] : []),
    ].filter((s) => s.mark);
    const survey = svg('g', { fill: 'none', 'stroke-width': 1, 'stroke-dasharray': '1 4' });
    for (const s of shown) {
      survey.append(svg('path', { d: `M${L - 6} ${r1(yOf(s.mark.depth))} H${W}`, stroke: UI[zoneKey(s.mark.depth + 1)].rule, opacity: s.ahead ? 0.65 : 1 }));
    }
    // Soundings past the last milestone are open water: a fainter line and no plaque.
    for (const m of beyond) {
      if (!shown.some((s) => s.mark.depth === m)) survey.append(svg('path', { d: `M${L - 6} ${r1(yOf(m))} H${W}`, stroke: HADAL.rule, opacity: 0.5 }));
    }

    // ---- wards: where a ward saved a day, the spent stone hangs from the cable
    const wards = svg('g', { fill: 'none' });
    for (const pt of pts) {
      if (pt.p?.kind !== 'ward') continue;
      const c = glowAt(pt.p.depth);
      wards.append(
        svg('path', { d: `M${r1(pt.x)} ${r1(pt.y)} V${r1(pt.y + 6)}`, stroke: c, 'stroke-width': 0.75 }),
        svg('use', { href: '#ward-spent', x: pt.x - 7.3, y: pt.y + 4, width: 16, height: 16, style: `color:${c}` }),
      );
    }

    // ---- today: the lead weight at the end of the cable
    const leadColour = glowAt(career.depth);
    const lead = svg('path', {
      class: 'lb-lead',
      'data-x': W,
      d: `M${r1(end.x - 2.2)} ${r1(end.y - 1)} h4.4 l1.9 11.5 q-4.1 2.7 -8.2 0 Z`,
      fill: leadColour,
      style: career.depth >= 160 ? `filter: drop-shadow(0 0 5px ${leadColour})` : null,
    });
    leadEl = lead;

    const deepY = yOf(200);
    const floorY = yOf(FLOOR);
    sheet.replaceChildren(
      svg(
        'svg',
        { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' },
        svg(
          'defs',
          {},
          svg('linearGradient', { id: id('water'), gradientUnits: 'userSpaceOnUse', x1: 0, y1: y0, x2: 0, y2: H }, ...water),
          svg('linearGradient', { id: id('cable'), gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: H }, ...cableStops),
          svg('linearGradient', { id: id('muted'), gradientUnits: 'userSpaceOnUse', x1: 0, y1: 0, x2: 0, y2: H }, ...mutedStops),
          svg('linearGradient', { id: id('roofs'), x1: 0, y1: 0, x2: 0, y2: 1 }, stop('0', FLOOR_FOG, 0), stop('0.5', FLOOR_FOG, 0.75), stop('1', FLOOR_FOG, 0)),
          svg('filter', { id: id('blur'), x: '-20%', y: '-20%', width: '140%', height: '140%' }, svg('feGaussianBlur', { stdDeviation: 4 })),
          svg('clipPath', { id: id('deep') }, svg('rect', { x: 0, y: deepY, width: W, height: H - deepY })),
          svg('clipPath', { id: id('reveal') }, svg('rect', { x: 0, y: 0, width: W, height: H })),
        ),
        // the surface: a hairline where the paper meets the sea
        svg('path', { d: `M${L - 6} ${r1(yOf(0))} H${W}`, stroke: UI.surface.rule, 'stroke-width': 0.75, opacity: 0.45 }),
        svg('path', { d: `M-6 ${H + 6} L${ragged(-10, 7)} L${W + 6} ${H + 6} Z`, fill: url('water'), opacity: 0.3 }),
        svg('path', { d: `M-6 ${H + 6} L${ragged(0, 3)} L${W + 6} ${H + 6} Z`, fill: url('water') }),
        // the floor is lit from below: the roofs of the city, where the square-root scale ends
        beyond.length > 0 && svg('rect', { x: 0, y: floorY - 28, width: W, height: 56, fill: url('roofs') }),
        survey,
        svg(
          'g',
          { 'clip-path': url('reveal') },
          dive && svg('g', { 'clip-path': url('deep') }, svg('path', { d: dive, fill: 'none', stroke: url('cable'), 'stroke-width': 5, opacity: 0.55, filter: url('blur') })),
          dive && svg('path', { d: dive, fill: 'none', stroke: url('cable'), 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
          drift && svg('path', { d: drift, fill: 'none', stroke: url('muted'), 'stroke-width': 1.25, 'stroke-dasharray': '2 3' }),
          ticks && svg('path', { d: ticks, fill: 'none', stroke: url('cable'), 'stroke-width': 1, 'stroke-linecap': 'round' }),
          wards,
        ),
        lead,
      ),
    );

    // ---- labels in HTML, so the type stays sharp and the plaques can be read aloud
    const labels: HTMLElement[] = [];
    for (const m of depthMarks(beyond)) {
      labels.push(h('span', { class: 'lb-tick', 'aria-hidden': 'true', 'data-zone': zoneKey(m + 1), 'data-below': m > FLOOR, style: `top:${r1(yOf(m))}px` }, `${fmtMetres(m)} m`));
    }
    const above = o.zones.filter((z) => z.from < FLOOR);
    above.forEach((z, i) => {
      const top = yOf(z.from) + (z.from ? 7 : 26);
      const limit = Math.min(yOf(above[i + 1]?.from ?? FLOOR), H - 4);
      labels.push(h('span', { class: 'lb-zone', 'aria-hidden': 'true', 'data-zone': zoneKey(z.from + 1), 'data-top': r1(top), 'data-limit': r1(limit), style: `top:${r1(top)}px` }, z.name));
    });
    const floorZone = o.zones.find((z) => z.from >= FLOOR);
    if (floorZone && beyond.length) {
      const top = floorY + 7;
      labels.push(h('span', { class: 'lb-zone', 'aria-hidden': 'true', 'data-zone': 'hadal', 'data-top': r1(top), 'data-limit': r1(yOf(beyond[0])), style: `top:${r1(top)}px` }, floorZone.name));
    }
    if (career.firstDay !== null) {
      for (const d of dateTicks(days, narrow ? 64 : 76)) labels.push(h('span', { class: 'lb-date', 'aria-hidden': 'true', style: `left:${r1(xOf(d.day))}px` }, d.label));
    }

    const plaques = h('ul', { class: 'lb-plaques', role: 'list' });
    for (const s of shown) {
      const cx = s.ahead ? end.x : crossAt(s.mark.depth) ?? end.x;
      const toGo = Math.max(0, s.mark.depth - career.depth);
      plaques.append(
        h(
          'li',
          {
            class: 'cth-milestone',
            'data-zone': zoneKey(s.mark.depth + 1),
            'data-state': s.ahead ? 'ahead' : null,
            'data-new': !s.ahead && s.day === today && o.motion,
            'data-x': r1(s.ahead ? W : cx),
            'data-cx': r1(cx),
            style: `top:${r1(yOf(s.mark.depth))}px`,
          },
          benchmark(),
          h(
            'div',
            { class: 'cth-milestone__plaque' },
            h('span', { class: 'cth-milestone__name' }, h('span', { class: 'visually-hidden' }, s.ahead ? 'Next milestone: ' : 'Milestone passed: '), s.mark.name),
            h('span', { class: 'cth-milestone__depth' }, `${fmtMetres(s.mark.depth)} m`, s.ahead ? ` · ${fmtMetres(toGo)} m to go` : ''),
          ),
        ),
      );
    }

    const readout = h(
      'p',
      { class: 'lb-today', 'data-zone': zoneKey(career.depth + 1), 'data-x': W, 'data-rise': end.p?.kind === 'drift', style: `--x:${r1(end.x)}px;--y:${r1(end.y)}px;color:${leadColour}` },
      h('span', { class: 'lb-today__m' }, `${fmtMetres(career.depth)} m`),
      h('span', { class: 'lb-today__k' }, career.daysPlayed ? 'today' : 'the surface'),
    );
    const extra: HTMLElement[] = [];
    if (!career.daysPlayed) extra.push(h('p', { class: 'lb-empty-note', 'data-zone': 'midnight' }, 'The cable is paid out with your first dive.'));
    if (deepLine) extra.push(h('p', { class: 'lb-deep-words', 'aria-hidden': 'true', 'data-zone': 'hadal', style: `top:${r1(yOf(deepest) + FOOT * 0.55)}px` }, deepLine));

    sheet.append(...labels, plaques, readout, ...extra);
    // Does a box on the sheet touch the cable? (Each day's cable is a straight segment.)
    cableHits = (r: Rect) => pts.some((b, i) => i > 0 && segmentMeetsBox(pts[i - 1], b, { l: r.l - 2, r: r.r + 2, t: r.t - 2, b: r.b + 2 }));
    placeLabels(sheet, W, L, cableHits);
    showReveal();
    o.onDrawn?.(!drawn);
    if (!drawn) document.fonts?.ready.then(() => placeLabels(sheet, width, layout.L, cableHits)).catch(() => {});
    drawn = true;
  };

  const payOut = () => {
    if (reveal >= 1) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - t0) / 2400);
      reveal = 1 - (1 - t) * (1 - t);
      showReveal();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const measure = () => {
    const w = Math.round(sheet.clientWidth);
    if (!w || w === width) return;
    const first = !width;
    width = w;
    draw();
    if (first) payOut();
  };
  if (typeof ResizeObserver === 'function') new ResizeObserver(measure).observe(sheet);
  else requestAnimationFrame(measure);

  return { el: fig, lead: () => leadEl };
}

/** Below 4,000 m the deep may say a few words of its own, once, at the foot of the chart. */
function deepWords(today: number): string {
  const words = ['Come down.', 'We remember you.', 'Deeper.', 'It knows you are coming.'];
  return words[Math.abs(today) % words.length];
}

/** The surveyor's benchmark beside a plaque. */
function benchmark(): SVGSVGElement {
  return svg('svg', { class: 'cth-milestone__mark', viewBox: '0 0 32 32', 'aria-hidden': 'true', focusable: 'false' }, svg('use', { href: '#milestone' }));
}

/** The key under the chart: what the line, the dashes and the marks mean. */
function legend(drift: boolean, ward: boolean, milestone: boolean): HTMLElement {
  const sw = (...kids: SVGElement[]) => svg('svg', { class: 'lb-key__sw', viewBox: '0 0 28 16', 'aria-hidden': 'true', focusable: 'false' }, ...kids);
  const item = (swatch: SVGElement, text: string) => h('li', {}, swatch, h('span', {}, text));
  return h(
    'ul',
    { class: 'lb-key', role: 'list', 'aria-label': 'Key' },
    item(sw(svg('path', { d: 'M2 4 L26 12', class: 'lb-key__cable' }), svg('path', { d: 'M12.6 4.6 L15.4 11.4', class: 'lb-key__tick' })), 'A dive'),
    drift ? item(sw(svg('path', { d: 'M2 12 L26 4', class: 'lb-key__drift' })), 'Drift') : null,
    ward ? item(sw(svg('path', { d: 'M2 3 H26', class: 'lb-key__cable' }), svg('use', { href: '#ward-spent', x: 7, y: 2, width: 14, height: 14 })), 'A ward held') : null,
    milestone ? item(sw(svg('use', { href: '#milestone', x: 5, y: -3, width: 18, height: 18 })), 'Milestone') : null,
  );
}

type Rect = { l: number; r: number; t: number; b: number };

/** Whether the segment from a to b passes through the box (Liang–Barsky clipping). */
export function segmentMeetsBox(a: { x: number; y: number }, b: { x: number; y: number }, box: Rect): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - box.l],
    [dx, box.r - a.x],
    [-dy, a.y - box.t],
    [dy, box.b - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false; // parallel to this edge and outside it
      continue;
    }
    const u = q / p;
    if (p < 0) {
      if (u > t1) return false;
      t0 = Math.max(t0, u);
    } else {
      if (u < t0) return false;
      t1 = Math.min(t1, u);
    }
  }
  return t0 <= t1;
}

/**
 * Each plaque goes on whichever side of its benchmark has room (wrapping when neither
 * has enough); the readout goes beside the lead weight, or under or over it, out of the
 * cable's way; then the zone names step down clear of both, or are left out where there
 * is no room, because the plaque already says where you are.
 * (After placeLabels in the showcase sketch, docs/art/showcase.)
 */
function placeLabels(sheet: HTMLElement, W: number, L: number, cable: (r: Rect) => boolean): void {
  if (!W || !sheet.isConnected) return;
  const box = sheet.getBoundingClientRect();
  const rel = (el: Element): Rect => {
    const r = el.getBoundingClientRect();
    return { l: r.left - box.left, r: r.right - box.left, t: r.top - box.top, b: r.bottom - box.top };
  };
  const hits = (a: Rect, b: Rect, pad = 2) => a.l < b.r + 4 && a.r > b.l - 4 && a.t < b.b + pad && a.b > b.t - pad;
  const blocks: Rect[] = [];
  // Below the floor the depth marks sit out on the water, where a plaque may need the room.
  const deepTicks = [...sheet.querySelectorAll<HTMLElement>('.lb-tick[data-below]')];
  deepTicks.forEach((t) => (t.hidden = false));

  sheet.querySelectorAll<HTMLElement>('.cth-milestone').forEach((el) => {
    const x = Number(el.dataset.cx);
    const roomR = W - 6 - (x - 11);
    const roomL = x + 11 - L;
    const place = (onLeft: boolean) => {
      el.classList.toggle('flip', onLeft);
      el.style.maxWidth = `${Math.floor(onLeft ? roomL : roomR)}px`;
      el.style.left = onLeft ? '' : `${r1(x - 11)}px`;
      el.style.right = onLeft ? `${r1(W - x - 11)}px` : '';
    };
    el.style.maxWidth = '';
    el.classList.remove('flip');
    const w = el.offsetWidth;
    const left = (x > W * 0.5 && roomL >= w) || (roomR < w && roomL > roomR);
    // The side it would take, unless the other is clearer: of the other plaques first,
    // then of the cable, then of wrapping its name.
    const cost = (onLeft: boolean) => {
      place(onLeft);
      const r = rel(el);
      return (blocks.some((b) => hits(r, b)) ? 4 : 0) + (cable(r) ? 2 : 0) + ((onLeft ? roomL : roomR) < w ? 1 : 0);
    };
    const stay = cost(left);
    if (stay > 0 && cost(!left) >= stay) place(left);
    const r = rel(el);
    blocks.push(r);
    // A plaque over its own depth mark says the depth already: the mark gives way.
    for (const t of deepTicks) {
      const k = rel(t);
      if (!t.hidden && k.l < r.r - 1 && k.r > r.l + 1 && k.t < r.b && k.b > r.t) t.hidden = true;
    }
  });

  const readout = sheet.querySelector<HTMLElement>('.lb-today');
  if (readout) {
    // Beside the lead weight if it fits; otherwise under it, or over it when the cable rose to it.
    const order = readout.hasAttribute('data-rise') ? ['right', 'above', 'below'] : ['right', 'below', 'above'];
    let at = '';
    for (const pos of order) {
      readout.dataset.at = pos;
      const r = rel(readout);
      if (r.l < 2 || r.r > W - 2) continue;
      if (!blocks.some((b) => hits(r, b)) && !cable(r)) {
        at = pos;
        break;
      }
      at ||= pos;
    }
    readout.dataset.at = at || order[1];
    blocks.push(rel(readout));
  }

  sheet.querySelectorAll<HTMLElement>('.lb-zone').forEach((el) => {
    el.hidden = false;
    el.style.top = `${el.dataset.top}px`;
    el.style.right = '';
    const limit = Number(el.dataset.limit);
    for (let pass = 0; pass < 4; pass++) {
      const r = rel(el);
      const hit = blocks.find((b) => hits(r, b));
      if (!hit) return;
      if (hit.b + 3 + (r.b - r.t) <= limit) {
        el.style.top = `${r1(hit.b + 3)}px`; // step down below it
        continue;
      }
      const right = W - hit.l + 8; // or sit to its left
      if (W - right - (r.r - r.l) >= L + 4) {
        el.style.right = `${r1(right)}px`;
        continue;
      }
      break;
    }
    if (blocks.some((b) => hits(rel(el), b))) el.hidden = true;
  });
}
