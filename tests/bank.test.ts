import { describe, expect, it } from 'vitest';
import placeholder from '../src/content/placeholder-bank.json';
import { bankFrom, cleanPrompt, collectBank, loadBank } from '../src/game/bank';
import { matchAnswer } from '../src/game/matcher';
import type { PromptDef } from '../src/game/types';

const raw = (placeholder as { prompts: PromptDef[] }).prompts;
const prompt = (extra: Record<string, unknown> = {}) => ({ id: 'q', text: 'Name a thing', category: 'misc', answers: [{ answer: 'Thing', tier: 2 }], ...extra });
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => prompt({ id: `${prefix}${i}` }));
/** What the player sees from a guess. */
function verdict(p: PromptDef, input: string): unknown[] {
  const r = matchAnswer(p, input);
  if (r.kind === 'accept') return [r.kind, r.answer.answer, r.answer.tier, r.fuzzy];
  if (r.kind === 'trap') return [r.kind, r.trap.answer, r.trap.reason];
  if (r.kind === 'decoy') return [r.kind, r.decoy];
  if (r.kind === 'ambiguous') return [r.kind, r.options];
  return [r.kind];
}

describe('cleaning prompts', () => {
  it('drops prompts it cannot play', () => {
    const broken: unknown[] = [
      null,
      'q',
      [],
      prompt({ id: 7 }),
      prompt({ id: '  ' }),
      prompt({ text: '' }),
      prompt({ answers: 'Thing' }),
      prompt({ answers: [] }),
      prompt({ answers: [{ answer: '', tier: 1 }, { answer: 'X', tier: '3' }, { answer: 'Y', tier: NaN }, { answer: 'Z', tier: Infinity }, null] }),
    ];
    for (const p of broken) expect(cleanPrompt(p), JSON.stringify(p)).toBeNull();
    expect(cleanPrompt(prompt())?.id).toBe('q');
  });

  it('clamps and rounds tiers into 1..6, and drops only the answers that are broken', () => {
    const p = cleanPrompt(prompt({ answers: [{ answer: 'A', tier: 0 }, { answer: 'B', tier: 9 }, { answer: 'C', tier: 2.6 }, { answer: 'D', tier: -4 }, { answer: '', tier: 3 }] }))!;
    expect(p.answers.map((a) => [a.answer, a.tier])).toEqual([['A', 1], ['B', 6], ['C', 3], ['D', 1]]);
  });

  it('never turns a bare alias string into single-letter answers', () => {
    const p = cleanPrompt(prompt({ answers: [{ answer: 'United States', tier: 1, aliases: 'USA' }, { answer: 'Nineteen Eighty-Four', tier: 4, aliases: [1984, null, ' '] }] }))!;
    expect(p.answers[0].aliases).toEqual(['USA']);
    expect(matchAnswer(p, 'U').kind).toBe('reject');
    expect(matchAnswer(p, 'usa').kind).toBe('accept');
    expect(p.answers[1].aliases).toEqual(['1984']);
    expect(matchAnswer(p, '1984').kind).toBe('accept');
  });

  it('refuses a trap with no reason as a decoy, never with an empty reason', () => {
    const p = cleanPrompt(prompt({ traps: [{ answer: 'Sun', reason: 'A star.' }, { answer: 'Moon', aliases: ['Luna'] }, { reason: 'no answer' }], decoys: ['Comet', 3, ''] }))!;
    expect(p.traps!.map((t) => t.answer)).toEqual(['Sun']);
    expect(p.decoys).toEqual(['Comet', '3', 'Moon', 'Luna']);
    expect(matchAnswer(p, 'Luna')).toEqual({ kind: 'decoy', decoy: 'Luna' });
    const sun = matchAnswer(p, 'the sun');
    expect(sun.kind === 'trap' && sun.trap.reason).toBe('A star.');
  });

  it('keeps optional text only when it is text', () => {
    const p = cleanPrompt(prompt({ flavor: 42, rules: { only: 'UN members' }, category: '' }))!;
    expect(p).toMatchObject({ flavor: undefined, rules: undefined, category: 'misc' });
  });

  it('leaves a well-formed bank exactly as playable as it was', () => {
    for (const before of raw) {
      const after = cleanPrompt(before)!;
      expect(after.answers.map((a) => [a.answer, a.tier, a.aliases ?? [], a.lore, !!a.openSecret])).toEqual(
        before.answers.map((a) => [a.answer, a.tier, a.aliases ?? [], a.lore, !!a.openSecret]),
      );
      const forms = [
        ...before.answers.flatMap((a) => [a.answer, ...(a.aliases ?? [])]),
        ...(before.traps ?? []).flatMap((t) => [t.answer, ...(t.aliases ?? [])]),
        ...(before.decoys ?? []),
      ];
      for (const f of forms) {
        for (const input of [f, `${f}x`, f.slice(1), f.toUpperCase()]) expect(verdict(after, input), `${before.id}: ${input}`).toEqual(verdict(before, input));
      }
    }
  });
});

describe('collecting the bank', () => {
  it('keeps the first file to use an id', () => {
    const { prompts } = collectBank([{ prompts: [prompt({ text: 'first' })] }, { prompts: [prompt({ text: 'second' })] }]);
    expect(prompts.map((p) => p.text)).toEqual(['first']);
  });

  it('reads fixed days from any file, including one with no prompts', () => {
    const { days } = collectBank([
      { prompts: ids(3, 'a') },
      { days: [{ date: '2026-12-25', prompts: ['a0', 4, 'a1'] }, { date: 20261225, prompts: ['a0'] }, { date: '2026-12-26' }, null] },
      { notes: 'not a bank file' },
      'nonsense',
    ]);
    expect(days).toEqual([{ date: '2026-12-25', prompts: ['a0', 'a1'] }]);
  });

  it('plays the data once it can fill a day', () => {
    const bank = bankFrom([{ prompts: ids(7, 'd') }], placeholder);
    expect(bank.source).toBe('data');
    expect(bank.prompts.map((p) => p.id)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
  });

  it('makes up a short bank from the placeholders, letting the data win a shared id', () => {
    const shared = { ...raw[0], text: 'The newer wording from data/' };
    const bank = bankFrom([{ prompts: [shared, ...ids(2, 'd')], days: [{ date: '2026-12-25', prompts: ['d0'] }] }], placeholder);
    expect(bank.source).toBe('placeholder');
    expect(bank.prompts).toHaveLength(raw.length + 2);
    expect(bank.prompts.find((p) => p.id === raw[0].id)?.text).toBe('The newer wording from data/');
    expect(bank.days).toEqual([{ date: '2026-12-25', prompts: ['d0'] }]);
  });

  it('loads the placeholder bank while data/ is empty', () => {
    const bank = loadBank();
    expect(bank.source).toBe('placeholder');
    expect(bank.prompts).toHaveLength(raw.length);
    expect([...bank.byId.keys()]).toEqual(raw.map((p) => p.id));
  });
});
