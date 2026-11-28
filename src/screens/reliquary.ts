// The Reliquary: every Forbidden and Unspeakable answer a diver has brought up
// from a daily dive, kept in the Logbook like relics behind glass. It needs no
// relay: it reads the dives kept in this browser, and the census shares heard for
// them when there were enough divers that day to tell. The rules are in
// src/game/reliquary.ts.

import '../styles/reliquary.css';
import { censusLine } from '../party/census';
import { relicCounts, type Relic } from '../game/reliquary';
import { tierDef } from '../game/theme';
import type { ThemeCopy } from '../game/types';
import { fmtMetres, h } from '../ui/dom';
import { sealSvg } from '../ui/art';
import { dateLabel } from './riddle';

export { collectRelics, reliquaryNote } from '../game/reliquary';

export interface ReliquaryOpts {
  theme: ThemeCopy;
  /** Divers a question needs that day before its share is told. */
  min: number;
  today: number;
}

/** The body of the Reliquary's sheet: what it is, how many, then each relic by dive. */
export function reliquaryBody(relics: Relic[], opts: ReliquaryOpts): HTMLElement[] {
  const { theme } = opts;
  const name = (t: 5 | 6) => tierDef(theme, t)?.name ?? (t === 6 ? 'Unspeakable' : 'Forbidden');
  const { unspeakable, forbidden } = relicCounts(relics);
  const tally = h(
    'p',
    { class: 'reliquary-tally' },
    h('span', { style: '--tier-color: var(--color-tier-6)' }, h('b', {}, String(unspeakable)), ` ${name(6)}`),
    h('span', { class: 'reliquary-tally__sep', 'aria-hidden': 'true' }, '·'),
    h('span', { style: '--tier-color: var(--color-tier-5)' }, h('b', {}, String(forbidden)), ` ${name(5)}`),
  );
  const out: HTMLElement[] = [
    h('p', { class: 'flavor reliquary-intro' }, `Every ${name(5)} and ${name(6)} answer you have brought up from a daily dive, kept behind glass.`),
    tally,
  ];
  if (!relics.length) {
    out.push(h('p', { class: 'reliquary-empty' }, `Nothing rests here yet. Give a ${name(5)} or ${name(6)} answer in a daily dive and it will be kept here.`));
    return out;
  }
  const dives = new Map<number, Relic[]>();
  for (const r of relics) dives.set(r.day, [...(dives.get(r.day) ?? []), r]);
  const list = h('ol', { class: 'reliquary', 'aria-label': 'Your rarest answers, newest dive first' });
  for (const [day, kept] of dives) {
    const date = dateLabel(kept[0].date);
    list.append(
      h(
        'li',
        { class: 'reliquary-dive' },
        h('h3', { class: 'reliquary-dive__head' }, day === opts.today ? `No. ${day} · today` : `No. ${day}${date ? ` · ${date}` : ''}`),
        h('ul', { class: 'reliquary-dive__relics' }, ...kept.map((r) => relicEl(r, name(r.tier), opts))),
      ),
    );
  }
  out.push(list);
  return out;
}

function relicEl(r: Relic, tierName: string, opts: ReliquaryOpts): HTMLElement {
  const told = r.census && r.census.total >= opts.min ? censusLine(r.census, opts.min, true, r.day !== opts.today) : '';
  return h(
    'li',
    { class: `relic${r.tier === 6 ? ' relic--unspeakable' : ''}`, style: `--tier-color: var(--color-tier-${r.tier})` },
    h('span', { class: 'seal relic__seal', 'aria-hidden': 'true', html: sealSvg(r.tier) }),
    h(
      'div',
      { class: 'relic__body' },
      h('p', { class: 'relic__answer' }, `“${r.answer}”`),
      h('p', { class: 'relic__tier' }, h('span', { class: 'relic__name' }, tierName), h('span', { class: 'relic__depth' }, `+${fmtMetres(r.depth)} m`)),
      h('p', { class: 'relic__q' }, r.question),
      told ? h('p', { class: 'relic__census' }, told) : null,
      r.lore ? h('p', { class: 'relic__lore' }, r.lore) : null,
    ),
  );
}
