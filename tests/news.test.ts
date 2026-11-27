import { describe, expect, it } from 'vitest';
import { careerDay, computeCareer } from '../src/game/career';
import { resultsNews, titleNews } from '../src/game/news';
import { PLACEHOLDER_THEME } from '../src/game/theme';
import type { CareerCopy, DayRecord, MilestoneDef } from '../src/game/types';
import { countWords, multiplierWords, numberWords } from '../src/game/words';

const dive = (day: number, depth: number): DayRecord => ({
  day,
  date: '',
  omen: 'still',
  promptIds: ['p'],
  answers: [{ promptId: 'p', input: 'x', answer: 'x', tier: 3, depth, rejects: [], timeMs: 5000 }],
  sanity: 80,
  finished: true,
});
const days = (...recs: DayRecord[]) => Object.fromEntries(recs.map((r) => [r.day, r]));
const run = (from: number, to: number, depth = 1000) => Array.from({ length: to - from + 1 }, (_, i) => dive(from + i, depth));
const M = (depth: number): MilestoneDef => ({ depth, name: `M${depth}`, place: `m${depth}`, line: '' });

const copy: CareerCopy = {
  ...PLACEHOLDER_THEME.career,
  drift: ['AWAY {days} STOP THE SEA GAVE YOU BACK {metres} STOP'],
  wardSpent: ['A WARD HELD FOR {days} STOP'],
  wardEarned: ['{days} STOP A WARD IS YOURS STOP'],
  multiplier: ['WEEK {week} STOP EVERYTHING COUNTS {mult} STOP'],
};

describe('numbers in words', () => {
  it('spells numbers the British way, as a telegram would', () => {
    expect(numberWords(0)).toBe('zero');
    expect(numberWords(7)).toBe('seven');
    expect(numberWords(40)).toBe('forty');
    expect(numberWords(333)).toBe('three hundred and thirty three');
    expect(numberWords(1050)).toBe('one thousand and fifty');
    expect(numberWords(1250)).toBe('one thousand two hundred and fifty');
    expect(numberWords(2000000)).toBe('two million');
    expect(numberWords(1000001)).toBe('one million and one');
    expect(numberWords(712345)).toBe('seven hundred and twelve thousand three hundred and forty five');
  });

  it('counts nouns and multipliers', () => {
    expect(countWords(1, 'day')).toBe('one day');
    expect(countWords(2, 'day')).toBe('two days');
    expect(countWords(1, 'metre')).toBe('one metre');
    expect(multiplierWords(1.1)).toBe('one point one times');
    expect(multiplierWords(2)).toBe('two times');
  });
});

describe('telegrams', () => {
  it('says nothing to a diver with nothing new', () => {
    expect(titleNews(computeCareer({}, 5, []), copy, 'seed', 5)).toBeNull();
    expect(titleNews(computeCareer(days(...run(1, 3)), 4, []), copy, 'seed', 4)).toBeNull();
  });

  it('tells a returning diver how far the sea gave them back', () => {
    const n = titleNews(computeCareer(days(...run(1, 3)), 6, []), copy, 'seed', 6);
    expect(n?.kind).toBe('drift');
    expect(n?.lines).toEqual(['AWAY two days STOP THE SEA GAVE YOU BACK six hundred and sixty six metres STOP']);
    expect(n?.plain).toBe('You drifted up 666 m while you were away.');
  });

  it('tells of wards that held before the lantern went out', () => {
    const n = titleNews(computeCareer(days(...run(1, 7)), 10, []), copy, 'seed', 10);
    expect(n?.kind).toBe('drift');
    expect(n?.lines).toEqual(['AWAY two days STOP THE SEA GAVE YOU BACK three hundred and thirty three metres STOP']);
    expect(n?.plain).toBe('Your ward held for 1 day, then the lantern went out. You drifted up 333 m while you were away.');
    const held = titleNews(computeCareer(days(...run(1, 7)), 9, []), copy, 'seed', 9);
    expect(held?.kind).toBe('ward-spent');
    expect(held?.lines).toEqual(['A WARD HELD FOR one day STOP']);
    expect(held?.plain).toBe('A ward kept your lantern lit for 1 day.');
  });

  it('announces a new week of the lantern on the day it begins', () => {
    const n = titleNews(computeCareer(days(...run(1, 7)), 8, []), copy, 'seed', 8);
    expect(n?.kind).toBe('multiplier');
    expect(n?.lines).toEqual(['WEEK two STOP EVERYTHING COUNTS one point one times STOP']);
    expect(titleNews(computeCareer(days(...run(1, 8)), 9, []), copy, 'seed', 9)).toBeNull();
  });

  it('says nothing on the title once today is played', () => {
    expect(titleNews(computeCareer(days(...run(1, 3), dive(6, 1000)), 6, []), copy, 'seed', 6)).toBeNull();
  });

  it('hands over the ward on the day it is earned', () => {
    const c = computeCareer(days(...run(1, 7)), 7, []);
    expect(resultsNews(c, copy, 'seed', 7)?.lines).toEqual(['seven days STOP A WARD IS YOURS STOP']);
    expect(resultsNews(c, copy, 'seed', 6)).toBeNull();
  });
});

describe('a day in the career', () => {
  it('knows what the day added, and the milestones it passed', () => {
    const marks = [M(1500), M(2500), M(10000)];
    const c = computeCareer(days(...run(1, 2), dive(3, 2000)), 3, marks);
    expect(careerDay(c, 3)).toEqual({ dive: { dive: 2000, mult: 1, gained: 2000, streak: 3 }, riddle: 0, milestones: [1], wardEarned: false, before: 2000, after: 4000 });
    expect(careerDay(c, 2).milestones).toEqual([0]);
    expect(careerDay(c, 1).before).toBe(0);
  });
});
