import { describe, expect, it } from 'vitest';
import { EPOCH_UTC, dateForDay } from '../src/game/daily';
import type { PromptDef } from '../src/game/types';
import { CULT_MAX, WEEKS_KEPT, boardFor, joinCult, leaveCult, newCult, pruneCult, recordDive, relayDay, weekOf } from '../src/party/cult';
import {
  addSitter,
  againPass,
  candleOut,
  gutter,
  holder,
  newPass,
  nextCandle,
  orderFor,
  passOn,
  removeSitter,
  revivePass,
  speakPass,
  startPass,
  takeLantern,
} from '../src/party/passplay';
import { RISE_MS } from '../src/party/room';

const DEPTHS = [0, 100, 250, 400, 600, 800, 1000];
const DAY = 86_400_000;
const noonOf = (day: number) => EPOCH_UTC + (day - 1) * DAY + DAY / 2;

describe('the cult board', () => {
  it('starts each week on a Monday', () => {
    expect(dateForDay(1).getDay()).toBe(5); // 27 November 2026, a Friday
    expect(weekOf(1)).toBe(-3);
    expect(dateForDay(weekOf(1)).getDay()).toBe(1);
    for (let d = -20; d < 60; d++) {
      const w = weekOf(d);
      expect(dateForDay(w).getDay()).toBe(1);
      expect(d - w).toBeGreaterThanOrEqual(0);
      expect(d - w).toBeLessThan(7);
    }
  });

  it('knows the relay’s day', () => {
    expect(relayDay(EPOCH_UTC)).toBe(1);
    expect(relayDay(EPOCH_UTC + DAY - 1)).toBe(1);
    expect(relayDay(EPOCH_UTC + DAY)).toBe(2);
  });

  it('takes members, by name, up to the limit', () => {
    const c = newCult('BRINE-42', 0);
    expect(joinCult(c, 'ada00001', 'Ada', 0).ok).toBe(true);
    expect(joinCult(c, 'ada00001', 'Ada Byron', 1).ok).toBe(true);
    expect(c.members).toHaveLength(1);
    expect(c.members[0].name).toBe('Ada Byron');
    expect(joinCult(c, 'bram0001', '  ', 0)).toMatchObject({ ok: false, code: 'name' });
    expect(joinCult(c, 'NOT AN ID', 'Bram', 0)).toMatchObject({ ok: false, code: 'bad' });
    for (let i = 1; i < CULT_MAX; i++) joinCult(c, `member${i}`, `M${i}`, 0);
    expect(joinCult(c, 'late0001', 'Late', 0)).toMatchObject({ ok: false, code: 'full' });
  });

  it('keeps the deeper dive of a day, only from members, only from about today', () => {
    const today = 10;
    const now = noonOf(today);
    const c = newCult('BRINE-42', now);
    joinCult(c, 'ada00001', 'Ada', now);
    expect(recordDive(c, 'ada00001', today, 2400, now).ok).toBe(true);
    expect(recordDive(c, 'ada00001', today, 1300, now).ok).toBe(true);
    expect(c.dives.ada00001[today]).toBe(2400);
    expect(recordDive(c, 'ada00001', today + 1, 900, now).ok).toBe(true);
    expect(recordDive(c, 'ada00001', today - 2, 900, now)).toMatchObject({ ok: false, code: 'bad' });
    expect(recordDive(c, 'eve00001', today, 900, now)).toMatchObject({ ok: false, code: 'gone' });
    expect(recordDive(c, 'ada00001', today, -5, now)).toMatchObject({ ok: false, code: 'bad' });
    expect(recordDive(c, 'ada00001', today, 99_999, now).ok).toBe(true);
    expect(c.dives.ada00001[today]).toBe(20_000);
  });

  it('draws the week, deepest first, with last week’s deepest', () => {
    const today = 12; // a Tuesday
    const c = newCult('BRINE-42', 0);
    joinCult(c, 'ada00001', 'Ada', 0);
    joinCult(c, 'bram0001', 'Bram', 0);
    joinCult(c, 'cleo0001', 'Cleo', 0);
    const monday = weekOf(today);
    c.dives = {
      ada00001: { [monday]: 1000, [today]: 1500, [monday - 3]: 4000 },
      bram0001: { [monday + 1]: 3000, [monday - 2]: 4000 },
    };
    const b = boardFor(c, 'bram0001', today);
    expect(b.week).toBe(monday);
    expect(b.rows.map((r) => [r.name, r.total])).toEqual([
      ['Bram', 3000],
      ['Ada', 2500],
      ['Cleo', 0],
    ]);
    expect(b.rows[1].days).toEqual([1000, 1500, null, null, null, null, null]);
    expect(b.total).toBe(5500);
    expect(b.lastWeek).toEqual({ names: ['Ada', 'Bram'], depth: 4000 });
    expect(b.member).toBe(true);
    expect(boardFor(c, 'stranger', today).member).toBe(false);
  });

  it('forgets old weeks and those who left', () => {
    const c = newCult('BRINE-42', 0);
    joinCult(c, 'ada00001', 'Ada', 0);
    joinCult(c, 'bram0001', 'Bram', 0);
    const today = 100;
    const oldest = weekOf(today) - 7 * (WEEKS_KEPT - 1);
    c.dives = { ada00001: { [oldest]: 1, [oldest - 1]: 2 }, bram0001: { [today]: 3 }, gone0001: { [today]: 4 } };
    pruneCult(c, today);
    expect(c.dives).toEqual({ ada00001: { [oldest]: 1 }, bram0001: { [today]: 3 } });
    leaveCult(c, 'bram0001', 0);
    expect(c.members.map((m) => m.id)).toEqual(['ada00001']);
    expect(c.dives.bram0001).toBeUndefined();
  });
});

const planets: PromptDef = {
  id: 'planets',
  text: 'Name a planet.',
  category: 'science',
  answers: [
    { answer: 'Mars', tier: 1 },
    { answer: 'Uranus', tier: 5 },
  ],
  traps: [{ answer: 'Pluto', reason: 'Demoted in 2006.' }],
};

describe('passing the lantern', () => {
  it('seats two to eight, with names nobody shares', () => {
    const s = newPass();
    expect(addSitter(s, 'Ada')).toBeNull();
    expect(addSitter(s, 'ada')).toMatch(/already sitting/);
    expect(addSitter(s, '   ')).toMatch(/name/);
    expect(startPass(s, ['planets'], DEPTHS)).toMatch(/at least 2/);
    for (const n of ['Bram', 'Cleo', 'Dora', 'Eli', 'Fen', 'Gus', 'Hal']) expect(addSitter(s, n)).toBeNull();
    expect(addSitter(s, 'Ivy')).toMatch(/8 is as many/);
    removeSitter(s, s.sitters[1].id);
    expect(addSitter(s, 'Ivy')).toBeNull();
    expect(s.sitters.find((x) => x.name === 'Ivy')?.mark).toBe(1);
  });

  it('plays a whole séance on one device', () => {
    const s = newPass();
    for (const n of ['Ada', 'Bram', 'Cleo']) addSitter(s, n);
    expect(startPass(s, ['planets', 'planets'], DEPTHS, { candles: 3, seconds: 20 })).toBeNull();
    expect(s.promptIds).toHaveLength(2);
    expect(orderFor(s).map((x) => x.name)).toEqual(['Ada', 'Bram', 'Cleo']);

    // Ada: a trap, then a lone rare answer.
    expect(holder(s)?.name).toBe('Ada');
    takeLantern(s, 1000);
    expect(s.litAt).toBe(1000 + RISE_MS);
    expect(candleOut(s)).toBe(1000 + RISE_MS + 20_000);
    expect(speakPass(s, planets, 'pluto', 2000)).toMatchObject({ kind: 'refused', verdict: 'trap' });
    expect(speakPass(s, planets, 'Uranus', 3000)).toMatchObject({ kind: 'sealed', answer: 'Uranus' });
    expect(s.phase).toBe('sealed');
    passOn(s, planets);
    // Bram and Cleo share an answer; nobody sees anyone's until the end.
    expect(holder(s)?.name).toBe('Bram');
    takeLantern(s, 4000);
    speakPass(s, planets, 'mars', 5000);
    passOn(s, planets);
    takeLantern(s, 6000);
    speakPass(s, planets, 'Mars', 7000);
    passOn(s, planets);
    expect(s.phase).toBe('reveal');
    const byName = (id: string) => s.sitters.find((x) => x.id === id)?.name;
    expect(s.results[0].voices.map((v) => [byName(v.sitter), v.depth])).toEqual([
      ['Ada', 1200],
      ['Bram', 50],
      ['Cleo', 50],
    ]);

    // The second candle starts one seat on; Cleo lets hers gutter.
    nextCandle(s);
    expect(orderFor(s).map((x) => x.name)).toEqual(['Bram', 'Cleo', 'Ada']);
    takeLantern(s, 8000);
    speakPass(s, planets, 'Mars', 9000);
    passOn(s, planets);
    takeLantern(s, 10_000);
    gutter(s);
    passOn(s, planets);
    takeLantern(s, 11_000);
    speakPass(s, planets, 'Uranus', 12_000);
    passOn(s, planets);
    nextCandle(s);
    expect(s.phase).toBe('ended');
    expect(s.heralds.map(byName)).toEqual(['Ada']);

    // A reload picks it up; the circle may sit again.
    expect(revivePass(JSON.parse(JSON.stringify(s)))).toEqual(s);
    againPass(s);
    expect(s.phase).toBe('setup');
    expect(s.sitters.map((x) => x.name)).toEqual(['Ada', 'Bram', 'Cleo']);
    expect(s.results).toEqual([]);
  });
});
