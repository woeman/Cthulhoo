// The Reliquary's rules: which answers are kept as relics, and how they are counted.
// Every Forbidden and Unspeakable answer a diver has brought up from a daily dive,
// read from the dives kept in this browser. Pure: src/screens/reliquary.ts draws it.

import { censusKeptFor, type CensusKept } from './storage';
import { tierDef } from './theme';
import type { DayRecord, PromptDef, PromptMeta, ThemeCopy } from './types';

/** The lowest tier the Reliquary keeps: Forbidden. */
export const RELIC_TIER = 5;

export interface Relic {
  day: number;
  /** The dive's local date, YYYY-MM-DD. */
  date: string;
  promptId: string;
  /** The question as the bank asks it, or its topic once the bank has let it go. */
  question: string;
  answer: string;
  tier: 5 | 6;
  depth: number;
  lore?: string;
  census?: CensusKept;
}

/** A relic's question as far as it is known: its answers (for the line of lore) only when they have been fetched. */
export type RelicPrompt = PromptMeta & Partial<Pick<PromptDef, 'answers'>>;

/**
 * Every relic in the dives kept, newest dive first and in the order answered
 * within a dive. Practice dives are never kept, and an Open Secret is no relic:
 * everyone whispers it.
 */
export function collectRelics(
  days: Record<number, DayRecord>,
  byId: (id: string) => RelicPrompt | undefined,
  theme: ThemeCopy,
  kept: Record<string, CensusKept> = {},
): Relic[] {
  const out: Relic[] = [];
  for (const rec of Object.values(days).sort((a, b) => b.day - a.day)) {
    if (rec.practice) continue;
    for (const a of rec.answers) {
      if (a.tier < RELIC_TIER || !a.answer || a.openSecret) continue;
      const p = byId(a.promptId);
      const topic = a.category ?? p?.category;
      const question = p?.text ?? (topic && theme.categories[topic] ? `A question from ${theme.categories[topic].title}, since lost` : 'A question since lost to the deep');
      const lore = p?.answers?.find((x) => x.answer === a.answer)?.lore;
      const census = censusKeptFor(kept, rec.day, a.promptId);
      out.push({
        day: rec.day,
        date: rec.date,
        promptId: a.promptId,
        question,
        answer: a.answer,
        tier: a.tier === 6 ? 6 : 5,
        depth: a.depth,
        ...(lore ? { lore } : {}),
        ...(census ? { census } : {}),
      });
    }
  }
  return out;
}

/** How many of each are kept, for the Logbook's line: "3 Unspeakable · 11 Forbidden". */
export function relicCounts(relics: Relic[]): { unspeakable: number; forbidden: number } {
  const unspeakable = relics.filter((r) => r.tier === 6).length;
  return { unspeakable, forbidden: relics.length - unspeakable };
}

/** The Reliquary's line in the Logbook. */
export function reliquaryNote(relics: Relic[], theme: ThemeCopy): string {
  const { unspeakable, forbidden } = relicCounts(relics);
  const parts = [unspeakable ? `${unspeakable} ${tierDef(theme, 6)?.name ?? 'Unspeakable'}` : '', forbidden ? `${forbidden} ${tierDef(theme, 5)?.name ?? 'Forbidden'}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Your rarest answers will rest here';
}

