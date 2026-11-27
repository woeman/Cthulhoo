import { describe, expect, it } from 'vitest';
import { depthFor, sanityAfterAnswer, totalDepth } from '../src/game/scoring';
import { omenById, bellIndexFor } from '../src/game/omens';
import { computeStats } from '../src/game/stats';
import { PLACEHOLDER_THEME as theme, landmarkFor, zoneFor, pickLine } from '../src/game/theme';
import type { DayRecord } from '../src/game/types';

describe('depth', () => {
  it('maps tiers to 100..1000 m on a still day', () => {
    const still = omenById('still');
    expect([1, 2, 3, 4, 5, 6].map((t) => depthFor(theme, t, still, 0, 2))).toEqual([100, 250, 400, 600, 800, 1000]);
    expect(depthFor(theme, 0, still, 0, 2)).toBe(0);
  });
  it('applies omens', () => {
    expect(depthFor(theme, 6, omenById('stars'), 0, 2)).toBe(1500);
    expect(depthFor(theme, 2, omenById('blood'), 0, 2)).toBe(300);
    const bell = omenById('bell');
    const b = bellIndexFor(1, 7);
    expect(depthFor(theme, 3, bell, b, 1)).toBe(800);
    expect(depthFor(theme, 3, bell, (b + 1) % 7, 1)).toBe(400);
  });
  it('sums a dive', () => {
    expect(totalDepth({ answers: [{ depth: 100 }, { depth: 600 }] as DayRecord['answers'] })).toBe(700);
  });
});

describe('sanity', () => {
  it('drains with depth and the unspeakable', () => {
    expect(sanityAfterAnswer(100, 1000, 6)).toBe(88);
    expect(sanityAfterAnswer(5, 1000, 6)).toBe(0);
  });
});

describe('theme', () => {
  it('places depths in zones and landmarks', () => {
    expect(zoneFor(theme, 0).key).toBe('surface');
    expect(zoneFor(theme, 999).key).toBe('twilight');
    expect(zoneFor(theme, 7000).key).toBe('floor');
    expect(zoneFor(theme, 9500).key).toBe('floor');
    expect(landmarkFor(theme, 0)?.name).toBeTruthy();
    expect(landmarkFor(theme, 3600)?.zone).toBe('midnight');
  });
  it('picks lines deterministically', () => {
    const lines = ['a', 'b', 'c'];
    expect(pickLine(lines, 'x', 'Paris')).toBe(pickLine(lines, 'x', 'paris'));
  });
});

describe('stats', () => {
  const rec = (day: number, depths: number[]): DayRecord => ({
    day,
    date: '',
    omen: 'still',
    promptIds: [],
    sanity: 50,
    finished: true,
    answers: depths.map((d) => ({ promptId: 'p', input: 'x', answer: 'x', tier: 1, depth: d, rejects: [], timeMs: 1 })),
  });
  it('counts streaks ending today or yesterday', () => {
    const days = { 1: rec(1, [100]), 2: rec(2, [200]), 3: rec(3, [300]), 5: rec(5, [400]) };
    expect(computeStats(days, 5).streak).toBe(1);
    expect(computeStats(days, 4).streak).toBe(3);
    expect(computeStats(days, 7).streak).toBe(0);
    expect(computeStats(days, 5).bestStreak).toBe(3);
    expect(computeStats(days, 5).deepest).toBe(400);
  });
});
