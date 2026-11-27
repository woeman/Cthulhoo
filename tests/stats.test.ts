import { describe, expect, it } from 'vitest';
import { computeStats } from '../src/game/stats';
import type { DayRecord, Tier } from '../src/game/types';

const DEPTH = [0, 100, 250, 400, 600, 800, 1000];

function dive(day: number, tiers: number[], extra: Partial<DayRecord> = {}): DayRecord {
  return {
    day,
    date: '',
    omen: 'still',
    promptIds: tiers.map((_, i) => `p${i}`),
    sanity: 50,
    finished: true,
    answers: tiers.map((t, i) => ({ promptId: `p${i}`, input: t ? 'x' : null, answer: t ? 'x' : null, tier: t as Tier, depth: DEPTH[t] ?? 0, rejects: [], timeMs: 1 })),
    ...extra,
  };
}
const byDay = (...recs: DayRecord[]) => Object.fromEntries(recs.map((r) => [r.day, r]));

describe('streaks', () => {
  it('end today, or yesterday while today is still to play', () => {
    const days = byDay(dive(3, [1]), dive(4, [1]), dive(5, [1]));
    expect(computeStats(days, 5).streak).toBe(3);
    expect(computeStats(days, 6).streak).toBe(3);
    expect(computeStats(days, 7).streak).toBe(0);
  });

  it('survive a dive in progress today, but not one left unfinished yesterday', () => {
    const playing = byDay(dive(3, [1]), dive(4, [1]), dive(5, [1, 2], { finished: false }));
    expect(computeStats(playing, 5).streak).toBe(2);
    const abandoned = byDay(dive(3, [1]), dive(4, [1], { finished: false }));
    expect(computeStats(abandoned, 5).streak).toBe(0);
    expect(computeStats(abandoned, 5).bestStreak).toBe(1);
  });

  it('break at a gap, and keep the best run', () => {
    const days = byDay(dive(1, [1]), dive(2, [1]), dive(3, [1]), dive(5, [1]), dive(6, [1]));
    expect(computeStats(days, 6).streak).toBe(2);
    expect(computeStats(days, 6).bestStreak).toBe(3);
    expect(computeStats({}, 6)).toMatchObject({ played: 0, streak: 0, bestStreak: 0, deepest: 0, average: 0 });
  });

  it('count a dive finished after midnight for the day it began', () => {
    // Day 7's dive began at 23:58 and was saved under day 7 when it ended on day 8.
    const days = byDay(dive(6, [1]), dive(7, [1]));
    expect(computeStats(days, 8).streak).toBe(2);
  });

  it('never count practice dives', () => {
    const days = byDay(dive(4, [1]), dive(5, [6, 6, 6, 6, 6, 6, 6], { practice: true }));
    const stats = computeStats(days, 5);
    expect(stats).toMatchObject({ played: 1, streak: 1, deepest: 100, unspeakables: 0 });
  });
});

describe('totals', () => {
  it('leave unfinished days out of played, deepest, average and tier counts', () => {
    const days = byDay(dive(1, [1, 2]), dive(2, [6, 6, 6], { finished: false }), dive(3, [3]));
    const stats = computeStats(days, 3);
    expect(stats.played).toBe(2);
    expect(stats.deepest).toBe(400);
    expect(stats.average).toBe(375);
    expect(stats.tierCounts).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });

  it('count timeouts at 0, open secrets at their tier, and only real tiers', () => {
    const secret = dive(2, [6]);
    secret.answers[0].openSecret = true;
    const odd = dive(3, [1]);
    odd.answers.push({ ...odd.answers[0], tier: 9 as Tier }, { ...odd.answers[0], tier: -1 as Tier });
    const stats = computeStats(byDay(dive(1, [0, 0, 5]), secret, odd), 3);
    expect(stats.tierCounts).toEqual([2, 1, 0, 0, 0, 1, 1]);
    expect(stats.tierCounts).toHaveLength(7);
    expect(stats.unspeakables).toBe(1);
  });

  it('round the average', () => {
    const stats = computeStats(byDay(dive(1, [1]), dive(2, [1, 1]), dive(3, [2])), 3);
    expect(stats.average).toBe(Math.round(550 / 3));
  });
});
