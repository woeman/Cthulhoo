// The Convocation (a class-sized séance): shapes shared by the game in the
// browser and the surface relay. Nothing here may touch the DOM or the bundler.
//
// It differs from the Séance where a class differs from a circle of friends:
// one device hosts and never answers (the big screen), the divers may be a
// hundred or more, and nobody but the host is ever sent the answers or the
// whole roll. The relay hears every answer itself.

import type { PromptDef } from '../game/types';
import type { CandlePrompt, Verdict } from './types';

/** Divers one convocation holds. */
export const CLASS_MAX_SEATS = 300;
/** Tables a class may be split into; 0 is every diver alone. */
export const CLASS_TABLES = [0, 2, 3, 4, 5, 6, 8] as const;
export const CLASS_MAX_TABLES = 8;

/**
 * How a question is played. Classic: one answer each, as in the Séance.
 * Blitz: as many different answers as a diver can give before the time is out.
 */
export type ClassMode = 'classic' | 'blitz';
export const CLASS_MODES: readonly ClassMode[] = ['classic', 'blitz'];
/** Seconds a question may burn, by mode: the first is the usual. */
export const CLASS_SECONDS: Record<ClassMode, readonly number[]> = {
  classic: [30, 20, 45, 60],
  blitz: [60, 90, 120],
};
export const CLASS_QUESTIONS = [3, 5, 7, 10] as const;

export type ClassPhase = 'lobby' | 'asking' | 'reveal' | 'ended';

export interface ClassConfig {
  mode: ClassMode;
  seconds: number;
  /** Tables competing; 0 for every diver alone. */
  tables: number;
  /** How many questions the host means to ask ("Question 3 of 7"). */
  questions: number;
  /** The names of the topics the host chose, for the class to read. */
  topics?: string[];
}

export const DEFAULT_CLASS_CONFIG: ClassConfig = { mode: 'classic', seconds: 30, tables: 0, questions: 5 };

/** A diver as the host's roll shows them. */
export interface ClassSeatPublic {
  id: string;
  name: string;
  online: boolean;
  /** Their table, from 1; 0 when the class has no tables. */
  table: number;
  total: number;
  /** Whether they have answered the question being asked. */
  answered: boolean;
}

/** One answer the class gave, once the answers surface. */
export interface ClassAnswerRow {
  answer: string;
  tier: number;
  /** How many divers gave it. 1 is a lone voice. */
  voices: number;
  /** The first few who gave it. */
  names: string[];
  /** Metres it sank each diver who gave it. */
  depth: number;
}

/** What one table won on a question: its deepest different answers. */
export interface ClassTableGain {
  table: number;
  gain: number;
  total: number;
  counted: Array<{ answer: string; tier: number; depth: number; lone: boolean }>;
}

/** A question once its answers have surfaced: what anyone may see. */
export interface ClassResult {
  n: number;
  mode: ClassMode;
  prompt: CandlePrompt;
  /** The answers given, rarest first; cut to what the reader's screen holds. */
  answers: ClassAnswerRow[];
  /** How many different answers the class gave, and how many the deep knew. */
  given: number;
  known: number;
  /** The rarest answers nobody gave. */
  unsaid: Array<{ answer: string; tier: number }>;
  /** Divers who were here and gave nothing. */
  silent: number;
  /** Divers who answered. */
  spoke: number;
  /** With tables: what each won, deepest first. */
  tables?: ClassTableGain[];
}

export interface ClassStanding {
  id: string;
  name: string;
  table: number;
  total: number;
  /** Metres won on the question last revealed. */
  gain: number;
  /** 1 is the deepest; equal totals share a place. */
  rank: number;
}

/** What a diver gave to one question, once it is revealed. */
export interface ClassOutcome {
  answers: Array<{ input: string; answer: string; tier: number; voices: number; depth: number }>;
  gain: number;
}

/** A diver's own corner of the view. */
export interface ClassYou {
  id: string;
  name: string;
  table: number;
  total: number;
  rank: number;
  /** What they have had sealed for the question being asked: what they typed and what it was taken as. */
  sealed: Array<{ input: string; answer: string }>;
  /** What the deep refused, for the question being asked. */
  tries: string[];
  /** Once revealed. */
  outcome?: ClassOutcome;
}

/** Everything one device is shown. */
export interface ClassView {
  sign: string;
  role: 'host' | 'seat';
  phase: ClassPhase;
  config: ClassConfig;
  /** The question being asked or last revealed, from 1; 0 before the first. */
  n: number;
  prompt: CandlePrompt | null;
  /** Relay clock: when the question has risen and may be answered, and when its time is out. */
  litAt: number;
  deadline: number;
  /** Divers seated, divers whose line is up, and divers who have answered the question being asked. */
  seats: number;
  here: number;
  answered: number;
  /** Every answer the deep has taken on the question being asked: in a blitz, far more than the divers. */
  said: number;
  /** Members by table, [0] unused, when the class has tables. */
  tableSeats?: number[];
  /** Metres by table, [0] unused. */
  tableTotals?: number[];
  result?: ClassResult;
  /** The deepest divers: all of them for the host, a few for a diver. */
  standings?: ClassStanding[];
  you?: ClassYou;
  /** The host's roll: everyone, in the order they sat down. */
  roll?: ClassSeatPublic[];
  /** The relay's clock when this was sent, to set ours by. */
  now: number;
}

export type ClassClientMsg =
  | { t: 'host'; key: string }
  | { t: 'hello'; id: string; name: string; rejoin?: boolean }
  | { t: 'config'; mode: ClassMode; seconds: number; tables: number; questions: number; topics?: string[] }
  | { t: 'ask'; prompt: PromptDef; depths: number[] }
  | { t: 'reveal' }
  | { t: 'end' }
  | { t: 'again' }
  | { t: 'remove'; id: string }
  | { t: 'say'; text: string }
  | { t: 'table'; table: number }
  | { t: 'leave' };

export type ClassErrorCode = 'full' | 'gone' | 'name' | 'host' | 'phase' | 'bad' | 'late' | 'sealed' | 'removed';

export type ClassVerdict = Verdict | 'said';

export type ClassServerMsg =
  | { t: 'view'; view: ClassView }
  /** As the class answers or comes and goes: to the host at once, to the divers now and then. */
  | { t: 'count'; seats: number; here: number; answered: number; said: number; tableSeats?: number[] }
  | { t: 'seat'; seat: ClassSeatPublic; tableSeats?: number[] }
  | { t: 'gone'; id: string; tableSeats?: number[] }
  /** To a diver: the deep took the answer. `sealed` is everything of theirs sealed so far. */
  | { t: 'heard'; input: string; answer: string; sealed: number }
  | { t: 'refused'; text: string; verdict: ClassVerdict; reason?: string }
  | { t: 'error'; code: ClassErrorCode; message: string };
