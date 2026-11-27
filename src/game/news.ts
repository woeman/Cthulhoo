import type { CareerCopy } from './types';
import { lanternWeek, multiplierFor, type Career } from './career';
import { fillLine, pickLine } from './theme';
import { countWords, multiplierWords, numberWords } from './words';

// Telegrams from the ship: what happened while you were away, a ward earned, a
// new week of the lantern. The copy is in the telegram voice (capitals, STOP
// between phrases, numbers in words); the screen inks each STOP in red.

export type NewsKind = 'drift' | 'ward-spent' | 'ward-earned' | 'multiplier';

export interface News {
  kind: NewsKind;
  /** One or two telegram lines, filled in. */
  lines: string[];
  /** The same news in plain words, for the strip under it and for screen readers. */
  plain: string;
}

const metres = (m: number) => `${Math.round(m).toLocaleString('en-GB')} m`;
const days = (d: number) => `${d} ${d === 1 ? 'day' : 'days'}`;

/** What the title tells a diver before today's dive, if anything. */
export function titleNews(career: Career, copy: CareerCopy, seed: string, today: number): News | null {
  if (career.playedToday) return null;
  const say = (lines: string[], k: string, values: Record<string, string>) => (lines.length ? fillLine(pickLine(lines, seed, today, k), values) : '');
  const away = career.away;
  if (away && away.drift > 0) {
    // The wards (if any) held for a while, then the lantern went out and the sea took the rest.
    const line = say(copy.drift, 'drift', { metres: countWords(away.drift, 'metre'), days: countWords(away.days, 'day') });
    const held = away.wardsSpent > 0 ? `${away.wardsSpent === 1 ? 'Your ward' : 'Your wards'} held for ${days(away.wardsSpent)}, then the lantern went out. ` : '';
    if (line) return { kind: 'drift', lines: [line], plain: `${held}You drifted up ${metres(away.drift)} while you were away.` };
  } else if (away && away.wardsSpent > 0) {
    const line = say(copy.wardSpent, 'ward-spent', { days: countWords(away.wardsSpent, 'day'), streak: numberWords(career.streak) });
    const plain = `${away.wardsSpent === 1 ? 'A ward' : `${away.wardsSpent} wards`} kept your lantern lit for ${days(away.wardsSpent)}.`;
    if (line) return { kind: 'ward-spent', lines: [line], plain };
  }
  // Today's dive begins a new week of the lantern, and counts for more.
  if (career.streak > 0 && career.nextMult > multiplierFor(career.streak)) {
    const week = lanternWeek(career.streak + 1);
    const line = say(copy.multiplier, 'multiplier', { mult: multiplierWords(career.nextMult), week: numberWords(week), streak: numberWords(career.streak) });
    if (line) return { kind: 'multiplier', lines: [line], plain: `Week ${week} of your lantern. Today's dive counts ×${career.nextMult.toFixed(1)}.` };
  }
  return null;
}

/** What the results tell a diver about the dive just counted: a ward earned. */
export function resultsNews(career: Career, copy: CareerCopy, seed: string, day: number): News | null {
  const earned = career.events.find((e) => e.kind === 'ward-earned' && e.day === day);
  if (!earned || earned.kind !== 'ward-earned' || !copy.wardEarned.length) return null;
  const line = fillLine(pickLine(copy.wardEarned, seed, day, 'ward-earned'), { days: countWords(earned.streak, 'day'), streak: numberWords(earned.streak) });
  return { kind: 'ward-earned', lines: [line], plain: `${days(earned.streak)} in a row. You earned a ward: it keeps your lantern lit through one missed day.` };
}
