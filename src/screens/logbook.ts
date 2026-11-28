// The Logbook: one diver's whole career, set out like an expedition's survey chart
// (docs/art/06-interface.md, "The Logbook"). From the top: the title and synopsis in a
// cartouche, the Sigils, the lantern and the wards, the chart, then your soundings and
// the settings row. The head sits in the water of the career depth; only the chart
// runs the whole way from paper to the floor.

import '../styles/logbook.css';
import { MAX_MULT, MAX_WARDS, WEEK, multiplierFor, type Career } from '../game/career';
import type { Persona } from '../game/persona';
import { definingSigils, type Sigil } from '../game/sigils';
import type { Stats } from '../game/stats';
import type { MilestoneDef, ThemeCopy } from '../game/types';
import { loadNumber, saveNumber } from '../game/storage';
import { zoneFor } from '../game/theme';
import { paletteAt, zoneForDepth } from '../../art/js/depth.js';
import { fmtMetres, h } from '../ui/dom';
import { icon, madden, madnessForDepth, markSvg, sealSvg, type IconName } from '../ui/art';
import { FLOOR, careerChart, driftCount } from '../ui/career-chart';

export interface LogbookData {
  theme: ThemeCopy;
  career: Career;
  persona: Persona;
  sigils: Sigil[];
  stats: Stats;
  today: number;
  reduced: boolean;
  /** What else the deep has given: the Sightings, the Reliquary, the Drowned Codex, the Cult. */
  keepsakes?: Keepsake[];
}

export interface Keepsake {
  icon: IconName;
  /** Markup to draw in place of the icon (the Reliquary shows a seal). */
  iconHtml?: string;
  label: string;
  /** One short line: "7 of 24 creatures". */
  note: string;
  onOpen: () => void;
}

export interface LogbookActions {
  onBack: () => void;
  onSettings: () => void;
}

/**
 * Each topic's Sigil in art/glyphs/sigils-sprite.svg (inlined by installArt). A topic
 * the art does not know yet takes the knot of loose ends.
 */
export const SIGIL_ART: { viewBox: string; fallback: string; topics: Readonly<Record<string, string>> } = {
  viewBox: '-4 -4 40 40',
  fallback: 'sigil-misc',
  topics: {
    geography: 'sigil-geography',
    science: 'sigil-science',
    nature: 'sigil-nature',
    culture: 'sigil-culture',
    history: 'sigil-history',
    myth: 'sigil-myth',
    food: 'sigil-food',
    language: 'sigil-language',
    sport: 'sigil-sport',
    misc: 'sigil-misc',
  },
};

export const sigilSymbol = (topic: string): string => (Object.hasOwn(SIGIL_ART.topics, topic) ? SIGIL_ART.topics[topic] : SIGIL_ART.fallback);

/** The words for a Sigil's four levels, as the art kit names them. */
export const SIGIL_LEVEL_NAMES = ['unlit', 'kindled', 'burning', 'blazing'] as const;

/** The title may take the madness below 2,500 m, but never so much that it cannot be read. */
const TITLE_MADNESS = 0.42;

// The cable pays itself out the first time the Logbook opens each day. Kept like the
// rest of the player's things (memory only under ?fresh, or when storage is blocked).
function firstOpenToday(today: number): boolean {
  if (loadNumber('logbookCable') === today) return false;
  saveNumber('logbookCable', today);
  return true;
}

let seq = 0;

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const num = (n: number) => (n <= 10 ? WORDS[n] : fmtMetres(n));
const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
/** The log's way: always figures ("12 days"), for readings and tallies. */
const tally = (n: number, one: string, many = `${one}s`) => `${fmtMetres(n)} ${n === 1 ? one : many}`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const times = (m: number) => `×${Number.isInteger(m) ? m : m.toFixed(1)}`;

const SVG_NS = 'http://www.w3.org/2000/svg';
/** An inline <svg> that shows one symbol from the sprites. */
function useSvg(cls: string, viewBox: string, href: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('class', cls);
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  const u = document.createElementNS(SVG_NS, 'use');
  u.setAttribute('href', `#${href}`);
  s.append(u);
  return s;
}

export function logbookScreen(data: LogbookData, actions: LogbookActions): HTMLElement {
  const { theme, career, persona, sigils, stats, today, reduced } = data;
  const uid = `lb${++seq}`;
  const id = (k: string) => `${uid}-${k}`;
  const marks: MilestoneDef[] = [...theme.career.milestones].sort((a, b) => a.depth - b.depth);
  const next = career.next >= 0 ? marks[career.next] : undefined;
  const depth = career.depth;
  const water = Math.min(depth, FLOOR);
  const pal = paletteAt(water);

  const section = h('section', {
    class: 'screen logbook-screen',
    'aria-labelledby': `${id('name')} ${id('title')}`,
    'data-zone': zoneForDepth(water).key,
    'data-floor': depth >= FLOOR,
    'data-bloom': !reduced,
    'data-still': reduced,
    style: `--lb-water:${pal.water};--lb-fog:${pal.fog}`,
  });

  // ---------------------------------------------------------------- the bar
  const bar = h(
    'header',
    { class: 'lb-bar' },
    h('button', { class: 'icon-btn lb-iconbtn', type: 'button', 'aria-label': 'Back', title: 'Back', onclick: () => actions.onBack(), html: icon('back') }),
    h('p', { class: 'lb-bar__name', id: id('name') }, 'The Logbook'),
    h('button', { class: 'icon-btn lb-iconbtn', type: 'button', 'aria-label': 'Settings', title: 'Settings', onclick: () => actions.onSettings(), html: icon('settings') }),
  );

  // ---------------------------------------------------------------- the cartouche
  const title = h('h1', { class: 'lb-title', id: id('title') }, persona.title);
  const zoneName = zoneFor(theme, depth).name;
  const cartouche = h(
    'header',
    { class: 'lb-cartouche' },
    h('p', { class: 'lb-kicker' }, 'a survey of the'),
    title,
    h('div', { class: 'cth-rule lb-cartouche__rule', 'aria-hidden': 'true', html: markSvg('diver') }),
    persona.synopsis.length ? h('p', { class: 'lb-synopsis' }, persona.synopsis.join(' ')) : null,
    h(
      'p',
      { class: 'lb-depth' },
      h('span', { class: 'lb-depth__m' }, `${fmtMetres(depth)} m`),
      h('span', { class: 'lb-depth__k' }, `career depth · ${zoneName}`),
      next
        ? h('span', { class: 'lb-depth__next' }, `${fmtMetres(Math.max(0, next.depth - depth))} m to ${next.name}`)
        : career.daysPlayed
          ? h('span', { class: 'lb-depth__next' }, 'Every milestone is behind you.')
          : null,
    ),
  );

  // ---------------------------------------------------------------- the Sigils
  const ranked = definingSigils(sigils);
  const top = ranked[0];
  const grid = h('ul', { class: 'lb-sigils__grid', role: 'list' });
  sigils.forEach((s, i) => {
    grid.append(
      h(
        'li',
        { class: 'lb-sigils__cell', style: `--i:${i}`, 'data-top': s === top },
        h(
          'figure',
          { class: 'cth-sigil', 'data-level': s.level },
          useSvg('cth-sigil__glyph', SIGIL_ART.viewBox, sigilSymbol(s.topic)),
          h(
            'figcaption',
            {},
            s.name,
            ' ',
            h('span', {}, SIGIL_LEVEL_NAMES[s.level]),
            h('span', { class: 'visually-hidden' }, s.answered ? `, ${plural(s.answered, 'answer')}` : ', not yet met'),
          ),
        ),
      ),
    );
  });
  const sigilNote = ranked.length
    ? ranked.length > 1 && ranked[ranked.length - 1].strength < top.strength
      ? `Strongest in ${top.name}, ${SIGIL_LEVEL_NAMES[top.level]}. Weakest in ${ranked[ranked.length - 1].name}.`
      : `Strongest in ${top.name}, ${SIGIL_LEVEL_NAMES[top.level]}.`
    : 'A Sigil kindles as you give rare answers in its topic. Three answers are enough to read it.';
  const sigilBlock = h(
    'section',
    { class: 'lb-block lb-sigils', 'aria-labelledby': id('sigils') },
    sechead(id('sigils'), 'Sigils', 'what you know best'),
    grid,
    h('p', { class: 'lb-note' }, sigilNote),
  );

  // ---------------------------------------------------------------- the lantern and the wards
  const keep = h(
    'section',
    { class: 'lb-block lb-keep', 'aria-labelledby': id('keep') },
    sechead(id('keep'), 'The lantern', career.bestStreak > career.streak ? `longest ${tally(career.bestStreak, 'day')}` : ''),
    career.away ? awayNote(career) : null,
    h('div', { class: 'lb-keep__pair' }, lantern(career), wards(career, theme)),
  );

  // ---------------------------------------------------------------- the chart
  const chart = careerChart({
    career,
    milestones: marks,
    zones: theme.zones,
    today,
    payout: !reduced && career.daysPlayed > 0 && firstOpenToday(today),
    motion: !reduced,
    uid: id('chart'),
    onDrawn: (first) => {
      if (!first) return;
      // A new diver opens at the top, on the empty title; anyone else at today's weight.
      if (career.daysPlayed > 0) showLead(section, chart.lead());
      // The deep gets into the title below 2,500 m (never the synopsis), once the
      // screen is in the page, so the app's change of screen does not calm it at once.
      const level = Math.min(TITLE_MADNESS, madnessForDepth(depth));
      if (level > 0) madden(title, 0, reduced, level);
    },
  });
  const days = career.firstDay === null ? 0 : today - career.firstDay + 1;
  const drifts = driftCount(career.points);
  const surveyNote = career.daysPlayed ? [tally(days, 'day'), drifts ? tally(drifts, 'drift') : ''].filter(Boolean).join(' · ') : '';
  const survey = h('section', { class: 'lb-block lb-survey', 'aria-labelledby': id('survey') }, sechead(id('survey'), 'The survey', surveyNote), chart.el);

  // ---------------------------------------------------------------- your soundings, and the settings row
  const soundings = h(
    'section',
    { class: 'lb-block lb-soundings', 'aria-labelledby': id('soundings') },
    sechead(id('soundings'), 'Your soundings', ''),
    ...(stats.played || career.daysPlayed ? soundingsBody(data, marks) : [h('p', { class: 'lb-note' }, 'No soundings yet. Your first dive takes them.')]),
  );
  const foot = h(
    'footer',
    { class: 'lb-foot' },
    h(
      'div',
      { class: 'lb-foot__row' },
      h('button', { class: 'btn', type: 'button', onclick: () => actions.onSettings(), html: `${icon('settings')}<span>Settings</span>` }),
      h('button', { class: 'btn ghost', type: 'button', onclick: () => actions.onBack(), html: `${icon('back')}<span>Back to the surface</span>` }),
    ),
    h('p', { class: 'lb-foot__note' }, 'Your logbook is kept only in this browser.'),
  );

  const keepsakes = data.keepsakes?.length
    ? h(
        'section',
        { class: 'lb-block lb-keepsakes', 'aria-labelledby': id('keepsakes') },
        sechead(id('keepsakes'), 'Keepsakes', ''),
        h(
          'div',
          { class: 'lb-keepsakes__row' },
          ...data.keepsakes.map((k) =>
            h(
              'button',
              { class: 'btn lb-keepsake', type: 'button', onclick: () => k.onOpen() },
              h('span', { class: 'lb-keepsake__icon', 'aria-hidden': 'true', html: k.iconHtml ?? icon(k.icon) }),
              h('span', { class: 'lb-keepsake__label' }, k.label),
              h('span', { class: 'lb-keepsake__note' }, k.note),
            ),
          ),
        ),
      )
    : null;
  const head = h('div', { class: 'lb-head' }, cartouche, sigilBlock, keep);
  const tail = h('div', { class: 'lb-tail' }, soundings, keepsakes, foot);
  section.append(bar, h('div', { class: 'lb-page' }, head, survey, tail));

  // The chart's pane on a wide screen is as tall as the screen itself.
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(() => section.style.setProperty('--lb-vh', `${section.clientHeight}px`)).observe(section);
  }
  return section;
}

/** A section heading: small capitals, an engraved rule, and a note at the end of it. */
function sechead(hid: string, text: string, aside: string): HTMLElement {
  return h('div', { class: 'lb-sechead' }, h('h2', { class: 'lb-h2', id: hid }, text), aside ? h('p', { class: 'lb-aside' }, aside) : null);
}

/** Open the page with today's lead weight in view, a little above the bottom of the window. */
function showLead(section: HTMLElement, lead: Element | null): void {
  if (!lead) return;
  // On a wide screen the chart scrolls in its own pane; on a phone the whole page scrolls.
  let scroller: HTMLElement | null = (lead as SVGElement).ownerSVGElement?.parentElement ?? null;
  while (scroller && scroller !== section) {
    const oy = getComputedStyle(scroller).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && scroller.scrollHeight > scroller.clientHeight + 1) break;
    scroller = scroller.parentElement;
  }
  const box = (scroller ?? section).getBoundingClientRect();
  const r = lead.getBoundingClientRect();
  const el = scroller ?? section;
  const inView = r.top >= box.top + 64 && r.bottom <= box.bottom - 72;
  if (!inView) el.scrollTop += r.top - box.top - el.clientHeight * 0.66;
}

function awayNote(career: Career): HTMLElement {
  const away = career.away!;
  const lines = [`You were away ${plural(away.days, 'day')}.`];
  if (away.wardsSpent) {
    const held = away.wardsSpent === away.days ? (away.days === 1 ? 'it' : 'them') : away.wardsSpent === 1 ? 'one of them' : `${num(away.wardsSpent)} of them`;
    lines.push(`${away.wardsSpent === 1 ? 'A ward' : `${cap(num(away.wardsSpent))} wards`} held ${held}.`);
  }
  if (away.drift > 0) lines.push(`The sea gave back ${fmtMetres(away.drift)} m.`);
  else if (!away.wardsSpent) lines.push('A milestone held you where you were.');
  return h('p', { class: 'lb-away' }, h('span', { class: 'lb-away__icon', 'aria-hidden': 'true', html: icon('drift') }), h('span', {}, lines.join(' ')));
}

function lantern(career: Career): HTMLElement {
  const lit = career.streak > 0;
  const state = lit ? 'lit' : career.daysPlayed ? 'out' : 'unlit';
  const lines: string[] = [];
  if (!career.daysPlayed) {
    lines.push('Your first dive lights it. Each week it burns adds a tenth to every dive, up to double.');
  } else if (!lit) {
    lines.push('Your lantern has gone out. Dive today to light it again.');
  } else {
    if (!career.playedToday) lines.push('Dive today to keep it lit.');
    const mult = career.nextMult;
    if (mult >= MAX_MULT) lines.push(`Your next dive counts ${times(mult)}. It burns no brighter than this.`);
    else {
      const upDay = WEEK * (Math.floor(career.streak / WEEK) + 1) + 1;
      lines.push(`${mult > 1 ? `Your next dive counts ${times(mult)}. ` : ''}From day ${fmtMetres(upDay)} of the lantern, ${times(multiplierFor(upDay))}.`);
    }
  }
  const big = lit
    ? [h('span', { class: 'lb-big' }, fmtMetres(career.streak)), h('span', { class: 'lb-unit' }, career.streak === 1 ? 'day' : 'days')]
    : [h('span', { class: 'lb-big lb-big--word' }, state === 'out' ? 'Out' : 'Unlit')];
  return h(
    'div',
    { class: 'lb-lantern', 'data-state': state },
    h('span', { class: 'lb-lantern__art', 'aria-hidden': 'true', html: icon('streak', 'lb-lantern__icon') }),
    h(
      'div',
      { class: 'lb-lantern__text' },
      h('p', { class: 'lb-figure' }, h('span', { class: 'visually-hidden' }, 'Lantern: '), ...big),
      h('p', { class: 'lb-line' }, lines.join(' ')),
    ),
  );
}

function wards(career: Career, theme: ThemeCopy): HTMLElement {
  const held = Math.min(MAX_WARDS, career.wards);
  const spent = Math.min(MAX_WARDS - held, career.away?.wardsSpent ?? 0);
  const states = Array.from({ length: MAX_WARDS }, (_, i) => (i < held ? 'held' : i < held + spent ? 'spent' : 'empty'));
  const slots = h('div', {
    class: 'lb-wards__slots',
    role: 'img',
    'aria-label': `${cap(num(held))} of ${num(MAX_WARDS)} wards held`,
    html: states.map((s) => markSvg(s === 'spent' ? 'ward-spent' : 'ward', 'cth-ward', `data-state="${s}"`)).join(''),
  });
  let earn: string;
  if (held >= MAX_WARDS) earn = 'You hold both. Two is as many as a diver can carry.';
  else if (career.streak > 0) {
    const n = WEEK - (career.streak % WEEK);
    earn = n === 1 ? 'One more dive earns a ward.' : `${cap(num(n))} more dives earn a ward.`;
  } else earn = 'Seven days of lantern earn a ward.';
  const name = theme.career.ward.name || 'Ward';
  return h(
    'div',
    { class: 'lb-wards', 'data-held': held },
    slots,
    h(
      'div',
      { class: 'lb-wards__text' },
      h('h3', { class: 'lb-h3' }, `${name}s`, h('span', { class: 'lb-h3__count' }, ` ${held} of ${MAX_WARDS} held`)),
      h('p', { class: 'lb-line' }, `${theme.career.ward.blurb} ${earn}`),
    ),
  );
}

function soundingsBody(data: LogbookData, marks: MilestoneDef[]): HTMLElement[] {
  const { theme, career, sigils, stats } = data;
  const cell = (k: string, v: string) => h('div', {}, h('dt', {}, k), h('dd', {}, v));
  const grid = h(
    'dl',
    { class: 'lb-stats' },
    cell('Dives', fmtMetres(stats.played)),
    cell('Deepest dive', `${fmtMetres(stats.deepest)} m`),
    cell('Average dive', `${fmtMetres(stats.average)} m`),
    cell('Unspeakable', fmtMetres(stats.unspeakables)),
    cell('Longest lantern', tally(career.bestStreak, 'day')),
    cell('Milestones', marks.length ? `${career.passed.length} of ${marks.length}` : '0'),
  );

  // Answers by rarity, as the old sheet had them: a seal, a name and a hatched bar each.
  const most = Math.max(1, ...stats.tierCounts.slice(1));
  const bars = h('div', { class: 'tier-bars lb-tiers' });
  for (const t of theme.tiers) {
    const n = stats.tierCounts[t.tier] ?? 0;
    bars.append(
      h(
        'div',
        { class: 'bar', style: `--tier-color: var(--color-tier-${t.tier})` },
        h('span', { class: 'bar-name' }, h('span', { class: 'seal', 'aria-hidden': 'true', html: sealSvg(t.tier) }), t.name),
        h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'fill', style: `width:${((n / most) * 100).toFixed(1)}%` })),
        h('span', { class: 'log' }, fmtMetres(n)),
      ),
    );
  }

  // By topic: every topic met, strongest first, with how bright its Sigil burns.
  const met = [...sigils].filter((s) => s.answered > 0).sort((a, b) => b.strength - a.strength || b.answered - a.answered);
  const unmet = sigils.filter((s) => s.answered === 0);
  const topics = h('ol', { class: 'lb-topics', role: 'list' });
  for (const s of met) {
    topics.append(
      h(
        'li',
        { class: 'lb-topic', 'data-level': s.level },
        useSvg('lb-topic__glyph', SIGIL_ART.viewBox, sigilSymbol(s.topic)),
        h(
          'span',
          { class: 'lb-topic__name' },
          s.name,
          h('span', { class: 'lb-topic__n' }, [tally(s.answered, 'answer'), s.rare ? `${fmtMetres(s.rare)} rare` : ''].filter(Boolean).join(' · ')),
        ),
        h('span', { class: 'lb-topic__level' }, SIGIL_LEVEL_NAMES[s.level]),
        h('span', { class: 'lb-topic__bar', 'aria-hidden': 'true' }, h('span', { style: `width:${(s.strength * 100).toFixed(1)}%` })),
      ),
    );
  }

  const out: HTMLElement[] = [
    grid,
    h('h3', { class: 'lb-h3 lb-h3--rule' }, 'Answers by rarity'),
    bars,
    h('h3', { class: 'lb-h3 lb-h3--rule' }, 'By topic'),
    met.length ? topics : h('p', { class: 'lb-note' }, 'No topic has been met yet.'),
  ];
  if (unmet.length && met.length) out.push(h('p', { class: 'lb-note' }, `Not yet met: ${unmet.map((s) => s.name).join(', ')}.`));
  return out;
}
