import { describe, expect, it } from 'vitest';
import bank from '../src/content/placeholder-bank.json';
import { dateForDay, dayNumberFor, localDateKey, planCycle, promptsForDay, MAX_PER_CATEGORY } from '../src/game/daily';
import { bellIndexFor, omenForDay } from '../src/game/omens';
import type { PromptDef } from '../src/game/types';

const prompts = (bank as { prompts: PromptDef[] }).prompts;

function fakeBank(n: number): PromptDef[] {
  const cats = ['geography', 'science', 'nature', 'culture', 'history', 'myth', 'food', 'language', 'sport', 'misc'];
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(3, '0')}`,
    text: `Prompt ${i}`,
    category: cats[i % cats.length],
    answers: [{ answer: `a${i}`, tier: 1 }],
  }));
}

describe('day numbers', () => {
  it('starts at 1 on launch day and rolls over at local midnight', () => {
    expect(dayNumberFor(new Date(2026, 10, 27, 0, 0, 1))).toBe(1);
    expect(dayNumberFor(new Date(2026, 10, 27, 23, 59, 59))).toBe(1);
    expect(dayNumberFor(new Date(2026, 10, 28, 0, 0, 0))).toBe(2);
    expect(localDateKey(dateForDay(1))).toBe('2026-11-27');
    expect(localDateKey(dateForDay(36))).toBe('2027-01-01');
  });
});

describe('daily picker', () => {
  it('is deterministic and gives seven prompts', () => {
    const a = promptsForDay(prompts, 5);
    expect(a).toHaveLength(7);
    expect(promptsForDay(prompts, 5)).toEqual(a);
  });

  it('uses every prompt once per cycle before repeating', () => {
    const big = fakeBank(70);
    const seen = new Set<string>();
    for (let d = 1; d <= 10; d++) for (const id of promptsForDay(big, d)) seen.add(id);
    expect(seen.size).toBe(70);
  });

  it('keeps at most two prompts of one category per day', () => {
    const big = fakeBank(140);
    for (const day of planCycle(big, 0)) {
      const counts = new Map<string, number>();
      for (const id of day) {
        const c = big.find((p) => p.id === id)!.category;
        counts.set(c, (counts.get(c) ?? 0) + 1);
      }
      expect(Math.max(...counts.values())).toBeLessThanOrEqual(MAX_PER_CATEGORY);
    }
  });

  it('honours fixed days from the bank', () => {
    const big = fakeBank(20);
    const ids = promptsForDay(big, 3, [{ date: '2026-11-29', prompts: ['p001', 'p002'] }], '2026-11-29');
    expect(ids).toEqual(['p001', 'p002']);
  });
});

describe('omens', () => {
  it('opens day 1 with the bell and is stable per day', () => {
    expect(omenForDay(1).id).toBe('bell');
    expect(omenForDay(9).id).toBe(omenForDay(9).id);
    const ids = new Set(Array.from({ length: 28 }, (_, i) => omenForDay(i + 2).id));
    expect(ids.size).toBeGreaterThanOrEqual(5);
  });
  it('picks a bell question inside the dive', () => {
    for (let d = 1; d < 50; d++) {
      const b = bellIndexFor(d, 7);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(7);
    }
  });
});
