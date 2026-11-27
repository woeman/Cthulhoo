import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchAnswer } from '../src/game/matcher';
import type { PromptDef } from '../src/game/types';

// The question bank's shared matcher cases (scripts/matcher-cases.json), which its
// reference matcher also passes, so the game and the bank judge answers alike.
// They arrive with the bank; until then point MATCHER_CASES at a copy.
const path = process.env.MATCHER_CASES ?? resolve(__dirname, '../scripts/matcher-cases.json');

interface Case {
  prompt: string;
  input: string;
  expect: 'accepted' | 'trap' | 'decoy' | 'ambiguous' | 'unknown' | 'empty';
  answer?: string;
  trap?: string;
  candidates?: string[];
  note?: string;
}

const file = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { prompts: Record<string, PromptDef>; cases: Case[] }) : null;

function describeResult(prompt: PromptDef, input: string): string {
  const r = matchAnswer(prompt, input);
  if (r.kind === 'accept') return `accepted (${r.answer.answer})`;
  if (r.kind === 'trap') return `trap (${r.trap.answer})`;
  if (r.kind === 'ambiguous') return `ambiguous (${[...r.options].sort().join(', ')})`;
  if (r.kind === 'reject') return 'unknown';
  return r.kind;
}

function wanted(c: Case): string {
  if (c.expect === 'accepted') return `accepted (${c.answer})`;
  if (c.expect === 'trap') return `trap (${c.trap})`;
  if (c.expect === 'ambiguous') return `ambiguous (${[...(c.candidates ?? [])].sort().join(', ')})`;
  return c.expect;
}

describe.skipIf(!file)('the shared matcher cases', () => {
  for (const c of file?.cases ?? []) {
    it(`${c.prompt}: ${JSON.stringify(c.input)}${c.note ? ` (${c.note})` : ''}`, () => {
      const prompt = file!.prompts[c.prompt];
      expect(prompt, `no test prompt named ${c.prompt}`).toBeTruthy();
      expect(describeResult(prompt, c.input)).toBe(wanted(c));
    });
  }
});
