import { describe, expect, it } from 'vitest';
import { computeCareer } from '../src/game/career';
import { personaFor, weekOf } from '../src/game/persona';
import { computeSigils, definingSigils, levelFor } from '../src/game/sigils';
import { PLACEHOLDER_THEME, buildCareer } from '../src/game/theme';
import type { AnswerRecord, DayRecord, PromptDef, ThemeCopy } from '../src/game/types';

const answer = (category: string, tier: number, timeMs = 9000): AnswerRecord => ({
  promptId: `${category}-q`,
  input: 'x',
  answer: tier ? 'x' : null,
  tier: tier as AnswerRecord['tier'],
  depth: tier * 150,
  rejects: [],
  timeMs,
  category,
});
const dive = (day: number, answers: AnswerRecord[], extra: Partial<DayRecord> = {}): DayRecord => ({
  day,
  date: '',
  omen: 'still',
  promptIds: answers.map((a) => a.promptId),
  answers,
  sanity: 80,
  finished: true,
  ...extra,
});
const none = (): PromptDef | undefined => undefined;
const T: ThemeCopy = PLACEHOLDER_THEME;

describe('sigils', () => {
  it('has one per topic, unlit until played', () => {
    const s = computeSigils({}, none, T);
    expect(s.map((x) => x.topic)).toEqual(Object.keys(T.categories));
    expect(s.every((x) => x.level === 0 && x.answered === 0)).toBe(true);
  });

  it('weighs rare answers far above common ones', () => {
    const days = { 1: dive(1, [answer('history', 6), answer('history', 6), answer('history', 5), answer('food', 1), answer('food', 1), answer('food', 0)]) };
    const s = computeSigils(days, none, T);
    const history = s.find((x) => x.topic === 'history')!;
    const food = s.find((x) => x.topic === 'food')!;
    expect(history.strength).toBeGreaterThan(food.strength);
    expect(history.rare).toBe(3);
    expect(history.level).toBeGreaterThanOrEqual(2);
    expect(food.level).toBeLessThanOrEqual(1);
  });

  it('never sets a sigil blazing on one lucky answer', () => {
    const s = computeSigils({ 1: dive(1, [answer('myth', 6)]) }, none, T);
    expect(s.find((x) => x.topic === 'myth')!.level).toBeLessThan(3);
    expect(definingSigils(s)).toEqual([]);
  });

  it('falls back to the prompt’s topic for answers saved before topics were', () => {
    const old = { ...answer('science', 4), category: undefined };
    const lookup = (id: string) => (id === 'science-q' ? ({ category: 'science' } as PromptDef) : undefined);
    expect(computeSigils({ 1: dive(1, [old]) }, lookup, T).find((x) => x.topic === 'science')!.answered).toBe(1);
  });

  it('ignores practice dives', () => {
    expect(computeSigils({ 1: dive(1, [answer('sport', 6)], { practice: true }) }, none, T).find((x) => x.topic === 'sport')!.answered).toBe(0);
  });

  it('maps strength to four levels', () => {
    expect([0, 0.19, 0.2, 0.39, 0.4, 0.59, 0.6, 1].map(levelFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe('the persona', () => {
  const theme: ThemeCopy = {
    ...T,
    career: buildCareer({
      title: '{epithet} {role} of {place}',
      surfacePlace: 'the Shallows',
      milestones: [{ depth: 1000, name: 'The First Trench', place: 'the First Trench', line: '' }],
      epithets: [
        { from: 0, words: ['Damp'] },
        { from: 1000, words: ['Drowned'] },
      ],
      stateEpithets: { unsleeping: ['Unsleeping'], surfacing: ['Surfacing'], newcomer: ['Untried'] },
      roles: { geography: ['Cartographer'], none: ['Diver'] },
      synopsis: {
        strong: { geography: ['It knows the rivers of {topic}.'] },
        weak: { food: ['It has no taste for {topic}.'] },
        fast: ['It answers fast.'],
        slow: ['It answers slowly.'],
        rare: ['It knows rare things.'],
        common: ['It says common things.'],
        night: ['It dives at night.'],
        day: ['It dives by day.'],
        streak: ['Its lantern has burned {streak} days.'],
        drifting: ['It has been away.'],
        newcomer: ['It is new.'],
        warded: ['A ward held.'],
      },
    }),
  };
  const geoDays = (n: number) =>
    Object.fromEntries(
      Array.from({ length: n }, (_, i) => [i + 1, dive(i + 1, [answer('geography', 5, 4000), answer('geography', 6, 4000), answer('food', 1, 4000), answer('food', 1, 4000)])]),
    );

  it('names a newcomer as untried', () => {
    const days = geoDays(1);
    const c = computeCareer(days, 1, theme.career.milestones);
    const p = personaFor(c, computeSigils(days, none, theme), days, theme, 'seed', 1);
    expect(p.title).toBe('Untried Diver of the First Trench');
    expect(p.synopsis[0]).toBe('It is new.');
  });

  it('builds the title from depth, the strongest topic and the deepest milestone', () => {
    const days = geoDays(4);
    const c = computeCareer(days, 4, theme.career.milestones);
    const p = personaFor(c, computeSigils(days, none, theme), days, theme, 'seed', 4);
    expect(p.title).toBe('Drowned Cartographer of the First Trench');
    expect(p.synopsis[0]).toBe('It knows the rivers of Geography.');
    expect(p.synopsis).toContain('It has no taste for Food & Drink.');
    expect(p.synopsis.every((l) => !l.includes('{'))).toBe(true);
  });

  it('calls a drifting diver surfacing', () => {
    const days = geoDays(4);
    const c = computeCareer(days, 7, theme.career.milestones);
    const p = personaFor(c, computeSigils(days, none, theme), days, theme, 'seed', 7);
    expect(p.epithet).toBe('Surfacing');
    expect(p.synopsis).toContain('It has been away.');
  });

  it('keeps the same synopsis all week and may change it the next', () => {
    const days = geoDays(4);
    const c = computeCareer(days, 4, theme.career.milestones);
    const s = computeSigils(days, none, theme);
    expect(personaFor(c, s, days, theme, 'seed', 4).synopsis).toEqual(personaFor(c, s, days, theme, 'seed', 5).synopsis);
    expect(weekOf(7)).toBe(1);
    expect(weekOf(8)).toBe(2);
  });

  it('works with the copy the game ships with', () => {
    const days = geoDays(10);
    const c = computeCareer(days, 10, T.career.milestones);
    const p = personaFor(c, computeSigils(days, none, T), days, T, 'abc', 10);
    expect(p.title.length).toBeGreaterThan(5);
    expect(p.title).not.toMatch(/[{}]/);
    expect(p.synopsis.length).toBeGreaterThan(0);
    expect(p.synopsis.join(' ')).not.toMatch(/[{}]/);
  });
});
