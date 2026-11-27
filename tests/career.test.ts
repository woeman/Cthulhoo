import { describe, expect, it } from 'vitest';
import { careerDay, computeCareer, lanternWeek, multiplierFor, toNextMilestone } from '../src/game/career';
import type { DayRecord, MilestoneDef } from '../src/game/types';

/** A finished dive worth `depth` metres on `day` (one answer carries it all). */
const dive = (day: number, depth: number, extra: Partial<DayRecord> = {}): DayRecord => ({
  day,
  date: '',
  omen: 'still',
  promptIds: ['p'],
  answers: [{ promptId: 'p', input: 'x', answer: 'x', tier: 3, depth, rejects: [], timeMs: 5000 }],
  sanity: 80,
  finished: true,
  ...extra,
});
const days = (...recs: DayRecord[]) => Object.fromEntries(recs.map((r) => [r.day, r]));
const run = (from: number, to: number, depth = 1000) => Array.from({ length: to - from + 1 }, (_, i) => dive(from + i, depth));
const M = (depth: number): MilestoneDef => ({ depth, name: `M${depth}`, place: `m${depth}`, line: '' });

describe('the lantern multiplier', () => {
  it('steps up by 0.1 for each full week, to at most 2', () => {
    expect([1, 7, 8, 14, 15, 21, 22].map(multiplierFor)).toEqual([1, 1, 1.1, 1.1, 1.2, 1.2, 1.3]);
    expect(multiplierFor(71)).toBe(2);
    expect(multiplierFor(500)).toBe(2);
    expect(multiplierFor(0)).toBe(1);
    expect(multiplierFor(NaN)).toBe(1);
  });

  it('names the week of the lantern', () => {
    expect([1, 7, 8, 14, 15].map(lanternWeek)).toEqual([1, 1, 2, 2, 3]);
  });
});

describe('career depth', () => {
  it('starts at the surface', () => {
    const c = computeCareer({}, 10, [M(1000)]);
    expect(c).toMatchObject({ depth: 0, streak: 0, wards: 0, nextMult: 1, daysPlayed: 0, away: null });
  });

  it('adds every dive, and the second week earns more', () => {
    const c = computeCareer(days(...run(1, 8)), 8, []);
    // seven days at x1, then day 8 at x1.1
    expect(c.depth).toBe(7 * 1000 + 1100);
    expect(c.streak).toBe(8);
    expect(c.nextMult).toBe(1.1);
    expect(c.playedToday).toBe(true);
  });

  it('earns a ward every seven days, holding at most two', () => {
    expect(computeCareer(days(...run(1, 6)), 6, []).wards).toBe(0);
    expect(computeCareer(days(...run(1, 7)), 7, []).wards).toBe(1);
    expect(computeCareer(days(...run(1, 21)), 21, []).wards).toBe(2);
  });

  it('drifts up a third of an average day for each missed day, and puts the lantern out', () => {
    // played days 1 to 3 (1,000 m each), missed day 4, today is day 5 (not yet played)
    const c = computeCareer(days(...run(1, 3)), 5, []);
    expect(c.depth).toBe(3000 - 333);
    expect(c.streak).toBe(0);
    expect(c.nextMult).toBe(1);
    expect(c.away).toEqual({ days: 1, drift: 333, wardsSpent: 0 });
  });

  it('takes about three missed days to lose a whole day', () => {
    const c = computeCareer(days(...run(1, 3)), 7, []);
    expect(c.away?.days).toBe(3);
    expect(c.away?.drift).toBe(999);
  });

  it('never counts today as missed', () => {
    const c = computeCareer(days(...run(1, 3)), 4, []);
    expect(c.depth).toBe(3000);
    expect(c.away).toBeNull();
    expect(c.streak).toBe(3);
    expect(c.nextMult).toBe(1);
    expect(c.playedToday).toBe(false);
  });

  it('spends a ward to keep the lantern lit through a missed day', () => {
    // a week (ward earned), day 8 missed, day 9 played
    const c = computeCareer(days(...run(1, 7), dive(9, 1000)), 9, []);
    expect(c.wards).toBe(0);
    expect(c.streak).toBe(8); // the warded day kept the lantern but did not add to it
    expect(c.depth).toBe(7000 + 1100);
    expect(c.events.filter((e) => e.kind === 'ward-spent')).toHaveLength(1);
    expect(c.events.some((e) => e.kind === 'drift')).toBe(false);
  });

  it('drifts once the wards run out', () => {
    // a week, then days 8 and 9 missed: the ward covers day 8, day 9 drifts
    const c = computeCareer(days(...run(1, 7)), 10, []);
    expect(c.away).toEqual({ days: 2, drift: 333, wardsSpent: 1 });
    expect(c.streak).toBe(0);
  });

  it('never drifts back above a milestone it has passed', () => {
    const marks = [M(500), M(2000)];
    // 2,100 m in all, then a long time away
    const c = computeCareer(days(dive(1, 2100)), 40, marks);
    expect(c.floor).toBe(2000);
    expect(c.depth).toBe(2000);
    expect(c.best).toBe(2100);
    expect(c.passed.map((p) => p.index)).toEqual([0, 1]);
    expect(c.next).toBe(-1);
    expect(toNextMilestone(c, marks)).toBeNull();
  });

  it('records the day each milestone was passed, and how far the next is', () => {
    const marks = [M(1500), M(5000)];
    const c = computeCareer(days(...run(1, 3)), 3, marks);
    expect(c.passed).toEqual([{ index: 0, day: 2 }]);
    expect(c.next).toBe(1);
    expect(toNextMilestone(c, marks)).toBe(2000);
  });

  it('counts a dive left unfinished on an earlier day, but not today’s until it is finished', () => {
    const partial = dive(1, 400, { finished: false });
    const today = dive(2, 900, { finished: false });
    const c = computeCareer(days(partial, today), 2, []);
    expect(c.depth).toBe(400);
    expect(c.daysPlayed).toBe(1);
    expect(c.playedToday).toBe(false);
    // a dive begun but with nothing answered does not count
    expect(computeCareer(days(dive(1, 0, { finished: false, answers: [] })), 3, []).daysPlayed).toBe(0);
  });

  it('ignores practice dives and days in the future', () => {
    const c = computeCareer(days(dive(1, 1000, { practice: true }), dive(5, 1000)), 3, []);
    expect(c.daysPlayed).toBe(0);
    expect(c.depth).toBe(0);
  });

  it('keeps one point per day for the chart, drifting days included', () => {
    const c = computeCareer(days(...run(1, 2)), 4, []);
    expect(c.points.map((p) => [p.day, p.kind])).toEqual([
      [1, 'dive'],
      [2, 'dive'],
      [3, 'drift'],
      [4, 'today'],
    ]);
    expect(c.points[2].depth).toBeLessThan(c.points[1].depth);
  });
});

describe('riddles in the career', () => {
  const solved = (day: number, metres: number) => ({ day, status: 'solved', metres });
  const riddles = (...rs: Array<{ day: number; status: string; metres?: number }>) => Object.fromEntries(rs.map((r) => [r.day, r]));

  it('adds a solved riddle’s metres as they are, on its day', () => {
    // Day 8 is the lantern's second week: the dive earns 1,100, the riddle its own 700.
    const c = computeCareer(days(...run(1, 8)), 8, [], riddles(solved(8, 700), solved(3, 450)));
    expect(c.depth).toBe(7 * 1000 + 1100 + 700 + 450);
    expect(c.fromRiddles).toBe(1150);
    expect(c.riddlesSolved).toBe(2);
    expect(careerDay(c, 8)).toMatchObject({ riddle: 700, before: 7450, after: 9250 });
    expect(careerDay(c, 4).riddle).toBe(0);
  });

  it('never lights the lantern, spends a ward or softens the drift', () => {
    // Played days 1 to 3, then only the riddle on days 4 and 5: both are missed dives.
    const c = computeCareer(days(...run(1, 3)), 6, [], riddles(solved(4, 1000), solved(5, 1000)));
    expect(c.streak).toBe(0);
    expect(c.daysPlayed).toBe(3);
    // Each missed day drifts a third of the average dive (1,000), then the riddle adds its own.
    expect(c.depth).toBe(3000 - 333 + 1000 - 333 + 1000);
    expect(c.away).toMatchObject({ days: 2, drift: 666 });
  });

  it('counts a riddle solved before any dive, and only riddles solved', () => {
    const c = computeCareer({}, 5, [M(900)], riddles(solved(2, 1000), { day: 3, status: 'sunk' }, { day: 4, status: 'playing' }, solved(9, 250)));
    expect(c.depth).toBe(1000);
    expect(c.firstDay).toBe(2);
    expect(c.passed).toEqual([{ index: 0, day: 2 }]);
    expect(c.daysPlayed).toBe(0);
    expect(c.away).toBeNull(); // nothing to drift from: no telegram
  });
});
