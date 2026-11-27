import type { DayRecord } from './types';
import { totalDepth } from './scoring';

export interface Stats {
  played: number;
  streak: number;
  bestStreak: number;
  deepest: number;
  average: number;
  tierCounts: number[]; // index 0..6
  unspeakables: number;
}

/** Streak counts consecutive finished days ending today, or yesterday if today isn't played yet. */
export function computeStats(days: Record<number, DayRecord>, today: number): Stats {
  const finished = Object.values(days)
    .filter((d) => d.finished && !d.practice)
    .sort((a, b) => a.day - b.day);
  const played = finished.length;
  const tierCounts = [0, 0, 0, 0, 0, 0, 0];
  let deepest = 0;
  let sum = 0;
  for (const d of finished) {
    const t = totalDepth(d);
    sum += t;
    deepest = Math.max(deepest, t);
    // Only real tiers: a stray value would grow the array and skew the logbook bars.
    for (const a of d.answers) if (Number.isInteger(a.tier) && a.tier >= 0 && a.tier <= 6) tierCounts[a.tier]++;
  }
  const set = new Set(finished.map((d) => d.day));
  let streak = 0;
  let cursor = set.has(today) ? today : today - 1;
  while (set.has(cursor)) {
    streak++;
    cursor--;
  }
  let bestStreak = 0;
  let run = 0;
  let prev = -Infinity;
  for (const d of finished) {
    run = d.day === prev + 1 ? run + 1 : 1;
    prev = d.day;
    bestStreak = Math.max(bestStreak, run);
  }
  return {
    played,
    streak,
    bestStreak,
    deepest,
    average: played ? Math.round(sum / played) : 0,
    tierCounts,
    unspeakables: tierCounts[6],
  };
}
