import placeholderRiddles from '../content/riddles.placeholder.json';
import { dayNumberForKey, seededShuffle } from './daily';
import { keyOf, keyVariants, matchAnswer, type MatchResult } from './matcher';
import type { PromptDef } from './types';

// The Whispering Deep: one verse riddle a day, the same for everyone. No clock,
// but five breaths (wrong guesses) before it sinks, and three whispers (hints),
// each heard on request and each costing depth. A riddle solved gives up a page
// of the Drowned Codex, kept in the Logbook.
//
// Riddles come from every data/*.json file with a "riddles" list (the question
// bank thread's data/riddles.json; the format is app/specs/riddles-format.md),
// merged as bank.ts merges prompts. Until such a file has a playable riddle, the
// placeholders in src/content are played instead.

const dataFiles = import.meta.glob('/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

/** The depth a solve earns, by the number of whispers heard first. Giving up or running out of breath earns 0. */
export const RIDDLE_DEPTHS: readonly number[] = [1000, 700, 450, 250];
/** Wrong guesses before the riddle sinks. */
export const BREATHS = 5;
/** Whispers each riddle holds. */
export const HINTS = 3;
/** A near miss (one of the riddle's traps) is refused with its reason. It costs no breath; flip this to make it cost one. */
export const NEAR_MISS_COSTS_BREATH = false;
/** A verse has 2 to 6 lines. */
export const VERSE_LINES = { min: 2, max: 6 } as const;

// ---------------------------------------------------------------- shapes

export interface RiddleAnswer {
  answer: string;
  aliases: string[];
}

export interface RiddleTrap {
  answer: string;
  aliases: string[];
  reason: string;
}

/** A page of the Drowned Codex. */
export interface CodexPage {
  title: string;
  text: string;
}

export interface Riddle {
  id: string;
  verse: string[];
  /** Every answer is equally right. */
  answers: RiddleAnswer[];
  /** Exactly three, each nearer the answer than the last. */
  hints: string[];
  /** Near misses, refused with a reason. */
  traps: RiddleTrap[];
  /** Wrong answers listed as traps with no reason: refused like any other wrong guess. */
  decoys: string[];
  page: CodexPage;
  /** Word play, where the spelling is the answer: no typos, folding or plurals. */
  exact?: boolean;
}

export interface RiddleDay {
  date: string; // YYYY-MM-DD
  riddle: string;
}

export interface RiddleDeck {
  riddles: Riddle[];
  byId: Map<string, Riddle>;
  days: RiddleDay[];
  source: 'data' | 'placeholder';
}

export type RiddleStatus = 'playing' | 'solved' | 'sunk';

/** A refused guess, kept so it is never charged twice. */
export interface RiddleTry {
  text: string;
  /** One of the riddle's traps: refused with its reason, at no cost in breath. */
  near?: boolean;
}

/** One day's attempt, saved after every change so a reload carries on where it was. */
export interface RiddleAttempt {
  day: number;
  /** Local YYYY-MM-DD of the day. */
  date: string;
  riddleId: string;
  /** Refused guesses, in order, each said once. */
  tries: RiddleTry[];
  /** Whispers heard, 0 to 3. */
  hints: number;
  status: RiddleStatus;
  /** Sunk by giving up rather than by running out of breath. */
  gaveUp?: boolean;
  /** The accepted answer's name, and what was typed for it. */
  answer?: string;
  input?: string;
  /** The depth earned, fixed when the riddle ends. */
  metres?: number;
  /** A copy of the page given up, so the Codex keeps it if the bank changes. */
  page?: CodexPage;
  startedAt?: number;
  endedAt?: number;
}

/** What the app needs once a riddle ends. */
export interface RiddleResult {
  day: number;
  date: string;
  riddleId: string;
  status: 'solved' | 'sunk';
  gaveUp: boolean;
  /** Depth earned: 1,000, 700, 450 or 250 m when solved, 0 otherwise. Add it to the career. */
  metres: number;
  hints: number;
  breathsLeft: number;
  answer: string | null;
  /** The page of the Drowned Codex given up, or null when the riddle sank. */
  page: CodexPage | null;
}

// ---------------------------------------------------------------- loading

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/**
 * A list of spellings. A bare string is one spelling (spread as a list it would
 * become single letters), and numbers count as text, as in the bank.
 */
const forms = (v: unknown): string[] =>
  (typeof v === 'string' ? [v] : Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'number' && Number.isFinite(x) ? String(x) : x))
    .map(text)
    .filter((x): x is string => !!x);

/** Verse lines: a list, or one string with a line on each row. Blank lines are dropped. */
const linesOf = (v: unknown): string[] => (typeof v === 'string' ? v.split(/\r?\n/) : Array.isArray(v) ? v : []).map(text).filter((x): x is string => !!x);

function cleanAnswer(a: unknown): RiddleAnswer | null {
  if (typeof a === 'string') return text(a) ? { answer: a.trim(), aliases: [] } : null;
  if (!isObj(a) || !text(a.answer)) return null;
  return { answer: text(a.answer)!, aliases: forms(a.aliases) };
}

/** Traps keep their reason; one with no reason to show is still wrong, so it is refused as a decoy. */
function cleanTraps(list: unknown): { traps: RiddleTrap[]; decoys: string[] } {
  const traps: RiddleTrap[] = [];
  const decoys: string[] = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t) || !text(t.answer)) continue;
    const answer = text(t.answer)!;
    const aliases = forms(t.aliases);
    const reason = text(t.reason);
    if (reason) traps.push({ answer, aliases, reason });
    else decoys.push(answer, ...aliases);
  }
  return { traps, decoys };
}

/** A riddle as the game can play it, or null when it is malformed (the spec's shape is the contract). */
export function cleanRiddle(r: unknown): Riddle | null {
  if (!isObj(r)) return null;
  const id = text(r.id);
  const verse = linesOf(r.verse);
  const answers = (Array.isArray(r.answers) ? r.answers : []).map(cleanAnswer).filter((a): a is RiddleAnswer => !!a);
  const hints = (Array.isArray(r.hints) ? r.hints : []).map(text).filter((x): x is string => !!x);
  const page = isObj(r.page) ? { title: text(r.page.title), text: text(r.page.text) } : null;
  if (!id || verse.length < VERSE_LINES.min || verse.length > VERSE_LINES.max || !answers.length || hints.length !== HINTS) return null;
  if (!page?.title || !page.text) return null;
  const { traps, decoys } = cleanTraps(r.traps);
  return { id, verse, answers, hints, traps, decoys, page: { title: page.title, text: page.text }, ...(r.exact === true ? { exact: true } : {}) };
}

/** Riddles (first file to use an id wins) and fixed days from every file that has a "riddles" list. */
export function collectRiddles(files: unknown[]): { riddles: Riddle[]; days: RiddleDay[] } {
  const byId = new Map<string, Riddle>();
  const days: RiddleDay[] = [];
  for (const f of files) {
    if (!isObj(f) || !Array.isArray(f.riddles)) continue;
    for (const raw of f.riddles) {
      const r = cleanRiddle(raw);
      if (r && !byId.has(r.id)) byId.set(r.id, r);
    }
    for (const d of Array.isArray(f.days) ? f.days : []) {
      const date = isObj(d) ? text(d.date) : undefined;
      const riddle = isObj(d) ? text(d.riddle) : undefined;
      if (date && riddle) days.push({ date, riddle });
    }
  }
  return { riddles: [...byId.values()], days };
}

/** The deck to play: the data's riddles when it has any that can be played, the placeholders otherwise. */
export function deckFrom(files: unknown[], fallback: unknown): RiddleDeck {
  const data = collectRiddles(files);
  const use = data.riddles.length ? { ...data, source: 'data' as const } : { ...collectRiddles([fallback]), source: 'placeholder' as const };
  return { ...use, byId: new Map(use.riddles.map((r) => [r.id, r])) };
}

let loaded: RiddleDeck | null = null;

/** Today's deck, read once from data/*.json (sorted by path, like the bank). */
export function loadRiddleDeck(): RiddleDeck {
  if (loaded) return loaded;
  const files = Object.entries(dataFiles)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, v]) => v);
  loaded = deckFrom(files, placeholderRiddles);
  return loaded;
}

// ---------------------------------------------------------------- the day's riddle

const SEED = 0x5eac0de; // the sea's own code
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Fixed days by day number: known riddles only, the first entry for a date wins. */
function pinnedDays(known: Set<string>, days: RiddleDay[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const d of days) {
    const day = dayNumberForKey(d.date);
    if (day === null || out.has(day) || !known.has(d.riddle)) continue;
    out.set(day, d.riddle);
  }
  return out;
}

/**
 * The open days of one cycle and their riddles. A cycle is as many days as there
 * are riddles, and deals every riddle once: riddles fixed to a date inside the
 * cycle keep that date, and the open days are dealt the rest. With `settle`, a
 * cycle's first day is swapped with a middle day when it would repeat the day
 * before (the last day of the previous cycle, which is never moved itself).
 */
function cycleDays(ids: string[], pins: Map<number, string>, cycle: number, settle: boolean): Map<number, string> {
  const first = cycle * ids.length + 1;
  const reserved = new Set<string>();
  const open: number[] = [];
  for (let d = first; d < first + ids.length; d++) {
    const id = pins.get(d);
    if (id) reserved.add(id);
    else open.push(d);
  }
  const order = seededShuffle(
    ids.filter((id) => !reserved.has(id)),
    SEED + cycle * 7919,
  ).slice(0, open.length);
  if (settle && cycle > 0 && open[0] === first && order.length >= 3) {
    const before = pins.get(first - 1) ?? cycleDays(ids, pins, cycle - 1, false).get(first - 1);
    // A cycle deals each riddle once, so the middle one is never the one before.
    const mid = Math.floor(order.length / 2);
    if (order[0] === before) [order[0], order[mid]] = [order[mid], order[0]];
  }
  return new Map(open.map((d, i) => [d, order[i]]));
}

/**
 * The day's riddle, the same for everyone. A fixed date from the bank wins;
 * every other day comes from its cycle, so every riddle is used once before any
 * comes back. The plan is a pure function of the riddles' ids (not their order in
 * the files) and of the fixed days. Adding or removing riddles re-plans the days
 * that are not fixed, so a saved attempt keeps its own riddle id (todaysRiddle).
 *
 * `dateKey`, when given, must be the local date of `day`.
 */
export function riddleForDay(deck: { riddles: Riddle[]; days?: RiddleDay[] }, day: number, dateKey?: string): Riddle | null {
  if (!deck.riddles.length) return null;
  const byId = new Map(deck.riddles.map((r) => [r.id, r]));
  const pins = pinnedDays(new Set(byId.keys()), deck.days ?? []);
  const own = pins.get(dateKey === undefined ? day : (dayNumberForKey(dateKey) ?? NaN));
  if (own) return byId.get(own) ?? null;
  if (day < 1) return riddleForDay(deck, 1);
  const ids = [...byId.keys()].sort(byText);
  const id = cycleDays(ids, pins, Math.floor((day - 1) / ids.length), true).get(day);
  return (id && byId.get(id)) || null;
}

/**
 * The riddle to show today and the attempt to resume. A saved attempt keeps its
 * own riddle while the bank still has it, even if the plan has moved since. An
 * unfinished attempt at a riddle the bank has lost starts again on today's riddle;
 * a finished one stands, with `riddle` null (the day is done: there is nothing to show).
 */
export function todaysRiddle(deck: RiddleDeck, day: number, dateKey: string, saved?: RiddleAttempt | null): { riddle: Riddle | null; attempt: RiddleAttempt | null } {
  const mine = saved && saved.day === day ? saved : null;
  const own = mine ? deck.byId.get(mine.riddleId) : undefined;
  if (mine && own) return { riddle: own, attempt: resumeAttempt(own, mine, day) };
  if (mine && mine.status !== 'playing') return { riddle: null, attempt: mine };
  return { riddle: riddleForDay(deck, day, dateKey), attempt: null };
}

// ---------------------------------------------------------------- one attempt

const clampHints = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(HINTS, Math.floor(n))) : 0);

export function newAttempt(riddle: Riddle, day: number, date: string, now = Date.now()): RiddleAttempt {
  return { day, date, riddleId: riddle.id, tries: [], hints: 0, status: 'playing', startedAt: now };
}

/** A saved attempt made fit to play on: null when it belongs to another riddle or day. */
export function resumeAttempt(riddle: Riddle, saved: RiddleAttempt | null | undefined, day: number): RiddleAttempt | null {
  if (!saved || saved.riddleId !== riddle.id || saved.day !== day) return null;
  const a: RiddleAttempt = { ...saved, tries: saved.tries.filter((t) => !!t && typeof t.text === 'string' && !!t.text.trim()), hints: clampHints(saved.hints) };
  if (a.status === 'playing' && breathsLeft(a) <= 0) return { ...a, status: 'sunk', metres: 0 };
  if (a.status === 'solved' && !a.page) return { ...a, page: { ...riddle.page } };
  return a;
}

export const hintsHeard = (a: RiddleAttempt): number => clampHints(a.hints);
export const breathsLeft = (a: RiddleAttempt): number => Math.max(0, BREATHS - a.tries.filter((t) => !t.near).length);
/** What a solve is worth now. */
export const worthNow = (a: RiddleAttempt): number => RIDDLE_DEPTHS[hintsHeard(a)];
/** What the next whisper costs, or 0 when none are left. */
export const hintCost = (a: RiddleAttempt): number => (hintsHeard(a) < HINTS ? RIDDLE_DEPTHS[hintsHeard(a)] - RIDDLE_DEPTHS[hintsHeard(a) + 1] : 0);

/** The depth an attempt earned: its share of RIDDLE_DEPTHS when solved, 0 otherwise. */
export function riddleMetres(a: RiddleAttempt): number {
  if (a.status !== 'solved') return 0;
  return typeof a.metres === 'number' && Number.isFinite(a.metres) && a.metres >= 0 ? a.metres : worthNow(a);
}

/** A riddle's answers and traps, shaped as a daily prompt, so the daily game's matcher judges them. */
const prompts = new WeakMap<Riddle, PromptDef>();
export function riddlePrompt(r: Riddle): PromptDef {
  let p = prompts.get(r);
  if (!p) {
    p = {
      id: r.id,
      text: r.verse.join(' '),
      category: 'riddle',
      answers: r.answers.map((a) => ({ answer: a.answer, aliases: a.aliases, tier: 1 })),
      traps: r.traps,
      decoys: r.decoys,
      exact: r.exact === true ? true : undefined,
    };
    prompts.set(r, p);
  }
  return p;
}

export function matchRiddle(r: Riddle, input: string): MatchResult {
  return matchAnswer(riddlePrompt(r), input);
}

/** Two guesses are the same guess when they normalise alike ("The Wave", "wave", "waves"). */
const tryKey = (s: string) => keyOf(s) || s.trim().toLowerCase();
function sameGuess(a: string, b: string): boolean {
  const ka = tryKey(a);
  const kb = tryKey(b);
  return ka === kb || keyVariants(ka).includes(kb) || keyVariants(kb).includes(ka);
}

export type RiddleAction = { type: 'guess'; text: string } | { type: 'hint' } | { type: 'give-up' };

export type RiddleEvent =
  | { kind: 'solved'; answer: string; input: string; fuzzy: boolean; metres: number }
  | {
      kind: 'refused';
      input: string;
      /** The trap's reason, for a near miss. */
      reason: string | null;
      near: boolean;
      /** Said before: nothing more is charged. */
      again: boolean;
      breathLost: boolean;
      breathsLeft: number;
      /** That was the last breath. */
      sunk: boolean;
    }
  | { kind: 'hint'; index: number; text: string; worth: number }
  | { kind: 'gave-up' }
  /** Nothing happened: an empty guess, no whispers left, or the riddle is over. */
  | { kind: 'none' };

export interface RiddleStep {
  attempt: RiddleAttempt;
  event: RiddleEvent;
}

/**
 * One move in an attempt, as a pure function: the attempt after it, and what
 * happened. A guess is solved (every listed answer is equally right, and a typo
 * that could be either of two answers is still right), refused as a near miss
 * with the trap's reason, or refused for a breath. The same wrong guess twice is
 * charged once. Hints and giving up do what they say; nothing moves once the
 * riddle is solved or sunk.
 */
export function stepRiddle(riddle: Riddle, attempt: RiddleAttempt, action: RiddleAction, now = Date.now()): RiddleStep {
  const none: RiddleStep = { attempt, event: { kind: 'none' } };
  if (attempt.status !== 'playing') return none;

  if (action.type === 'hint') {
    const index = hintsHeard(attempt);
    if (index >= HINTS) return none;
    const next = { ...attempt, hints: index + 1 };
    return { attempt: next, event: { kind: 'hint', index, text: riddle.hints[index] ?? '', worth: worthNow(next) } };
  }

  if (action.type === 'give-up') {
    return { attempt: { ...attempt, status: 'sunk', gaveUp: true, metres: 0, endedAt: now }, event: { kind: 'gave-up' } };
  }

  const input = String(action.text ?? '').trim();
  if (!input) return none;
  const res = matchRiddle(riddle, input);
  if (res.kind === 'empty') return none;
  if (res.kind === 'accept' || res.kind === 'ambiguous') {
    const answer = res.kind === 'accept' ? res.answer.answer : res.options[0];
    const metres = worthNow(attempt);
    return {
      attempt: { ...attempt, status: 'solved', answer, input, metres, page: { ...riddle.page }, endedAt: now },
      event: { kind: 'solved', answer, input, fuzzy: res.kind === 'ambiguous' || res.fuzzy, metres },
    };
  }

  const reason = res.kind === 'trap' ? res.trap.reason : null;
  const near = reason !== null;
  if (attempt.tries.some((t) => sameGuess(t.text, input))) {
    return { attempt, event: { kind: 'refused', input, reason, near, again: true, breathLost: false, breathsLeft: breathsLeft(attempt), sunk: false } };
  }
  const free = near && !NEAR_MISS_COSTS_BREATH;
  let next: RiddleAttempt = { ...attempt, tries: [...attempt.tries, free ? { text: input, near: true } : { text: input }] };
  const left = breathsLeft(next);
  const sunk = left <= 0;
  if (sunk) next = { ...next, status: 'sunk', metres: 0, endedAt: now };
  return { attempt: next, event: { kind: 'refused', input, reason, near, again: false, breathLost: !free, breathsLeft: left, sunk } };
}

/** The result of a finished attempt, or null while it is still being played. */
export function riddleResult(a: RiddleAttempt): RiddleResult | null {
  if (a.status === 'playing') return null;
  const solved = a.status === 'solved';
  return {
    day: a.day,
    date: a.date,
    riddleId: a.riddleId,
    status: a.status,
    gaveUp: !solved && a.gaveUp === true,
    metres: riddleMetres(a),
    hints: hintsHeard(a),
    breathsLeft: breathsLeft(a),
    answer: solved ? (a.answer ?? null) : null,
    page: solved ? (a.page ?? null) : null,
  };
}

/** Metres earned by day, for every finished riddle (0 for one that sank), to fold into the career. */
export function riddleMetresByDay(saves: Record<number, RiddleAttempt>): Record<number, number> {
  const out: Record<number, number> = {};
  for (const a of Object.values(saves)) if (a && a.status !== 'playing' && Number.isInteger(a.day)) out[a.day] = riddleMetres(a);
  return out;
}

// ---------------------------------------------------------------- the Drowned Codex

export interface CodexEntry {
  riddleId: string;
  /** The day the page was first given up. */
  day: number;
  date: string;
  /** Its place in the Codex: 1 for the first page ever found. */
  folio: number;
  page: CodexPage;
  /** What it was answered with, the whispers heard first, and the depth it earned. */
  answer: string;
  hints: number;
  metres: number;
}

/**
 * Every page found so far, newest first, one per riddle (a riddle that comes round
 * again gives up no second page), and how many of the deck's pages are still lost.
 * The bank's current page is shown while it has the riddle; the copy kept with the
 * attempt otherwise.
 */
export function codexPages(deck: Pick<RiddleDeck, 'riddles' | 'byId'>, saves: Record<number, RiddleAttempt>): { pages: CodexEntry[]; found: number; lost: number } {
  const first = new Map<string, RiddleAttempt>();
  const solved = Object.values(saves)
    .filter((a) => !!a && a.status === 'solved' && Number.isInteger(a.day))
    .sort((a, b) => a.day - b.day);
  for (const a of solved) if (!first.has(a.riddleId)) first.set(a.riddleId, a);
  const pages: CodexEntry[] = [];
  for (const a of first.values()) {
    const own = deck.byId.get(a.riddleId);
    const page = own?.page ?? a.page;
    if (!page) continue;
    const answer = a.answer ?? own?.answers[0]?.answer ?? '';
    pages.push({ riddleId: a.riddleId, day: a.day, date: a.date, folio: pages.length + 1, page, answer, hints: hintsHeard(a), metres: riddleMetres(a) });
  }
  const lost = deck.riddles.filter((r) => !first.has(r.id)).length;
  return { pages: pages.reverse(), found: pages.length, lost };
}

/** The folio a riddle's page holds in the player's Codex, or the one it would take if it were solved now. */
export function codexFolio(riddle: Riddle, saves: Record<number, RiddleAttempt>): number {
  const { pages } = codexPages({ riddles: [riddle], byId: new Map([[riddle.id, riddle]]) }, saves);
  return pages.find((p) => p.riddleId === riddle.id)?.folio ?? pages.length + 1;
}
