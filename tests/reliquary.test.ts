import { describe, expect, it } from 'vitest';
import { collectRelics, relicCounts, reliquaryNote } from '../src/game/reliquary';
import { PLACEHOLDER_THEME } from '../src/game/theme';
import type { AnswerRecord, DayRecord, PromptDef, Tier } from '../src/game/types';

const PROMPTS: PromptDef[] = [
  {
    id: 'rivers-1',
    text: 'Name a river in Africa.',
    category: 'geography',
    answers: [
      { answer: 'Nile', tier: 1 },
      { answer: 'Ubangi', tier: 5, lore: 'It carries more water than the Thames by far.' },
      { answer: 'Lufira', tier: 6 },
    ],
  },
  {
    id: 'moons-1',
    text: 'Name a moon of Saturn.',
    category: 'science',
    answers: [
      { answer: 'Titan', tier: 1 },
      { answer: 'Pan', tier: 6, openSecret: true },
      { answer: 'Ymir', tier: 6 },
    ],
  },
];
const byId = (id: string) => PROMPTS.find((p) => p.id === id);

const answer = (promptId: string, given: string | null, tier: number, extra: Partial<AnswerRecord> = {}): AnswerRecord => ({
  promptId,
  input: given,
  answer: given,
  tier: tier as Tier,
  depth: tier ? [0, 100, 250, 400, 600, 800, 1000][tier] : 0,
  rejects: [],
  timeMs: 4000,
  ...extra,
});

const dive = (day: number, date: string, answers: AnswerRecord[], extra: Partial<DayRecord> = {}): DayRecord => ({
  day,
  date,
  omen: 'still',
  promptIds: answers.map((a) => a.promptId),
  answers,
  sanity: 80,
  finished: true,
  ...extra,
});

describe('the Reliquary', () => {
  const days: Record<number, DayRecord> = {
    3: dive(3, '2026-11-29', [answer('rivers-1', 'Ubangi', 5), answer('moons-1', 'Ymir', 6)]),
    1: dive(1, '2026-11-27', [answer('rivers-1', 'Nile', 1), answer('moons-1', 'Pan', 6, { openSecret: true })]),
    2: dive(2, '2026-11-28', [answer('rivers-1', null, 0), answer('lost-1', 'Atlantis', 6, { category: 'myth' }), answer('moons-1', 'Titan', 1)]),
  };

  it('keeps every Forbidden and Unspeakable answer, newest dive first and in the order given', () => {
    const relics = collectRelics(days, byId, PLACEHOLDER_THEME);
    expect(relics.map((r) => `${r.day}:${r.answer}`)).toEqual(['3:Ubangi', '3:Ymir', '2:Atlantis']);
    expect(relics[0]).toMatchObject({ date: '2026-11-29', question: 'Name a river in Africa.', tier: 5, depth: 800, lore: 'It carries more water than the Thames by far.' });
    expect(relics[1].lore).toBeUndefined();
  });

  it('keeps no Open Secret, however rare it looks: everyone whispers it', () => {
    expect(collectRelics(days, byId, PLACEHOLDER_THEME).some((r) => r.answer === 'Pan')).toBe(false);
  });

  it('remembers a relic whose question the bank has since let go', () => {
    const lost = collectRelics(days, byId, PLACEHOLDER_THEME).find((r) => r.answer === 'Atlantis');
    expect(lost?.question).toMatch(/^A question (from .+, since lost|since lost to the deep)$/);
    const nothing = collectRelics({ 4: dive(4, '2026-11-30', [answer('gone', 'Mu', 6)]) }, byId, PLACEHOLDER_THEME);
    expect(nothing[0].question).toBe('A question since lost to the deep');
  });

  it('never keeps a practice dive', () => {
    expect(collectRelics({ 5: dive(5, '2026-12-01', [answer('moons-1', 'Ymir', 6)], { practice: true }) }, byId, PLACEHOLDER_THEME)).toEqual([]);
  });

  it('carries the census heard for a relic', () => {
    const relics = collectRelics(days, byId, PLACEHOLDER_THEME, { '3|moons-1': { total: 212, mine: 3 } });
    expect(relics.find((r) => r.answer === 'Ymir')?.census).toEqual({ total: 212, mine: 3 });
    expect(relics.find((r) => r.answer === 'Ubangi')?.census).toBeUndefined();
  });

  it('counts them for the Logbook', () => {
    const relics = collectRelics(days, byId, PLACEHOLDER_THEME);
    expect(relicCounts(relics)).toEqual({ unspeakable: 2, forbidden: 1 });
    expect(reliquaryNote(relics, PLACEHOLDER_THEME)).toBe('2 Unspeakable · 1 Forbidden');
    expect(reliquaryNote(relics.filter((r) => r.tier === 5), PLACEHOLDER_THEME)).toBe('1 Forbidden');
    expect(reliquaryNote([], PLACEHOLDER_THEME)).toBe('Your rarest answers will rest here');
  });
});
