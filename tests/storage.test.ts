import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DayRecord } from '../src/game/types';

class FakeStorage {
  data = new Map<string, string>();
  full = false;
  writes = 0;
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.writes++;
    if (this.full) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const DAYS = 'cthulhoo.v1.days';

/** A fresh copy of the module, so its in-memory state starts empty. */
async function storage(local?: FakeStorage) {
  if (local) vi.stubGlobal('localStorage', local);
  vi.resetModules();
  return import('../src/game/storage');
}

function dive(day: number, answers = 0, extra: Partial<DayRecord> = {}): DayRecord {
  return {
    day,
    date: '2026-11-27',
    omen: 'bell',
    promptIds: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    answers: Array.from({ length: answers }, (_, i) => ({ promptId: 'abcdefg'[i], input: 'x', answer: 'X', tier: 2 as const, depth: 250, rejects: [], timeMs: 900 })),
    sanity: 90,
    finished: answers === 7,
    active: null,
    ...extra,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('saved progress', () => {
  it('falls back to defaults on corrupt JSON', async () => {
    const local = new FakeStorage();
    local.data.set(DAYS, '{"1": {"day": 1,');
    local.data.set('cthulhoo.v1.settings', 'not json');
    const s = await storage(local);
    expect(s.loadDays()).toEqual({});
    expect(s.loadSettings()).toEqual(s.DEFAULT_SETTINGS);
  });

  it('survives JSON of the wrong shape, and saving still works', async () => {
    for (const raw of ['null', '[]', '"days"', '42', 'true', '[{"day":1}]']) {
      const local = new FakeStorage();
      local.data.set(DAYS, raw);
      const s = await storage(local);
      expect(s.loadDays(), raw).toEqual({});
      expect(s.saveDay(dive(1, 1)), raw).toBe(true);
      expect(s.loadDays()[1].answers, raw).toHaveLength(1);
    }
  });

  it('drops damaged days, repairs small slips, and keeps the rest', async () => {
    const local = new FakeStorage();
    const good = dive(1, 2);
    const slips = { ...dive(5, 1), sanity: 'lots', finished: 'yes', active: { index: 'one' } } as unknown as DayRecord;
    local.data.set(
      DAYS,
      JSON.stringify({
        1: good,
        2: { ...dive(2), promptIds: 'abc' },
        3: dive(4),
        4: { ...dive(4, 1), answers: [{ promptId: 'a', tier: 9, depth: 100 }] },
        5: slips,
        6: { ...dive(6, 1), practice: true },
        7: { ...dive(7, 1), answers: [{ promptId: 'a', tier: 2, depth: 250 }] },
      }),
    );
    const s = await storage(local);
    const days = s.loadDays();
    expect(Object.keys(days)).toEqual(['1', '5', '7']);
    expect(days[1]).toEqual(good);
    expect(days[5]).toMatchObject({ sanity: 100, finished: false, active: null });
    expect(days[7].answers[0]).toMatchObject({ input: null, answer: null, rejects: [], timeMs: 0 });
  });

  it('keeps working in memory when localStorage cannot even be touched', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
    const s = await storage();
    expect(s.loadDays()).toEqual({});
    expect(s.saveDay(dive(3, 2))).toBe(true);
    expect(s.loadDays()[3].answers).toHaveLength(2);
    s.saveFlag('seenHowTo');
    expect(s.loadFlag('seenHowTo')).toBe(true);
  });

  it('reads the newest copy, not the stale stored one, when writes hit the quota', async () => {
    const local = new FakeStorage();
    const s = await storage(local);
    s.saveDay(dive(1, 1));
    local.full = true;
    expect(s.saveDay(dive(1, 3))).toBe(true);
    expect(s.loadDays()[1].answers).toHaveLength(3);
    expect(JSON.parse(local.data.get(DAYS)!)[1].answers).toHaveLength(1);
    // Once a write lands again, localStorage is the truth again (another tab may write it).
    local.full = false;
    s.saveDay(dive(1, 4));
    local.data.set(DAYS, JSON.stringify({ 1: dive(1, 5) }));
    expect(s.loadDays()[1].answers).toHaveLength(5);
  });

  it('never touches localStorage in ephemeral mode', async () => {
    const local = new FakeStorage();
    local.data.set(DAYS, JSON.stringify({ 1: dive(1, 6) }));
    const s = await storage(local);
    s.setEphemeral(true);
    expect(s.loadDays()).toEqual({});
    s.saveDay(dive(1, 2));
    s.saveSettings({ ...s.DEFAULT_SETTINGS, muted: true });
    s.saveFlag('seenHowTo');
    expect(local.writes).toBe(0);
    expect(s.loadDays()[1].answers).toHaveLength(2);
    expect(s.loadSettings().muted).toBe(true);
    expect(s.loadFlag('seenHowTo')).toBe(true);
  });

  it('never records practice dives', async () => {
    const local = new FakeStorage();
    const s = await storage(local);
    expect(s.saveDay(dive(1, 7, { practice: true }))).toBe(false);
    expect(s.loadDays()).toEqual({});
    expect(local.writes).toBe(0);
  });

  it('refuses a save that would undo progress, as a stale second tab would', async () => {
    const s = await storage(new FakeStorage());
    expect(s.saveDay(dive(2, 2))).toBe(true);
    expect(s.saveDay(dive(2, 1))).toBe(false);
    const rewritten = dive(2, 2);
    rewritten.answers[1] = { ...rewritten.answers[1], answer: 'Something rarer', tier: 6 };
    expect(s.saveDay(rewritten)).toBe(false);
    expect(s.loadDays()[2].answers[1].tier).toBe(2);
    // Progress on the same answers is always fine: a refusal, a whisper, the next answer.
    expect(s.saveDay({ ...dive(2, 2), sanity: 87, whisperUsed: true })).toBe(true);
    expect(s.saveDay(dive(2, 3))).toBe(true);
    expect(s.saveDay(dive(2, 7))).toBe(true);
    expect(s.saveDay({ ...dive(2, 7), finished: false })).toBe(false);
    expect(s.loadDays()[2].finished).toBe(true);
  });

  it('checks every setting', async () => {
    const local = new FakeStorage();
    local.data.set('cthulhoo.v1.settings', JSON.stringify({ muted: 'yes', volume: 5, reducedMotion: 'sometimes', haptics: 0, music: 'loud' }));
    let s = await storage(local);
    expect(s.loadSettings()).toEqual({ muted: false, volume: 1, reducedMotion: 'auto', haptics: true, music: true });
    local.data.set('cthulhoo.v1.settings', JSON.stringify({ muted: true, volume: 0.25, reducedMotion: 'on', haptics: false, music: false }));
    s = await storage(local);
    expect(s.loadSettings()).toEqual({ muted: true, volume: 0.25, reducedMotion: 'on', haptics: false, music: false });
    // Settings saved before there was music keep it on.
    local.data.set('cthulhoo.v1.settings', JSON.stringify({ muted: true, volume: 0.25, reducedMotion: 'on', haptics: false }));
    s = await storage(local);
    expect(s.loadSettings().music).toBe(true);
  });
});

describe('census shares kept with the dives', () => {
  it('keeps the latest count for each daily answer, and never a smaller one', async () => {
    const local = new FakeStorage();
    const s = await storage(local);
    s.keepCensus(3, 'rivers-1', { total: 40, mine: 2 });
    s.keepCensus(3, 'rivers-1', { total: 212, mine: 9 });
    s.keepCensus(3, 'rivers-1', { total: 90, mine: 4 }); // an older answer arriving late
    s.keepCensus(4, 'rivers-1', { total: 5, mine: 9 });
    const kept = s.loadCensusKept();
    expect(s.censusKeptFor(kept, 3, 'rivers-1')).toEqual({ total: 212, mine: 9 });
    expect(s.censusKeptFor(kept, 4, 'rivers-1')).toEqual({ total: 5, mine: 5 });
    expect(s.censusKeptFor(kept, 5, 'rivers-1')).toBeUndefined();
    expect(JSON.parse(local.data.get('cthulhoo.v1.census') ?? '{}')).toEqual({ '3|rivers-1': { total: 212, mine: 9 }, '4|rivers-1': { total: 5, mine: 5 } });
  });

  it('drops what it cannot trust', async () => {
    const local = new FakeStorage();
    local.data.set('cthulhoo.v1.census', JSON.stringify({ '3|a': { total: 12, mine: 1 }, nonsense: { total: 3, mine: 1 }, '4|b': { total: -1, mine: 0 }, '5|c': 'many', '6|d': { total: 9.6, mine: 30 } }));
    const s = await storage(local);
    expect(s.loadCensusKept()).toEqual({ '3|a': { total: 12, mine: 1 }, '6|d': { total: 9, mine: 9 } });
    local.data.set('cthulhoo.v1.census', '[1,2');
    expect((await storage(local)).loadCensusKept()).toEqual({});
  });

  it('lets the oldest days go once it holds a year of them', async () => {
    const local = new FakeStorage();
    const all: Record<string, { total: number; mine: number }> = {};
    for (let day = 1; day <= 430; day++) for (let q = 0; q < 7; q++) all[`${day}|q${q}`] = { total: 30, mine: 2 };
    local.data.set('cthulhoo.v1.census', JSON.stringify(all));
    const s = await storage(local);
    s.keepCensus(431, 'q0', { total: 25, mine: 1 });
    const kept = s.loadCensusKept();
    expect(Object.keys(kept)).toHaveLength(3000);
    expect(kept['1|q0']).toBeUndefined();
    expect(kept['431|q0']).toEqual({ total: 25, mine: 1 });
    expect(kept['430|q6']).toEqual({ total: 30, mine: 2 });
  });
});
