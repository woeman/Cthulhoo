import type { DayRecord, PromptDef, ThemeCopy } from './types';
import { baseDepth } from './scoring';

// Sigils: how strong the player is at each topic, weighted by rarity. Each answer
// counts for the base depth of its tier (a timeout counts for nothing), averaged
// per topic, and a few imaginary faint answers pull a topic with little history
// towards the dark, so one lucky answer never sets a sigil blazing.

/** Imaginary answers added to every topic, each worth PRIOR_DEPTH metres. */
export const PRIOR_ANSWERS = 3;
export const PRIOR_DEPTH = 150;
/** Strength at which a sigil is kindled, burning and blazing (strength 1 = every answer Unspeakable). */
export const SIGIL_LEVELS = [0.2, 0.4, 0.6] as const;
/** Answers needed before a topic can define the player (their title, their synopsis). */
export const DEFINING_ANSWERS = 3;

export type SigilLevel = 0 | 1 | 2 | 3;

export interface Sigil {
  topic: string;
  name: string;
  /** Questions met in this topic in daily dives. */
  answered: number;
  /** Forbidden and Unspeakable answers in it. */
  rare: number;
  /** 0 to 1. */
  strength: number;
  level: SigilLevel;
}

export const levelFor = (strength: number): SigilLevel =>
  strength >= SIGIL_LEVELS[2] ? 3 : strength >= SIGIL_LEVELS[1] ? 2 : strength >= SIGIL_LEVELS[0] ? 1 : 0;

/**
 * One sigil per topic the theme names, in the theme's order. An answer's topic is
 * the one it was saved with, or failing that the topic its prompt has now.
 */
export function computeSigils(days: Record<number, DayRecord>, promptById: (id: string) => Pick<PromptDef, 'category'> | undefined, theme: ThemeCopy): Sigil[] {
  const sums = new Map<string, { n: number; metres: number; rare: number }>();
  for (const rec of Object.values(days)) {
    if (!rec || rec.practice) continue;
    for (const a of rec.answers) {
      const topic = a.category ?? promptById(a.promptId)?.category;
      if (!topic) continue;
      const s = sums.get(topic) ?? { n: 0, metres: 0, rare: 0 };
      s.n += 1;
      s.metres += a.tier ? baseDepth(theme, a.tier) : 0;
      if (a.tier >= 5) s.rare += 1;
      sums.set(topic, s);
    }
  }
  const deepest = Math.max(1, ...theme.tiers.map((t) => t.depth));
  return Object.entries(theme.categories).map(([topic, c]) => {
    const s = sums.get(topic) ?? { n: 0, metres: 0, rare: 0 };
    const strength = Math.min(1, (s.metres + PRIOR_ANSWERS * PRIOR_DEPTH) / (s.n + PRIOR_ANSWERS) / deepest);
    return { topic, name: c.name, answered: s.n, rare: s.rare, strength, level: levelFor(strength) };
  });
}

/** The topics that can define the player, strongest first. */
export function definingSigils(sigils: Sigil[]): Sigil[] {
  return sigils.filter((s) => s.answered >= DEFINING_ANSWERS).sort((a, b) => b.strength - a.strength || b.answered - a.answered);
}
