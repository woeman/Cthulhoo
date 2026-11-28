import { describe, expect, it } from 'vitest';
import { FLOOR_DEPTH } from '../src/game/scoring';
import { KNOWN_MAX, agoWords, cleanRevisionBook, closeSitting, depthNamed, floorOf, missedByTier, packProgress, revisionOrder, type RevisionBook, type RevisionRecord } from '../src/game/revision';
import type { PromptDef } from '../src/game/types';

const DEPTHS = [0, 100, 250, 400, 600, 800, 1000];
const depthOf = (tier: number) => DEPTHS[tier] ?? 0;

const planets: PromptDef = {
  id: 'sky-planets',
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
};

/** A long list: forty answers of the rarest tier. */
const deep: PromptDef = { id: 'sky-stars', text: 'Name a star.', category: 'science', answers: Array.from({ length: 40 }, (_, i) => ({ answer: `Star ${i}`, tier: 6 })) };

const rec = (over: Partial<RevisionRecord> = {}): RevisionRecord => ({ pack: 'sky', depth: 500, floor: 2700, named: 3, known: ['Mars', 'Jupiter'], sittings: 1, last: 10, ...over });

describe('revision dives: how deep a question goes', () => {
  it('has the game’s floor, or the whole list when that is shallower', () => {
    // 3 × 100 + 2 × 250 + 400 + 600 + 800
    expect(floorOf(planets, depthOf)).toBe(2600);
    expect(floorOf(deep, depthOf)).toBe(FLOOR_DEPTH);
    expect(floorOf({ answers: [] }, depthOf)).toBe(0);
  });

  it('sinks a diver each named answer’s depth, once, and never past the floor', () => {
    expect(depthNamed(planets, ['Mars', 'Uranus'], depthOf)).toBe(900);
    expect(depthNamed(planets, ['Mars', 'Mars', 'Pluto'], depthOf)).toBe(100);
    expect(depthNamed(deep, ['Star 0', 'Star 1', 'Star 2', 'Star 3', 'Star 4', 'Star 5', 'Star 6', 'Star 7'], depthOf)).toBe(FLOOR_DEPTH);
  });
});

describe('revision dives: a sitting', () => {
  it('keeps a first sitting: how deep, how many, and what was named', () => {
    const r = closeSitting(planets, 'sky', ['Mars', 'Neptune', 'Mars'], undefined, 12, depthOf);
    expect(r).toMatchObject({ named: 2, total: 8, depth: 500, floor: 2600, fathomed: false, depthBefore: 0, first: true, deeper: false, fresh: ['Mars', 'Neptune'], slipped: [] });
    expect(r.record).toEqual({ pack: 'sky', depth: 500, floor: 2600, named: 2, known: ['Neptune', 'Mars'], sittings: 1, last: 12 });
  });

  it('says what is new and what has slipped since the sitting before', () => {
    const before = closeSitting(planets, 'sky', ['Mars', 'Jupiter', 'Uranus'], undefined, 12, depthOf).record;
    const r = closeSitting(planets, 'sky', ['Mars', 'Venus'], before, 15, depthOf);
    expect(r.fresh).toEqual(['Venus']);
    expect(r.slipped).toEqual(['Uranus', 'Jupiter']);
    // A shallower sitting leaves the deepest where it was.
    expect(r).toMatchObject({ depth: 350, depthBefore: 1150, deeper: false, first: false });
    expect(r.record).toMatchObject({ depth: 1150, named: 3, sittings: 2, last: 15 });
    expect(r.record.known).toEqual(['Venus', 'Mars', 'Uranus', 'Jupiter']);
  });

  it('says so when a sitting goes deeper than any before, and when it touches the floor', () => {
    const before = rec({ depth: 500 });
    const r = closeSitting(planets, 'sky', planets.answers.map((a) => a.answer), before, 20, depthOf);
    expect(r).toMatchObject({ depth: 2600, floor: 2600, fathomed: true, deeper: true });
    expect(r.record.depth).toBe(2600);
    expect(closeSitting(deep, 'sky', ['Star 1'], undefined, 20, depthOf).fathomed).toBe(false);
  });

  it('forgets answers the list no longer holds, and never keeps too many', () => {
    const before = rec({ known: ['Pluto', 'Mars'], depth: 5000 });
    const r = closeSitting(planets, 'sky', ['Ceres', 'Earth'], before, 20, depthOf);
    expect(r.named).toBe(1);
    expect(r.slipped).toEqual(['Mars']);
    // The list is shallower than the old best says: the best is brought up to today's floor.
    expect(r.depthBefore).toBe(2600);
    expect(r.record.known).toEqual(['Earth', 'Mars']);
    const many: PromptDef = { ...deep, answers: Array.from({ length: KNOWN_MAX + 50 }, (_, i) => ({ answer: `Star ${i}`, tier: 1 })) };
    const all = closeSitting(many, 'sky', many.answers.map((a) => a.answer), undefined, 20, depthOf);
    expect(all.record.known).toHaveLength(KNOWN_MAX);
    expect(all.record.known[0]).toBe(`Star ${KNOWN_MAX + 49}`);
  });
});

describe('revision dives: what was missed', () => {
  it('lists it tier by tier, the commonest first, each cut to what the page holds', () => {
    const missed = missedByTier(planets, ['Mars', 'Jupiter', 'Venus'], 1);
    expect(missed.map((t) => [t.tier, t.of, t.missed, t.answers.map((a) => a.answer)])).toEqual([
      [1, 3, 2, ['Saturn']],
      [2, 2, 0, []],
      [3, 1, 1, ['Neptune']],
      [4, 1, 1, ['Mercury']],
      [5, 1, 1, ['Uranus']],
    ]);
    expect(missedByTier(planets, [])[0].answers).toHaveLength(3);
  });
});

describe('revision dives: a pack', () => {
  const book: RevisionBook = {
    'sky-planets': rec({ depth: 1300, floor: 2600, last: 9 }),
    'sky-stars': rec({ depth: 7000, floor: 7000, last: 11 }),
    'sea-fish': rec({ pack: 'sea', depth: 700, floor: 7000, last: 12 }),
  };

  it('is as far down as its questions have been taken, on average', () => {
    expect(packProgress('sky', 4, book)).toEqual({ questions: 4, revised: 2, fathomed: 1, share: 0.375, last: 11 });
    expect(packProgress('moon', 3, book)).toEqual({ questions: 3, revised: 0, fathomed: 0, share: 0, last: 0 });
  });

  it('is revised from what is known least: never sat, then the shallowest, then the longest left', () => {
    const qs = ['sky-a', 'sky-stars', 'sky-planets', 'sky-b', 'sky-c'].map((id) => ({ id }));
    const more: RevisionBook = { ...book, 'sky-c': rec({ depth: 1300, floor: 2600, last: 4 }) };
    expect(revisionOrder(qs, more).map((q) => q.id)).toEqual(['sky-a', 'sky-b', 'sky-c', 'sky-planets', 'sky-stars']);
  });

  it('says how long ago in plain words', () => {
    expect([agoWords(10, 10), agoWords(9, 10), agoWords(3, 10), agoWords(12, 10)]).toEqual(['today', 'yesterday', '7 days ago', 'today']);
  });
});

describe('revision dives: what is kept', () => {
  it('drops anything damaged rather than trusting it', () => {
    const good = rec();
    const book = cleanRevisionBook({
      'sky-planets': good,
      'sky-stars': { ...good, depth: 99_999, known: ['Sirius', 7, ''], sittings: 0 },
      'sea-fish': good,
      'sky-moons': { ...good, floor: 0 },
      'sky-junk': 'nonsense',
    });
    expect(Object.keys(book)).toEqual(['sky-planets', 'sky-stars']);
    expect(book['sky-stars']).toEqual({ ...good, depth: 2700, known: ['Sirius'], sittings: 1 });
    expect(cleanRevisionBook(null)).toEqual({});
    expect(cleanRevisionBook([good])).toEqual({});
  });
});
