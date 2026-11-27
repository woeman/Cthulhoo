import type { AnswerDef, PromptDef, TrapDef } from './types';

// Answer matching. This is a TypeScript port of the question-bank thread's
// reference matcher (scripts/lib/matcher.mjs, described in docs/content.md),
// which its validator replays every real-but-wrong name through. The bank is
// only proven safe at exactly these rules, so keep them in step:
// - The key is the normalised text with spaces removed.
// - Exact matches (and simple singular/plural variants) beat fuzzy ones;
//   traps and decoys are part of the exact table too.
// - Typo allowance comes from the shorter key: <=3 exact only, 4-7 one edit,
//   8-11 two, 12+ three. Adjacent swaps count as one edit.
// - In the fuzzy pass traps and decoys compete on equal terms, so a wrong
//   answer can never be "corrected" into a valid one; tied answers are ambiguous.

export type MatchResult =
  | { kind: 'accept'; answer: AnswerDef; fuzzy: boolean }
  | { kind: 'trap'; trap: TrapDef }
  | { kind: 'decoy'; decoy: string }
  | { kind: 'ambiguous'; options: string[] }
  | { kind: 'reject' }
  | { kind: 'empty' };

type Entry =
  | { key: string; kind: 'answer'; ref: AnswerDef }
  | { key: string; kind: 'trap'; ref: TrapDef }
  | { key: string; kind: 'decoy'; ref: string };

interface Compiled {
  entries: Entry[];
  exact: Map<string, Entry>;
}

const APOSTROPHES = /['‘’ʻʼ`´]/g;
const SPECIAL: Record<string, string> = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', ł: 'l', đ: 'd', ð: 'd', þ: 'th', ı: 'i' };

/** Lowercase, strip accents and apostrophes, other punctuation to spaces, drop a leading article. */
export function normalize(input: string): string {
  let s = String(input ?? '').toLowerCase();
  s = s.replace(/[ßæœøłđðþı]/g, (c) => SPECIAL[c] ?? c);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  s = s.replace(APOSTROPHES, '');
  s = s.replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/^(the|a|an) (?=\S)/, '');
  return s;
}

/** Comparison key: normalised with spaces removed ("New Zealand" == "Newzealand"). */
export function keyOf(input: string): string {
  return normalize(input).replace(/ /g, '');
}

export function typoAllowance(len: number): number {
  if (len <= 3) return 0;
  if (len <= 7) return 1;
  if (len <= 11) return 2;
  return 3;
}

/** Optimal string alignment distance, giving up once it must exceed max. */
export function osaDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const cols = b.length + 1;
  let prevPrev: number[] | null = null;
  let prev = Array.from({ length: cols }, (_, j) => j);
  let prevRowMin = 0;
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array<number>(cols);
    cur[0] = i;
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prevPrev[j - 2] + 1);
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // A transposition can skip a row, so stop only when two rows are over.
    if (rowMin > max && prevRowMin > max) return max + 1;
    prevRowMin = rowMin;
    prevPrev = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

const cache = new WeakMap<PromptDef, Compiled>();

function compile(p: PromptDef): Compiled {
  let c = cache.get(p);
  if (c) return c;
  const entries: Entry[] = [];
  for (const a of p.answers ?? []) for (const f of [a.answer, ...(a.aliases ?? [])]) entries.push({ key: keyOf(f), kind: 'answer', ref: a });
  for (const t of p.traps ?? []) for (const f of [t.answer, ...(t.aliases ?? [])]) entries.push({ key: keyOf(f), kind: 'trap', ref: t });
  for (const d of p.decoys ?? []) entries.push({ key: keyOf(d), kind: 'decoy', ref: d });
  const exact = new Map<string, Entry>();
  for (const e of entries) if (e.key && !exact.has(e.key)) exact.set(e.key, e);
  c = { entries, exact };
  cache.set(p, c);
  return c;
}

/** Singular and plural forms tried for an exact match. */
export function keyVariants(key: string): string[] {
  const out = [key];
  if (key.length > 4 && key.endsWith('ies')) out.push(key.slice(0, -3) + 'y');
  if (key.length > 4 && key.endsWith('es')) out.push(key.slice(0, -2));
  if (key.length > 3 && key.endsWith('s')) out.push(key.slice(0, -1));
  out.push(key + 's');
  return out;
}

function verdict(e: Entry, fuzzy: boolean): MatchResult {
  if (e.kind === 'answer') return { kind: 'accept', answer: e.ref, fuzzy };
  if (e.kind === 'trap') return { kind: 'trap', trap: e.ref };
  return { kind: 'decoy', decoy: e.ref };
}

export function matchAnswer(prompt: PromptDef, input: string): MatchResult {
  const key = keyOf(input);
  if (!key) return { kind: 'empty' };
  const c = compile(prompt);

  for (const v of keyVariants(key)) {
    const hit = c.exact.get(v);
    if (hit) return verdict(hit, false);
  }

  if (key.length < 4) return { kind: 'reject' };
  let best = Infinity;
  let hits: Entry[] = [];
  for (const e of c.entries) {
    const limit = typoAllowance(Math.min(key.length, e.key.length));
    if (limit === 0) continue;
    const d = osaDistance(key, e.key, limit);
    if (d > limit) continue;
    if (d < best) {
      best = d;
      hits = [e];
    } else if (d === best) hits.push(e);
  }
  if (!hits.length) return { kind: 'reject' };
  const wrong = hits.filter((h) => h.kind !== 'answer');
  if (wrong.length) return verdict(wrong.find((h) => h.kind === 'trap') ?? wrong[0], true);
  const answers = [...new Set(hits.map((h) => h.ref as AnswerDef))];
  if (answers.length > 1) return { kind: 'ambiguous', options: answers.map((a) => a.answer) };
  return verdict(hits[0], true);
}

/** All accepted answers grouped by tier, rarest first. Used for the post-dive reveal. */
export function answersByTier(prompt: PromptDef): Map<number, AnswerDef[]> {
  const m = new Map<number, AnswerDef[]>();
  for (const a of prompt.answers) {
    const list = m.get(a.tier) ?? [];
    list.push(a);
    m.set(a.tier, list);
  }
  return new Map([...m.entries()].sort((a, b) => b[0] - a[0]));
}
