import placeholder from '../content/theme.placeholder.json';
import type { CultRank, Landmark, ThemeCopy, TierDef, ZoneDef, ZoneKey } from './types';
import { hashString } from './daily';

// Copy comes from data/theme.json (question-bank thread). Until that file is in
// the repo, src/content/theme.placeholder.json (an early copy of it) is used.
// Zone subtitles and cult ranks are added here; every field is read defensively
// so a small format drift never breaks the game.

const ZONE_SUBTITLES: Record<ZoneKey, string> = {
  surface: 'fog on the water, the last of the sun',
  twilight: 'where the light gives up',
  midnight: 'lights that are not ours',
  abyss: 'stones cut by no human hand',
  hadal: 'it knows you are coming',
  floor: 'its true name is written only in glyphs',
};

const CULT_RANKS: CultRank[] = [
  { minStreak: 0, name: 'Landlubber' },
  { minStreak: 1, name: 'Initiate' },
  { minStreak: 3, name: 'Acolyte of the Tide' },
  { minStreak: 7, name: 'Deep One' },
  { minStreak: 14, name: 'Priest of Dagon' },
  { minStreak: 30, name: 'High Priest of the Drowned' },
  { minStreak: 100, name: 'Dreamer in the Drowned City' },
];

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d: string): string => (typeof v === 'string' && v.trim() ? v : d);
const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown, d: string[]): string[] =>
  Array.isArray(v) && v.length && v.every((x) => typeof x === 'string') ? (v as string[]) : d;

const FALLBACK_TIERS: Array<Pick<TierDef, 'key' | 'name' | 'depth' | 'emoji' | 'blurb'>> = [
  { key: 'commonplace', name: 'Commonplace', depth: 100, emoji: '🌊', blurb: 'What most people say first.' },
  { key: 'curious', name: 'Curious', depth: 250, emoji: '🐟', blurb: 'A step off the beaten shore.' },
  { key: 'obscure', name: 'Obscure', depth: 400, emoji: '🪼', blurb: 'Few minds wander this far.' },
  { key: 'arcane', name: 'Arcane', depth: 600, emoji: '🦑', blurb: 'Old knowledge, rarely spoken.' },
  { key: 'forbidden', name: 'Forbidden', depth: 800, emoji: '👁️', blurb: 'You should not know that.' },
  { key: 'unspeakable', name: 'Unspeakable', depth: 1000, emoji: '🐙', blurb: 'The rarest true answer the deep will accept.' },
];

const FALLBACK_ZONES: Array<Omit<ZoneDef, 'subtitle'>> = [
  { key: 'surface', name: 'The Shallows', from: 0, to: 200 },
  { key: 'twilight', name: 'The Gloaming', from: 200, to: 1000 },
  { key: 'midnight', name: 'The Stygian Dark', from: 1000, to: 4000 },
  { key: 'abyss', name: 'The Cyclopean Abyss', from: 4000, to: 6000 },
  { key: 'hadal', name: 'The Dreaming Deep', from: 6000, to: 7000 },
  { key: 'floor', name: 'The Drowned City', from: 7000, to: Infinity },
];

export function buildTheme(raw: unknown): ThemeCopy {
  const r: Json = isObj(raw) ? raw : {};
  const rawTiers = Array.isArray(r.tiers) ? (r.tiers.filter(isObj) as Json[]) : [];
  const tiers: TierDef[] = FALLBACK_TIERS.map((f, i) => {
    const t = rawTiers.find((x) => num(x.tier, -1) === i + 1) ?? {};
    return {
      tier: (i + 1) as TierDef['tier'],
      key: str(t.key, f.key),
      name: str(t.name, f.name),
      depth: num(t.depth, f.depth),
      emoji: str(t.emoji, f.emoji),
      blurb: str(t.blurb, f.blurb),
      lines: strs(t.lines, [f.blurb]),
      color: `var(--color-tier-${i + 1})`,
    };
  });

  const os: Json = isObj(r.openSecret) ? r.openSecret : {};
  const rf: Json = isObj(r.refused) ? r.refused : {};
  const rl: Json = isObj(rf.lines) ? rf.lines : {};

  const rawZones = Array.isArray(r.zones) ? (r.zones.filter(isObj) as Json[]) : [];
  const zones: ZoneDef[] = FALLBACK_ZONES.map((f) => {
    const z = rawZones.find((x) => x.key === f.key || (f.key === 'floor' && x.key === 'city')) ?? {};
    // The floor is open-ended: anything at or past it is the city.
    const to = f.key === 'floor' ? Infinity : num(z.to, f.to);
    return { key: f.key, name: str(z.name, f.name), subtitle: str(z.subtitle, ZONE_SUBTITLES[f.key]), from: num(z.from, f.from), to };
  });

  const landmarks: Landmark[] = (Array.isArray(r.landmarks) ? (r.landmarks.filter(isObj) as Json[]) : [])
    .map((l) => ({ zone: str(l.zone, ''), from: num(l.from, NaN), to: num(l.to, NaN), name: str(l.name, ''), lines: strs(l.lines, []) }))
    .filter((l) => Number.isFinite(l.from) && l.name)
    .sort((a, b) => a.from - b.from);

  const categories: ThemeCopy['categories'] = {};
  if (isObj(r.categories)) {
    for (const [k, v] of Object.entries(r.categories)) {
      if (isObj(v)) categories[k] = { name: str(v.name, k), title: str(v.title, str(v.name, k)) };
      else if (typeof v === 'string') categories[k] = { name: v, title: v };
    }
  }
  const share: Json = isObj(r.share) ? r.share : {};

  return {
    maxDepth: num(r.maxDepth, 7000),
    promptsPerDay: num(r.promptsPerDay, 7),
    secondsPerPrompt: num(r.secondsPerPrompt, 25),
    tiers,
    openSecret: {
      name: str(os.name, 'Open Secret'),
      emoji: str(os.emoji, '🤫'),
      blurb: str(os.blurb, 'Feels like forbidden knowledge. Everyone whispers it.'),
      lines: strs(os.lines, ['So clever. So very, very common.']),
    },
    refused: {
      name: str(rf.name, 'Refused'),
      emoji: str(rf.emoji, '🫧'),
      lines: {
        unknown: strs(rl.unknown, ['The deep does not know that word.']),
        decoy: strs(rl.decoy, ['True of something. Not of this.']),
        ambiguous: strs(rl.ambiguous, ['The deep heard two names at once. Be more precise.']),
        timeout: strs(rl.timeout, ['Too slow. The tide took your answer.']),
      },
    },
    zones,
    landmarks,
    categories,
    share: {
      template: str(share.template, 'Cthulhoo #{day} · {depth} m\n{emoji}\n{landmark}'),
      missEmoji: str(share.missEmoji, '🫧'),
    },
    howToPlay: strs(r.howToPlay, []),
    cultRanks: CULT_RANKS,
  };
}

export const PLACEHOLDER_THEME: ThemeCopy = buildTheme(placeholder);

export function tierDef(theme: ThemeCopy, tier: number): TierDef | undefined {
  return theme.tiers.find((t) => t.tier === tier);
}

export function zoneFor(theme: ThemeCopy, depth: number): ZoneDef {
  const zones = theme.zones;
  for (let i = zones.length - 1; i >= 0; i--) if (depth >= zones[i].from) return zones[i];
  return zones[0];
}

export function landmarkFor(theme: ThemeCopy, depth: number): Landmark | undefined {
  let hit: Landmark | undefined;
  for (const l of theme.landmarks) if (depth >= l.from) hit = l;
  return hit;
}

export function cultRankFor(theme: ThemeCopy, streak: number): CultRank {
  let rank = theme.cultRanks[0];
  for (const r of theme.cultRanks) if (streak >= r.minStreak) rank = r;
  return rank;
}

/** Deterministic line choice, so friends who give the same answer see the same line. */
export function pickLine(lines: string[], ...keys: Array<string | number>): string {
  if (!lines.length) return '';
  return lines[hashString(keys.join('|').toLowerCase()) % lines.length];
}
