import { afterEach, describe, expect, it, vi } from 'vitest';
import { repairDive } from '../src/game/daily';
import { computeStats } from '../src/game/stats';
import type { DayRecord } from '../src/game/types';

// Situations the controller (src/app.ts) meets in the middle of a dive.

function dive(answered: number, extra: Partial<DayRecord> = {}): DayRecord {
  const promptIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  return {
    day: 9,
    date: '2026-12-05',
    omen: 'still',
    promptIds,
    answers: promptIds.slice(0, answered).map((promptId) => ({ promptId, input: 'x', answer: 'X', tier: 3 as const, depth: 400, rejects: [], timeMs: 5000 })),
    sanity: 80,
    finished: answered === 7,
    active: { index: answered, startedAt: 1_000_000, rejects: ['wrong'] },
    ...extra,
  };
}
const without = (...gone: string[]) => (id: string) => !gone.includes(id);
const TODAY = ['p', 'q', 'c', 'r', 's', 't', 'u'];

describe('a bank update that removes prompts mid-dive', () => {
  it('changes nothing while every prompt still exists', () => {
    const rec = dive(3);
    expect(repairDive(rec, () => true, TODAY)).toBe(rec);
  });

  it('swaps only the lost prompts, in place, and keeps the clock on the question in progress', () => {
    const rec = dive(3);
    const fixed = repairDive(rec, without('a', 'f'), TODAY);
    // "a" was answered, so it stays; "f" is swapped for the first unused prompt of today's plan.
    expect(fixed.promptIds).toEqual(['a', 'b', 'c', 'd', 'e', 'p', 'g']);
    expect(fixed.active).toEqual(rec.active);
    expect(fixed.answers).toBe(rec.answers);
    expect(rec.promptIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('gives a fresh clock when the question in progress is the one that went', () => {
    const fixed = repairDive(dive(3), without('d'), TODAY);
    expect(fixed.promptIds[3]).toBe('p');
    expect(fixed.active).toBeNull();
  });

  it('shortens the dive when nothing is left to swap in, never repeating a question', () => {
    const fixed = repairDive(dive(3), without('d', 'e'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(fixed.promptIds).toEqual(['a', 'b', 'c', 'f', 'g']);
    expect(fixed.active).toBeNull();
    const ok = repairDive(dive(3), without('g'), []);
    expect(ok.promptIds).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(ok.active).not.toBeNull();
  });

  it('leaves a finished dive as it was played', () => {
    const rec = dive(7, { active: null });
    expect(repairDive(rec, without('a', 'b'), TODAY)).toBe(rec);
  });
});

describe('reloading and the midnight turn', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the running clock and the refusals of the question in progress across a reload', async () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    vi.resetModules();
    const storage = await import('../src/game/storage');
    const rec = dive(2);
    storage.saveDay(rec);
    vi.resetModules();
    const reloaded = (await import('../src/game/storage')).loadDays()[9];
    expect(reloaded.active).toEqual({ index: 2, startedAt: 1_000_000, rejects: ['wrong'] });
    expect(reloaded.answers).toHaveLength(2);
  });

  it('saves and counts a dive that runs past midnight under the day it began', async () => {
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v) });
    vi.resetModules();
    const storage = await import('../src/game/storage');
    storage.saveDay({ ...dive(7, { active: null }), day: 8 });
    storage.saveDay(dive(3));
    storage.saveDay(dive(7, { active: null }));
    const days = storage.loadDays();
    expect(Object.keys(days)).toEqual(['8', '9']);
    expect(computeStats(days, 10).streak).toBe(2);
  });
});
