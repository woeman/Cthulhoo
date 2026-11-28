import { describe, expect, it } from 'vitest';
import { CLASS_MAX_SEATS } from '../src/party/class-types';
import {
  ALL_IN_MS,
  CLASS_SEAT_ROWS,
  CLASS_SHOTS_MAX,
  CLASS_TOP,
  CLASS_TTL_MS,
  againClass,
  ask,
  classAlarmAt,
  classTick,
  configureClass,
  endClass,
  everyoneIn,
  hostView,
  leaveSeat,
  makeKey,
  newClass,
  removeSeat,
  reveal,
  reviveClass,
  say,
  seatOnline,
  seatView,
  setTable,
  snapshot,
  tableSeats,
  takeSeat,
  type ClassRoom,
} from '../src/party/classroom';
import { GRACE_MS, RISE_MS } from '../src/party/room';
import type { PromptDef } from '../src/game/types';

const DEPTHS = [0, 100, 250, 400, 600, 800, 1000];
const T0 = 1_000_000;

const planets: PromptDef = {
  id: 'planets',
  text: 'Name a planet of the Solar System.',
  category: 'science',
  answers: [
    { answer: 'Mars', tier: 1 },
    { answer: 'Saturn', tier: 1 },
    { answer: 'Jupiter', tier: 2 },
    { answer: 'Neptune', tier: 3 },
    { answer: 'Mercury', tier: 4 },
    { answer: 'Uranus', tier: 5 },
    { answer: 'Venus', tier: 2 },
    { answer: 'Earth', tier: 1 },
  ],
  traps: [{ answer: 'Pluto', reason: 'Pluto was demoted in 2006.' }],
  decoys: ['Moon'],
};

const dev = (n: number) => `dev-${String(n).padStart(4, '0')}`;

/** A class of `n` divers named D1…Dn, all here. */
function classOf(n: number, tables = 0): ClassRoom {
  const room = newClass('DAGON-417', 'k'.repeat(24), T0);
  if (tables) expect(configureClass(room, { mode: 'classic', seconds: 30, tables, questions: 5 }, T0).ok).toBe(true);
  for (let i = 1; i <= n; i++) expect(takeSeat(room, dev(i), `D${i}`, T0).ok).toBe(true);
  return room;
}

const asked = (room: ClassRoom, at = T0): number => {
  expect(ask(room, planets, DEPTHS, at)).toEqual({ ok: true });
  return room.litAt + 1;
};

const heard = (room: ClassRoom, n: number, text: string, at: number) => {
  const res = say(room, dev(n), text, at);
  if (!res.ok) throw new Error(`${text}: ${res.code}`);
  return res.heard;
};

describe('a convocation: taking a seat', () => {
  it('seats divers under names of their own', () => {
    const room = newClass('DAGON-417', 'key', T0);
    const a = takeSeat(room, dev(1), '  Ada  ', T0);
    const b = takeSeat(room, dev(2), 'ada', T0);
    const c = takeSeat(room, dev(3), 'ADA', T0);
    expect(a.ok && a.seat.name).toBe('Ada');
    expect(a.ok && a.fresh).toBe(true);
    expect(b.ok && b.seat.name).toBe('ada II');
    expect(c.ok && c.seat.name).toBe('ADA III');
    expect(room.seats.map((s) => s.id)).toEqual([dev(1), dev(2), dev(3)]);
  });

  it('wants a proper mark and a name', () => {
    const room = newClass('DAGON-417', 'key', T0);
    expect(takeSeat(room, 'x', 'Ada', T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(takeSeat(room, 'NOT ok!', 'Ada', T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(takeSeat(room, dev(1), '   ', T0)).toMatchObject({ ok: false, code: 'name' });
    expect(room.seats).toHaveLength(0);
  });

  it('keeps a seat for the device that comes back, and renames it only before the class begins', () => {
    const room = classOf(2);
    seatOnline(room, dev(1), false);
    const back = takeSeat(room, dev(1), 'Adeline', T0 + 5);
    expect(back.ok && back.fresh).toBe(false);
    expect(back.ok && back.seat.name).toBe('Adeline');
    expect(room.seats[0].online).toBe(true);
    asked(room);
    const later = takeSeat(room, dev(1), 'Someone Else', T0 + 9000);
    expect(later.ok && later.seat.name).toBe('Adeline');
    expect(room.seats).toHaveLength(2);
  });

  it(`holds ${CLASS_MAX_SEATS} and no more, but always lets a seated diver back`, () => {
    const room = classOf(CLASS_MAX_SEATS);
    expect(takeSeat(room, dev(9000), 'Late', T0)).toMatchObject({ ok: false, code: 'full' });
    expect(takeSeat(room, dev(7), 'D7', T0).ok).toBe(true);
    expect(new Set(room.seats.map((s) => s.name.toLowerCase())).size).toBe(CLASS_MAX_SEATS);
  });

  it('gives up a seat left before the first question, and keeps the depth of one left after it', () => {
    const room = classOf(3);
    expect(leaveSeat(room, dev(2), T0)).toBe('gone');
    expect(room.seats.map((s) => s.name)).toEqual(['D1', 'D3']);
    const at = asked(room);
    heard(room, 1, 'Uranus', at);
    reveal(room, at + 1);
    expect(leaveSeat(room, dev(1), at + 2)).toBe('away');
    expect(room.seats.find((s) => s.id === dev(1))).toMatchObject({ online: false, total: 1200 });
    expect(leaveSeat(room, 'nobody-here', at)).toBeNull();
  });

  it('lets the host remove a diver, who may not sit again', () => {
    const room = classOf(3);
    expect(removeSeat(room, dev(2), T0)).toBe(true);
    expect(removeSeat(room, dev(2), T0)).toBe(false);
    expect(room.seats.map((s) => s.name)).toEqual(['D1', 'D3']);
    expect(takeSeat(room, dev(2), 'Back again', T0)).toMatchObject({ ok: false, code: 'removed' });
  });
});

describe('a convocation: how it is held', () => {
  it('takes only the choices offered', () => {
    const room = classOf(1);
    expect(configureClass(room, { mode: 'blitz', seconds: 90, tables: 4, questions: 7, topics: ['Finance', 'Finance', ' Economics '] }, T0)).toEqual({ ok: true, dealt: true });
    expect(room.config).toEqual({ mode: 'blitz', seconds: 90, tables: 4, questions: 7, topics: ['Finance', 'Economics'] });
    // 30 seconds is a classic time, not a blitz one.
    expect(configureClass(room, { mode: 'blitz', seconds: 30, tables: 4, questions: 7 }, T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(configureClass(room, { mode: 'classic', seconds: 30, tables: 7, questions: 5 }, T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(configureClass(room, { mode: 'duel', seconds: 30, tables: 0, questions: 5 }, T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(configureClass(room, { mode: 'classic', seconds: 30, tables: 0, questions: 0 }, T0)).toMatchObject({ ok: false, code: 'bad' });
    // No topics sent keeps the ones told; an empty list clears them.
    expect(configureClass(room, { mode: 'classic', seconds: 45, tables: 4, questions: 3 }, T0)).toEqual({ ok: true, dealt: false });
    expect(room.config.topics).toEqual(['Finance', 'Economics']);
    expect(configureClass(room, { mode: 'classic', seconds: 45, tables: 4, questions: 3, topics: [] }, T0).ok).toBe(true);
    expect(room.config.topics).toBeUndefined();
  });

  it('deals the class round its tables, and seats a newcomer at the emptiest', () => {
    const room = classOf(7);
    expect(room.seats.every((s) => s.table === 0)).toBe(true);
    configureClass(room, { mode: 'classic', seconds: 30, tables: 3, questions: 5 }, T0);
    expect(room.seats.map((s) => s.table)).toEqual([1, 2, 3, 1, 2, 3, 1]);
    expect(tableSeats(room)).toEqual([0, 3, 2, 2]);
    const late = takeSeat(room, dev(8), 'Late', T0);
    expect(late.ok && late.seat.table).toBe(2);
    expect(setTable(room, dev(8), 3, T0)).toEqual({ ok: true });
    expect(tableSeats(room)).toEqual([0, 3, 2, 3]);
    expect(setTable(room, dev(8), 4, T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(setTable(room, dev(8), 1.5, T0)).toMatchObject({ ok: false, code: 'bad' });
    asked(room);
    expect(setTable(room, dev(8), 1, T0)).toMatchObject({ ok: false, code: 'phase' });
    expect(configureClass(room, { mode: 'classic', seconds: 30, tables: 0, questions: 5 }, T0)).toMatchObject({ ok: false, code: 'phase' });
    // Back to no tables.
    reveal(room, T0 + 99_000);
    configureClass(room, { mode: 'classic', seconds: 30, tables: 0, questions: 5 }, T0);
    expect(room.seats.every((s) => s.table === 0)).toBe(true);
  });
});

describe('a convocation: a classic question', () => {
  it('rises, burns for the seconds chosen, and takes one answer from each diver', () => {
    const room = classOf(3);
    expect(ask(room, { id: 'x' }, DEPTHS, T0)).toMatchObject({ ok: false, code: 'bad' });
    expect(ask(room, planets, [1, 2, 3], T0)).toMatchObject({ ok: false, code: 'bad' });
    const at = asked(room);
    expect(room).toMatchObject({ phase: 'asking', n: 1, litAt: T0 + RISE_MS, deadline: T0 + RISE_MS + 30_000 });
    expect(ask(room, planets, DEPTHS, at)).toMatchObject({ ok: false, code: 'phase' });

    expect(heard(room, 1, '  mars ', at)).toEqual({ kind: 'sealed', input: 'mars', answer: 'Mars', sealed: 1 });
    expect(say(room, dev(1), 'Saturn', at)).toMatchObject({ ok: false, code: 'sealed' });
    expect(heard(room, 2, 'Pluto', at)).toEqual({ kind: 'refused', text: 'Pluto', verdict: 'trap', reason: 'Pluto was demoted in 2006.' });
    expect(heard(room, 2, 'Moon', at)).toMatchObject({ kind: 'refused', verdict: 'decoy' });
    expect(heard(room, 2, 'Narnia', at)).toMatchObject({ kind: 'refused', verdict: 'unknown' });
    expect(heard(room, 2, '   ', at)).toEqual({ kind: 'empty' });
    // A slip of the keys still counts.
    expect(heard(room, 2, 'Nepture', at)).toMatchObject({ kind: 'sealed', answer: 'Neptune' });
    expect(room.seats[1].tries).toEqual(['Pluto', 'Moon', 'Narnia']);
    expect(say(room, 'dev-nobody', 'Mars', at)).toMatchObject({ ok: false, code: 'bad' });

    expect(everyoneIn(room)).toBe(false);
    expect(room.earlyAt).toBe(0);
    expect(heard(room, 3, 'Mars', room.deadline - 9000)).toMatchObject({ kind: 'sealed' });
    expect(everyoneIn(room)).toBe(true);
    // The last answer in closes the question a moment early.
    expect(room.earlyAt).toBe(room.deadline - 9000 + ALL_IN_MS);
    expect(classAlarmAt(room)).toBe(room.earlyAt);
    expect(classTick(room, room.earlyAt - 1)).toBe(false);
    expect(classTick(room, room.earlyAt)).toBe('reveal');
    expect(room).toMatchObject({ phase: 'reveal', earlyAt: 0 });
  });

  it('takes an answer to the very end of the time, and none after', () => {
    const room = classOf(2);
    asked(room);
    expect(heard(room, 1, 'Mars', room.deadline + GRACE_MS)).toMatchObject({ kind: 'sealed' });
    expect(say(room, dev(2), 'Mars', room.deadline + GRACE_MS + 1)).toMatchObject({ ok: false, code: 'late' });
  });

  it('does not wait for a diver whose line is down', () => {
    const room = classOf(3);
    const at = asked(room);
    heard(room, 1, 'Mars', at);
    heard(room, 2, 'Mars', at);
    expect(everyoneIn(room)).toBe(false);
    seatOnline(room, dev(3), false);
    expect(everyoneIn(room)).toBe(true);
    // A line dropping does not close the question by itself: the diver may be back in a moment.
    expect(room.earlyAt).toBe(0);
    expect(ALL_IN_MS).toBeLessThan(5000);
  });

  it('sinks each diver their tier, half as deep again alone, and never splits a shared answer', () => {
    const room = classOf(5);
    const at = asked(room);
    heard(room, 1, 'Mars', at); // tier 1, shared by three
    heard(room, 2, 'Mars', at);
    heard(room, 3, 'mars', at);
    heard(room, 4, 'Uranus', at); // tier 5, alone
    expect(reveal(room, at + 10)).toBe(true);
    expect(reveal(room, at + 11)).toBe(false);
    expect(room.phase).toBe('reveal');
    expect(room.seats.map((s) => s.gain)).toEqual([100, 100, 100, 1200, 0]);
    expect(room.seats.map((s) => s.total)).toEqual([100, 100, 100, 1200, 0]);
    const r = room.result!;
    expect(r).toMatchObject({ n: 1, mode: 'classic', given: 2, known: 8, silent: 1, spoke: 4 });
    expect(r.answers).toEqual([
      { answer: 'Uranus', tier: 5, voices: 1, names: ['D4'], depth: 1200 },
      { answer: 'Mars', tier: 1, voices: 3, names: ['D1', 'D2', 'D3'], depth: 100 },
    ]);
    // What the deep knew that nobody said: rarest first.
    expect(r.unsaid.map((u) => u.answer)).toEqual(['Mercury', 'Neptune', 'Jupiter', 'Venus', 'Saturn']);
    expect(r.prompt).toEqual({ id: 'planets', text: planets.text, category: 'science' });
    expect(JSON.stringify(r.prompt)).not.toContain('Mars');
  });

  it('ranks the class, equal depths sharing a place', () => {
    const room = classOf(5);
    const at = asked(room);
    heard(room, 1, 'Mars', at);
    heard(room, 2, 'Mars', at);
    heard(room, 3, 'Neptune', at);
    heard(room, 4, 'Uranus', at);
    reveal(room, at + 10);
    const snap = snapshot(room, at + 10);
    expect(snap.standings.map((s) => [s.name, s.total, s.rank])).toEqual([
      ['D4', 1200, 1],
      ['D3', 600, 2],
      ['D1', 100, 3],
      ['D2', 100, 3],
      ['D5', 0, 5],
    ]);
    expect(snap.here).toBe(5);
  });

  it('reveals by itself when the time is out, and not before', () => {
    const room = classOf(2);
    asked(room);
    expect(classAlarmAt(room)).toBe(room.deadline + GRACE_MS);
    expect(classTick(room, room.deadline)).toBe(false);
    expect(room.phase).toBe('asking');
    expect(classTick(room, room.deadline + GRACE_MS)).toBe('reveal');
    expect(room.phase).toBe('reveal');
    expect(classAlarmAt(room)).toBe(room.touched + CLASS_TTL_MS);
    expect(classTick(room, room.deadline + 99_999)).toBe(false);
  });

  it('asks again from a clean slate, and counts the questions', () => {
    const room = classOf(2);
    let at = asked(room);
    heard(room, 1, 'Mars', at);
    heard(room, 2, 'Narnia', at);
    reveal(room, at + 5);
    at = asked(room, at + 10_000);
    expect(room.n).toBe(2);
    expect(room.result).toBeNull();
    expect(room.seats.map((s) => [s.said.length, s.tries.length, s.gain, s.total])).toEqual([
      [0, 0, 0, 150],
      [0, 0, 0, 0],
    ]);
    heard(room, 1, 'Mars', at);
    heard(room, 2, 'Mars', at);
    reveal(room, at + 5);
    expect(room.seats.map((s) => s.total)).toEqual([250, 100]);
  });
});

describe('a convocation: blitz', () => {
  const blitz = (n: number, tables = 0) => {
    const room = classOf(n);
    expect(configureClass(room, { mode: 'blitz', seconds: 60, tables, questions: 3 }, T0).ok).toBe(true);
    return room;
  };

  it('takes every different right answer a diver can give, once each', () => {
    const room = blitz(3);
    const at = asked(room);
    expect(room.deadline - room.litAt).toBe(60_000);
    expect(heard(room, 1, 'Mars', at)).toMatchObject({ kind: 'sealed', sealed: 1 });
    expect(heard(room, 1, 'Uranus', at)).toMatchObject({ kind: 'sealed', sealed: 2 });
    expect(heard(room, 1, 'mars', at)).toEqual({ kind: 'refused', text: 'mars', verdict: 'said', reason: 'You have already given Mars.' });
    expect(heard(room, 1, 'Narnia', at)).toMatchObject({ kind: 'refused', verdict: 'unknown' });
    expect(heard(room, 2, 'Mars', at)).toMatchObject({ kind: 'sealed', sealed: 1 });
    expect(heard(room, 2, 'Venus', at)).toMatchObject({ kind: 'sealed', sealed: 2 });
    // Blitz is never all in: there is always another answer to find.
    expect(everyoneIn(room)).toBe(false);
    reveal(room, at + 10);
    // D1: Mars shared (100) + Uranus alone (800 × 1.5). D2: Mars (100) + Venus alone (250 × 1.5 = 375, to the nearest ten).
    expect(room.seats.map((s) => s.gain)).toEqual([1300, 480, 0]);
    expect(room.result).toMatchObject({ mode: 'blitz', given: 3, spoke: 2, silent: 1 });
    const mine = seatView(room, dev(1), snapshot(room, at + 10))!;
    expect(mine.you!.outcome).toEqual({
      answers: [
        { input: 'Mars', answer: 'Mars', tier: 1, voices: 2, depth: 100 },
        { input: 'Uranus', answer: 'Uranus', tier: 5, voices: 1, depth: 1200 },
      ],
      gain: 1300,
    });
  });

  it('hears only so much from one diver', () => {
    const room = blitz(1);
    const at = asked(room);
    for (let i = 0; i < CLASS_SHOTS_MAX; i++) expect(say(room, dev(1), `nonsense ${i}`, at).ok).toBe(true);
    expect(say(room, dev(1), 'Mars', at)).toMatchObject({ ok: false, code: 'late' });
    expect(room.seats[0].tries.length).toBeLessThanOrEqual(6);
  });
});

describe('a convocation: tables', () => {
  it('wins each table its deepest different answers, deeper when no other table found them', () => {
    const room = classOf(6, 2); // tables: D1 D3 D5 | D2 D4 D6
    expect(room.seats.map((s) => s.table)).toEqual([1, 2, 1, 2, 1, 2]);
    const at = asked(room);
    heard(room, 1, 'Mars', at); // table 1
    heard(room, 3, 'Mars', at); // table 1 again: counts once
    heard(room, 5, 'Uranus', at); // table 1, only they found it
    heard(room, 2, 'Mars', at); // table 2
    heard(room, 4, 'Neptune', at); // table 2, only they found it
    reveal(room, at + 10);
    const t = room.result!.tables!;
    expect(t.map((x) => [x.table, x.gain, x.total])).toEqual([
      [1, 1300, 1300],
      [2, 700, 700],
    ]);
    expect(t[0].counted).toEqual([
      { answer: 'Uranus', tier: 5, depth: 1200, lone: true },
      { answer: 'Mars', tier: 1, depth: 100, lone: false },
    ]);
    expect(room.tables).toEqual([0, 1300, 700]);
    // A diver's own depth is still their own.
    expect(room.seats.map((s) => s.gain)).toEqual([100, 100, 100, 600, 1200, 0]);

    const at2 = asked(room, at + 20_000);
    heard(room, 2, 'Uranus', at2);
    reveal(room, at2 + 10);
    expect(room.tables).toEqual([0, 1300, 1900]);
    expect(room.result!.tables!.map((x) => x.table)).toEqual([2, 1]);
  });

  it('counts three answers a table in a classic question', () => {
    const room = classOf(8, 2);
    const at = asked(room);
    // Table 1 (D1 D3 D5 D7) finds four different answers; only the deepest three count.
    heard(room, 1, 'Mars', at);
    heard(room, 3, 'Jupiter', at);
    heard(room, 5, 'Neptune', at);
    heard(room, 7, 'Uranus', at);
    reveal(room, at + 10);
    const one = room.result!.tables!.find((x) => x.table === 1)!;
    expect(one.counted.map((c) => c.answer)).toEqual(['Uranus', 'Neptune', 'Jupiter']);
    expect(one.gain).toBe(1200 + 600 + 380);
  });
});

describe('a convocation: what each device is shown', () => {
  it('shows the host the roll and every standing, and nothing of the answers until they surface', () => {
    const room = classOf(3);
    const at = asked(room);
    heard(room, 1, 'Uranus', at);
    const host = hostView(room, snapshot(room, at));
    expect(host).toMatchObject({ role: 'host', phase: 'asking', n: 1, seats: 3, here: 3, answered: 1 });
    expect(host.roll!.map((s) => [s.name, s.answered])).toEqual([
      ['D1', true],
      ['D2', false],
      ['D3', false],
    ]);
    expect(host.result).toBeUndefined();
    expect(JSON.stringify(host)).not.toContain('Uranus');
    expect(JSON.stringify(host)).not.toContain(room.key);
    reveal(room, at + 5);
    const after = hostView(room, snapshot(room, at + 5));
    expect(after.result!.answers[0]).toMatchObject({ answer: 'Uranus', names: ['D1'] });
    expect(after.standings).toHaveLength(3);
  });

  it('shows a diver their own corner and never anyone else’s answer while the question burns', () => {
    const room = classOf(12);
    const at = asked(room);
    heard(room, 1, 'Uranus', at);
    heard(room, 2, 'Narnia', at);
    heard(room, 2, 'Mars', at);
    const snap = snapshot(room, at);
    const two = seatView(room, dev(2), snap)!;
    expect(two.you).toMatchObject({ name: 'D2', sealed: [{ input: 'Mars', answer: 'Mars' }], tries: ['Narnia'] });
    expect(two.roll).toBeUndefined();
    expect(two.result).toBeUndefined();
    expect(two.prompt).toEqual({ id: 'planets', text: planets.text, category: 'science' });
    expect(JSON.stringify(two)).not.toContain('Uranus');
    expect(two.standings!.length).toBe(CLASS_TOP);
    expect(seatView(room, 'dev-nobody', snap)).toBeNull();

    for (let i = 3; i <= 12; i++) heard(room, i, ['Saturn', 'Jupiter', 'Neptune', 'Mercury', 'Venus', 'Earth', 'Saturn', 'Jupiter', 'Venus', 'Earth'][i - 3], at);
    reveal(room, at + 5);
    const done = seatView(room, dev(2), snapshot(room, at + 5))!;
    expect(done.result!.answers.length).toBeLessThanOrEqual(CLASS_SEAT_ROWS);
    expect(done.result!.given).toBe(8);
    expect(done.you!.outcome).toEqual({ answers: [{ input: 'Mars', answer: 'Mars', tier: 1, voices: 1, depth: 150 }], gain: 150 });
    expect(done.you!.rank).toBeGreaterThan(1);
    expect(done.you!.sealed).toEqual([]);
  });

  it('tells a class with tables how the tables stand', () => {
    const room = classOf(4, 2);
    const at = asked(room);
    heard(room, 1, 'Uranus', at);
    reveal(room, at + 5);
    const v = seatView(room, dev(2), snapshot(room, at + 5))!;
    expect(v.tableSeats).toEqual([0, 2, 2]);
    expect(v.tableTotals).toEqual([0, 1200, 0]);
    expect(v.you!.table).toBe(2);
  });
});

describe('a convocation: ending and sitting again', () => {
  it('ends on the host’s word, surfacing a question still burning', () => {
    const room = classOf(2);
    const at = asked(room);
    heard(room, 1, 'Mars', at);
    expect(endClass(room, at + 5)).toEqual({ ok: true });
    expect(room.phase).toBe('ended');
    expect(room.seats[0].total).toBe(150);
    expect(room.result!.given).toBe(1);
    expect(endClass(room, at + 6)).toMatchObject({ ok: false, code: 'phase' });
    expect(ask(room, planets, DEPTHS, at + 7)).toMatchObject({ ok: false, code: 'phase' });
  });

  it('sits the same class again from the surface', () => {
    const room = classOf(4, 2);
    const at = asked(room);
    heard(room, 1, 'Mars', at);
    endClass(room, at + 5);
    expect(againClass(room, at + 10)).toEqual({ ok: true });
    expect(room).toMatchObject({ phase: 'lobby', n: 0, prompt: null, result: null, tables: [0, 0, 0] });
    expect(room.seats.map((s) => s.total)).toEqual([0, 0, 0, 0]);
    expect(room.seats.map((s) => s.table)).toEqual([1, 2, 1, 2]);
    expect(asked(room, at + 20)).toBeGreaterThan(0);
  });

  it('comes back from storage as it was, and is not fooled by junk', () => {
    const room = classOf(2);
    asked(room);
    const back = reviveClass(JSON.parse(JSON.stringify(room)));
    expect(back).toEqual(room);
    expect(reviveClass(null)).toBeNull();
    expect(reviveClass({ v: 2, sign: 'X', key: 'k', seats: [] })).toBeNull();
    expect(reviveClass({ v: 1, sign: 'X' })).toBeNull();
  });

  it('makes host keys nobody will guess', () => {
    let k = 0;
    const rand = () => ((k++ * 7919) % 1000) / 1000;
    const a = makeKey(rand);
    const b = makeKey(rand);
    expect(a).toMatch(/^[a-z2-9]{24}$/);
    expect(b).not.toBe(a);
  });
});
