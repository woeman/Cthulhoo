import { describe, expect, it } from 'vitest';
import {
  CENSUS_DIVERS_MAX,
  CENSUS_MIN,
  CENSUS_TOP,
  airLine,
  censusFull,
  censusLine,
  censusRows,
  censusSoFar,
  censusWait,
  cleanCensusAnswer,
  cleanCount,
  cleanPromptId,
  diversSaid,
  outOfAir,
  percent,
  shareTag,
  type CensusCount,
} from '../src/party/census';

const count = (total: number, mine: number, top: Array<[string, number]> = []): CensusCount => ({ prompt: 'capitals-1', total, mine, top });

describe('what the census will count', () => {
  it('takes question ids as the bank writes them', () => {
    for (const id of ['capitals-1', 'q00', 'geo.rivers_2', 'A1']) expect(cleanPromptId(id)).toBe(id);
    for (const bad of ['', '-lead', 'has space', 'semi;colon', 'x'.repeat(81), 7, null, undefined, {}]) expect(cleanPromptId(bad)).toBeNull();
  });

  it('counts running out of air as an empty answer', () => {
    expect(cleanCensusAnswer(null)).toBe('');
    expect(cleanCensusAnswer(undefined)).toBe('');
  });

  it('tidies an answer the way the bank spells it, and refuses what it cannot count', () => {
    expect(cleanCensusAnswer('  Ulaan   Baatar ')).toBe('Ulaan Baatar');
    // The same word typed two ways is one answer.
    expect(cleanCensusAnswer('Réunion')).toBe(cleanCensusAnswer('Réunion'));
    expect(cleanCensusAnswer('x'.repeat(120))).toBe('x'.repeat(120));
    expect(cleanCensusAnswer('x'.repeat(121))).toBeNull();
    expect(cleanCensusAnswer('bell\u0007')).toBeNull();
    expect(cleanCensusAnswer(42)).toBeNull();
    expect(cleanCensusAnswer(['Paris'])).toBeNull();
  });
});

describe('a count from the relay', () => {
  it('is checked, never trusted', () => {
    expect(cleanCount(null)).toBeNull();
    expect(cleanCount('count')).toBeNull();
    expect(cleanCount({ total: 3 })).toBeNull();
    expect(cleanCount({ prompt: 'bad id!', total: 3 })).toBeNull();
    expect(cleanCount({ prompt: 'q1', total: -4, mine: 'x', top: 'no' })).toEqual({ prompt: 'q1', total: 0, mine: 0, top: [] });
  });

  it('never has more of one answer than divers in all', () => {
    expect(cleanCount({ prompt: 'q1', total: 5, mine: 9, top: [] })?.mine).toBe(5);
    expect(cleanCount({ prompt: 'q1', total: 12.7, mine: 3.2, top: [] })).toMatchObject({ total: 12, mine: 3 });
  });

  it('keeps only answers it can show, and no more than the relay sends', () => {
    const top = [['Paris', 9], ['', 2], ['bad\u0000', 4], ['Lyon', 0], [5, 5], 'Nice', ['Rome', 1]];
    expect(cleanCount({ prompt: 'q1', total: 20, mine: 1, top })?.top).toEqual([
      ['Paris', 9],
      ['', 2],
      ['Rome', 1],
    ]);
    const many = Array.from({ length: CENSUS_TOP + 10 }, (_, i) => [`A${i}`, 100 - i]);
    expect(cleanCount({ prompt: 'q1', total: 5000, mine: 1, top: many })?.top).toHaveLength(CENSUS_TOP);
  });
});

describe('shares', () => {
  it('rounds to whole percentages without claiming all or none unless it is so', () => {
    expect(percent(0, 50)).toBe('0%');
    expect(percent(3, 0)).toBe('0%');
    expect(percent(50, 50)).toBe('100%');
    expect(percent(199, 200)).toBe('99%');
    expect(percent(1, 3)).toBe('33%');
    expect(percent(2, 3)).toBe('67%');
    expect(percent(1, 100)).toBe('1%');
    expect(percent(1, 101)).toBe('under 1%');
    expect(percent(1, 250)).toBe('under 1%');
  });

  it('says how many have faced a question before there are enough to tell', () => {
    expect(censusSoFar(1)).toBe('The first diver to face this today.');
    expect(censusSoFar(7)).toBe('One of 7 divers to face this today.');
    expect(censusLine(count(19, 3), 20, true)).toBe('One of 19 divers to face this today.');
    expect(censusLine(count(1, 1), 20, false)).toBe('The first diver to face this today.');
    expect(censusWait(7, 20)).toBe('One of 7 divers to face this today. Shares show once 20 have.');
  });

  it('tells the share of today’s divers once there are enough', () => {
    expect(censusLine(count(212, 9), 20, true)).toBe('4% of today’s 212 divers said it.');
    expect(censusLine(count(20, 20), 20, true)).toBe('Every one of today’s 20 divers said it.');
    expect(censusLine(count(212, 1), 20, true)).toBe('No other diver of today’s 212 said it.');
    expect(censusLine(count(640, 3), 20, true)).toBe('Fewer than 1 in 100 of today’s 640 divers said it.');
    expect(censusLine(count(900, 225), 20, true)).toBe('25% of today’s 900 divers said it.');
  });

  it('turns it round when the air ran out: how many found anything', () => {
    expect(censusLine(count(212, 80), 20, false)).toBe('62% of today’s 212 divers found an answer.');
    expect(censusLine(count(30, 30), 20, false)).toBe('0% of today’s 30 divers found an answer.');
  });

  it('speaks of a day gone for the Reliquary', () => {
    expect(censusLine(count(212, 9), 20, true, true)).toBe('4% of the 212 divers that day said it.');
    expect(censusLine(count(212, 1), 20, true, true)).toBe('No other diver of the 212 that day said it.');
  });

  it('says “the first” once a question has stopped counting for the day', () => {
    const full = count(CENSUS_DIVERS_MAX, 40);
    expect(censusFull(full)).toBe(true);
    expect(censusFull(count(CENSUS_DIVERS_MAX - 1, 40))).toBe(false);
    expect(censusLine(full, 20, true)).toBe('4% of the first 1,000 divers today said it.');
    expect(censusLine(count(CENSUS_DIVERS_MAX, 0), 20, true)).toBe('No other diver of the first 1,000 today said it.');
    expect(censusLine(full, 20, true, true)).toBe('4% of the first 1,000 divers that day said it.');
    expect(diversSaid(full)).toBe('The first 1,000 divers today said:');
    expect(diversSaid(count(212, 1))).toBe('Today’s 212 divers said:');
  });

  it('puts the share in a few words for the log, only when there is one to tell', () => {
    expect(shareTag(count(212, 9), 20, true)).toBe('4% said it');
    expect(shareTag(count(212, 1), 20, true)).toBe('only you said it');
    expect(shareTag(count(25, 25), 20, true)).toBe('everyone said it');
    expect(shareTag(count(12, 2), 20, true)).toBeNull();
    expect(shareTag(count(212, 80), 20, false)).toBeNull();
  });
});

describe('the answers most given', () => {
  const known = new Set(['Paris', 'Lyon', 'Marseille', 'Nice', 'Lille', 'Brest', 'Ys']);
  const c = count(200, 2, [
    ['Paris', 90],
    ['', 30],
    ['rude word', 25],
    ['Lyon', 20],
    ['Marseille', 15],
    ['Nice', 10],
    ['Lille', 5],
    ['Brest', 3],
    ['Ys', 2],
  ]);

  it('leaves out what the bank does not know, and running out of air', () => {
    const rows = censusRows(c, known, 'Lyon');
    expect(rows.map((r) => r.answer)).toEqual(['Paris', 'Lyon', 'Marseille', 'Nice', 'Lille']);
    expect(rows.find((r) => r.yours)?.answer).toBe('Lyon');
    expect(rows[0]).toEqual({ answer: 'Paris', share: '45%', part: 0.45, yours: false });
  });

  it('adds your own answer when it is not among the most given', () => {
    const rows = censusRows(c, known, 'Ys');
    expect(rows).toHaveLength(6);
    expect(rows[5]).toEqual({ answer: 'Ys', share: '1%', part: 0.01, yours: true });
  });

  it('has no row of yours when the air ran out', () => {
    expect(censusRows(c, known, null).some((r) => r.yours)).toBe(false);
  });

  it('tells how many ran out of air', () => {
    expect(outOfAir(c)).toBe(30);
    expect(outOfAir(count(10, 1, [['Paris', 10]]))).toBe(0);
    expect(airLine(30, 200, false)).toBe('15% ran out of air.');
    expect(airLine(30, 200, true)).toBe('15% ran out of air, you among them.');
  });
});

describe('the bar for shares', () => {
  it('shows shares from ten divers on a question', () => {
    expect(CENSUS_MIN).toBe(10);
    expect(censusLine(count(9, 2), CENSUS_MIN, true)).toBe('One of 9 divers to face this today.');
    expect(censusLine(count(10, 2), CENSUS_MIN, true)).toBe('20% of today’s 10 divers said it.');
  });
});
