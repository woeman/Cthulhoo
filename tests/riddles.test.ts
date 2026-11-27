import { afterEach, describe, expect, it, vi } from 'vitest';
import placeholder from '../src/content/riddles.placeholder.json';
import { dateKeyForDay, dayNumberForKey } from '../src/game/daily';
import {
  BREATHS,
  HINTS,
  NEAR_MISS_COSTS_BREATH,
  RIDDLE_DEPTHS,
  breathsLeft,
  cleanRiddle,
  codexFolio,
  codexPages,
  collectRiddles,
  deckFrom,
  hintCost,
  loadRiddleDeck,
  matchRiddle,
  newAttempt,
  resumeAttempt,
  riddleForDay,
  riddleMetres,
  riddleMetresByDay,
  riddleResult,
  stepRiddle,
  todaysRiddle,
  worthNow,
  type Riddle,
  type RiddleAction,
  type RiddleAttempt,
  type RiddleDay,
  type RiddleDeck,
} from '../src/game/riddles';

const raw = (placeholder as { riddles: unknown[] }).riddles;
const placeholders = raw.map((r) => cleanRiddle(r)!);

/** A riddle in the spec's shape, playable as it stands. */
const riddle = (extra: Record<string, unknown> = {}) => ({
  id: 'tide',
  verse: ['Twice a day I leave the harbour,', 'twice a day I come again.'],
  answers: [{ answer: 'Tide', aliases: ['The tide', 'High tide'] }],
  hints: ['The moon pulls, and I follow.', 'Fishermen wait on me.', 'I leave the dead on the sand.'],
  traps: [{ answer: 'Wave', aliases: ['Waves'], reason: 'A wave is only my messenger.' }],
  page: { title: 'Of the Tide That Keeps Time', text: 'A page from a drowned book.' },
  ...extra,
});
const R = (extra: Record<string, unknown> = {}): Riddle => cleanRiddle(riddle(extra))!;
const deckOf = (ids: string[], days: RiddleDay[] = []): RiddleDeck => deckFrom([{ riddles: ids.map((id) => riddle({ id })), days }], placeholder);
const letters = (n: number) => Array.from({ length: n }, (_, i) => String.fromCharCode(97 + i));

const DATE = '2026-11-27';
const guess = (text: string): RiddleAction => ({ type: 'guess', text });
const HINT: RiddleAction = { type: 'hint' };
const GIVE_UP: RiddleAction = { type: 'give-up' };
function play(r: Riddle, moves: RiddleAction[], from: RiddleAttempt = newAttempt(r, 1, DATE, 0)): RiddleAttempt {
  return moves.reduce((a, m) => stepRiddle(r, a, m, 0).attempt, from);
}
const WRONG = ['Teapot', 'Violin', 'Saddle', 'Umbrella', 'Carrot', 'Bicycle'].map(guess);

describe('cleaning riddles', () => {
  it('drops riddles it cannot play', () => {
    const broken: unknown[] = [
      null,
      'tide',
      [],
      riddle({ id: 7 }),
      riddle({ id: '  ' }),
      riddle({ verse: ['Only one line.'] }),
      riddle({ verse: ['One,', ' ', ''] }),
      riddle({ verse: Array.from({ length: 7 }, (_, i) => `Line ${i}`) }),
      riddle({ verse: 42 }),
      riddle({ answers: [] }),
      riddle({ answers: [{ answer: '' }, { aliases: ['Tide'] }, null, 5] }),
      riddle({ hints: ['One.', 'Two.'] }),
      riddle({ hints: ['One.', 'Two.', 'Three.', 'Four.'] }),
      riddle({ hints: ['One.', '   ', 'Three.'] }),
      riddle({ hints: 'One. Two. Three.' }),
      riddle({ page: null }),
      riddle({ page: 'Of the Tide' }),
      riddle({ page: { title: 'Of the Tide' } }),
      riddle({ page: { title: ' ', text: 'A page.' } }),
    ];
    for (const r of broken) expect(cleanRiddle(r), JSON.stringify(r)).toBeNull();
    expect(cleanRiddle(riddle())?.id).toBe('tide');
  });

  it('trims what it keeps, and takes a verse written as one string with a line on each row', () => {
    const r = R({ id: ' tide ', verse: '  Twice a day I leave the harbour,\r\n\n  twice a day I come again.  \n' });
    expect(r.id).toBe('tide');
    expect(r.verse).toEqual(['Twice a day I leave the harbour,', 'twice a day I come again.']);
    expect(R({ verse: ['  One,  ', '', 'two.'] }).verse).toEqual(['One,', 'two.']);
  });

  it('takes bare answer strings, and never spreads a bare alias string into letters', () => {
    const r = R({ answers: ['Tide', { answer: 'Sea', aliases: 'Ocean' }, { answer: 'Moon', aliases: [1969, null, ' '] }] });
    expect(r.answers).toEqual([
      { answer: 'Tide', aliases: [] },
      { answer: 'Sea', aliases: ['Ocean'] },
      { answer: 'Moon', aliases: ['1969'] },
    ]);
    expect(matchRiddle(r, 'O').kind).toBe('reject');
    expect(matchRiddle(r, 'ocean').kind).toBe('accept');
    expect(matchRiddle(r, '1969').kind).toBe('accept');
  });

  it('keeps a trap with its reason, and refuses one with no reason as an ordinary wrong guess', () => {
    const r = R({ traps: [{ answer: 'Wave', reason: 'Only my messenger.' }, { answer: 'Foam', aliases: ['Spume'] }, { answer: '' }, null, 'Moon'] });
    expect(r.traps).toEqual([{ answer: 'Wave', aliases: [], reason: 'Only my messenger.' }]);
    expect(r.decoys).toEqual(['Foam', 'Spume']);
    const step = stepRiddle(r, newAttempt(r, 1, DATE), guess('Spume'));
    expect(step.event).toMatchObject({ kind: 'refused', near: false, reason: null, breathLost: true, breathsLeft: BREATHS - 1 });
    expect(R({ traps: 'Wave' }).traps).toEqual([]);
  });

  it('is exact only when it says exactly true', () => {
    expect(R({ exact: true }).exact).toBe(true);
    for (const exact of ['true', 1, 'yes', null]) expect(R({ exact }).exact, String(exact)).toBeUndefined();
  });
});

describe('loading the deck', () => {
  it('collects riddles and fixed days from every file with a riddles list; the first file to use an id wins', () => {
    const files = [
      { prompts: [{ id: 'q' }], days: [{ date: '2026-12-01', riddle: 'a' }] },
      null,
      'riddles',
      { riddles: [riddle({ id: 'a' }), riddle({ id: 'b', hints: [] })], days: [{ date: '2026-12-25', riddle: 'a' }, { date: 7, riddle: 'a' }, { date: '2026-12-26' }, 'bad'] },
      { riddles: [riddle({ id: 'a', page: { title: 'A later page', text: 'x' } }), riddle({ id: 'c' })], days: 'none' },
    ];
    const { riddles, days } = collectRiddles(files);
    expect(riddles.map((r) => r.id)).toEqual(['a', 'c']);
    expect(riddles[0].page.title).toBe('Of the Tide That Keeps Time');
    expect(days).toEqual([{ date: '2026-12-25', riddle: 'a' }]);
  });

  it('plays the data once it has a riddle that can be played, and the placeholders otherwise', () => {
    const data = deckFrom([{ riddles: [riddle()] }], placeholder);
    expect(data.source).toBe('data');
    expect(data.riddles.map((r) => r.id)).toEqual(['tide']);
    expect(data.byId.get('tide')).toBe(data.riddles[0]);
    for (const files of [[], [{ riddles: [riddle({ hints: [] })] }], [{ riddles: 'tide' }]]) {
      const deck = deckFrom(files, placeholder);
      expect(deck.source).toBe('placeholder');
      expect(deck.riddles.map((r) => r.id)).toEqual(placeholders.map((r) => r.id));
    }
  });

  // Passes before and after the riddle bank lands in data/.
  it('loads data/ when it holds riddles, the placeholders otherwise, and honours the fixed days', () => {
    const deck = loadRiddleDeck();
    expect(loadRiddleDeck()).toBe(deck);
    expect(deck.byId.size).toBe(deck.riddles.length);
    if (deck.source === 'placeholder') expect(deck.riddles.map((r) => r.id)).toEqual(placeholders.map((r) => r.id));
    else expect(deck.riddles.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const d of deck.days) {
      const day = dayNumberForKey(d.date);
      if (day === null || seen.has(d.date) || !deck.byId.has(d.riddle)) continue;
      seen.add(d.date);
      expect(riddleForDay(deck, day, d.date)?.id, d.date).toBe(d.riddle);
    }
    // Every riddle the deck holds can be solved by its own answers.
    for (const r of deck.riddles) for (const a of r.answers) expect(stepRiddle(r, newAttempt(r, 1, DATE), guess(a.answer)).event.kind, `${r.id}: ${a.answer}`).toBe('solved');
  });
});

describe('the placeholder riddles', () => {
  it('are five, at the sizes the bank validator allows', () => {
    expect(placeholders).toHaveLength(5);
    expect(placeholders.every(Boolean)).toBe(true);
    expect(new Set(placeholders.map((r) => r.id)).size).toBe(5);
    for (const r of placeholders) {
      expect(r.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(r.verse.length).toBeGreaterThanOrEqual(2);
      expect(r.verse.length).toBeLessThanOrEqual(6);
      for (const line of r.verse) expect(line.length, line).toBeLessThanOrEqual(60);
      expect(r.hints).toHaveLength(HINTS);
      const words = r.page.text.split(/\s+/).filter(Boolean).length;
      expect(words, r.id).toBeGreaterThanOrEqual(60);
      expect(words, r.id).toBeLessThanOrEqual(120);
      expect(JSON.stringify(r), 'the house voice has no exclamation marks').not.toContain('!');
    }
  });

  it('accept every answer and alias, and refuse every trap as a near miss', () => {
    for (const r of placeholders) {
      for (const a of r.answers) for (const s of [a.answer, ...a.aliases]) expect(matchRiddle(r, s).kind, `${r.id}: ${s}`).toBe('accept');
      for (const t of r.traps) for (const s of [t.answer, ...t.aliases]) expect(matchRiddle(r, s), `${r.id}: ${s}`).toMatchObject({ kind: 'trap', trap: { reason: t.reason } });
    }
  });

  it('never give an answer away in a whisper', () => {
    const words = (s: string) => s.toLowerCase().match(/[a-z]+/g) ?? [];
    for (const r of placeholders) {
      const forms = r.answers.flatMap((a) => [a.answer, ...a.aliases]).map((f) => words(f).join(' '));
      for (const hint of r.hints) {
        const said = ` ${words(hint).join(' ')} `;
        for (const f of forms) {
          expect(said.includes(` ${f} `) || said.includes(` ${f}s `), `${r.id}: "${hint}" says ${f}`).toBe(false);
        }
      }
    }
  });
});

describe("the day's riddle", () => {
  it('is the same for everyone, whatever order the files list the riddles in', () => {
    const ids = letters(9);
    const a = deckOf(ids);
    const b = deckOf([...ids].reverse());
    for (let day = 1; day <= 60; day++) expect(riddleForDay(b, day)?.id).toBe(riddleForDay(a, day)?.id);
    expect(riddleForDay(a, 5, dateKeyForDay(5))?.id).toBe(riddleForDay(a, 5)?.id);
  });

  it('deals every riddle once before any comes back', () => {
    const ids = letters(10);
    const deck = deckOf(ids);
    for (let cycle = 0; cycle < 6; cycle++) {
      const dealt = ids.map((_, i) => riddleForDay(deck, cycle * ids.length + i + 1)!.id);
      expect([...dealt].sort(), `cycle ${cycle}`).toEqual(ids);
    }
    // and the cycles are not all dealt in the same order
    const order = (cycle: number) => ids.map((_, i) => riddleForDay(deck, cycle * 10 + i + 1)!.id).join('');
    expect(new Set([0, 1, 2, 3].map(order)).size).toBeGreaterThan(1);
  });

  it('never sets the same riddle two days running, even where one cycle meets the next', () => {
    for (const n of [3, 4, 7, 12]) {
      for (const days of [[], [{ date: dateKeyForDay(n), riddle: 'a' }, { date: dateKeyForDay(n + 1), riddle: 'b' }]]) {
        const deck = deckOf(letters(n), days);
        for (let day = 1; day < n * 30; day++) expect(riddleForDay(deck, day + 1)!.id, `${n} riddles, day ${day + 1}`).not.toBe(riddleForDay(deck, day)!.id);
      }
    }
  });

  it('honours fixed days, and deals the rest of their cycle around them', () => {
    const ids = letters(8);
    const deck = deckOf(ids, [
      { date: dateKeyForDay(3), riddle: 'e' },
      { date: dateKeyForDay(12), riddle: 'a' },
    ]);
    expect(riddleForDay(deck, 3, dateKeyForDay(3))?.id).toBe('e');
    expect(riddleForDay(deck, 3)?.id).toBe('e');
    expect(riddleForDay(deck, 12)?.id).toBe('a');
    for (const cycle of [0, 1]) {
      const dealt = ids.map((_, i) => riddleForDay(deck, cycle * 8 + i + 1)!.id);
      expect([...dealt].sort(), `cycle ${cycle}`).toEqual(ids);
    }
  });

  it('ignores fixed days for riddles it does not have, dates it cannot read, and a second entry for a date', () => {
    const ids = letters(6);
    const plain = deckOf(ids, [{ date: dateKeyForDay(4), riddle: 'b' }]);
    const noisy = deckOf(ids, [
      { date: dateKeyForDay(2), riddle: 'zz' },
      { date: 'soon', riddle: 'c' },
      { date: dateKeyForDay(4), riddle: 'b' },
      { date: dateKeyForDay(4), riddle: 'c' },
    ]);
    for (let day = 1; day <= 30; day++) expect(riddleForDay(noisy, day)?.id, `day ${day}`).toBe(riddleForDay(plain, day)?.id);
    expect(riddleForDay(noisy, 4)?.id).toBe('b');
  });

  it('starts at day one, and has nothing to set from an empty deck', () => {
    const deck = deckOf(letters(5));
    expect(riddleForDay(deck, 0)?.id).toBe(riddleForDay(deck, 1)?.id);
    expect(riddleForDay(deck, -40)?.id).toBe(riddleForDay(deck, 1)?.id);
    expect(riddleForDay({ riddles: [] }, 1)).toBeNull();
  });
});

describe('playing a riddle', () => {
  it('pays 1,000, 700, 450 or 250 m by the whispers heard, and nothing when it sinks', () => {
    expect(RIDDLE_DEPTHS).toEqual([1000, 700, 450, 250]);
    expect(BREATHS).toBe(5);
    const r = R();
    for (let heard = 0; heard <= HINTS; heard++) {
      const a = play(r, [...Array<RiddleAction>(heard).fill(HINT), WRONG[0], guess('Tide')]);
      expect(a.status).toBe('solved');
      expect(riddleMetres(a)).toBe(RIDDLE_DEPTHS[heard]);
      expect(riddleResult(a)).toMatchObject({ status: 'solved', metres: RIDDLE_DEPTHS[heard], hints: heard, breathsLeft: 4, answer: 'Tide', gaveUp: false, page: r.page });
    }
    const gaveUp = play(r, [HINT, GIVE_UP]);
    expect(riddleResult(gaveUp)).toMatchObject({ status: 'sunk', gaveUp: true, metres: 0, answer: null, page: null });
    const drowned = play(r, WRONG.slice(0, 5));
    expect(riddleResult(drowned)).toMatchObject({ status: 'sunk', gaveUp: false, metres: 0, breathsLeft: 0 });
    expect(riddleResult(play(r, [HINT]))).toBeNull();
  });

  it('whispers in order, at the price the button shows, three times and no more', () => {
    const r = R();
    let a = newAttempt(r, 1, DATE);
    const costs: number[] = [];
    for (let i = 0; i < HINTS; i++) {
      costs.push(hintCost(a));
      const step = stepRiddle(r, a, HINT);
      expect(step.event).toEqual({ kind: 'hint', index: i, text: r.hints[i], worth: RIDDLE_DEPTHS[i + 1] });
      a = step.attempt;
      expect(worthNow(a)).toBe(RIDDLE_DEPTHS[i + 1]);
    }
    expect(costs).toEqual([300, 250, 200]);
    expect(hintCost(a)).toBe(0);
    const more = stepRiddle(r, a, HINT);
    expect(more.event.kind).toBe('none');
    expect(more.attempt).toBe(a);
    expect(breathsLeft(a)).toBe(BREATHS);
  });

  it('sinks after five wrong guesses, and nothing moves once it is over', () => {
    const r = R();
    const four = play(r, WRONG.slice(0, 4));
    expect(four.status).toBe('playing');
    expect(breathsLeft(four)).toBe(1);
    const last = stepRiddle(r, four, WRONG[4], 5);
    expect(last.event).toMatchObject({ kind: 'refused', breathLost: true, breathsLeft: 0, sunk: true });
    expect(last.attempt).toMatchObject({ status: 'sunk', metres: 0, endedAt: 5 });
    for (const move of [guess('Tide'), HINT, GIVE_UP, WRONG[5]]) {
      const after = stepRiddle(r, last.attempt, move);
      expect(after.event.kind).toBe('none');
      expect(after.attempt).toBe(last.attempt);
    }
    const solved = play(r, [guess('tide')]);
    expect(stepRiddle(r, solved, GIVE_UP).attempt).toBe(solved);
  });

  it('charges the same wrong guess once, however it is written', () => {
    const r = R();
    let a = newAttempt(r, 1, DATE);
    const events = ['Teapot', 'teapot', '  TEAPOT ', 'the teapot', 'A teapot', 'Teapots'].map((text) => {
      const step = stepRiddle(r, a, guess(text));
      a = step.attempt;
      return step.event;
    });
    expect(events[0]).toMatchObject({ kind: 'refused', again: false, breathLost: true, breathsLeft: 4 });
    for (const e of events.slice(1)) expect(e).toMatchObject({ kind: 'refused', again: true, breathLost: false, breathsLeft: 4 });
    expect(a.tries).toEqual([{ text: 'Teapot' }]);
    // a different word is a different guess
    expect(stepRiddle(r, a, guess('Teacup')).event).toMatchObject({ again: false, breathLost: true, breathsLeft: 3 });
  });

  it('refuses a near miss with its reason, at no cost in breath', () => {
    expect(NEAR_MISS_COSTS_BREATH).toBe(false);
    const r = R();
    const step = stepRiddle(r, newAttempt(r, 1, DATE), guess('Waves'));
    expect(step.event).toEqual({ kind: 'refused', input: 'Waves', reason: 'A wave is only my messenger.', near: true, again: false, breathLost: false, breathsLeft: 5, sunk: false });
    expect(step.attempt.tries).toEqual([{ text: 'Waves', near: true }]);
    expect(stepRiddle(r, step.attempt, guess('wave')).event).toMatchObject({ kind: 'refused', near: true, again: true });
    // near misses never drown it
    const a = play(r, [guess('Wave'), ...WRONG.slice(0, 4)]);
    expect(a.status).toBe('playing');
    expect(breathsLeft(a)).toBe(1);
  });

  it('ignores an empty guess', () => {
    const r = R();
    const a = newAttempt(r, 1, DATE);
    for (const text of ['', '   ']) expect(stepRiddle(r, a, guess(text))).toEqual({ attempt: a, event: { kind: 'none' } });
  });

  it('forgives typos and plurals as the daily game does, unless the riddle is word play', () => {
    const loose = R({ answers: [{ answer: 'Lighthouse' }], traps: [] });
    expect(stepRiddle(loose, newAttempt(loose, 1, DATE), guess('lighthose')).event).toMatchObject({ kind: 'solved', answer: 'Lighthouse', input: 'lighthose', fuzzy: true });
    expect(matchRiddle(loose, 'Lighthouses').kind).toBe('accept');

    const exact = R({ answers: [{ answer: 'Lighthouse' }], traps: [], exact: true });
    for (const s of ['lighthose', 'Lighthouses', 'Light-houses']) expect(matchRiddle(exact, s).kind, s).toBe('reject');
    for (const s of ['LIGHTHOUSE', 'the lighthouse', 'Light house']) expect(matchRiddle(exact, s).kind, s).toBe('accept');

    const radar = placeholders.find((p) => p.id === 'radar')!;
    expect(radar.exact).toBe(true);
    expect(matchRiddle(radar, 'Radar').kind).toBe('accept');
    for (const s of ['Raddar', 'radars', 'Rader']) expect(matchRiddle(radar, s).kind, s).toBe('reject');
    expect(matchRiddle(radar, 'kayak')).toMatchObject({ kind: 'trap', trap: { answer: 'Level' } });
  });

  it('holds every listed answer equally right, even a typo that could be either', () => {
    const ammonite = placeholders.find((p) => p.id === 'ammonite')!;
    for (const name of ['Fossil', 'Ammonite']) {
      const a = play(ammonite, [guess(name)]);
      expect(a).toMatchObject({ status: 'solved', answer: name, metres: 1000 });
    }
    const twins = R({ answers: ['Stone', 'Stove'], traps: [] });
    expect(matchRiddle(twins, 'Stoke').kind).toBe('ambiguous');
    expect(stepRiddle(twins, newAttempt(twins, 1, DATE), guess('Stoke')).event).toMatchObject({ kind: 'solved', answer: 'Stone', fuzzy: true, metres: 1000 });
  });

  it('keeps a copy of the page it gives up', () => {
    const r = R();
    const a = play(r, [guess('High tide')]);
    expect(a.page).toEqual(r.page);
    expect(a.page).not.toBe(r.page);
    expect(a.answer).toBe('Tide');
    expect(a.input).toBe('High tide');
  });
});

describe('resuming', () => {
  it('carries on from a saved attempt at the same riddle and day, and nothing else', () => {
    const r = R();
    const saved = play(r, [HINT, WRONG[0], guess('Wave')]);
    expect(resumeAttempt(r, saved, 1)).toEqual(saved);
    expect(resumeAttempt(r, saved, 2)).toBeNull();
    expect(resumeAttempt(R({ id: 'other' }), saved, 1)).toBeNull();
    expect(resumeAttempt(r, null, 1)).toBeNull();
    const next = stepRiddle(r, resumeAttempt(r, saved, 1)!, guess('tide')).attempt;
    expect(riddleResult(next)).toMatchObject({ metres: 700, breathsLeft: 4, hints: 1 });
  });

  it('mends what a save cannot mean', () => {
    const r = R();
    const base = newAttempt(r, 1, DATE);
    expect(resumeAttempt(r, { ...base, hints: 7 }, 1)?.hints).toBe(3);
    expect(resumeAttempt(r, { ...base, hints: -2 }, 1)?.hints).toBe(0);
    expect(resumeAttempt(r, { ...base, hints: 1.7 }, 1)?.hints).toBe(1);
    expect(resumeAttempt(r, { ...base, tries: [{ text: ' ' }, { text: 'Teapot' }] }, 1)?.tries).toEqual([{ text: 'Teapot' }]);
    const drowned = { ...base, tries: WRONG.slice(0, 5).map((m) => ({ text: (m as { text: string }).text })) };
    expect(resumeAttempt(r, drowned, 1)).toMatchObject({ status: 'sunk', metres: 0 });
    const solvedBare: RiddleAttempt = { ...base, status: 'solved', answer: 'Tide', metres: 1000 };
    expect(resumeAttempt(r, solvedBare, 1)?.page).toEqual(r.page);
  });

  it("keeps a saved riddle for its day even when the plan has moved, and lets a lost riddle's day start again", () => {
    const deck = deckOf(letters(6));
    const day = 3;
    const date = dateKeyForDay(day);
    const planned = riddleForDay(deck, day, date)!;
    const other = deck.riddles.find((x) => x.id !== planned.id)!;
    expect(todaysRiddle(deck, day, date)).toEqual({ riddle: planned, attempt: null });

    const mine = play(other, [HINT], newAttempt(other, day, date, 0));
    expect(todaysRiddle(deck, day, date, mine)).toEqual({ riddle: other, attempt: mine });
    expect(todaysRiddle(deck, day + 1, dateKeyForDay(day + 1), mine).attempt).toBeNull();

    const lost = { ...mine, riddleId: 'gone' };
    expect(todaysRiddle(deck, day, date, lost)).toEqual({ riddle: planned, attempt: null });
    const lostDone = { ...lost, status: 'solved' as const, metres: 700 };
    expect(todaysRiddle(deck, day, date, lostDone)).toEqual({ riddle: null, attempt: lostDone });
  });
});

describe('the career and the Codex', () => {
  it('counts the metres of every finished riddle by day', () => {
    const r = R();
    const saves: Record<number, RiddleAttempt> = {
      1: play(r, [HINT, guess('Tide')], newAttempt(r, 1, '2026-11-27')),
      2: play(r, [GIVE_UP], newAttempt(r, 2, '2026-11-28')),
      3: play(r, [HINT], newAttempt(r, 3, '2026-11-29')),
      4: { ...play(r, [guess('Tide')], newAttempt(r, 4, '2026-11-30')), metres: -5 },
    };
    expect(riddleMetresByDay(saves)).toEqual({ 1: 700, 2: 0, 4: 1000 });
  });

  it('shows each page found once, newest first, and counts the pages still lost', () => {
    const deck = deckOf(letters(5));
    const [a, b, c] = ['a', 'b', 'c'].map((id) => deck.byId.get(id)!);
    const gone = R({ id: 'gone', page: { title: 'Of a Riddle the Bank Lost', text: 'Kept with the save.' } });
    const saves: Record<number, RiddleAttempt> = {
      1: play(a, [guess('Tide')], newAttempt(a, 1, '2026-11-27')),
      2: play(b, WRONG.slice(0, 5), newAttempt(b, 2, '2026-11-28')),
      3: play(gone, [guess('Tide')], newAttempt(gone, 3, '2026-11-29')),
      4: play(c, [HINT, guess('Tide')], newAttempt(c, 4, '2026-11-30')),
      9: play(a, [guess('Tide')], newAttempt(a, 9, '2026-12-05')),
      10: { ...play(a, [guess('Tide')], newAttempt(a, 10, '2026-12-06')), riddleId: 'gone-without-a-page', page: undefined },
    };
    const { pages, found, lost } = codexPages(deck, saves);
    expect(pages.map((p) => [p.riddleId, p.day, p.folio])).toEqual([
      ['c', 4, 3],
      ['gone', 3, 2],
      ['a', 1, 1],
    ]);
    expect(pages[1].page.title).toBe('Of a Riddle the Bank Lost');
    expect(pages[0]).toMatchObject({ answer: 'Tide', hints: 1, metres: 700, date: '2026-11-30' });
    expect(found).toBe(3);
    expect(lost).toBe(3); // b sank, d and e never came
    expect(codexPages(deck, {})).toEqual({ pages: [], found: 0, lost: 5 });
  });

  it('gives a riddle the folio its page holds, or the next one free while it is unsolved', () => {
    const deck = deckOf(letters(4));
    const [a, b, c] = ['a', 'b', 'c'].map((id) => deck.byId.get(id)!);
    const saves: Record<number, RiddleAttempt> = {
      1: play(a, [guess('Tide')], newAttempt(a, 1, '2026-11-27')),
      2: play(b, [GIVE_UP], newAttempt(b, 2, '2026-11-28')),
      3: play(c, [guess('Tide')], newAttempt(c, 3, '2026-11-29')),
    };
    expect(codexFolio(a, saves)).toBe(1);
    expect(codexFolio(c, saves)).toBe(2);
    expect(codexFolio(b, saves)).toBe(3);
    expect(codexFolio(a, {})).toBe(1);
  });
});

// ---------------------------------------------------------------- saving

class FakeStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, String(v));
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const RIDDLES = 'cthulhoo.v1.riddles';

/** A fresh copy of the storage module, so its in-memory state starts empty. */
async function storage(local: FakeStorage) {
  vi.stubGlobal('localStorage', local);
  vi.resetModules();
  return import('../src/game/storage');
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('saved riddles', () => {
  it('keeps one attempt a day, and a reload carries on where it was', async () => {
    const local = new FakeStorage();
    const s = await storage(local);
    const r = R();
    expect(s.loadRiddles()).toEqual({});
    let a = newAttempt(r, 1, DATE, 0);
    for (const move of [HINT, WRONG[0], guess('Wave')]) {
      a = stepRiddle(r, a, move, 0).attempt;
      expect(s.saveRiddle(a)).toBe(true);
    }
    expect(Object.keys(JSON.parse(local.data.get(RIDDLES)!))).toEqual(['1']);

    const again = await storage(local);
    const saved = again.loadRiddles()[1];
    expect(saved).toEqual(a);
    const resumed = resumeAttempt(r, saved, 1)!;
    expect(breathsLeft(resumed)).toBe(4);
    expect(worthNow(resumed)).toBe(700);
    const done = stepRiddle(r, resumed, guess('Tide'), 0).attempt;
    expect(again.saveRiddle(done)).toBe(true);
    expect((await storage(local)).loadRiddles()[1]).toMatchObject({ status: 'solved', metres: 700, page: r.page });
  });

  it('drops damaged saves and keeps the good ones', async () => {
    const r = R();
    const good = play(r, [HINT]);
    const local = new FakeStorage();
    local.data.set(
      RIDDLES,
      JSON.stringify({
        1: good,
        2: { ...good, day: 3 },
        4: { ...good, day: 4, status: 'won' },
        5: { ...good, day: 5, tries: 'Teapot' },
        6: { ...good, day: 6, tries: [{ text: '' }] },
        7: { ...good, day: 7, hints: -1 },
        8: { ...good, day: 8, riddleId: '' },
        9: null,
        x: { ...good, day: 1 },
      }),
    );
    const s = await storage(local);
    expect(s.loadRiddles()).toEqual({ 1: good });

    for (const junk of ['{"1":', 'null', '[]', '"riddles"', '42']) {
      const broken = new FakeStorage();
      broken.data.set(RIDDLES, junk);
      const t = await storage(broken);
      expect(t.loadRiddles(), junk).toEqual({});
      expect(t.saveRiddle(good)).toBe(true);
      expect(t.loadRiddles()).toEqual({ 1: good });
    }
  });

  it('refuses a stale save (another tab behind this one) that would undo progress', async () => {
    const r = R();
    const s = await storage(new FakeStorage());
    const one = play(r, [WRONG[0]]);
    const two = play(r, [WRONG[0], HINT, WRONG[1]]);
    expect(s.saveRiddle(two)).toBe(true);
    expect(s.saveRiddle(one)).toBe(false);
    expect(s.saveRiddle(play(r, [WRONG[1], HINT, WRONG[0]]))).toBe(false);
    expect(s.loadRiddles()[1]).toEqual(two);

    const solved = stepRiddle(r, two, guess('Tide'), 0).attempt;
    expect(s.saveRiddle(solved)).toBe(true);
    expect(s.saveRiddle(two)).toBe(false);
    expect(s.saveRiddle(play(r, [WRONG[0], HINT, WRONG[1], GIVE_UP]))).toBe(false);
    expect(s.saveRiddle(solved)).toBe(true);
    expect(s.loadRiddles()[1]).toEqual(solved);
    expect(s.saveRiddle({ ...solved, day: 1.5 })).toBe(false);
  });

  it('lets a day start on a new riddle while the old one was still being played, never once it ended', async () => {
    const s = await storage(new FakeStorage());
    const r = R();
    const other = R({ id: 'other' });
    expect(s.saveRiddle(play(r, [HINT, WRONG[0]]))).toBe(true);
    expect(s.saveRiddle(newAttempt(other, 1, DATE, 0))).toBe(true);
    expect(s.loadRiddles()[1].riddleId).toBe('other');
    expect(s.saveRiddle(play(other, [GIVE_UP]))).toBe(true);
    expect(s.saveRiddle(newAttempt(r, 1, DATE, 0))).toBe(false);
    expect(s.loadRiddles()[1]).toMatchObject({ riddleId: 'other', status: 'sunk', gaveUp: true });
  });
});
