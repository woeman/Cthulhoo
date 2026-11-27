// Pass the lantern: the Séance on one device, handed round the circle. Each
// sitter takes the device in turn and has their own candle; when every voice
// is sealed, the answers surface together. Same rules and scoring as a séance
// on the relay, kept in a small state that a reload can pick up.

import type { PromptDef } from '../game/types';
import { RISE_MS, cleanName, hear, heraldsOf, scoreCandle, type Heard, type Seal } from './room';
import { DEFAULT_CONFIG, NAME_MAX, SPEAK_MAX, type CandleResult, type SeanceConfig } from './types';

export const PASS_MIN = 2;
export const PASS_MAX = 8;

export type PassPhase = 'setup' | 'pass' | 'speak' | 'sealed' | 'reveal' | 'ended';

export interface PassSitter {
  id: string;
  name: string;
  mark: number;
}

export interface PassState {
  v: 1;
  phase: PassPhase;
  config: SeanceConfig;
  sitters: PassSitter[];
  promptIds: string[];
  /** Metres for each tier, [0] silence. */
  depths: number[];
  candle: number;
  /** Place in this candle's order of whoever holds the lantern. */
  turn: number;
  /** When the holder's candle catches (after the question has risen), in ms. */
  litAt: number;
  seals: Record<string, Seal>;
  tries: Record<string, string[]>;
  results: CandleResult[];
  totals: Record<string, number>;
  heralds: string[];
}

export function newPass(): PassState {
  return {
    v: 1,
    phase: 'setup',
    config: { ...DEFAULT_CONFIG },
    sitters: [],
    promptIds: [],
    depths: [0, 0, 0, 0, 0, 0, 0],
    candle: -1,
    turn: 0,
    litAt: 0,
    seals: {},
    tries: {},
    results: [],
    totals: {},
    heralds: [],
  };
}

/** Add a sitter by name. Returns the reason when the circle will not take them. */
export function addSitter(s: PassState, raw: string): string | null {
  if (s.phase !== 'setup') return 'The candles are already lit.';
  if (s.sitters.length >= PASS_MAX) return `${PASS_MAX} is as many as can share one lantern.`;
  const name = cleanName(raw).slice(0, NAME_MAX);
  if (!name) return 'Give them a name to be called by.';
  if (s.sitters.some((x) => x.name.toLowerCase() === name.toLowerCase())) return `${name} is already sitting.`;
  const used = new Set(s.sitters.map((x) => x.mark));
  let mark = 0;
  while (used.has(mark)) mark++;
  s.sitters.push({ id: `p${Date.now().toString(36)}${s.sitters.length}${Math.floor(Math.random() * 1e6).toString(36)}`, name, mark });
  return null;
}

export function removeSitter(s: PassState, id: string): void {
  if (s.phase === 'setup') s.sitters = s.sitters.filter((x) => x.id !== id);
}

/** The order the lantern goes round for a candle: it starts one seat further on each time. */
export function orderFor(s: PassState, candle = s.candle): PassSitter[] {
  const n = s.sitters.length;
  if (!n) return [];
  const k = ((candle % n) + n) % n;
  return [...s.sitters.slice(k), ...s.sitters.slice(0, k)];
}

/** Whoever holds the lantern now, or null between turns. */
export function holder(s: PassState): PassSitter | null {
  return s.phase === 'pass' || s.phase === 'speak' || s.phase === 'sealed' ? (orderFor(s)[s.turn] ?? null) : null;
}

export function startPass(s: PassState, promptIds: string[], depths: number[], config: SeanceConfig = s.config): string | null {
  if (s.phase !== 'setup') return 'The candles are already lit.';
  if (s.sitters.length < PASS_MIN) return `A séance needs at least ${PASS_MIN} sitters.`;
  if (!promptIds.length) return 'The deep has nothing to ask.';
  s.config = { ...config };
  s.promptIds = promptIds.slice(0, config.candles);
  s.depths = depths.slice(0, 7);
  s.results = [];
  s.heralds = [];
  s.totals = Object.fromEntries(s.sitters.map((x) => [x.id, 0]));
  s.candle = 0;
  s.turn = 0;
  s.seals = {};
  s.tries = {};
  s.phase = 'pass';
  return null;
}

/** The sitter takes the lantern: the question rises and their candle catches. */
export function takeLantern(s: PassState, now: number): void {
  if (s.phase !== 'pass') return;
  s.phase = 'speak';
  s.litAt = now + RISE_MS;
}

/** When the holder's candle goes out. */
export const candleOut = (s: PassState): number => s.litAt + s.config.seconds * 1000;

export function speakPass(s: PassState, prompt: PromptDef, text: string, now: number): Heard | null {
  const who = holder(s);
  if (s.phase !== 'speak' || !who) return null;
  const said = text.trim().slice(0, SPEAK_MAX);
  const heard = hear(prompt, said);
  if (heard.kind === 'refused') {
    const tries = (s.tries[who.id] ??= []);
    if (!tries.some((t) => t.toLowerCase() === said.toLowerCase())) tries.push(said);
  } else if (heard.kind === 'sealed') {
    s.seals[who.id] = { sitter: who.id, input: said, answer: heard.answer, tier: heard.tier, at: now };
    s.phase = 'sealed';
  }
  return heard;
}

/** The holder's candle went out before they sealed anything. */
export function gutter(s: PassState): void {
  if (s.phase === 'speak') s.phase = 'sealed';
}

/** Hand the lantern on; after the last sitter, the answers surface. */
export function passOn(s: PassState, prompt: PromptDef): void {
  if (s.phase !== 'sealed') return;
  if (s.turn + 1 < s.sitters.length) {
    s.turn++;
    s.phase = 'pass';
    return;
  }
  const result = scoreCandle(prompt, s.sitters.map((x) => x.id), s.seals, s.depths);
  s.results.push(result);
  for (const v of result.voices) s.totals[v.sitter] = (s.totals[v.sitter] ?? 0) + v.depth;
  s.phase = 'reveal';
}

/** After the reveal: the next candle, or the last rites. */
export function nextCandle(s: PassState): void {
  if (s.phase !== 'reveal') return;
  if (s.candle + 1 < s.promptIds.length) {
    s.candle++;
    s.turn = 0;
    s.seals = {};
    s.tries = {};
    s.phase = 'pass';
  } else {
    s.phase = 'ended';
    s.heralds = heraldsOf(s.totals, s.sitters.map((x) => x.id));
  }
}

/** The same circle sits again. */
export function againPass(s: PassState): void {
  const sitters = s.sitters;
  const config = s.config;
  Object.assign(s, newPass(), { sitters, config });
}

/** A saved pass-and-play séance, if it is one this code can still run. */
export function revivePass(raw: unknown): PassState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as PassState;
  return r.v === 1 && Array.isArray(r.sitters) && Array.isArray(r.promptIds) && typeof r.phase === 'string' ? r : null;
}
