// The bestiary on screen: a sighting on the reveal, and the collection of every
// creature by zone. Until the specimen plates are drawn, each creature shows a
// Drowned Script glyph for its zone in a roundel.

import type { Sighting } from '../game/bestiary';
import { bestiaryByZone } from '../game/bestiary';
import type { CreatureDef, ThemeCopy, ZoneKey } from '../game/types';
import { fmtMetres, h } from './dom';
import '../styles/bestiary.css';

/** The glyph that stands in for a zone's creatures until their plates exist. */
export const ZONE_GLYPH: Record<ZoneKey, string> = {
  surface: 'tide',
  twilight: 'eye',
  midnight: 'maw',
  abyss: 'coil',
  hadal: 'sleeper',
  floor: 'spire',
};

/** A creature's plate, as markup. Decorative: the name is always written beside it. */
export function plateMarkup(c: CreatureDef): string {
  return `<svg class="specimen-glyph" viewBox="0 0 20 32" aria-hidden="true" focusable="false"><use href="#g-${ZONE_GLYPH[c.zone] ?? 'eye'}"/></svg>`;
}

/** The sighting on the reveal: what passed the porthole, and where. */
export function sightingCard(c: CreatureDef, s: Sighting, seen: number, total: number): HTMLElement {
  return h(
    'figure',
    { class: 'plate sighting', 'data-kind': c.kind, 'data-zone-of': c.zone },
    h('div', { class: 'roundel', html: plateMarkup(c) }),
    h(
      'figcaption',
      {},
      h('p', { class: 'kicker' }, `A sighting · ${fmtMetres(s.depth)} m`),
      h('p', { class: 'sighting-name' }, c.name),
      h('p', { class: 'sighting-line' }, c.line),
      h('p', { class: 'sighting-count' }, `${seen} of ${total} creatures sighted`),
    ),
  );
}

/** Every creature, by zone: the ones seen with their line, fact and where; the rest as shapes in the dark. */
export function bestiaryBody(theme: ThemeCopy, creatures: CreatureDef[], sightings: Record<string, Sighting>): HTMLElement[] {
  const seen = creatures.filter((c) => sightings[c.id]).length;
  const out: HTMLElement[] = [
    h(
      'p',
      { class: 'flavor bestiary-intro' },
      `${seen} of ${creatures.length} sighted. A Forbidden or Unspeakable answer pays out enough cable to meet something new, in the zone where you meet it.`,
    ),
  ];
  const zones = [...theme.zones].sort((a, b) => a.from - b.from);
  for (const group of bestiaryByZone(theme, creatures, sightings)) {
    const next = zones[zones.indexOf(group.zone) + 1];
    const range = next ? `${fmtMetres(group.zone.from)}–${fmtMetres(next.from)} m` : `${fmtMetres(group.zone.from)} m and below`;
    const list = h('ul', { class: 'bestiary-list' });
    for (const { creature: c, sighting: s } of group.creatures) {
      const known = !!s;
      const name = known || c.kind === 'real' ? c.name : 'Something unnamed';
      list.append(
        h(
          'li',
          { class: `specimen${known ? ' seen' : ''}`, 'data-kind': c.kind },
          h('div', { class: 'roundel', html: plateMarkup(c) }),
          h(
            'div',
            { class: 'specimen-text' },
            h('p', { class: 'specimen-name' }, name),
            known ? h('p', { class: 'specimen-line' }, c.line) : h('p', { class: 'specimen-unseen' }, 'Not yet sighted'),
            known ? h('p', { class: 'specimen-fact' }, c.fact) : null,
            known && s ? h('p', { class: 'specimen-when' }, `Dive No. ${s.day} · ${fmtMetres(s.depth)} m`) : null,
          ),
        ),
      );
    }
    out.push(h('h3', { class: 'bestiary-zone' }, group.zone.name, h('span', { class: 'range' }, range)), list);
  }
  return out;
}
