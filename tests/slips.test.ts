import { describe, expect, it } from 'vitest';
import { matchAnswer } from '../src/game/matcher';
import { SLIP_LINES, slipRemark, usableSlips } from '../src/game/slips';
import { buildTheme } from '../src/game/theme';
import type { PromptDef } from '../src/game/types';

describe('spelling remarks', () => {
  it('has a good pool of short lines, each showing the right spelling once', () => {
    expect(SLIP_LINES.length).toBeGreaterThanOrEqual(20);
    expect(new Set(SLIP_LINES).size).toBe(SLIP_LINES.length);
    for (const line of SLIP_LINES) {
      expect(line.split('{answer}').length - 1, line).toBe(1);
      expect(line.replace('{answer}', '').length, line).toBeLessThanOrEqual(72);
    }
  });

  it('never suggests that the answer itself was wrong', () => {
    const doubt = /\b(wrong|incorrect|error|mistak|almost|nearly|close|refus|reject|fail|invalid|not quite|try again|guess)/i;
    for (const line of SLIP_LINES) expect(line).not.toMatch(doubt);
  });

  it('sets the right spelling apart, and gives the same slip the same line', () => {
    const r = slipRemark(SLIP_LINES, 'Cheddar', 'cheeses', 'Chedar');
    expect(r.answer).toBe('Cheddar');
    expect(r.text).toBe(`${r.before}Cheddar${r.after}`);
    expect(r.text).not.toContain('{answer}');
    expect(SLIP_LINES).toContain(`${r.before}{answer}${r.after}`);
    expect(slipRemark(SLIP_LINES, 'Cheddar', 'cheeses', 'chedar')).toEqual(r);
    const lines = new Set(Array.from({ length: 60 }, (_, i) => slipRemark(SLIP_LINES, 'Cheddar', 'cheeses', `chedar${i}`).text));
    expect(lines.size).toBeGreaterThan(15);
  });

  it('never doubles the stop after an answer that ends in one', () => {
    for (let i = 0; i < 120; i++) {
      expect(slipRemark(SLIP_LINES, 'Washington, D.C.', 'q', `slip${i}`).text).not.toMatch(/\.\./);
      expect(slipRemark(SLIP_LINES, 'Oklahoma!', 'q', `slip${i}`).text).not.toMatch(/!\./);
    }
  });

  it('takes the bank’s own lines only when they show the spelling', () => {
    expect(usableSlips(['The deep forgives you.'])).toBe(SLIP_LINES);
    expect(usableSlips(undefined)).toBe(SLIP_LINES);
    expect(usableSlips(['Spelt {answer}.', 7, ''])).toEqual(['Spelt {answer}.']);
    expect(slipRemark([], 'Cheddar', 'q', 'chedar').text).toContain('Cheddar');
    expect(buildTheme({}).slips.lines).toBe(SLIP_LINES);
    expect(buildTheme({ slips: { lines: ['Spelt {answer}.'] } }).slips.lines).toEqual(['Spelt {answer}.']);
    expect(slipRemark(buildTheme({ slips: { lines: ['Spelt {answer}.'] } }).slips.lines, 'Cheddar', 'q', 'chedar').text).toBe('Spelt Cheddar.');
  });

  it('is for spelling slips alone, not for words the bank leaves out', () => {
    const cheese: PromptDef = { id: 'c', text: 'Name a cheese.', category: 'food', answers: [{ answer: 'Cheddar', tier: 1 }] };
    const slip = (input: string) => {
      const r = matchAnswer(cheese, input);
      return r.kind === 'accept' && r.fuzzy;
    };
    expect(slip('Chedar')).toBe(true);
    expect(slip('CHEDDAR')).toBe(false);
    expect(slip('Cheddar cheese')).toBe(false);
  });
});
