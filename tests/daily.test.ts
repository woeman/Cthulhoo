import { describe, expect, it } from 'vitest';
import bank from '../src/content/placeholder-bank.json';
import {
  MAX_PER_CATEGORY,
  PRACTICE_HORIZON,
  dateForDay,
  dateKeyForDay,
  dayNumberFor,
  dayNumberForKey,
  freezeDays,
  localDateKey,
  planCycle,
  practicePrompts,
  promptsForDay,
  seededShuffle,
} from '../src/game/daily';
import { bellIndexFor, omenForDay } from '../src/game/omens';
import type { BankDay, PromptDef } from '../src/game/types';

const prompts = (bank as { prompts: PromptDef[] }).prompts;

function fakeBank(n: number, prefix = 'p'): PromptDef[] {
  const cats = ['geography', 'science', 'nature', 'culture', 'history', 'myth', 'food', 'language', 'sport', 'misc'];
  return Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${String(i).padStart(3, '0')}`,
    text: `Prompt ${i}`,
    category: cats[i % cats.length],
    answers: [{ answer: `a${i}`, tier: 1 }],
  }));
}

/** Uneven categories, as a real bank will be: a quarter of it geography. */
function mixedBank(n: number, salt = 'm'): PromptDef[] {
  const shares: Array<[string, number]> = [
    ['geography', 25],
    ['science', 15],
    ['nature', 12],
    ['culture', 10],
    ['history', 10],
    ['myth', 8],
    ['food', 6],
    ['language', 6],
    ['sport', 5],
    ['misc', 3],
  ];
  return shares.flatMap(([category, share]) =>
    Array.from({ length: Math.round((share / 100) * n) }, (_, i) => ({ id: `${salt}-${category}-${i}`, text: 't', category, answers: [{ answer: 'a', tier: 1 }] })),
  );
}

const cycleLength = (ps: PromptDef[]) => Math.floor(ps.length / 7);
const run = (ps: PromptDef[], from: number, to: number, fixed: BankDay[] = []) =>
  Array.from({ length: to - from + 1 }, (_, i) => promptsForDay(ps, from + i, fixed, dateKeyForDay(from + i)));
function mostOfOneCategory(ps: PromptDef[], ids: string[]): number {
  const cat = new Map(ps.map((p) => [p.id, p.category]));
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(cat.get(id)!, (counts.get(cat.get(id)!) ?? 0) + 1);
  return Math.max(...counts.values());
}

describe('day numbers', () => {
  it('starts at 1 on launch day and rolls over at local midnight', () => {
    expect(dayNumberFor(new Date(2026, 10, 27, 0, 0, 1))).toBe(1);
    expect(dayNumberFor(new Date(2026, 10, 27, 23, 59, 59))).toBe(1);
    expect(dayNumberFor(new Date(2026, 10, 28, 0, 0, 0))).toBe(2);
    expect(localDateKey(dateForDay(1))).toBe('2026-11-27');
    expect(localDateKey(dateForDay(36))).toBe('2027-01-01');
  });

  it('reads and writes date keys by the calendar alone', () => {
    expect(dayNumberForKey('2026-11-27')).toBe(1);
    expect(dayNumberForKey('2027-01-01')).toBe(36);
    expect(dayNumberForKey('2026-11-26')).toBe(0);
    expect(dateKeyForDay(36)).toBe('2027-01-01');
    for (let d = -10; d < 1500; d += 7) expect(dayNumberForKey(dateKeyForDay(d))).toBe(d);
    for (const bad of ['2027-02-29', '2026-13-01', '2026-11-27T00:00', '27/11/2026', '', '2026-1-5']) expect(dayNumberForKey(bad)).toBeNull();
  });
});

describe('daily picker', () => {
  it('is deterministic and gives seven prompts', () => {
    const a = promptsForDay(prompts, 5);
    expect(a).toHaveLength(7);
    expect(promptsForDay(prompts, 5)).toEqual(a);
  });

  it('gives everyone the same day whatever order the files list the prompts in', () => {
    const big = mixedBank(100);
    const reordered = seededShuffle(big, 99);
    expect(run(reordered, 1, 40)).toEqual(run(big, 1, 40));
  });

  it('uses every prompt once per cycle before repeating', () => {
    const big = fakeBank(70);
    const seen = new Set<string>();
    for (let d = 1; d <= 10; d++) for (const id of promptsForDay(big, d)) seen.add(id);
    expect(seen.size).toBe(70);
  });

  it('never repeats a prompt inside any cycle, and leaves out only the spare ones', () => {
    for (const big of [mixedBank(100), fakeBank(73), mixedBank(200)]) {
      const len = cycleLength(big);
      for (let c = 0; c < 6; c++) {
        const ids = run(big, c * len + 1, (c + 1) * len).flat();
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(len * 7);
      }
    }
  });

  it('keeps at most two prompts of one category per day in every cycle', () => {
    for (const big of [fakeBank(70), fakeBank(140), mixedBank(71), mixedBank(100), mixedBank(200)]) {
      for (let c = 0; c < 30; c++) {
        for (const day of planCycle(big, c)) expect(mostOfOneCategory(big, day)).toBeLessThanOrEqual(MAX_PER_CATEGORY);
      }
    }
  });

  it('spreads a category excess it cannot avoid as thinly as it can', () => {
    // The placeholder bank is 8 geography prompts out of 14: two days cannot hold
    // them two at a time, but each day gets four rather than one day getting six.
    for (let d = 1; d <= 20; d++) expect(mostOfOneCategory(prompts, promptsForDay(prompts, d))).toBe(4);
  });

  it('replans when a category changes even though the ids do not', () => {
    const big = fakeBank(70);
    planCycle(big, 0);
    const regrouped = big.map((p, i) => ({ ...p, category: i < 20 ? 'geography' : `other${i % 7}` }));
    for (const day of planCycle(regrouped, 0)) expect(mostOfOneCategory(regrouped, day)).toBeLessThanOrEqual(MAX_PER_CATEGORY);
  });

  it('does not repeat a prompt on consecutive days across a cycle boundary', () => {
    for (const big of [mixedBank(100), fakeBank(70), mixedBank(200)]) {
      const len = cycleLength(big);
      for (let c = 1; c <= 40; c++) {
        const last = promptsForDay(big, c * len);
        expect(promptsForDay(big, c * len + 1).filter((id) => last.includes(id))).toEqual([]);
      }
    }
  });

  it('treats the days before launch (a wrong clock) as day 1', () => {
    expect(promptsForDay(prompts, 0)).toEqual(promptsForDay(prompts, 1));
    expect(promptsForDay(prompts, -40)).toEqual(promptsForDay(prompts, 1));
  });
});

describe('fixed days', () => {
  it('honours fixed days from the bank', () => {
    const big = fakeBank(20);
    const ids = promptsForDay(big, 3, [{ date: '2026-11-29', prompts: ['p001', 'p002'] }], '2026-11-29');
    expect(ids).toEqual(['p001', 'p002']);
  });

  it('drops unknown and repeated ids, and ignores a fixed day with none left', () => {
    const big = fakeBank(20);
    expect(promptsForDay(big, 3, [{ date: '2026-11-29', prompts: ['p001', 'p001', 'gone', 'p002'] }], '2026-11-29')).toEqual(['p001', 'p002']);
    expect(promptsForDay(big, 3, [{ date: '2026-11-29', prompts: ['gone'] }], '2026-11-29')).toEqual(promptsForDay(big, 3));
    const many = big.slice(0, 10).map((p) => p.id);
    expect(promptsForDay(big, 3, [{ date: '2026-11-29', prompts: many }], '2026-11-29')).toEqual(many.slice(0, 7));
  });

  it('keeps fixed prompts out of the rest of their cycle', () => {
    const big = fakeBank(70);
    const free = promptsForDay(big, 9);
    const fixed = [{ date: dateKeyForDay(3), prompts: free }];
    const cycle = run(big, 1, 10, fixed);
    expect(cycle[2]).toEqual(free);
    const all = cycle.flat();
    expect(new Set(all).size).toBe(70);
    expect(all).toHaveLength(70);
  });
});

describe('growing the bank', () => {
  const old = fakeBank(70);
  const grown = [...old, ...fakeBank(7, 'new')];

  it('re-plans the open days when prompts are added (documented)', () => {
    expect(run(grown, 1, 10)).not.toEqual(run(old, 1, 10));
  });

  it('keeps frozen days exactly, and the rest of the cycle still repeats nothing', () => {
    const today = 4;
    const frozen = freezeDays(old, [], 1, today + 1);
    expect(frozen.map((d) => d.date)).toEqual(['2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01']);
    expect(run(grown, 1, today + 1, frozen)).toEqual(run(old, 1, today + 1));
    const cycle = run(grown, 1, cycleLength(grown), frozen).flat();
    expect(new Set(cycle).size).toBe(grown.length);
    expect(cycle).toHaveLength(grown.length);
  });
});

describe('practice dives', () => {
  it("avoid today's prompts", () => {
    const today = promptsForDay(prompts, 1);
    for (let seed = 0; seed < 50; seed++) {
      const ids = practicePrompts(prompts, today, seed);
      expect(ids).toHaveLength(7);
      expect(ids.filter((id) => today.includes(id))).toEqual([]);
    }
  });

  it('keep clear of the coming week when given the day, and still vary', () => {
    const big = mixedBank(100);
    const week = run(big, 1, 1 + PRACTICE_HORIZON).flat();
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const ids = practicePrompts(big, promptsForDay(big, 1), seed, 1, []);
      expect(ids.filter((id) => week.includes(id))).toEqual([]);
      ids.forEach((id) => seen.add(id));
    }
    expect(seen.size).toBeGreaterThan(20);
  });

  it("fall back on a small bank furthest-off first, today's last", () => {
    const small = fakeBank(10);
    const today = promptsForDay(small, 1);
    const others = small.map((p) => p.id).filter((id) => !today.includes(id));
    const ids = practicePrompts(small, today, 3, 1);
    expect(ids).toHaveLength(7);
    expect(others.every((id) => ids.includes(id))).toBe(true);
  });
});

describe('omens', () => {
  it('opens day 1 with the bell and is stable per day', () => {
    expect(omenForDay(1).id).toBe('bell');
    expect(omenForDay(9).id).toBe(omenForDay(9).id);
    const ids = new Set(Array.from({ length: 28 }, (_, i) => omenForDay(i + 2).id));
    expect(ids.size).toBeGreaterThanOrEqual(5);
  });

  it('gives every week each omen once and Still Water twice, launch week included', () => {
    for (let week = 0; week < 20; week++) {
      const ids = Array.from({ length: 7 }, (_, i) => omenForDay(week * 7 + i + 1).id).sort();
      expect(ids).toEqual(['bell', 'blood', 'slack', 'stars', 'still', 'still', 'whisper']);
    }
  });

  it('picks a bell question inside the dive', () => {
    for (let d = 1; d < 50; d++) {
      const b = bellIndexFor(d, 7);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(7);
    }
  });
});
