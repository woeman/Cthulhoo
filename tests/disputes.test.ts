import { describe, expect, it } from 'vitest';
import { MAX_DISPUTES, addDispute, disputesText, makeDispute } from '../src/game/disputes';
import type { PromptDef } from '../src/game/types';

const prompt: PromptDef = {
  id: 'moons',
  text: 'Name a moon of Jupiter.',
  category: 'science',
  answers: [{ answer: 'Ganymede', tier: 2 }, { answer: 'Callisto', tier: 3 }],
  traps: [{ answer: 'Titan', reason: 'That is Saturn’s.' }],
  decoys: ['Phobos'],
};

describe('disputes', () => {
  it('records what the deep made of a refused answer', () => {
    expect(makeDispute(prompt, ' Amalthea ', 50, 1)).toEqual({ promptId: 'moons', question: 'Name a moon of Jupiter.', input: 'Amalthea', verdict: 'unknown', day: 50, at: 1 });
    expect(makeDispute(prompt, 'Titan', 50)?.verdict).toBe('trap');
    expect(makeDispute(prompt, 'Phobos', 50)?.verdict).toBe('decoy');
  });

  it('drops a dispute the deep would now accept, and blank ones', () => {
    expect(makeDispute(prompt, 'Calisto', 50)).toBeNull();
    expect(makeDispute(prompt, '   ', 50)).toBeNull();
  });

  it('keeps one dispute per answer to a question, newest last, and caps the list', () => {
    const a = makeDispute(prompt, 'Amalthea', 50, 1)!;
    const b = makeDispute(prompt, 'amalthea ', 51, 2)!;
    const c = makeDispute(prompt, 'Io moon', 51, 3)!;
    expect(addDispute(addDispute(addDispute([], a), c), b).map((d) => [d.input, d.at])).toEqual([
      ['Io moon', 3],
      ['amalthea', 2],
    ]);
    let list = [a];
    for (let i = 0; i < MAX_DISPUTES + 5; i++) list = addDispute(list, { ...a, input: `x${i}`, at: i });
    expect(list).toHaveLength(MAX_DISPUTES);
    expect(list[list.length - 1].input).toBe(`x${MAX_DISPUTES + 4}`);
  });

  it('writes the list out for the surveyors', () => {
    const text = disputesText([makeDispute(prompt, 'Amalthea', 50, 1)!]);
    expect(text).toBe('Cthulhoo: answers the deep refused (1)\n- moons: "Amalthea" (unknown), dive 50. Q: Name a moon of Jupiter.');
  });
});
