import { describe, expect, it } from 'vitest';
import { foldClassNews } from '../src/party/class-link';
import { LAST_MAX_ALONE } from '../src/party/class-types';
import {
  LAST_AWAY_MS,
  LAST_BEAT_MS,
  LAST_BONUS,
  LAST_END_MS,
  LAST_READ_MS,
  LAST_SEAT_SAID,
  ask,
  boutBack,
  boutGone,
  boutView,
  classAlarmAt,
  classCount,
  classTick,
  cleanClassConfig,
  configureClass,
  hostView,
  leaveSeat,
  newClass,
  removeSeat,
  reveal,
  reviveClass,
  say,
  seatOnline,
  seatView,
  snapshot,
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

/** A class of `n` divers named D1…Dn, all here, held as last diver standing. */
function boutOf(n: number, opts: { tables?: number; seconds?: number; lanterns?: number } = {}): ClassRoom {
  const room = newClass('DAGON-417', 'k'.repeat(24), T0);
  expect(configureClass(room, { mode: 'last', seconds: opts.seconds ?? 15, tables: opts.tables ?? 0, questions: 5, ...(opts.lanterns ? { lanterns: opts.lanterns } : {}) }, T0).ok).toBe(true);
  for (let i = 1; i <= n; i++) expect(takeSeat(room, dev(i), `D${i}`, T0).ok).toBe(true);
  return room;
}

/** Ask the question; the time at which the first side may answer. */
function begun(room: ClassRoom, at = T0): number {
  expect(ask(room, planets, DEPTHS, at)).toEqual({ ok: true });
  return room.last!.turnLit;
}

const said = (room: ClassRoom, n: number, text: string, at: number) => {
  const res = say(room, dev(n), text, at);
  if (!res.ok) throw new Error(`${text}: ${res.code}`);
  return res;
};

/** The time at which the side now on turn may answer. */
const lit = (room: ClassRoom) => room.last!.turnLit;

describe('last diver standing: how a bout begins', () => {
  it('is a way to hold a class, with a short clock and lanterns', () => {
    const was = { mode: 'classic' as const, seconds: 30, tables: 0, questions: 5 };
    expect(cleanClassConfig({ mode: 'last', seconds: 15, tables: 0, questions: 5 }, was)).toEqual({ mode: 'last', seconds: 15, tables: 0, questions: 5 });
    expect(cleanClassConfig({ mode: 'last', seconds: 60, tables: 0, questions: 5 }, was)).toBeNull();
    expect(cleanClassConfig({ mode: 'last', seconds: 10, tables: 4, questions: 3, lanterns: 1 }, was)).toEqual({ mode: 'last', seconds: 10, tables: 4, questions: 3, lanterns: 1 });
    // A number of lanterns the deep does not offer leaves them as they were.
    expect(cleanClassConfig({ mode: 'last', seconds: 10, tables: 4, questions: 3, lanterns: 9 }, { ...was, lanterns: 2 })?.lanterns).toBe(2);
    // The lanterns are kept through the other modes.
    expect(cleanClassConfig({ mode: 'blitz', seconds: 60, tables: 0, questions: 5 }, { ...was, lanterns: 2 })?.lanterns).toBe(2);
  });

  it('makes every diver here a side, gives each its lanterns, and lets the first read the question', () => {
    const room = boutOf(3);
    seatOnline(room, dev(3), false);
    const t = begun(room);
    const bout = room.last!;
    expect(bout.order).toEqual([dev(1), dev(2)]);
    expect(bout.lanterns).toEqual([3, 3]);
    expect(bout.turn).toBe(0);
    expect(t).toBe(T0 + RISE_MS + LAST_READ_MS);
    expect(bout.turnEnds).toBe(t + 15_000);
    expect(classAlarmAt(room)).toBe(bout.turnEnds + GRACE_MS);
  });

  it('gives another side the first turn each question', () => {
    const room = boutOf(3);
    begun(room);
    expect(room.last!.turn).toBe(0);
    reveal(room, T0 + 50_000);
    begun(room, T0 + 60_000);
    expect(room.last!.turn).toBe(1);
  });

  it('wants tables for more divers than can take turns alone, and somebody to take one', () => {
    const many = boutOf(LAST_MAX_ALONE + 1);
    const res = ask(many, planets, DEPTHS, T0);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.message).toMatch(/choose tables/);
    expect(many.phase).toBe('lobby');
    expect(many.n).toBe(0);
    expect(ask(boutOf(LAST_MAX_ALONE), planets, DEPTHS, T0).ok).toBe(true);
    const empty = boutOf(0);
    expect(ask(empty, planets, DEPTHS, T0).ok).toBe(false);
    // With tables, a class of any size may play.
    const tabled = boutOf(40, { tables: 4 });
    expect(ask(tabled, planets, DEPTHS, T0).ok).toBe(true);
    expect(tabled.last!.order).toEqual([1, 2, 3, 4]);
  });
});

describe('last diver standing: taking turns', () => {
  it('hears only the side whose turn it is', () => {
    const room = boutOf(3);
    const t = begun(room);
    const res = said(room, 2, 'Mars', t);
    expect(res.heard).toEqual({ kind: 'refused', text: 'Mars', verdict: 'wait', reason: 'It is not your turn.' });
    expect(res.turn).toBeUndefined();
    // It cost nothing and was not kept.
    const d2 = room.seats[1];
    expect(d2.shots).toBe(0);
    expect(d2.tries).toEqual([]);
    expect(room.last!.said).toEqual([]);
    // A diver who sits down after the bout began watches it.
    takeSeat(room, dev(9), 'Late', t);
    expect(said(room, 9, 'Mars', t).heard).toMatchObject({ kind: 'refused', verdict: 'wait' });
  });

  it('passes the turn on a new right answer, after a beat', () => {
    const room = boutOf(3);
    const t = begun(room);
    const res = said(room, 1, 'mars', t + 2000);
    expect(res.heard).toEqual({ kind: 'sealed', input: 'mars', answer: 'Mars', sealed: 1 });
    expect(res.turn).toBe('next');
    const bout = room.last!;
    expect(bout.turn).toBe(1);
    expect(bout.turnN).toBe(1);
    expect(bout.turnLit).toBe(t + 2000 + LAST_BEAT_MS);
    expect(bout.turnEnds).toBe(bout.turnLit + 15_000);
    expect(bout.beat).toEqual({ kind: 'said', side: 0, name: 'D1', answer: 'Mars', tier: 1, depth: 100 });
    expect(classAlarmAt(room)).toBe(bout.turnEnds + GRACE_MS);
    // Round the class, and back to the first.
    expect(said(room, 2, 'Saturn', lit(room)).turn).toBe('next');
    expect(said(room, 3, 'Venus', lit(room)).turn).toBe('next');
    expect(room.last!.turn).toBe(0);
  });

  it('puts out a lantern for an answer already named, and passes the turn', () => {
    const room = boutOf(2);
    const t = begun(room);
    said(room, 1, 'Mars', t);
    const res = said(room, 2, 'MARS', lit(room));
    expect(res.heard).toMatchObject({ kind: 'refused', verdict: 'burnt' });
    expect(res.turn).toBe('next');
    const bout = room.last!;
    expect(bout.lanterns).toEqual([3, 2]);
    expect(bout.turn).toBe(0);
    expect(bout.beat).toEqual({ kind: 'repeat', side: 1, name: 'D2', answer: 'Mars' });
    // The answer is still named once, by the one who named it first.
    expect(bout.said).toEqual([0]);
    expect(room.seats[1].said).toEqual([]);
  });

  it('lets a wrong answer be tried again on the same clock, at no cost', () => {
    const room = boutOf(2);
    const t = begun(room);
    const ends = room.last!.turnEnds;
    expect(said(room, 1, 'Krypton', t).heard).toMatchObject({ kind: 'refused', verdict: 'unknown' });
    expect(said(room, 1, 'Pluto', t + 1000).heard).toMatchObject({ kind: 'refused', verdict: 'trap' });
    const bout = room.last!;
    expect(bout.turn).toBe(0);
    expect(bout.turnEnds).toBe(ends);
    expect(bout.lanterns).toEqual([3, 3]);
    expect(room.seats[0].tries).toEqual(['Krypton', 'Pluto']);
    expect(said(room, 1, 'Neptune', t + 2000).turn).toBe('next');
  });

  it('puts out a lantern when a turn runs out, and not a moment before', () => {
    const room = boutOf(2);
    begun(room);
    const ends = room.last!.turnEnds;
    expect(classTick(room, ends + GRACE_MS - 1)).toBe(false);
    // An answer in the last instant still counts; one after it is late.
    const late = say(room, dev(1), 'Mars', ends + GRACE_MS + 1);
    expect(late.ok).toBe(false);
    expect(classTick(room, ends + GRACE_MS)).toBe('turn');
    const bout = room.last!;
    expect(bout.lanterns).toEqual([2, 3]);
    expect(bout.turn).toBe(1);
    expect(bout.beat).toEqual({ kind: 'dark', side: 0 });
    expect(bout.turnLit).toBe(ends + GRACE_MS + LAST_BEAT_MS);
  });
});

describe('last diver standing: going out and standing last', () => {
  /** Two divers with one lantern each: D1 names Mars, D2 repeats it. */
  function decidedBout() {
    const room = boutOf(2, { lanterns: 1 });
    const t = begun(room);
    said(room, 1, 'Uranus', t);
    const at = lit(room);
    const res = said(room, 2, 'uranus', at);
    return { room, at, res };
  }

  it('is decided when one side is left, and surfaces a moment later', () => {
    const { room, at, res } = decidedBout();
    expect(res.turn).toBe('over');
    const bout = room.last!;
    expect(bout.ended).toBe('last');
    expect(bout.winner).toBe(0);
    expect(bout.turn).toBe(-1);
    expect(bout.out).toEqual([1]);
    expect(room.phase).toBe('asking');
    expect(classAlarmAt(room)).toBe(at + LAST_END_MS);
    // Nobody may speak once it is decided.
    expect(said(room, 1, 'Mars', at + 10).heard).toMatchObject({ kind: 'refused', verdict: 'wait' });
    expect(classTick(room, at + LAST_END_MS - 1)).toBe(false);
    expect(classTick(room, at + LAST_END_MS)).toBe('reveal');
    expect(room.phase).toBe('reveal');
    expect(room.last).toBeNull();
  });

  it('wins the last one standing a bonus, and each answer its plain depth', () => {
    const { room, at } = decidedBout();
    classTick(room, at + LAST_END_MS);
    const [d1, d2] = room.seats;
    // Uranus is Forbidden (800 m). Nobody else named it, yet it is not half as deep again: in a bout every answer is named once.
    expect(d1.gain).toBe(800 + LAST_BONUS);
    expect(d2.gain).toBe(0);
    const r = room.result!;
    expect(r.mode).toBe('last');
    expect(r.answers).toEqual([{ answer: 'Uranus', tier: 5, voices: 1, names: ['D1'], depth: 800 }]);
    // The winner's own phone tells the same sums: the answer at its plain depth, the bonus within the gain.
    const mine = seatView(room, dev(1), snapshot(room, at + LAST_END_MS))!.you!.outcome!;
    expect(mine).toEqual({ answers: [{ input: 'Uranus', answer: 'Uranus', tier: 5, voices: 1, depth: 800 }], gain: 800 + LAST_BONUS });
    expect(r.last).toEqual({
      ended: 'last',
      winner: 0,
      bonus: LAST_BONUS,
      turns: 2,
      lanterns: 1,
      sides: [
        { table: 0, id: dev(1), name: 'D1', lanterns: 1, said: 1, gain: 800 },
        { table: 0, id: dev(2), name: 'D2', lanterns: 0, said: 0, gain: 0 },
      ],
    });
  });

  it('skips a side whose lanterns are out', () => {
    const room = boutOf(3, { lanterns: 1 });
    const t = begun(room);
    said(room, 1, 'Mars', t);
    expect(said(room, 2, 'Mars', lit(room)).turn).toBe('next');
    expect(room.last!.lanterns).toEqual([1, 0, 1]);
    expect(room.last!.turn).toBe(2);
    said(room, 3, 'Venus', lit(room));
    expect(room.last!.turn).toBe(0);
    said(room, 1, 'Earth', lit(room));
    // D2 is passed over.
    expect(room.last!.turn).toBe(2);
    expect(said(room, 2, 'Saturn', lit(room)).heard).toMatchObject({ kind: 'refused', verdict: 'wait', reason: 'Your lanterns are out.' });
  });

  it('lets one diver alone play until their lanterns are out, and nobody stands last', () => {
    const room = boutOf(1, { lanterns: 2 });
    const t = begun(room);
    expect(said(room, 1, 'Mars', t).turn).toBe('next');
    expect(room.last!.turn).toBe(0);
    expect(said(room, 1, 'Mars', lit(room)).turn).toBe('next');
    expect(said(room, 1, 'Mars', lit(room)).turn).toBe('over');
    expect(room.last!.ended).toBe('none');
    expect(room.last!.winner).toBe(-1);
    reveal(room, lit(room) + 1);
    expect(room.seats[0].gain).toBe(100);
    expect(room.result!.last).toMatchObject({ ended: 'none', winner: -1 });
  });

  it('ends when every answer has been named', () => {
    const room = boutOf(2);
    let t = begun(room);
    planets.answers.forEach((a, i) => {
      const res = said(room, (i % 2) + 1, a.answer, t);
      expect(res.turn).toBe(i === planets.answers.length - 1 ? 'over' : 'next');
      t = lit(room);
    });
    expect(room.last!.ended).toBe('dry');
    expect(room.last!.winner).toBe(-1);
  });

  it('may be called by the host before it is decided: nobody wins the bonus', () => {
    const room = boutOf(2);
    const t = begun(room);
    said(room, 1, 'Mercury', t);
    expect(reveal(room, t + 5000)).toBe(true);
    expect(room.result!.last).toMatchObject({ ended: 'host', winner: -1, turns: 1 });
    expect(room.seats[0].gain).toBe(600);
    expect(room.last).toBeNull();
  });
});

describe('last diver standing: a side that is not here', () => {
  it('waits only a moment for a side with nobody here, then puts out a lantern', () => {
    const room = boutOf(2);
    const t = begun(room);
    seatOnline(room, dev(2), false);
    said(room, 1, 'Mars', t);
    const bout = room.last!;
    expect(bout.turn).toBe(1);
    expect(bout.away).toBe(true);
    expect(bout.turnEnds).toBe(bout.turnLit + LAST_AWAY_MS);
    expect(classTick(room, bout.turnEnds + GRACE_MS)).toBe('turn');
    expect(room.last!.lanterns).toEqual([3, 2]);
    expect(room.last!.beat).toEqual({ kind: 'away', side: 1 });
    expect(room.last!.turn).toBe(0);
  });

  it('gives the side its whole turn when somebody of it comes back in time', () => {
    const room = boutOf(2);
    const t = begun(room);
    seatOnline(room, dev(2), false);
    said(room, 1, 'Mars', t);
    const back = room.last!.turnLit + 2000;
    // Somebody else coming back changes nothing.
    expect(boutBack(room, dev(1), back)).toBe(false);
    takeSeat(room, dev(2), 'D2', back);
    expect(boutBack(room, dev(2), back)).toBe(true);
    const bout = room.last!;
    expect(bout.away).toBe(false);
    expect(bout.turnEnds).toBe(bout.turnLit + 15_000);
    expect(bout.turnLit).toBeGreaterThanOrEqual(back);
    expect(boutBack(room, dev(2), back + 10)).toBe(false);
    expect(said(room, 2, 'Venus', bout.turnLit).turn).toBe('next');
  });

  it('puts out all the lanterns of a diver who leaves or is sent out, so nobody waits for them', () => {
    const room = boutOf(3);
    const t = begun(room);
    // D2 leaves while it is D1's turn: the turn stays where it is.
    leaveSeat(room, dev(2), t);
    expect(boutGone(room, dev(2), t)).toBe('next');
    expect(room.last!.lanterns).toEqual([3, 0, 3]);
    expect(room.last!.turn).toBe(0);
    expect(boutGone(room, dev(2), t)).toBeNull();
    // The host sends D1 out on D1's own turn: that decides the bout for D3.
    removeSeat(room, dev(1), t + 100);
    expect(boutGone(room, dev(1), t + 100)).toBe('over');
    expect(room.last!.ended).toBe('last');
    expect(room.last!.winner).toBe(2);
    classTick(room, t + 100 + LAST_END_MS);
    expect(room.seats.find((s) => s.id === dev(3))?.gain).toBe(LAST_BONUS);
    expect(room.result!.last!.sides[0]).toMatchObject({ id: dev(1), name: 'A diver who left', lanterns: 0 });
  });
});

describe('last diver standing: tables', () => {
  it('makes each table with somebody here a side, and hears any of its divers on its turn', () => {
    const room = boutOf(6, { tables: 3 });
    // Tables are dealt round: D1 D4 at 1, D2 D5 at 2, D3 D6 at 3. Nobody of table 3 is here.
    seatOnline(room, dev(3), false);
    seatOnline(room, dev(6), false);
    const t = begun(room);
    expect(room.last!.order).toEqual([1, 2]);
    expect(said(room, 4, 'Mars', t).turn).toBe('next');
    expect(said(room, 1, 'Venus', lit(room)).heard).toMatchObject({ kind: 'refused', verdict: 'wait', reason: 'It is not your table’s turn.' });
    expect(said(room, 5, 'Venus', lit(room)).turn).toBe('next');
    // Table 3 came back too late for this bout.
    seatOnline(room, dev(3), true);
    expect(said(room, 3, 'Earth', lit(room)).heard).toMatchObject({ kind: 'refused', verdict: 'wait', reason: 'Your table sits this bout out.' });
    // A newcomer is sat at a table that is in the bout.
    const late = takeSeat(room, dev(7), 'Late', lit(room));
    expect(late.ok && [1, 2].includes(late.seat.table)).toBe(true);
  });

  it('wins a table every answer it named, and the last table standing the bonus', () => {
    const room = boutOf(4, { tables: 2, lanterns: 1 });
    const t = begun(room);
    said(room, 1, 'Uranus', t);
    said(room, 2, 'Mercury', lit(room));
    said(room, 3, 'Neptune', lit(room));
    said(room, 4, 'Jupiter', lit(room));
    said(room, 1, 'Mars', lit(room));
    const at = lit(room);
    expect(said(room, 2, 'Mars', at).turn).toBe('over');
    classTick(room, at + LAST_END_MS);
    const r = room.result!;
    // Kraken (table 1): Uranus 800, Neptune 400, Mars 100, and the bonus. Dagon (table 2): Mercury 600, Jupiter 250.
    expect(r.tables).toEqual([
      {
        table: 1,
        gain: 1300 + LAST_BONUS,
        total: 1300 + LAST_BONUS,
        bonus: LAST_BONUS,
        counted: [
          { answer: 'Uranus', tier: 5, depth: 800, lone: false },
          { answer: 'Neptune', tier: 3, depth: 400, lone: false },
          { answer: 'Mars', tier: 1, depth: 100, lone: false },
        ],
      },
      {
        table: 2,
        gain: 850,
        total: 850,
        counted: [
          { answer: 'Mercury', tier: 4, depth: 600, lone: false },
          { answer: 'Jupiter', tier: 2, depth: 250, lone: false },
        ],
      },
    ]);
    expect(room.tables).toEqual([0, 1300 + LAST_BONUS, 850]);
    // The divers keep what they named themselves; the bonus is the table's.
    expect(room.seats.map((s) => s.gain)).toEqual([900, 600, 400, 250]);
    expect(r.last).toMatchObject({ ended: 'last', winner: 0, sides: [{ table: 1, lanterns: 1, said: 3, gain: 1300 }, { table: 2, lanterns: 0, said: 2, gain: 850 }] });
  });
});

describe('last diver standing: a diver sent out in the middle of a bout', () => {
  it('leaves what they named on the record: it stays named, and their table keeps it', () => {
    const room = boutOf(4, { tables: 2 });
    const t = begun(room);
    said(room, 1, 'Mercury', t);
    expect(removeSeat(room, dev(1), lit(room))).toBe(true);
    // Their table has D3 still, and the answer may not be named again.
    expect(boutGone(room, dev(1), lit(room))).toBeNull();
    const again = said(room, 2, 'Mercury', lit(room));
    expect(again.heard).toMatchObject({ kind: 'refused', verdict: 'burnt' });
    expect(reveal(room, lit(room))).toBe(true);
    const result = room.result!;
    expect(result.given).toBe(1);
    expect(result.answers).toEqual([{ answer: 'Mercury', tier: 4, voices: 1, names: [], depth: 600 }]);
    expect(result.unsaid.map((a) => a.answer)).not.toContain('Mercury');
    expect(result.tables!.find((g) => g.table === 1)).toMatchObject({ gain: 600, counted: [{ answer: 'Mercury', tier: 4, depth: 600, lone: false }] });
    expect(result.last!.sides[0]).toMatchObject({ table: 1, said: 1, gain: 600 });
  });

  it('never calls a bout won when no lantern is left lit', () => {
    const room = boutOf(2, { lanterns: 1 });
    begun(room);
    // Both divers are sent out, one after the other: the first leaves the other standing last.
    removeSeat(room, dev(1), lit(room));
    expect(boutGone(room, dev(1), lit(room))).toBe('over');
    expect(room.last!.ended).toBe('last');
    expect(room.last!.winner).toBe(1);
    const lone = boutOf(1, { lanterns: 1 });
    begun(lone);
    removeSeat(lone, dev(1), lit(lone));
    expect(boutGone(lone, dev(1), lit(lone))).toBe('over');
    expect(lone.last!.ended).toBe('none');
    expect(lone.last!.winner).toBe(-1);
  });
});

describe('last diver standing: what each device is shown', () => {
  it('shows everyone the bout: whose turn, the lanterns, and what has been named', () => {
    const room = boutOf(2);
    const t = begun(room);
    said(room, 1, 'Mercury', t);
    said(room, 2, 'Mercury', lit(room));
    const now = lit(room);
    const host = hostView(room, snapshot(room, now));
    expect(host.last).toEqual({
      sides: [
        { table: 0, id: dev(1), name: 'D1', lanterns: 3, said: 1, gain: 600 },
        { table: 0, id: dev(2), name: 'D2', lanterns: 2, said: 0, gain: 0 },
      ],
      turn: 0,
      turnN: 2,
      turnLit: room.last!.turnLit,
      turnEnds: room.last!.turnEnds,
      lanterns: 3,
      said: [{ answer: 'Mercury', tier: 4, side: 0 }],
      saidN: 1,
      left: 7,
      beat: { kind: 'repeat', side: 1, name: 'D2', answer: 'Mercury' },
    });
    expect(host.deadline).toBe(room.last!.turnEnds);
    const seat = seatView(room, dev(2), snapshot(room, now))!;
    expect(seat.last).toEqual(host.last);
    expect(seat.you?.sealed).toEqual([]);
    expect(seatView(room, dev(1), snapshot(room, now))!.you?.sealed).toEqual([{ input: 'Mercury', answer: 'Mercury' }]);
    // Once the answers surface, the bout is part of the result.
    reveal(room, now);
    const after = hostView(room, snapshot(room, now));
    expect(after.last).toBeUndefined();
    expect(after.result?.last?.ended).toBe('host');
  });

  it('sends a phone the newest answers named and the big screen all of them', () => {
    const many: PromptDef = { id: 'numbers', text: 'Name a number.', category: 'misc', answers: Array.from({ length: 40 }, (_, i) => ({ answer: `Number${i}`, tier: 1 + (i % 6) })) };
    const room = boutOf(2);
    expect(ask(room, many, DEPTHS, T0)).toEqual({ ok: true });
    for (let i = 0; i < 20; i++) said(room, (i % 2) + 1, `Number${i}`, lit(room));
    expect(boutView(room)!.said).toHaveLength(20);
    const phone = boutView(room, LAST_SEAT_SAID)!;
    expect(phone.said).toHaveLength(LAST_SEAT_SAID);
    expect(phone.said[0].answer).toBe('Number19');
    expect(phone.saidN).toBe(20);
    expect(phone.left).toBe(20);
  });

  it('folds the news of a turn into the page a device already holds', () => {
    const room = boutOf(2);
    const t = begun(room);
    const before = seatView(room, dev(2), snapshot(room, t))!;
    said(room, 1, 'Mercury', t);
    const now = lit(room);
    const last = boutView(room, LAST_SEAT_SAID)!;
    const after = foldClassNews(before, { t: 'turn', last, ...classCount(room), now });
    expect(after.last).toEqual(last);
    expect(after.last?.turn).toBe(1);
    expect(after.deadline).toBe(room.last!.turnEnds);
    expect(after.said).toBe(1);
    expect(after.answered).toBe(1);
    expect(after.now).toBe(now);
    // The rest of the page stands: the question, and what it says of this diver.
    expect(after.prompt).toEqual(before.prompt);
    expect(after.you).toEqual(before.you);
    expect(after.phase).toBe('asking');
  });

  it('comes back from storage in the middle of a bout', () => {
    const room = boutOf(2);
    const t = begun(room);
    said(room, 1, 'Mars', t);
    const back = reviveClass(JSON.parse(JSON.stringify(room)))!;
    expect(back.last).toEqual(room.last);
    // A room written down before there were bouts has none.
    const old = JSON.parse(JSON.stringify(newClass('DAGON-417', 'key', T0)));
    delete old.last;
    expect(reviveClass(old)!.last).toBeNull();
  });
});
