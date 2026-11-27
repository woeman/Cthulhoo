import { describe, expect, it } from 'vitest';
import { FLOOR_DEPTH, SANITY, clampSanity, depthFor, isBellQuestion, sanityAfterAnswer, timeLimitMs, totalDepth } from '../src/game/scoring';
import { OMENS, omenById, omenForDay, bellIndexFor } from '../src/game/omens';
import { computeStats } from '../src/game/stats';
import { PLACEHOLDER_THEME as theme, buildTheme, landmarkFor, zoneFor, pickLine } from '../src/game/theme';
import type { DayRecord } from '../src/game/types';

const TIERS = [1, 2, 3, 4, 5, 6];

describe('depth', () => {
  it('maps tiers to 100..1000 m on a still day', () => {
    const still = omenById('still');
    expect(TIERS.map((t) => depthFor(theme, t, still, 0, 2))).toEqual([100, 250, 400, 600, 800, 1000]);
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

  it('gives the full table for every omen and tier, away from the bell', () => {
    const table: Record<string, number[]> = {
      still: [100, 250, 400, 600, 800, 1000],
      stars: [100, 250, 400, 600, 800, 1500],
      slack: [100, 250, 400, 600, 800, 1000],
      blood: [120, 300, 480, 720, 960, 1200],
      bell: [100, 250, 400, 600, 800, 1000],
      whisper: [100, 250, 400, 600, 800, 1000],
    };
    expect(OMENS.map((o) => o.id).sort()).toEqual(Object.keys(table).sort());
    for (const omen of OMENS) {
      const away = (bellIndexFor(9, 7) + 1) % 7;
      expect(TIERS.map((t) => depthFor(theme, t, omen, away, 9)), omen.id).toEqual(table[omen.id]);
      expect(depthFor(theme, 0, omen, away, 9), omen.id).toBe(0);
    }
  });

  it('doubles exactly one question on a bell day, and none on other days', () => {
    for (let day = 1; day <= 60; day++) {
      for (const omen of OMENS) {
        const doubled = [0, 1, 2, 3, 4, 5, 6].filter((i) => depthFor(theme, 4, omen, i, day) === 1200);
        expect(doubled, `${omen.id} day ${day}`).toEqual(omen.bell ? [bellIndexFor(day, 7)] : []);
        const rec = { omen: omen.id, day, promptIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
        const marked = [0, 1, 2, 3, 4, 5, 6].filter((i) => isBellQuestion(rec, i));
        expect(marked, `${omen.id} day ${day}`).toEqual(doubled);
      }
    }
    expect(TIERS.map((t) => depthFor(theme, t, omenById('bell'), bellIndexFor(5, 7), 5))).toEqual([200, 500, 800, 1200, 1600, 2000]);
  });

  it('rounds to the nearest 10 m', () => {
    const odd = buildTheme({ tiers: [{ tier: 1, depth: 333 }, { tier: 2, depth: 125 }] });
    expect(depthFor(odd, 1, omenById('blood'), 0, 2)).toBe(400);
    expect(depthFor(odd, 2, omenById('still'), 0, 2)).toBe(130);
    expect(depthFor(theme, 7, omenById('still'), 0, 2)).toBe(0);
  });

  it('sums a dive, and a perfect still dive reaches the floor', () => {
    expect(totalDepth({ answers: [{ depth: 100 }, { depth: 600 }] as DayRecord['answers'] })).toBe(700);
    expect(totalDepth({ answers: [] })).toBe(0);
    const still = omenById('still');
    const perfect = Array.from({ length: 7 }, (_, i) => ({ depth: depthFor(theme, 6, still, i, 2) })) as DayRecord['answers'];
    expect(totalDepth({ answers: perfect })).toBe(FLOOR_DEPTH);
  });

  it('gives each omen its own air', () => {
    expect(timeLimitMs(omenById('still'))).toBe(25_000);
    expect(timeLimitMs(omenById('slack'))).toBe(35_000);
    expect(timeLimitMs(omenById('blood'))).toBe(18_000);
    expect(timeLimitMs(omenById('no-such-omen'))).toBe(25_000);
  });
});

describe('sanity', () => {
  it('drains with depth and the unspeakable', () => {
    expect(sanityAfterAnswer(100, 1000, 6)).toBe(88);
    expect(sanityAfterAnswer(5, 1000, 6)).toBe(0);
    expect(sanityAfterAnswer(100, 2000, 6)).toBe(81);
    expect(sanityAfterAnswer(100, 100, 1)).toBe(99);
  });

  it('stays a whole number between 0 and 100 through any dive', () => {
    for (const omen of OMENS) {
      let s: number = SANITY.start;
      for (let i = 0; i < 7; i++) {
        for (let r = 0; r < 5; r++) s = clampSanity(s - SANITY.reject);
        s = sanityAfterAnswer(s, depthFor(theme, 6, omen, i, 1), 6);
        expect(Number.isInteger(s) && s >= 0 && s <= 100, omen.id).toBe(true);
      }
      expect(s, omen.id).toBe(0);
    }
    expect(clampSanity(140)).toBe(100);
    expect(clampSanity(-3)).toBe(0);
    expect(clampSanity(41.6)).toBe(42);
    expect(clampSanity(NaN)).toBe(SANITY.start);
    expect(clampSanity(clampSanity(9) - SANITY.timeout)).toBe(0);
  });
});

describe('omen per day', () => {
  it('is the same for everyone on a day and never unknown', () => {
    for (let day = -3; day <= 400; day++) {
      const omen = omenForDay(day);
      expect(OMENS).toContain(omen);
      expect(omenForDay(day)).toBe(omen);
    }
    expect(omenForDay(0).id).toBe('bell');
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
