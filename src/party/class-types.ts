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
 * Last (last diver standing): the tables, or the divers when there are no
 * tables, take turns naming an answer nobody has said yet. A repeat, or a turn
 * that runs out, puts out one of the side's lanterns; the last side with one
 * still lit wins the bout.
 */
export type ClassMode = 'classic' | 'blitz' | 'last';
export const CLASS_MODES: readonly ClassMode[] = ['classic', 'blitz', 'last'];
/** Seconds a question may burn, by mode (in a bout of last diver standing: seconds a turn): the first is the usual. */
export const CLASS_SECONDS: Record<ClassMode, readonly number[]> = {
  classic: [30, 20, 45, 60],
  blitz: [60, 90, 120],
  last: [15, 10, 20, 30],
};
export const CLASS_QUESTIONS = [3, 5, 7, 10] as const;
/** Lanterns each side of a bout begins with: the first is the usual. */
export const CLASS_LANTERNS = [3, 2, 1] as const;
/** Without tables every diver is a side, and each waits a whole round for a turn: a bout takes this many at most. */
export const LAST_MAX_ALONE = 12;

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
  /** Last diver standing: the lanterns each side begins a bout with. Absent, the usual. */
  lanterns?: number;
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
  /** Last diver standing: what it won for standing last, already part of `gain`. */
  bonus?: number;
}

// ------------------------------------------------------- last diver standing

/** One side of a bout: a table, or one diver when the class has no tables. */
export interface ClassLastSide {
  /** The table's number; 0 when the side is one diver. */
  table: number;
  /** The diver, when the side is one diver. */
  id?: string;
  name?: string;
  /** Lanterns still lit: none, and the side is out. */
  lanterns: number;
  /** Answers it has named in this bout, and the metres they sank it. */
  said: number;
  gain: number;
}

/** What the last turn came to, for the screens to show a moment. `side` is a place in the bout's sides. */
export type ClassLastBeat =
  | { kind: 'said'; side: number; name: string; answer: string; tier: number; depth: number }
  | { kind: 'repeat'; side: number; name: string; answer: string }
  /** The turn ran out. */
  | { kind: 'dark'; side: number }
  /** Nobody of the side was here for its turn: it was waited for a moment only, and it costs a lantern all the same. */
  | { kind: 'away'; side: number };

/**
 * How a bout ended: one side left standing, nobody left, every answer named,
 * too many turns, or the host calling it.
 */
export type ClassLastEnd = 'last' | 'none' | 'dry' | 'cap' | 'host';

/** A bout as it stands, for every screen. */
export interface ClassLastView {
  /** The sides in the order they take their turns. */
  sides: ClassLastSide[];
  /** Whose turn it is, as a place in `sides`; -1 once the bout is over. */
  turn: number;
  /** Turns taken so far. */
  turnN: number;
  /** Relay clock: when this turn may be answered, and when its time is out. */
  turnLit: number;
  turnEnds: number;
  /** The lanterns each side began with. */
  lanterns: number;
  /** The answers named so far, newest first: all of them for the host, the newest few for a diver. */
  said: Array<{ answer: string; tier: number; side: number }>;
  /** How many have been named in all, and how many the deep still holds. */
  saidN: number;
  left: number;
  /** Nobody of the side whose turn it is was here when it came: it is waited for a moment only. */
  away?: boolean;
  beat?: ClassLastBeat;
  /** Once the bout is over: how, and the side that stood last (-1 when none did). */
  ended?: ClassLastEnd;
  winner?: number;
}

/** A bout once it is over, as part of the question's result. */
export interface ClassLastResult {
  ended: ClassLastEnd;
  /** The sides, in the order they took their turns, as the bout left them. */
  sides: ClassLastSide[];
  /** The side that stood last, as a place in `sides`; -1 when none did. */
  winner: number;
  /** The metres standing last won. */
  bonus: number;
  turns: number;
  lanterns: number;
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
  /** Last diver standing: how the bout went. */
  last?: ClassLastResult;
}

/** One diver's line in a question's ledger: everything they gave to it. */
export interface ClassLedgerRow {
  id: string;
  name: string;
  /** Their table, from 1; 0 when the class has no tables. */
  table: number;
  /** Whether their line was up when the ledger was drawn. */
  here: boolean;
  /** What they gave, in the order given: a place in the ledger's `answers`, and what they typed (empty when it reads as the answer). */
  said: Array<[number, string]>;
  /** What the deep refused of theirs: the last few, oldest first. */
  tries: string[];
  /** Metres won on this question, and their depth after it. */
  gain: number;
  total: number;
}

/**
 * A question once its answers have surfaced, in full, for the host alone: who
 * gave what. The host's device keeps these as the record of the class (the
 * relay keeps a question only until the next is asked).
 */
export interface ClassLedger {
  /** When the class was opened, its round (from 1) and the question: a host keeps each ledger once. */
  born: number;
  round: number;
  n: number;
  /** Every different answer given, rarest first. */
  answers: Array<{ answer: string; tier: number; voices: number; depth: number }>;
  /** Every diver seated, in the order they sat down. */
  rows: ClassLedgerRow[];
  /** A class too busy for one message: the refused answers were left out, or those and what was typed. */
  cut?: 'tries' | 'typed';
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
  /** Last diver standing, while a bout is on. */
  last?: ClassLastView;
  result?: ClassResult;
  /** The deepest divers: all of them for the host, a few for a diver. */
  standings?: ClassStanding[];
  you?: ClassYou;
  /** The host's roll: everyone, in the order they sat down. */
  roll?: ClassSeatPublic[];
  /** The host's alone, once the answers have surfaced: the question in full, to keep. Absent from a relay older than the ledger. */
  ledger?: ClassLedger;
  /** The relay's clock when this was sent, to set ours by. */
  now: number;
}

export type ClassClientMsg =
  | { t: 'host'; key: string }
  | { t: 'hello'; id: string; name: string; rejoin?: boolean }
  | { t: 'config'; mode: ClassMode; seconds: number; tables: number; questions: number; topics?: string[]; lanterns?: number }
  | { t: 'ask'; prompt: PromptDef; depths: number[] }
  | { t: 'reveal' }
  | { t: 'end' }
  | { t: 'again' }
  | { t: 'remove'; id: string }
  | { t: 'say'; text: string }
  | { t: 'table'; table: number }
  | { t: 'leave' };

export type ClassErrorCode = 'full' | 'gone' | 'name' | 'host' | 'phase' | 'bad' | 'late' | 'sealed' | 'removed';

/**
 * Why an answer was not taken. Beyond the daily's own: 'said' (this diver gave it
 * already), and in a bout of last diver standing 'wait' (it is not their turn,
 * or they only watch this bout) and 'burnt' (it had been named: a lantern is out).
 */
export type ClassVerdict = Verdict | 'said' | 'wait' | 'burnt';

export type ClassServerMsg =
  | { t: 'view'; view: ClassView }
  /** As the class answers or comes and goes: to the host at once, to the divers now and then. */
  | { t: 'count'; seats: number; here: number; answered: number; said: number; tableSeats?: number[] }
  | { t: 'seat'; seat: ClassSeatPublic; tableSeats?: number[] }
  | { t: 'gone'; id: string; tableSeats?: number[] }
  /** Last diver standing: a turn has passed. Everyone is told at once. */
  | { t: 'turn'; last: ClassLastView; seats: number; here: number; answered: number; said: number; now: number }
  /** To a diver: the deep took the answer. `sealed` is everything of theirs sealed so far. */
  | { t: 'heard'; input: string; answer: string; sealed: number }
  | { t: 'refused'; text: string; verdict: ClassVerdict; reason?: string }
  | { t: 'error'; code: ClassErrorCode; message: string };
