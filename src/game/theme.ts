import placeholder from '../content/theme.placeholder.json';
import careerPlaceholder from '../content/career.placeholder.json';
import type { CareerCopy, CreatureDef, CultRank, Landmark, MilestoneDef, ThemeCopy, TierDef, ZoneDef, ZoneKey } from './types';
import { hashString } from './daily';
import { usableSlips } from './slips';

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

const ZONE_KEYS: ZoneKey[] = ['surface', 'twilight', 'midnight', 'abyss', 'hadal', 'floor'];

// The smallest career copy that still reads; src/content/career.placeholder.json
// is laid over it, and a "career" key in data/theme.json over that.
const MINIMAL_CAREER: CareerCopy = {
  title: '{epithet} {role} of {place}',
  milestones: [{ depth: 7000, name: 'The Roofs of the Drowned City', place: 'the Drowned City', line: 'You have touched the floor.' }],
  surfacePlace: 'the Shallows',
  epithets: [{ from: 0, words: ['Damp'] }],
  stateEpithets: { unsleeping: ['Unsleeping'], surfacing: ['Surfacing'], newcomer: ['Untried'] },
  roles: { none: ['Diver'] },
  synopsis: {
    strong: {},
    weak: {},
    fast: ['It answers quickly.'],
    slow: ['It takes its time.'],
    rare: ['It knows rare things.'],
    common: ['It says what most people say.'],
    night: ['It dives at night.'],
    day: ['It dives by day.'],
    streak: ['Its lantern has burned for {streak} days.'],
    drifting: ['It has been away.'],
    newcomer: ['It is new here.'],
    warded: ['A ward kept its lantern lit.'],
  },
  drift: ['WHILE YOU WERE AWAY STOP YOU DRIFTED UP {metres} STOP'],
  wardSpent: ['A WARD HELD FOR {days} STOP'],
  wardEarned: ['A WARD IS YOURS STOP'],
  multiplier: ['WEEK {week} STOP EVERYTHING COUNTS {mult} STOP'],
  ward: { name: 'Ward', blurb: 'Keeps your lantern lit through one missed day.' },
};

const strMap = (v: unknown, d: Record<string, string[]>): Record<string, string[]> => {
  const out: Record<string, string[]> = { ...d };
  if (isObj(v)) for (const [k, list] of Object.entries(v)) if (Array.isArray(list) && list.length && list.every((x) => typeof x === 'string')) out[k] = list as string[];
  return out;
};

/** Career copy read defensively over a fallback, so a partial "career" block only replaces what it holds. */
export function buildCareer(raw: unknown, d: CareerCopy = BASE_CAREER): CareerCopy {
  const r: Json = isObj(raw) ? raw : {};
  const milestones: MilestoneDef[] = (Array.isArray(r.milestones) ? (r.milestones.filter(isObj) as Json[]) : [])
    .map((m) => ({ depth: num(m.depth, NaN), name: str(m.name, ''), place: str(m.place, str(m.name, '')), line: str(m.line, '') }))
    .filter((m) => m.depth > 0 && m.name)
    .sort((a, b) => a.depth - b.depth)
    .filter((m, i, all) => i === 0 || m.depth !== all[i - 1].depth);
  const epithets = (Array.isArray(r.epithets) ? (r.epithets.filter(isObj) as Json[]) : [])
    .map((e) => ({ from: num(e.from, NaN), words: strs(e.words, []) }))
    .filter((e) => Number.isFinite(e.from) && e.from >= 0 && e.words.length)
    .sort((a, b) => a.from - b.from);
  const st: Json = isObj(r.stateEpithets) ? r.stateEpithets : {};
  const sy: Json = isObj(r.synopsis) ? r.synopsis : {};
  const w: Json = isObj(r.ward) ? r.ward : {};
  const line = (k: keyof CareerCopy['synopsis']) => strs(sy[k], d.synopsis[k] as string[]);
  return {
    title: str(r.title, d.title),
    milestones: milestones.length ? milestones : d.milestones,
    surfacePlace: str(r.surfacePlace, d.surfacePlace),
    epithets: epithets.length && epithets[0].from === 0 ? epithets : d.epithets,
    stateEpithets: {
      unsleeping: strs(st.unsleeping, d.stateEpithets.unsleeping),
      surfacing: strs(st.surfacing, d.stateEpithets.surfacing),
      newcomer: strs(st.newcomer, d.stateEpithets.newcomer),
    },
    roles: strMap(r.roles, d.roles),
    synopsis: {
      strong: strMap(sy.strong, d.synopsis.strong),
      weak: strMap(sy.weak, d.synopsis.weak),
      fast: line('fast'),
      slow: line('slow'),
      rare: line('rare'),
      common: line('common'),
      night: line('night'),
      day: line('day'),
      streak: line('streak'),
      drifting: line('drifting'),
      newcomer: line('newcomer'),
      warded: line('warded'),
    },
    drift: strs(r.drift, d.drift),
    wardSpent: strs(r.wardSpent, d.wardSpent),
    wardEarned: strs(r.wardEarned, d.wardEarned),
    multiplier: strs(r.multiplier, d.multiplier),
    ward: { name: str(w.name, d.ward.name), blurb: str(w.blurb, d.ward.blurb) },
  };
}

/** Bestiary entries read defensively; an unusable list falls back whole. */
export function buildBestiary(raw: unknown, d: CreatureDef[] = BASE_BESTIARY): CreatureDef[] {
  const seen = new Set<string>();
  const list = (Array.isArray(raw) ? (raw.filter(isObj) as Json[]) : [])
    .map((c) => ({
      id: str(c.id, ''),
      name: str(c.name, ''),
      zone: (ZONE_KEYS.includes(c.zone as ZoneKey) ? c.zone : '') as ZoneKey,
      kind: c.kind === 'mythos' ? ('mythos' as const) : ('real' as const),
      line: str(c.line, ''),
      fact: str(c.fact, ''),
    }))
    .filter((c) => c.id && c.name && c.zone && !seen.has(c.id) && (seen.add(c.id), true));
  return list.length ? list : d;
}

const BASE_CAREER = buildCareer((careerPlaceholder as Json).career, MINIMAL_CAREER);
const BASE_BESTIARY = buildBestiary((careerPlaceholder as Json).bestiary, []);

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
  const slips: Json = isObj(r.slips) ? r.slips : {};

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
    slips: { lines: usableSlips(slips.lines) },
    cultRanks: CULT_RANKS,
    career: buildCareer(r.career),
    bestiary: buildBestiary(r.bestiary),
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
/** Fill {placeholders} in a line of copy; unknown ones are left as they are. */
export const fillLine = (line: string, values: Record<string, string>): string => line.replace(/\{(\w+)\}/g, (all, k: string) => values[k] ?? all);

export function pickLine(lines: string[], ...keys: Array<string | number>): string {
  if (!lines.length) return '';
  return lines[hashString(keys.join('|').toLowerCase()) % lines.length];
}
