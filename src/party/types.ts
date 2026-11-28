// The Séance: shapes shared by the game in the browser and the surface relay
// (a Cloudflare Worker). Nothing here may touch the DOM or the bundler.

import type { PromptDef } from '../game/types';

export const MAX_SITTERS = 12;
export const MAX_TABLES = 4;
export const CANDLE_CHOICES = [3, 5, 7] as const;
export const SECONDS_CHOICES = [20, 30, 45] as const;
export const DEFAULT_CONFIG: SeanceConfig = { candles: 5, seconds: 30 };
export const NAME_MAX = 16;
export const SPEAK_MAX = 80;

export type Phase = 'lobby' | 'candle' | 'reveal' | 'ended';

export interface SeanceConfig {
  /** How many questions: one candle each. */
  candles: number;
  /** How long each candle burns. */
  seconds: number;
  /** The names of the topics the medium chose, for the circle to read. Absent for the whole daily deep. */
  topics?: string[];
}

/** Topic names one room shows, and how long each may be. */
export const TOPIC_NAMES_MAX = 24;
export const TOPIC_NAME_MAX = 24;

export interface Sitter {
  id: string;
  name: string;
  /** Which glyph of the Drowned Script is theirs, by join order. */
  mark: number;
  joined: number;
  online: boolean;
  /** A shared screen: it shows the circle and never answers. */
  table: boolean;
}

/** The question while its candle burns: never its answers. */
export interface CandlePrompt {
  id: string;
  text: string;
  category: string;
  rules?: string;
  flavor?: string;
  /** A class pack's question: the pack's name, shown in place of the category's. */
  topic?: string;
}

/** One sitter's answer, once the answers surface. */
export interface Voice {
  sitter: string;
  /** What they typed, or null if the candle went out first. */
  input: string | null;
  /** The answer it was taken as. */
  answer: string | null;
  /** 0 is silence. */
  tier: number;
  /** How many of the circle gave this same answer. 1 is a lone voice. */
  voices: number;
  /** Metres this candle sank them. */
  depth: number;
}

export interface CandleResult {
  prompt: CandlePrompt;
  /** Deepest first. */
  voices: Voice[];
  /** The rarest answers nobody gave: what the deep knew. */
  unsaid: Array<{ answer: string; tier: number }>;
}

export interface YourSeal {
  input: string;
  answer: string;
  tier: number;
}

/** Everything one device is shown. Answers stay sealed until the candle is out. */
export interface SeanceView {
  sign: string;
  phase: Phase;
  config: SeanceConfig;
  /** The sitter who lights the candles: the first to arrive who is still here. */
  medium: string | null;
  /** This device's sitter id. */
  you: string;
  sitters: Sitter[];
  /** The candle burning or last burnt, from 0; -1 before the first. */
  candle: number;
  prompt: CandlePrompt | null;
  /** Relay clock: when the words have risen and the candle catches, and when it goes out. */
  litAt: number;
  deadline: number;
  /** Who has sealed an answer this candle. */
  sealed: string[];
  yours: YourSeal | null;
  /** What this sitter has said this candle that the deep refused. */
  tries: string[];
  results: CandleResult[];
  totals: Record<string, number>;
  /** At the end: the deepest of the circle, more than one on a tie. */
  heralds: string[];
  /** The relay's clock when this was sent, to set ours by. */
  now: number;
}

export type Verdict = 'unknown' | 'decoy' | 'trap' | 'ambiguous';

export type ClientMsg =
  | { t: 'hello'; id: string; name: string; table?: boolean; rejoin?: boolean }
  | { t: 'config'; candles: number; seconds: number; topics?: string[] }
  | { t: 'begin'; prompts: PromptDef[]; depths: number[] }
  | { t: 'speak'; text: string }
  | { t: 'next' }
  | { t: 'again' }
  | { t: 'leave' };

export type ErrorCode = 'full' | 'gone' | 'name' | 'medium' | 'phase' | 'bad' | 'late' | 'sealed';

export type ServerMsg =
  | { t: 'view'; view: SeanceView }
  | { t: 'refused'; text: string; verdict: Verdict; reason?: string }
  | { t: 'error'; code: ErrorCode; message: string };
