import type { CreatureDef, ThemeCopy, ZoneKey } from './types';
import { hashString } from './daily';
import { zoneFor } from './theme';

// Sightings. A rare answer (Forbidden or Unspeakable) pays out a long run of cable,
// and somewhere along it a creature passes the porthole: one not yet seen, from
// the zone it passes in. Every zone keeps its own creatures, so the deep ones are
// only ever met by those who get that deep. Sightings are kept once made, so new
// creatures added to the copy later never rewrite what a player has seen.

/** The rarest tiers sight a creature. */
export const SIGHTING_TIER = 5;

export interface Sighting {
  id: string;
  day: number;
  /** Where it passed the porthole. */
  depth: number;
  /** Wall-clock ms. */
  at: number;
  promptId: string;
}

const unit = (seed: string) => (hashString(seed) % 100000) / 100000;

/**
 * The creature (if any) seen on the way from `from` to `to` metres: first from the
 * zone at a point picked along the way, then from the other zones passed, deepest first.
 */
export function sightingAlong(
  theme: ThemeCopy,
  creatures: CreatureDef[],
  seen: ReadonlySet<string>,
  from: number,
  to: number,
  seed: string,
): { creature: CreatureDef; depth: number } | null {
  if (!(to > from)) return null;
  const zones = [...theme.zones].sort((a, b) => a.from - b.from);
  const at = Math.round(from + (to - from) * unit(`${seed}|at`));
  const passed = zones
    .map((z, i) => ({ key: z.key as ZoneKey, top: Math.max(from, z.from), bottom: Math.min(to, zones[i + 1]?.from ?? Infinity) }))
    .filter((z) => z.bottom > z.top);
  const first = zoneFor(theme, at).key as ZoneKey;
  const order = [first, ...passed.map((z) => z.key).reverse().filter((k) => k !== first)];
  for (const key of order) {
    const pool = creatures.filter((c) => c.zone === key && !seen.has(c.id));
    if (!pool.length) continue;
    const creature = pool[hashString(`${seed}|${key}`) % pool.length];
    const span = passed.find((z) => z.key === key);
    const depth = key === first ? at : span ? Math.round(span.top + (Math.min(span.bottom, to) - span.top) * unit(`${seed}|${key}|at`)) : at;
    return { creature, depth };
  }
  return null;
}

/** The creatures by zone, in the theme's zone order, each with its sighting if it has one. */
export function bestiaryByZone(theme: ThemeCopy, creatures: CreatureDef[], sightings: Record<string, Sighting>) {
  return [...theme.zones]
    .sort((a, b) => a.from - b.from)
    .map((zone) => ({
      zone,
      creatures: creatures.filter((c) => c.zone === zone.key).map((c) => ({ creature: c, sighting: sightings[c.id] ?? null })),
    }))
    .filter((z) => z.creatures.length);
}
