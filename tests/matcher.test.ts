import { describe, expect, it } from 'vitest';
import bank from '../src/content/placeholder-bank.json';
import { fold, foldKey, keyOf, keysOf, matchAnswer, normalize, osaDistance, typoAllowance } from '../src/game/matcher';
import type { PromptDef } from '../src/game/types';

const prompts = (bank as { prompts: PromptDef[] }).prompts;
const P = (id: string) => prompts.find((p) => p.id === id)!;

describe('normalize', () => {
  it('folds case, accents, punctuation and leading articles', () => {
    expect(normalize('  The Côte d’Ivoire! ')).toBe('cote divoire');
    expect(normalize('Hawaiʻi')).toBe('hawaii');
    expect(normalize('R’lyeh')).toBe('rlyeh');
    expect(normalize('Bosnia & Herzegovina')).toBe('bosnia and herzegovina');
    expect(keyOf('Angler fish')).toBe(keyOf('anglerfish'));
    expect(normalize('Straße')).toBe('strasse');
  });
});

describe('distance', () => {
  it('counts transpositions as one edit', () => {
    expect(osaDistance('jupiter', 'jupietr')).toBe(1);
    expect(osaDistance('austria', 'australia')).toBe(2);
    expect(osaDistance('abc', 'abc')).toBe(0);
  });
  it('gives no allowance under 4 characters', () => {
    expect(typoAllowance(3)).toBe(0);
    expect(typoAllowance(4)).toBe(1);
    expect(typoAllowance(9)).toBe(2);
    expect(typoAllowance(12)).toBe(3);
  });
});

describe('matchAnswer', () => {
  it('accepts exact answers and aliases', () => {
    const r = matchAnswer(P('deep-sea-creatures'), 'angler fish');
    expect(r.kind).toBe('accept');
    if (r.kind === 'accept') expect(r.answer.answer).toBe('Anglerfish');
    expect(matchAnswer(P('solar-system-bodies'), 'io').kind).toBe('accept');
  });

  it('accepts small typos on longer words', () => {
    const r = matchAnswer(P('solar-system-bodies'), 'Ganymeed');
    expect(r.kind === 'accept' && r.answer.answer).toBe('Ganymede');
  });

  it('accepts simple plurals', () => {
    const r = matchAnswer(P('deep-sea-creatures'), 'blobfishes');
    expect(r.kind === 'accept' && r.answer.answer).toBe('Blobfish');
  });

  it('never fuzzes short words', () => {
    expect(matchAnswer(P('solar-system-bodies'), 'ip').kind).toBe('reject');
  });

  it('refuses traps with their reason', () => {
    const r = matchAnswer(P('solar-system-bodies'), 'the Sun');
    expect(r.kind).toBe('trap');
    if (r.kind === 'trap') expect(r.trap.reason).toMatch(/star/);
  });

  it('refuses decoys, and never snaps a decoy onto a nearby answer', () => {
    const p = P('landlocked-countries');
    expect(matchAnswer(p, 'Australia').kind).toBe('decoy');
    // One edit from both Austria (answer) and Australia (decoy): refuse.
    expect(matchAnswer(p, 'Austrlia').kind).not.toBe('accept');
    expect(matchAnswer(p, 'Austria').kind).toBe('accept');
  });

  it('refuses ties between two different answers as ambiguous', () => {
    const p: PromptDef = {
      id: 't',
      text: 't',
      category: 'geography',
      answers: [
        { answer: 'Niger', tier: 3 },
        { answer: 'Nigeria', tier: 1 },
      ],
    };
    expect(matchAnswer(p, 'Nigera').kind).toBe('ambiguous');
    expect(matchAnswer(p, 'Niger').kind).toBe('accept');
  });

  it('rejects nonsense and empty input', () => {
    expect(matchAnswer(P('colours'), 'qwertyuiop').kind).toBe('reject');
    expect(matchAnswer(P('colours'), '    ').kind).toBe('empty');
    expect(matchAnswer(P('colours'), '').kind).toBe('empty');
  });

  it('refuses text that folds to nothing, rather than ignoring it', () => {
    expect(matchAnswer(P('colours'), '   !!  ').kind).toBe('reject');
    expect(matchAnswer(P('colours'), 'Москва').kind).toBe('reject');
  });

  it('matches word-play prompts exactly, with no typos or plurals', () => {
    const p = {
      id: 'palindromes',
      text: 'Name a palindrome.',
      category: 'language',
      exact: true,
      answers: [{ answer: 'Noon', tier: 1 }, { answer: 'Racecar', aliases: ['Race car'], tier: 2 }],
      traps: [{ answer: 'Palindrome', reason: 'Not one itself.' }],
    } as PromptDef;
    expect(matchAnswer(p, 'noon').kind).toBe('accept');
    expect(matchAnswer(p, 'Race-car').kind).toBe('accept');
    expect(matchAnswer(p, 'Moon').kind).toBe('reject');
    expect(matchAnswer(p, 'Noons').kind).toBe('reject');
    expect(matchAnswer(p, 'Racecra').kind).toBe('reject');
    expect(matchAnswer(p, 'palindrome').kind).toBe('trap');
    expect(matchAnswer(p, 'palindromes').kind).toBe('reject');
    expect(matchAnswer({ ...p, exact: undefined }, 'Racecra').kind).toBe('accept');
  });

  it('reads a bare-string alias as one alias, never as single letters', () => {
    const p = {
      id: 'x',
      text: 'x',
      category: 'x',
      answers: [{ answer: 'Vermilion', aliases: 'Cinnabar red' as unknown as string[], tier: 3 }, { answer: 'bogus' } as never],
      traps: [{ reason: 'no answer' } as never],
      decoys: 'Scarlet' as unknown as string[],
    } as PromptDef;
    expect(matchAnswer(p, 'Cinnabar red').kind).toBe('accept');
    expect(matchAnswer(p, 'c').kind).toBe('reject');
    expect(matchAnswer(p, 'Scarlet').kind).toBe('decoy');
    expect(matchAnswer(p, 'Vermilion').kind).toBe('accept');
  });

  it('has no answer that collides with another answer in the same prompt', () => {
    for (const p of prompts) {
      const seen = new Map<string, string>();
      for (const a of p.answers) {
        for (const k of [a.answer, ...(a.aliases ?? [])].map(keyOf)) {
          const prev = seen.get(k);
          if (prev && prev !== a.answer) throw new Error(`${p.id}: "${k}" is both ${prev} and ${a.answer}`);
          seen.set(k, a.answer);
        }
      }
    }
  });
});

describe('symbol spelling', () => {
  it('keeps C, C++ and C# apart', () => {
    expect(keyOf('C')).toBe('c');
    expect(keyOf('C++')).toBe('cplusplus');
    expect(keyOf('C#')).toBe('csharp');
    expect(keyOf('F#')).toBe('fsharp');
  });
});

describe('folding', () => {
  it('spells out St, Mt, Ft and Dr only before another word', () => {
    expect(fold('st lucia')).toBe('saint lucia');
    expect(fold('mt everest')).toBe('mount everest');
    expect(fold('ft william')).toBe('fort william');
    expect(fold('dr who')).toBe('doctor who');
    expect(fold('ft')).toBe('ft');
    expect(fold('mt')).toBe('mt');
  });

  it('reads regnal numbers every way, but never the first word', () => {
    for (const s of ['henry viii', 'henry 8', 'henry 8th', 'henry the eighth', 'henry the 8th', 'henry the viii']) expect(foldKey(s)).toBe('henry8');
    expect(foldKey('Louis the Twenty Third')).toBe('louis23');
    expect(fold('xi jinping')).toBe('xi jinping');
    expect(fold('mix')).toBe('mix');
    expect(fold('malcolm x')).toBe('malcolm 10');
  });

  it('turns runs of number words into digits', () => {
    expect(fold('nineteen eighty four')).toBe('19 84');
    expect(foldKey('Nineteen Eighty-Four')).toBe(keyOf('1984'));
    expect(fold('one hundred and one dalmatians')).toBe('101 dalmatians');
    expect(fold('two thousand and six')).toBe('2006');
    expect(fold('catch twenty two')).toBe('catch 22');
    expect(fold('rock and roll')).toBe('rock and roll');
  });

  it('only ever adds a key, so the plain spelling still forgives typos', () => {
    expect(keysOf('Seven Samurai')).toEqual(['sevensamurai', '7samurai']);
    expect(keysOf('Saturn')).toEqual(['saturn']);
    expect(keysOf('St Lucia', true)).toEqual(['stlucia']);
    expect(keysOf('  ')).toEqual([]);
  });

  it('accepts folded spellings, and typos on spelled-out numbers', () => {
    const p: PromptDef = {
      id: 'f',
      text: 'f',
      category: 'history',
      answers: [
        { answer: 'Henry VIII', tier: 2 },
        { answer: 'Saint Lucia', tier: 4 },
        { answer: 'Nineteen Eighty-Four', aliases: ['1984'], tier: 3 },
        { answer: 'Seven Samurai', tier: 5 },
      ],
    };
    const got = (input: string) => {
      const r = matchAnswer(p, input);
      return r.kind === 'accept' ? r.answer.answer : r.kind;
    };
    expect(got('Henry the Eighth')).toBe('Henry VIII');
    expect(got('henry 8th')).toBe('Henry VIII');
    expect(got('St. Lucia')).toBe('Saint Lucia');
    expect(got('nineteen eighty four')).toBe('Nineteen Eighty-Four');
    expect(got('1984')).toBe('Nineteen Eighty-Four');
    expect(got('7 Samurai')).toBe('Seven Samurai');
    expect(got('Sevn Samurai')).toBe('Seven Samurai');
  });

  it('never folds word play', () => {
    const p: PromptDef = { id: 'w', text: 'w', category: 'language', exact: true, answers: [{ answer: 'Seven', tier: 2 }] };
    expect(matchAnswer(p, 'Seven').kind).toBe('accept');
    expect(matchAnswer(p, '7').kind).toBe('reject');
  });
});
