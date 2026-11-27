import type { PromptDef } from './types';
import { matchAnswer } from './matcher';

// "The deep disagrees": a refused answer the player believes is right, kept for the
// surveyors (the question bank) to review. There is no server yet, so disputes are
// kept in this browser, and the Logbook can copy them out as a list.

export type DisputeVerdict = 'unknown' | 'decoy' | 'trap' | 'ambiguous';

export interface Dispute {
  promptId: string;
  /** The question as it was asked. */
  question: string;
  input: string;
  /** What the deep made of the answer when it was disputed. */
  verdict: DisputeVerdict;
  day: number;
  /** Wall-clock ms when it was disputed. */
  at: number;
}

/** The most disputes kept; the oldest go first. */
export const MAX_DISPUTES = 200;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
export const disputeKey = (d: Pick<Dispute, 'promptId' | 'input'>) => `${d.promptId}|${norm(d.input)}`;

/** A new dispute for a refused answer, or null if the deep would now accept it. */
export function makeDispute(prompt: PromptDef, input: string, day: number, at = Date.now()): Dispute | null {
  const text = input.trim().slice(0, 120);
  if (!text) return null;
  const res = matchAnswer(prompt, text);
  if (res.kind === 'accept' || res.kind === 'empty') return null;
  const verdict: DisputeVerdict = res.kind === 'reject' ? 'unknown' : res.kind;
  return { promptId: prompt.id, question: prompt.text, input: text, verdict, day, at };
}

/** Add a dispute to a list: once per answer to a question, newest last, at most MAX_DISPUTES. */
export function addDispute(list: Dispute[], d: Dispute): Dispute[] {
  const key = disputeKey(d);
  const rest = list.filter((x) => disputeKey(x) !== key);
  return [...rest, d].slice(-MAX_DISPUTES);
}

/** The disputes as plain text, to paste wherever the surveyors will read it. */
export function disputesText(list: Dispute[]): string {
  const lines = list.map((d) => `- ${d.promptId}: "${d.input}" (${d.verdict}), dive ${d.day}. Q: ${d.question}`);
  return [`Cthulhoo: answers the deep refused (${list.length})`, ...lines].join('\n');
}
