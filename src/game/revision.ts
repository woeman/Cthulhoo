// Revision dives: one class pack studied alone, before an exam. A question at
// a time, the diver names every answer they can. Each answer sinks them its
// tier's depth, and the floor of a question is the game's own floor at 7,000 m
// (or the whole list, when the list is too short to reach it). Then the deep
// shows what they missed. The deepest they have been on each question is kept
// on the device, so the next sitting begins with the questions they know least.
// Nothing here touches the DOM or storage.

import { FLOOR_DEPTH } from './scoring';
import type { AnswerDef, PromptDef } from './types';

/** Seconds a revision question may burn; 0 is no candle, and the first is the usual. */
export const REVISION_CANDLES = [0, 60, 120] as const;
/** Named answers remembered for one question. */
export const KNOWN_MAX = 300;
/** Questions one device remembers. */
const BOOK_MAX = 2000;

/** What a device remembers of one question. */
export interface RevisionRecord {
  /** The class pack it belongs to. */
  pack: string;
  /** The deepest reached in one sitting, never deeper than the floor. */
  depth: number;
  /** The question's floor when that was reached. */
  floor: number;
  /** The most answers named in one sitting. */
  named: number;
  /** Answers named in any sitting, by their own spelling in the list: the newest first. */
  known: string[];
  /** Sittings finished, and the day number of the last. */
  sittings: number;
  last: number;
}

export type RevisionBook = Record<string, RevisionRecord>;

/** A tier's depth in metres, from the theme. */
export type DepthOf = (tier: number) => number;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const whole = (v: unknown, max: number): number => (isNum(v) ? Math.max(0, Math.min(max, Math.round(v))) : 0);

/** What was kept, checked: anything damaged is dropped rather than trusted. */
export function cleanRevisionBook(raw: unknown): RevisionBook {
  const out: RevisionBook = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  let n = 0;
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!v || typeof v !== 'object' || Array.isArray(v) || n >= BOOK_MAX) continue;
    const r = v as Record<string, unknown>;
    if (typeof r.pack !== 'string' || !r.pack || !id.startsWith(`${r.pack}-`)) continue;
    const floor = whole(r.floor, FLOOR_DEPTH);
    if (!floor) continue;
    out[id] = {
      pack: r.pack,
      depth: Math.min(whole(r.depth, FLOOR_DEPTH), floor),
      floor,
      named: whole(r.named, 100_000),
      known: Array.isArray(r.known) ? r.known.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 120).slice(0, KNOWN_MAX) : [],
      sittings: Math.max(1, whole(r.sittings, 100_000)),
      last: whole(r.last, 10_000_000),
    };
    n++;
  }
  return out;
}

/**
 * How deep a question goes: the game's floor, or the depth of its whole list
 * when that is shallower (seventeen global goals cannot reach 7,000 m).
 */
export function floorOf(prompt: Pick<PromptDef, 'answers'>, depthOf: DepthOf): number {
  let sum = 0;
  for (const a of prompt.answers) {
    sum += depthOf(a.tier);
    if (sum >= FLOOR_DEPTH) return FLOOR_DEPTH;
  }
  return sum;
}

/** The answers of a question by their own spelling. */
function bySpelling(prompt: Pick<PromptDef, 'answers'>): Map<string, AnswerDef> {
  return new Map(prompt.answers.map((a) => [a.answer, a]));
}

/** How deep a set of named answers sinks a diver, never deeper than the question's floor. */
export function depthNamed(prompt: Pick<PromptDef, 'answers'>, named: Iterable<string>, depthOf: DepthOf): number {
  const list = bySpelling(prompt);
  let sum = 0;
  for (const name of new Set(named)) sum += depthOf(list.get(name)?.tier ?? 0);
  return Math.min(sum, floorOf(prompt, depthOf));
}

export interface SittingResult {
  /** Answers named this sitting, and how many the list holds. */
  named: number;
  total: number;
  /** How deep this sitting went, and the question's floor. */
  depth: number;
  floor: number;
  /** Whether this sitting touched the floor. */
  fathomed: boolean;
  /** The deepest before this sitting; 0 on the first. */
  depthBefore: number;
  /** The first sitting on this question. */
  first: boolean;
  /** Deeper than any sitting before it (never said of the first). */
  deeper: boolean;
  /** Named today for the first time. */
  fresh: string[];
  /** Named in an earlier sitting and not today. */
  slipped: string[];
  /** What to keep. */
  record: RevisionRecord;
}

/**
 * A sitting on one question is over. `named` are the answers given, by their
 * own spelling in the list, in the order given.
 */
export function closeSitting(prompt: Pick<PromptDef, 'id' | 'answers'>, pack: string, named: string[], before: RevisionRecord | undefined, today: number, depthOf: DepthOf): SittingResult {
  const list = bySpelling(prompt);
  const given = [...new Set(named)].filter((a) => list.has(a));
  const said = new Set(given);
  const floor = floorOf(prompt, depthOf);
  const depth = depthNamed(prompt, given, depthOf);
  const knownBefore = (before?.known ?? []).filter((a) => list.has(a));
  const was = new Set(knownBefore);
  // A list can lose depth when the bank changes: the old best is never deeper than today's floor.
  const depthBefore = Math.min(before?.depth ?? 0, floor);
  const record: RevisionRecord = {
    pack,
    depth: Math.max(depthBefore, depth),
    floor,
    named: Math.max(before?.named ?? 0, given.length),
    // Today's first, so the oldest are the ones let go when there are too many.
    known: [...given.slice().reverse(), ...knownBefore.filter((a) => !said.has(a))].slice(0, KNOWN_MAX),
    sittings: (before?.sittings ?? 0) + 1,
    last: today,
  };
  return {
    named: given.length,
    total: prompt.answers.length,
    depth,
    floor,
    fathomed: floor > 0 && depth >= floor,
    depthBefore,
    first: !before,
    deeper: !!before && depth > depthBefore,
    fresh: given.filter((a) => !was.has(a)),
    slipped: knownBefore.filter((a) => !said.has(a)),
    record,
  };
}

export interface MissedTier {
  tier: number;
  /** Answers of this tier in the list, and how many of them were not named. */
  of: number;
  missed: number;
  /** The first of those not named, in the list's own order. */
  answers: AnswerDef[];
}

/**
 * What was not named, tier by tier, the commonest tier first: what everybody
 * says is what an exam asks first. Each tier's list is cut to `max`.
 */
export function missedByTier(prompt: Pick<PromptDef, 'answers'>, named: Iterable<string>, max = Infinity): MissedTier[] {
  const said = new Set(named);
  const tiers = new Map<number, MissedTier>();
  for (const a of prompt.answers) {
    let t = tiers.get(a.tier);
    if (!t) tiers.set(a.tier, (t = { tier: a.tier, of: 0, missed: 0, answers: [] }));
    t.of++;
    if (said.has(a.answer)) continue;
    t.missed++;
    if (t.answers.length < max) t.answers.push(a);
  }
  return [...tiers.values()].sort((a, b) => a.tier - b.tier);
}

export interface PackProgress {
  /** Questions in the pack, how many have had a sitting, and how many have been taken to their floor. */
  questions: number;
  revised: number;
  fathomed: number;
  /** How far down the pack has been taken: each question's deepest as a share of its floor, averaged. 0 to 1. */
  share: number;
  /** The day number of the last sitting on any of them; 0 when there has been none. */
  last: number;
}

const shareOf = (r: RevisionRecord | undefined): number => (r && r.floor > 0 ? Math.min(1, r.depth / r.floor) : 0);

/** A pack's progress from what is kept, when its questions have not been fetched: `questions` is the index's count. */
export function packProgress(packId: string, questions: number, book: RevisionBook): PackProgress {
  const mine = Object.values(book).filter((r) => r.pack === packId);
  const n = Math.max(questions, mine.length, 1);
  return {
    questions: Math.max(questions, mine.length),
    revised: mine.length,
    fathomed: mine.filter((r) => shareOf(r) >= 1).length,
    share: mine.reduce((s, r) => s + shareOf(r), 0) / n,
    last: mine.reduce((d, r) => Math.max(d, r.last), 0),
  };
}

/**
 * The order a pack is revised in: questions never sat first, in the pack's own
 * order; then the shallowest; then the longest left alone.
 */
export function revisionOrder<T extends Pick<PromptDef, 'id'>>(prompts: T[], book: RevisionBook): T[] {
  return prompts
    .map((p, i) => ({ p, i, r: book[p.id] }))
    .sort((a, b) => {
      if (!a.r || !b.r) return a.r ? 1 : b.r ? -1 : a.i - b.i;
      return shareOf(a.r) - shareOf(b.r) || a.r.last - b.r.last || a.i - b.i;
    })
    .map((x) => x.p);
}

/** How long ago a day was, in words: "today", "yesterday", "5 days ago". */
export function agoWords(day: number, today: number): string {
  const d = Math.max(0, today - day);
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}
