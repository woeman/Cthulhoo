import type { AnswerDef, PromptDef, TrapDef } from './types';

// Answer matching. This is a TypeScript port of the question-bank thread's
// reference matcher (scripts/lib/matcher.mjs, described in docs/content.md),
// which its validator replays every real-but-wrong name through. The bank is
// only proven safe at exactly these rules, so keep them in step:
// - The key is the normalised text with spaces removed. Every spelling also gets a
//   folded key ("St" = "Saint", "the Eighth" = "VIII" = "8", "nineteen eighty four"
//   = "1984"), which only ever adds matches. Word play ("exact") never folds.
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
  s = s.replace(/&/g, ' and ').replace(/\+/g, ' plus ').replace(/#/g, ' sharp ');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/^(the|a|an) (?=\S)/, '');
  return s;
}

/** Comparison key: normalised with spaces removed ("New Zealand" == "Newzealand"). */
export function keyOf(input: string): string {
  return normalize(input).replace(/ /g, '');
}

// ---------------------------------------------------------------- folding
// Folding gives every spelling a second, more forgiving key, so that "St Lucia"
// meets "Saint Lucia", "Henry 8" and "Henry the Eighth" meet "Henry VIII", and
// "Nineteen Eighty-Four" meets "1984". The plain key is always kept too, so typo
// tolerance on spelled-out numbers is never lost.

const ABBREVIATIONS = new Map([
  ['st', 'saint'],
  ['mt', 'mount'],
  ['ft', 'fort'],
  ['dr', 'doctor'],
]);
const SMALL_NUMBERS = new Map(
  Object.entries({
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
    ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19,
  }),
);
const TENS = new Map(Object.entries({ twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 }));
const SCALES = new Map(Object.entries({ hundred: 100, thousand: 1000, million: 1000000 }));
const ORDINALS = new Map(
  Object.entries({
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
    tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
    seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
    // Common misspellings, so "Henry the Eigth" still meets Henry VIII.
    eigth: 8, nineth: 9, twelth: 12, twelveth: 12, forth: 4,
  }),
);
const ROMAN = new Map<string, number>();
for (let n = 1; n <= 39; n++) {
  const ones = ['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix'][n % 10];
  ROMAN.set('x'.repeat(Math.floor(n / 10)) + ones, n);
}

/** The number an ordinal word names, as [value, words used]: "eighth" or "twenty third". */
function ordinalWordAt(words: string[], i: number): [number, number] | null {
  const w = words[i];
  if (w === undefined) return null;
  const ord = ORDINALS.get(w);
  if (ord !== undefined) return [ord, 1];
  const tens = TENS.get(w);
  const unit = ORDINALS.get(words[i + 1] ?? '') ?? 10;
  if (tens !== undefined && unit < 10) return [tens + unit, 2];
  return null;
}

/** The number a regnal ordinal names, as [value, words used]: "eighth", "twenty third", "8" or "viii". */
function ordinalAt(words: string[], i: number): [number, number] | null {
  const w = words[i];
  if (w === undefined) return null;
  const word = ordinalWordAt(words, i);
  if (word) return word;
  if (/^\d+$/.test(w)) return [Number(w), 1];
  const roman = ROMAN.get(w);
  if (roman !== undefined) return [roman, 1];
  return null;
}

const isNumberWord = (w: string) => SMALL_NUMBERS.has(w) || TENS.has(w) || SCALES.has(w);

/** Runs of number words as digits: "nineteen eighty four" is "19 84", "one hundred and one" is "101". */
function foldNumberWords(words: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < words.length) {
    if (!isNumberWord(words[i])) {
      out.push(words[i++]);
      continue;
    }
    let total = 0;
    let current = 0;
    let last: 'small' | 'tens' | 'scale' | null = null;
    const emit = () => {
      out.push(String(total + current));
      total = 0;
      current = 0;
      last = null;
    };
    while (i < words.length) {
      const w = words[i];
      const next = words[i + 1] ?? '';
      if (w === 'and' && last === 'scale' && (SMALL_NUMBERS.has(next) || TENS.has(next))) {
        i++;
        continue;
      }
      const small = SMALL_NUMBERS.get(w);
      const tens = TENS.get(w);
      const scale = SCALES.get(w);
      if (small !== undefined) {
        if (last === 'small' || (last === 'tens' && small >= 10)) emit();
        current += small;
        last = 'small';
      } else if (tens !== undefined) {
        if (last === 'small' || last === 'tens') emit();
        current += tens;
        last = 'tens';
      } else if (scale !== undefined) {
        if (scale === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * scale;
          current = 0;
        }
        last = 'scale';
      } else break;
      i++;
    }
    emit();
  }
  return out;
}

/**
 * The folded form of an already normalised string:
 * - "st", "mt", "ft" and "dr" before another word become saint, mount, fort and doctor;
 * - "8th" becomes "8";
 * - "twenty third" becomes "23" anywhere;
 * - after the first word, "the eighth", "the 8" and "the viii" become "8", and so do
 *   a bare "eighth" and a Roman numeral from i to xxxix;
 * - runs of number words become digits.
 */
export function fold(normalized: string): string {
  const split = normalized.split(' ').filter(Boolean);
  const words = split.map((w, i) => {
    const long = ABBREVIATIONS.get(w);
    if (long && i + 1 < split.length) return long;
    return w.replace(/^(\d+)(?:st|nd|rd|th)$/, '$1');
  });
  const out: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // "twenty third" is one ordinal wherever it stands: "21st Century" meets "Twenty-first Century".
    const tens = TENS.get(w);
    const unit = ORDINALS.get(words[i + 1] ?? '') ?? 10;
    if (tens !== undefined && unit < 10) {
      out.push(String(tens + unit));
      i += 1;
      continue;
    }
    if (out.length > 0) {
      if (w === 'the') {
        const ord = ordinalAt(words, i + 1);
        if (ord) {
          out.push(String(ord[0]));
          i += ord[1];
          continue;
        }
      }
      const word = ordinalWordAt(words, i);
      if (word) {
        out.push(String(word[0]));
        i += word[1] - 1;
        continue;
      }
      const roman = ROMAN.get(w);
      if (roman !== undefined) {
        out.push(String(roman));
        continue;
      }
    }
    out.push(w);
  }
  return foldNumberWords(out).join(' ');
}

/** The folded comparison key. */
export function foldKey(input: string): string {
  return fold(normalize(input)).replace(/ /g, '');
}

/** The keys a spelling is known by: its plain key, then its folded key if that differs. */
export function keysOf(input: string, exact = false): string[] {
  const plain = keyOf(input);
  if (!plain || exact) return plain ? [plain] : [];
  const folded = foldKey(input);
  return folded && folded !== plain ? [plain, folded] : [plain];
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

/** A list field as a list of strings. A bare string counts as a list of one, so a
 * slip in the data can never explode into single letters, and a number counts as its digits. */
function listOf(value: unknown): string[] {
  const text = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? String(v) : v);
  return (Array.isArray(value) ? value : [value]).map(text).filter((v): v is string => typeof v === 'string');
}

/** A list of answers or traps, skipping anything malformed. */
function objectsOf<T extends { answer: string }>(value: unknown): T[] {
  return Array.isArray(value) ? value.filter((v): v is T => !!v && typeof v === 'object' && typeof (v as T).answer === 'string') : [];
}

function compile(p: PromptDef): Compiled {
  let c = cache.get(p);
  if (c) return c;
  const exactMode = p.exact === true;
  const entries: Entry[] = [];
  // One entry per key per spelling, the plain key before the folded one.
  for (const a of objectsOf<AnswerDef>(p.answers))
    for (const f of [a.answer, ...listOf(a.aliases)]) for (const key of keysOf(f, exactMode)) entries.push({ key, kind: 'answer', ref: a });
  for (const t of objectsOf<TrapDef>(p.traps))
    for (const f of [t.answer, ...listOf(t.aliases)]) for (const key of keysOf(f, exactMode)) entries.push({ key, kind: 'trap', ref: t });
  for (const d of listOf(p.decoys)) for (const key of keysOf(d, exactMode)) entries.push({ key, kind: 'decoy', ref: d });
  const exact = new Map<string, Entry>();
  for (const e of entries) if (!exact.has(e.key)) exact.set(e.key, e);
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
  const plain = keyOf(input);
  // Text that folds to nothing (another alphabet, only symbols) is a refusal, not a blank.
  if (!plain) return String(input ?? '').trim() ? { kind: 'reject' } : { kind: 'empty' };
  const c = compile(prompt);

  // Word play ("exact": true), where the spelling is the answer: only the exact key
  // counts, with no folding, no plural forms and no forgiven typos. Traps still match exactly.
  if (prompt.exact === true) {
    const hit = c.exact.get(plain);
    return hit ? verdict(hit, false) : { kind: 'reject' };
  }
  const keys = keysOf(input);

  // 1. An exact match on the plain key, then on the folded key, each with its plural forms.
  for (const key of keys) {
    for (const v of keyVariants(key)) {
      const hit = c.exact.get(v);
      if (hit) return verdict(hit, false);
    }
  }

  // 2. Forgiven typos. A spelling's distance is the smallest between any of the input's
  //    keys and that entry's key, each within its own allowance.
  let best = Infinity;
  let hits: Entry[] = [];
  for (const e of c.entries) {
    let d = Infinity;
    for (const key of keys) {
      const limit = typoAllowance(Math.min(key.length, e.key.length));
      if (limit === 0) continue;
      const dk = osaDistance(key, e.key, limit);
      if (dk <= limit && dk < d) d = dk;
    }
    if (d === Infinity) continue;
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
