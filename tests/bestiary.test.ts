import { describe, expect, it } from 'vitest';
import { bestiaryByZone, sightingAlong } from '../src/game/bestiary';
import { PLACEHOLDER_THEME } from '../src/game/theme';
import type { CreatureDef, ZoneKey } from '../src/game/types';

const theme = PLACEHOLDER_THEME;
const C = (id: string, zone: ZoneKey): CreatureDef => ({ id, name: id, zone, kind: 'real', line: '', fact: '' });
const creatures = [C('jelly', 'surface'), C('weed', 'surface'), C('barreleye', 'twilight'), C('squid', 'twilight'), C('angler', 'midnight'), C('dagon', 'floor')];
const zoneOf = (id: string) => creatures.find((c) => c.id === id)!.zone;

describe('sightings', () => {
  it('sees a creature from a zone the cable passes', () => {
    for (let i = 0; i < 40; i++) {
      const s = sightingAlong(theme, creatures, new Set(), 0, 800, `seed${i}`)!;
      expect(['surface', 'twilight']).toContain(zoneOf(s.creature.id));
      expect(s.depth).toBeGreaterThanOrEqual(0);
      expect(s.depth).toBeLessThanOrEqual(800);
    }
  });

  it('puts the creature at a depth inside its own zone', () => {
    for (let i = 0; i < 40; i++) {
      const s = sightingAlong(theme, creatures, new Set(), 100, 1100, `z${i}`)!;
      const z = theme.zones.find((x) => x.key === s.creature.zone)!;
      const next = [...theme.zones].sort((a, b) => a.from - b.from).find((x) => x.from > z.from);
      expect(s.depth).toBeGreaterThanOrEqual(z.from);
      if (next) expect(s.depth).toBeLessThan(next.from + 1);
    }
  });

  it('is the same sighting for the same answer', () => {
    expect(sightingAlong(theme, creatures, new Set(), 0, 800, 'p|50|a')).toEqual(sightingAlong(theme, creatures, new Set(), 0, 800, 'p|50|a'));
  });

  it('looks to the other zones passed once a zone is all seen, and keeps the deep for the deep', () => {
    const seen = new Set(['barreleye', 'squid']);
    for (let i = 0; i < 20; i++) expect(zoneOf(sightingAlong(theme, creatures, seen, 0, 800, `s${i}`)!.creature.id)).toBe('surface');
    expect(sightingAlong(theme, creatures, new Set(['jelly', 'weed', 'barreleye', 'squid']), 0, 800, 'x')).toBeNull();
    // the floor's creature only ever comes to a dive that reaches the floor
    for (let i = 0; i < 20; i++) expect(sightingAlong(theme, creatures, new Set(), 1200, 2000, `d${i}`)?.creature.id).toBe('angler');
    expect(sightingAlong(theme, creatures, new Set(['angler']), 6400, 7400, 'f')?.creature.id).toBe('dagon');
  });

  it('sees nothing on a run of no cable', () => {
    expect(sightingAlong(theme, creatures, new Set(), 500, 500, 'x')).toBeNull();
  });

  it('lists the bestiary by zone, shallowest first', () => {
    const list = bestiaryByZone(theme, creatures, { angler: { id: 'angler', day: 3, depth: 1500, at: 1, promptId: 'p' } });
    expect(list.map((z) => z.zone.key)).toEqual(['surface', 'twilight', 'midnight', 'floor']);
    expect(list[2].creatures[0].sighting?.depth).toBe(1500);
    expect(list[0].creatures.every((c) => c.sighting === null)).toBe(true);
  });
});
