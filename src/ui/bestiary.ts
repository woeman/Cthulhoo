// The bestiary on screen: a sighting on the reveal, and the collection of every
// creature by zone, drawn from the art kit's specimen plates (src/ui/plates.ts).
// A creature not yet met is only its silhouette, and never its name.

import artBestiary from '../../art/bestiary/bestiary.json';
import type { Sighting } from '../game/bestiary';
import { bestiaryByZone } from '../game/bestiary';
import type { CreatureDef, ThemeCopy, ZoneKey } from '../game/types';
import { fmtMetres, h } from './dom';
import { plateInto } from './plates';
import '../styles/bestiary.css';

/** The glyph that stands in for a creature the art has drawn no plate for. */
export const ZONE_GLYPH: Record<ZoneKey, string> = {
  surface: 'tide',
  twilight: 'eye',
  midnight: 'maw',
  abyss: 'coil',
  hadal: 'sleeper',
  floor: 'spire',
};

const glyphMarkup = (c: CreatureDef) =>
  `<svg class="specimen-glyph" viewBox="0 0 20 32" aria-hidden="true" focusable="false"><use href="#g-${ZONE_GLYPH[c.zone] ?? 'eye'}"/></svg>`;

/** A real creature's Latin name, from the plate's note ("Mola mola: the heaviest bony fish…"). */
const LATIN = new Map<string, string>();
for (const c of artBestiary as Array<{ id: string; note?: string }>) {
  const m = /^([A-Z][a-z]+(?: [a-z]+){0,2}):/.exec(c.note ?? '');
  if (m) LATIN.set(c.id, m[1]);
}
export const latinName = (id: string): string | null => LATIN.get(id) ?? null;

/** A frame holding a creature's plate, or its silhouette if it has not been met. */
export function specimenFrame(c: CreatureDef, seen: boolean, opts: { bloom?: boolean; large?: boolean } = {}): HTMLElement {
  const frame = h('span', { class: `specimen-frame${seen ? '' : ' unseen'}${opts.large ? ' large' : ''}`, 'data-kind': c.kind });
  plateInto(frame, c.id, seen ? 'plate' : 'silhouette', { bloom: opts.bloom, fallback: glyphMarkup(c) });
  return frame;
}

/** The sighting on the reveal: what passed the porthole, and where. */
export function sightingCard(c: CreatureDef, s: Sighting, seen: number, total: number): HTMLElement {
  return h(
    'figure',
    { class: 'plate sighting', 'data-kind': c.kind, 'data-zone-of': c.zone },
    specimenFrame(c, true, { bloom: true }),
    h(
      'figcaption',
      {},
      h('p', { class: 'kicker' }, `A sighting · ${fmtMetres(s.depth)} m`),
      h('p', { class: 'sighting-name' }, c.name),
      latinName(c.id) ? h('p', { class: 'sighting-latin' }, latinName(c.id)) : null,
      h('p', { class: 'sighting-line' }, c.line),
      h('p', { class: 'sighting-count' }, `${seen} of ${total} creatures sighted`),
    ),
  );
}

/**
 * Every creature, by zone, four to a row: the ones met as their plates, the rest
 * as shapes in the dark. The latest sighting lies open at the top; tapping
 * another plate opens that one instead.
 */
export function bestiaryBody(theme: ThemeCopy, creatures: CreatureDef[], sightings: Record<string, Sighting>): HTMLElement[] {
  const seen = creatures.filter((c) => sightings[c.id]);
  const out: HTMLElement[] = [
    h(
      'p',
      { class: 'flavor bestiary-intro' },
      seen.length
        ? `${seen.length} of ${creatures.length} sighted. A Forbidden or Unspeakable answer pays out enough cable to meet something new, in the zone where you meet it.`
        : `None of ${creatures.length} sighted yet. A Forbidden or Unspeakable answer pays out enough cable to meet something, in the zone where you meet it. Until then, they are only shapes in the dark.`,
    ),
  ];
  const zones = [...theme.zones].sort((a, b) => a.from - b.from);
  const rangeOf = (key: ZoneKey) => {
    const z = zones.find((x) => x.key === key);
    if (!z) return '';
    const next = zones[zones.indexOf(z) + 1];
    return next ? `${fmtMetres(z.from)}–${fmtMetres(next.from)} m` : `${fmtMetres(z.from)} m and below`;
  };

  const feature = h('section', { class: 'specimen-feature', 'aria-live': 'polite' });
  const cells = new Map<string, HTMLButtonElement>();
  const open = (c: CreatureDef, bloom: boolean) => {
    const s = sightings[c.id];
    const zone = zones.find((z) => z.key === c.zone);
    const latin = latinName(c.id);
    feature.dataset.kind = c.kind;
    feature.replaceChildren(
      specimenFrame(c, true, { bloom, large: true }),
      h(
        'div',
        { class: 'specimen-feature__head' },
        zone ? h('p', { class: 'specimen-feature__zone' }, h('span', {}, zone.name), ' · ', h('span', { class: 'range' }, rangeOf(c.zone))) : null,
        h('p', { class: 'specimen-feature__name' }, c.name),
        latin ? h('p', { class: 'specimen-feature__latin' }, latin) : null,
        s ? h('p', { class: 'specimen-feature__when' }, `Dive No. ${s.day} · ${fmtMetres(s.depth)} m`) : null,
      ),
      h('div', { class: 'specimen-feature__body' }, h('p', { class: 'specimen-feature__line' }, c.line), h('p', { class: 'specimen-feature__fact' }, c.fact)),
    );
    for (const [id, b] of cells) b.setAttribute('aria-pressed', String(id === c.id));
  };
  const latest = [...seen].sort((a, b) => sightings[b.id].at - sightings[a.id].at)[0];
  if (latest) out.push(feature);

  for (const group of bestiaryByZone(theme, creatures, sightings)) {
    const list = h('ul', { class: 'bestiary-grid' });
    for (const { creature: c, sighting: s } of group.creatures) {
      if (s) {
        const cell = h(
          'button',
          { class: 'specimen-cell seen', type: 'button', 'aria-pressed': 'false', 'data-kind': c.kind },
          specimenFrame(c, true),
          h('span', { class: 'specimen-cell__name' }, c.name),
        );
        cell.addEventListener('click', () => {
          if (cell.getAttribute('aria-pressed') === 'true') return;
          open(c, true);
          const reduced = document.documentElement.classList.contains('reduced-motion');
          feature.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        });
        cells.set(c.id, cell);
        list.append(h('li', {}, cell));
      } else {
        list.append(h('li', {}, h('div', { class: 'specimen-cell' }, specimenFrame(c, false), h('span', { class: 'specimen-cell__name' }, 'Unseen'))));
      }
    }
    out.push(h('h3', { class: 'bestiary-zone' }, group.zone.name, h('span', { class: 'range' }, rangeOf(group.zone.key as ZoneKey))), list);
  }
  if (latest) open(latest, false);
  return out;
}
