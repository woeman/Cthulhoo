// The career on the title and results screens: lifetime depth, the lantern, the
// wards, the next milestone, and the telegrams the ship sends about them.

import type { Career, CareerDay } from '../game/career';
import { MAX_WARDS, toNextMilestone } from '../game/career';
import type { News } from '../game/news';
import type { MilestoneDef } from '../game/types';
import { icon, markSvg } from './art';
import { fmtMetres, h } from './dom';
import '../styles/career.css';

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

/** One telegram line as markup, with each STOP inked in red. */
export const telegramLine = (line: string): string => esc(line.trim()).replace(/\bSTOP\b/gi, '<b>stop</b>');

/** A telegram slip lowered from the surface. Tap it to send it back up. */
export function telegramEl(news: News, head: [string, string]): HTMLElement {
  const el = h(
    'div',
    { class: 'cth-telegram telegram-toast', 'data-kind': news.kind, 'aria-hidden': 'true' },
    h('div', { class: 'cth-telegram__head' }, h('span', {}, head[0]), h('span', {}, head[1])),
  );
  for (const line of news.lines) el.append(h('p', { html: telegramLine(line) }));
  return el;
}

/** Ward slots: a hag stone for each ward held, a faint one for each still to earn. */
export function wardSlots(held: number, spentToday = 0): HTMLElement {
  const wrap = h('span', { class: 'ward-slots', 'aria-hidden': 'true' });
  for (let i = 0; i < MAX_WARDS; i++) {
    const state = i < held ? 'held' : i < held + spentToday ? 'spent' : 'empty';
    wrap.insertAdjacentHTML('beforeend', markSvg(state === 'spent' ? 'ward-spent' : 'ward', 'cth-ward', `data-state="${state}"`));
  }
  return wrap;
}

/** A milestone carved in stone: reached, ahead, or carved today. */
export function milestonePlaque(m: MilestoneDef, state: 'passed' | 'ahead' | 'new' = 'passed'): HTMLElement {
  const el = h('div', { class: 'cth-milestone', 'data-state': state === 'ahead' ? 'ahead' : undefined, 'data-new': state === 'new' ? true : undefined });
  el.insertAdjacentHTML('beforeend', markSvg('milestone', 'cth-milestone__mark'));
  el.append(h('div', { class: 'cth-milestone__plaque' }, h('span', { class: 'cth-milestone__name' }, m.name), h('span', { class: 'cth-milestone__depth' }, `${fmtMetres(m.depth)} m`)));
  return el;
}

/** How far to the next milestone, with a thin line paid out from the last one. */
export function nextMilestoneRow(career: Career, marks: MilestoneDef[]): HTMLElement | null {
  const togo = toNextMilestone(career, marks);
  if (togo === null || career.next < 0) return null;
  const next = marks[career.next];
  const from = career.next > 0 ? marks[career.next - 1].depth : 0;
  const share = Math.max(0, Math.min(1, (career.depth - from) / Math.max(1, next.depth - from)));
  return h(
    'div',
    { class: 'cs-next' },
    h('span', { class: 'cs-next-mark', html: markSvg('milestone') }),
    h('span', { class: 'cs-next-text' }, h('span', { class: 'cs-togo' }, `${fmtMetres(togo)} m`), ' to ', h('span', { class: 'cs-next-name' }, next.name)),
    h('span', { class: 'cs-line', role: 'img', 'aria-label': `${Math.round(share * 100)}% of the way from ${from ? fmtMetres(from) + ' m' : 'the surface'}` }, h('span', { style: `width:${(share * 100).toFixed(1)}%` })),
  );
}

export interface StripParts {
  el: HTMLElement;
  /** The career depth's number, for counting it to a new value. */
  num: HTMLElement;
}

/** The title's career plate: lifetime depth, the lantern and its multiplier, the wards, the next milestone. */
export function careerStrip(career: Career, marks: MilestoneDef[], news: News | null): StripParts {
  const num = h('span', { class: 'num' }, fmtMetres(career.depth));
  const lit = career.streak > 0;
  const lantern = h(
    'div',
    { class: `cs-lantern${lit ? '' : ' out'}` },
    h('span', { class: 'cs-icon', html: icon('streak') }),
    h('span', { class: 'cs-v' }, lit ? `${career.streak} ${career.streak === 1 ? 'day' : 'days'}` : 'Unlit'),
    career.nextMult > 1 ? h('span', { class: 'cs-mult', title: 'What your next dive counts for' }, `×${career.nextMult.toFixed(1)}`) : null,
  );
  const wards = h(
    'div',
    { class: 'cs-wards' },
    wardSlots(career.wards),
    h('span', { class: 'cs-v' }, career.wards === 1 ? '1 ward' : `${career.wards} wards`),
  );
  const drifted = news && (news.kind === 'drift' || news.kind === 'ward-spent');
  const el = h(
    'section',
    { class: 'plate career-strip', 'aria-label': 'Your career' },
    h('div', { class: 'cs-depth' }, h('span', { class: 'cs-big' }, num, h('span', { class: 'unit' }, ' m')), h('span', { class: 'cs-k' }, 'career depth')),
    h(
      'div',
      { class: 'cs-side' },
      lantern,
      h('span', { class: 'visually-hidden' }, lit ? `Lantern lit for ${career.streak} days; your next dive counts ×${career.nextMult.toFixed(1)}.` : 'Lantern unlit; dive today to light it.'),
      wards,
    ),
    nextMilestoneRow(career, marks),
    drifted ? h('p', { class: `cs-news ${news.kind}` }, h('span', { class: 'cs-news-icon', html: icon(news.kind === 'drift' ? 'drift' : 'ward') }), news.plain) : null,
  );
  return { el, num };
}

/** The results' career plate: what today's dive added, milestones carved, a ward earned. */
export function careerGainPlate(career: Career, day: CareerDay, marks: MilestoneDef[], news: News | null): StripParts {
  const num = h('span', { class: 'num' }, fmtMetres(day.after));
  const d = day.dive;
  const gain = d
    ? h(
        'p',
        { class: 'cg-gain' },
        `+${fmtMetres(d.gained)} m today`,
        d.mult > 1 ? h('span', { class: 'cg-mult' }, ` · lantern ×${d.mult.toFixed(1)}`) : null,
      )
    : null;
  const carved = day.milestones.filter((i) => marks[i]).map((i) => marks[i]);
  const el = h(
    'section',
    { class: 'plate career-gain', 'aria-label': 'Your career' },
    h('p', { class: 'kicker' }, 'Your career'),
    h('p', { class: 'cg-total' }, num, h('span', { class: 'unit' }, ' m')),
    gain,
    ...carved.map((m) =>
      h('div', { class: 'cg-carved' }, h('p', { class: 'cg-carved-k' }, 'A milestone is carved'), milestonePlaque(m, 'new'), m.line ? h('p', { class: 'cg-carved-line' }, m.line) : null),
    ),
    news && news.kind === 'ward-earned' ? h('p', { class: 'cg-ward' }, wardSlots(career.wards), h('span', {}, news.plain)) : null,
    nextMilestoneRow(career, marks),
  );
  return { el, num };
}

/** Count a number from one value to another, easing out. Returns a cancel. */
export function countUp(el: HTMLElement, from: number, to: number, ms: number, reduced: boolean): () => void {
  if (reduced || ms <= 0 || from === to) {
    el.textContent = fmtMetres(to);
    return () => {};
  }
  let raf = 0;
  let t0 = -1;
  const step = (now: number) => {
    if (t0 < 0) t0 = now;
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtMetres(from + (to - from) * e);
    if (t < 1) raf = requestAnimationFrame(step);
  };
  el.textContent = fmtMetres(from);
  raf = requestAnimationFrame(step);
  return () => {
    cancelAnimationFrame(raf);
    el.textContent = fmtMetres(to);
  };
}
