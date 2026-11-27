// The Séance's rules, as pure functions over one room. The surface relay runs
// them for a séance across many devices; pass-and-play uses the scoring alone.
// Nothing here may touch the DOM or the bundler: the relay imports this file.

import { matchAnswer } from '../game/matcher';
import type { AnswerDef, PromptDef, TrapDef } from '../game/types';
import {
  CANDLE_CHOICES,
  DEFAULT_CONFIG,
  MAX_SITTERS,
  MAX_TABLES,
  NAME_MAX,
  SECONDS_CHOICES,
  SPEAK_MAX,
  type CandlePrompt,
  type CandleResult,
  type ErrorCode,
  type Phase,
  type SeanceConfig,
  type SeanceView,
  type Sitter,
  type Verdict,
  type Voice,
} from './types';

/** A lone voice sinks half as deep again. A chorus splits its depth between its voices. */
export const LONE_BONUS = 1.5;
/** The question rises before its candle catches. */
export const RISE_MS = 1400;
/** An answer already on its way when the candle gutters still counts. */
export const GRACE_MS = 800;
/** How many unsaid answers the reveal shows. */
export const UNSAID_SHOWN = 3;
/** A room nobody has touched for this long is forgotten. */
export const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
/** The Drowned Script has this many glyphs for the circle's marks. */
export const MARKS = 12;

const round10 = (n: number) => Math.round(n / 10) * 10;
const fold = (s: string) => s.toLowerCase();

export interface Seal {
  sitter: string;
  input: string;
  answer: string;
  tier: number;
  at: number;
}

export interface Room {
  v: 1;
  sign: string;
  created: number;
  touched: number;
  phase: Phase;
  config: SeanceConfig;
  /** In the order they arrived. */
  sitters: Sitter[];
  prompts: PromptDef[];
  /** Metres for each tier, by tier number; [0] is silence. */
  depths: number[];
  candle: number;
  litAt: number;
  deadline: number;
  /** Who may answer the candle that burns: the circle when it was lit, and anyone who sat down since. */
  circle: string[];
  seals: Record<string, Seal>;
  tries: Record<string, string[]>;
  results: CandleResult[];
  totals: Record<string, number>;
  heralds: string[];
  nextMark: number;
}

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; code: ErrorCode; message: string };

const fail = (code: ErrorCode, message: string): { ok: false; code: ErrorCode; message: string } => ({ ok: false, code, message });

// ------------------------------------------------------------------ scoring

export function candleDepth(base: number, voices: number): number {
  if (!(base > 0) || !(voices > 0)) return 0;
  return round10(voices === 1 ? base * LONE_BONUS : base / voices);
}

export type Heard = { kind: 'sealed'; answer: string; tier: number } | { kind: 'refused'; verdict: Verdict; reason?: string } | { kind: 'empty' };

/** Say an answer to the deep: it is sealed if the deep takes it, refused if not. */
export function hear(prompt: PromptDef, text: string): Heard {
  const res = matchAnswer(prompt, text);
  switch (res.kind) {
    case 'accept':
      return { kind: 'sealed', answer: res.answer.answer, tier: res.answer.tier };
    case 'trap':
      return { kind: 'refused', verdict: 'trap', reason: res.trap.reason };
    case 'decoy':
      return { kind: 'refused', verdict: 'decoy' };
    case 'ambiguous':
      return { kind: 'refused', verdict: 'ambiguous', reason: `Did you mean ${res.options.slice(0, 3).join(' or ')}?` };
    case 'reject':
      return { kind: 'refused', verdict: 'unknown' };
    default:
      return { kind: 'empty' };
  }
}

export const publicPrompt = (p: PromptDef): CandlePrompt => ({
  id: p.id,
  text: p.text,
  category: p.category,
  ...(p.rules ? { rules: p.rules } : {}),
  ...(p.flavor ? { flavor: p.flavor } : {}),
});

/**
 * The answers surface together. Each sealed answer sinks its tier's depth, half
 * as deep again when nobody else gave it, or a share of it when others did.
 * Deepest first; ties keep the circle's order.
 */
export function scoreCandle(prompt: PromptDef, circle: string[], seals: Record<string, Seal | undefined>, depths: number[]): CandleResult {
  const counts = new Map<string, number>();
  for (const id of circle) {
    const s = seals[id];
    if (s) counts.set(fold(s.answer), (counts.get(fold(s.answer)) ?? 0) + 1);
  }
  const voices: Voice[] = circle.map((id) => {
    const s = seals[id];
    if (!s) return { sitter: id, input: null, answer: null, tier: 0, voices: 0, depth: 0 };
    const n = counts.get(fold(s.answer)) ?? 1;
    return { sitter: id, input: s.input, answer: s.answer, tier: s.tier, voices: n, depth: candleDepth(depths[s.tier] ?? 0, n) };
  });
  voices.sort((a, b) => b.depth - a.depth);
  const unsaid = prompt.answers
    .filter((a) => !counts.has(fold(a.answer)))
    .sort((a, b) => b.tier - a.tier)
    .slice(0, UNSAID_SHOWN)
    .map((a) => ({ answer: a.answer, tier: a.tier }));
  return { prompt: publicPrompt(prompt), voices, unsaid };
}

/** The deepest of the circle; more than one on a tie, nobody if nobody sank at all. */
export function heraldsOf(totals: Record<string, number>, ids: string[]): string[] {
  const best = Math.max(0, ...ids.map((id) => totals[id] ?? 0));
  return best > 0 ? ids.filter((id) => (totals[id] ?? 0) === best) : [];
}

// ---------------------------------------------------------- what may be sent

const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max ? v : undefined);
const strs = (v: unknown, max: number, count: number): string[] =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x.trim() && x.length <= max).slice(0, count);

/** Questions sent by the medium's device, checked and cut to size: the relay trusts nobody's JSON. */
export function cleanPrompts(list: unknown, max: number): PromptDef[] {
  const out: PromptDef[] = [];
  for (const p of Array.isArray(list) ? list.slice(0, max) : []) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const id = str(r.id, 80);
    const text = str(r.text, 300);
    if (!id || !text || !Array.isArray(r.answers)) continue;
    const answers: AnswerDef[] = [];
    for (const a of r.answers.slice(0, 800)) {
      if (!a || typeof a !== 'object') continue;
      const ar = a as Record<string, unknown>;
      const answer = str(ar.answer, 120);
      const tier = typeof ar.tier === 'number' && Number.isFinite(ar.tier) ? Math.max(1, Math.min(6, Math.round(ar.tier))) : 0;
      if (answer && tier) answers.push({ answer, aliases: strs(ar.aliases, 120, 40), tier });
    }
    if (!answers.length) continue;
    const traps: TrapDef[] = [];
    for (const t of Array.isArray(r.traps) ? r.traps.slice(0, 200) : []) {
      if (!t || typeof t !== 'object') continue;
      const tr = t as Record<string, unknown>;
      const answer = str(tr.answer, 120);
      const reason = str(tr.reason, 300);
      if (answer && reason) traps.push({ answer, aliases: strs(tr.aliases, 120, 40), reason });
    }
    const rules = str(r.rules, 300);
    const flavor = str(r.flavor, 300);
    out.push({
      id,
      text,
      category: str(r.category, 40) ?? 'misc',
      ...(rules ? { rules } : {}),
      ...(flavor ? { flavor } : {}),
      answers,
      traps,
      decoys: strs(r.decoys, 120, 400),
      ...(r.exact === true ? { exact: true } : {}),
    });
  }
  return out;
}

/** Metres by tier, [0] silence: seven numbers, each between nothing and the floor. */
export function cleanDepths(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== 7) return null;
  const out = v.map((n) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(5000, Math.round(n))) : NaN));
  return out.some(Number.isNaN) ? null : [0, ...out.slice(1)];
}

/** A name as the circle will see it: no control or direction characters, no runs of spaces. */
export function cleanName(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .trim();
}

const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

/** Two sitters may not share a name: the second Ada is Ada II. */
function uniqueName(room: Room, id: string, name: string): string {
  const taken = new Set(room.sitters.filter((s) => s.id !== id).map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (const n of NUMERALS) {
    const next = `${name.slice(0, NAME_MAX - n.length - 1)} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return `${name.slice(0, NAME_MAX - 4)} ${room.sitters.length}`;
}

export function cleanConfig(candles: unknown, seconds: unknown): SeanceConfig | null {
  const c = (CANDLE_CHOICES as readonly number[]).includes(candles as number) ? (candles as number) : null;
  const s = (SECONDS_CHOICES as readonly number[]).includes(seconds as number) ? (seconds as number) : null;
  return c && s ? { candles: c, seconds: s } : null;
}

// -------------------------------------------------------------------- a room

export function newRoom(sign: string, now: number): Room {
  return {
    v: 1,
    sign,
    created: now,
    touched: now,
    phase: 'lobby',
    config: { ...DEFAULT_CONFIG },
    sitters: [],
    prompts: [],
    depths: [0, 0, 0, 0, 0, 0, 0],
    candle: -1,
    litAt: 0,
    deadline: 0,
    circle: [],
    seals: {},
    tries: {},
    results: [],
    totals: {},
    heralds: [],
    nextMark: 0,
  };
}

const sittersOf = (room: Room) => room.sitters.filter((s) => !s.table);

/** The medium lights the candles: the first to arrive who is still here, or the first to arrive. */
export function mediumOf(room: Room): string | null {
  const circle = sittersOf(room);
  return (circle.find((s) => s.online) ?? circle[0])?.id ?? null;
}

const byId = (room: Room, id: string) => room.sitters.find((s) => s.id === id);

export function join(room: Room, id: string, rawName: unknown, table: boolean, now: number): Outcome<{ sitter: Sitter }> {
  if (!/^[a-z0-9-]{4,40}$/.test(id)) return fail('bad', 'That device has no proper mark.');
  room.touched = now;
  const known = byId(room, id);
  if (known) {
    known.online = true;
    const name = cleanName(rawName);
    if (!known.table && name && room.phase === 'lobby') known.name = uniqueName(room, id, name);
    return { ok: true, sitter: known };
  }
  if (table) {
    if (room.sitters.filter((s) => s.table).length >= MAX_TABLES) return fail('full', 'The room has as many tables as it can hold.');
  } else if (sittersOf(room).length >= MAX_SITTERS) return fail('full', `The circle is full: ${MAX_SITTERS} is all a séance can hold.`);
  const name = table ? 'The table' : cleanName(rawName);
  if (!name) return fail('name', 'Give the circle a name to call you by.');
  const sitter: Sitter = { id, name: table ? name : uniqueName(room, id, name), mark: table ? -1 : room.nextMark++ % MARKS, joined: now, online: true, table };
  room.sitters.push(sitter);
  if (!table) {
    room.totals[id] ??= 0;
    // A latecomer may still answer the candle that burns.
    if (room.phase === 'candle' && now <= room.deadline && !room.circle.includes(id)) room.circle.push(id);
  }
  return { ok: true, sitter };
}

/** A device dropped or came back. Returns whether the circle should be told. */
export function setOnline(room: Room, id: string, online: boolean): boolean {
  const s = byId(room, id);
  if (!s || s.online === online) return false;
  s.online = online;
  return true;
}

/** Leaving before the first candle takes your seat away; after it, your depth stays on the record. */
export function leave(room: Room, id: string, now: number): void {
  room.touched = now;
  if (room.phase === 'lobby') {
    room.sitters = room.sitters.filter((s) => s.id !== id);
    delete room.totals[id];
  } else setOnline(room, id, false);
}

const mediumOnly = (room: Room, actor: string) => (mediumOf(room) === actor ? null : fail('medium', 'Only the medium can do that.'));

export function configure(room: Room, actor: string, candles: unknown, seconds: unknown, now: number): Outcome {
  const no = mediumOnly(room, actor);
  if (no) return no;
  if (room.phase !== 'lobby') return fail('phase', 'The candles are already lit.');
  const cfg = cleanConfig(candles, seconds);
  if (!cfg) return fail('bad', 'That is not a way to hold a séance.');
  room.config = cfg;
  room.touched = now;
  return { ok: true };
}

function light(room: Room, index: number, now: number) {
  room.phase = 'candle';
  room.candle = index;
  room.litAt = now + RISE_MS;
  room.deadline = room.litAt + room.config.seconds * 1000;
  room.circle = sittersOf(room).map((s) => s.id);
  room.seals = {};
  room.tries = {};
}

export function begin(room: Room, actor: string, prompts: unknown, depths: unknown, now: number): Outcome {
  const no = mediumOnly(room, actor);
  if (no) return no;
  if (room.phase !== 'lobby') return fail('phase', 'The candles are already lit.');
  const list = cleanPrompts(prompts, room.config.candles);
  const table = cleanDepths(depths);
  if (!list.length || !table) return fail('bad', 'The medium sent nothing the deep could ask.');
  // Seats left empty before the first candle are cleared away.
  room.sitters = room.sitters.filter((s) => s.online || s.table);
  if (!sittersOf(room).length) return fail('phase', 'Nobody is sitting.');
  room.prompts = list;
  room.depths = table;
  room.results = [];
  room.heralds = [];
  room.totals = Object.fromEntries(sittersOf(room).map((s) => [s.id, 0]));
  room.touched = now;
  light(room, 0, now);
  return { ok: true };
}

/** Put out the candle: the answers surface and the circle sinks. */
function snuff(room: Room) {
  const prompt = room.prompts[room.candle];
  const result = scoreCandle(prompt, room.circle, room.seals, room.depths);
  room.results.push(result);
  for (const v of result.voices) room.totals[v.sitter] = (room.totals[v.sitter] ?? 0) + v.depth;
  room.phase = 'reveal';
}

export type Spoken = Outcome<{ heard: Heard }>;

export function speak(room: Room, actor: string, rawText: unknown, now: number): Spoken {
  if (room.phase !== 'candle') return fail('phase', 'No candle is burning.');
  if (!room.circle.includes(actor)) return fail('phase', 'You are not sitting for this candle.');
  if (room.seals[actor]) return fail('sealed', 'Your answer is already sealed.');
  if (now > room.deadline + GRACE_MS) return fail('late', 'The candle has gone out.');
  const text = String(rawText ?? '').trim().slice(0, SPEAK_MAX);
  const prompt = room.prompts[room.candle];
  const heard = hear(prompt, text);
  room.touched = now;
  if (heard.kind === 'refused') {
    const tries = (room.tries[actor] ??= []);
    if (!tries.some((t) => fold(t) === fold(text)) && tries.length < 30) tries.push(text);
  } else if (heard.kind === 'sealed') {
    room.seals[actor] = { sitter: actor, input: text, answer: heard.answer, tier: heard.tier, at: now };
    settle(room);
  }
  return { ok: true, heard };
}

/** Every voice still here has sealed: no need to wait for the wax. Returns whether the candle went out. */
export function settle(room: Room): boolean {
  if (room.phase !== 'candle') return false;
  const here = room.circle.filter((id) => byId(room, id)?.online);
  if (!here.length || here.some((id) => !room.seals[id])) return false;
  snuff(room);
  return true;
}

/** Called by the clock. Returns whether anything changed. */
export function tick(room: Room, now: number): boolean {
  if (room.phase === 'candle' && now > room.deadline + GRACE_MS) {
    snuff(room);
    return true;
  }
  return false;
}

/** When the clock must look at the room again. */
export const alarmAt = (room: Room): number | null => (room.phase === 'candle' ? room.deadline + GRACE_MS + 50 : null);

export function advance(room: Room, actor: string, now: number): Outcome {
  const no = mediumOnly(room, actor);
  if (no) return no;
  if (room.phase !== 'reveal') return fail('phase', 'Wait for the answers to surface.');
  room.touched = now;
  if (room.candle + 1 < room.prompts.length) light(room, room.candle + 1, now);
  else {
    room.phase = 'ended';
    room.heralds = heraldsOf(room.totals, sittersOf(room).map((s) => s.id));
  }
  return { ok: true };
}

/** After the last rites, the same circle may sit again. */
export function again(room: Room, actor: string, now: number): Outcome {
  const no = mediumOnly(room, actor);
  if (no) return no;
  if (room.phase !== 'ended') return fail('phase', 'The séance is not over.');
  room.phase = 'lobby';
  room.candle = -1;
  room.prompts = [];
  room.results = [];
  room.heralds = [];
  room.seals = {};
  room.tries = {};
  room.circle = [];
  room.sitters = room.sitters.filter((s) => s.online);
  room.totals = Object.fromEntries(sittersOf(room).map((s) => [s.id, 0]));
  room.touched = now;
  return { ok: true };
}

export function viewFor(room: Room, viewer: string, now: number): SeanceView {
  const mine = room.phase === 'candle' ? room.seals[viewer] : undefined;
  const prompt = room.candle >= 0 && room.prompts[room.candle] ? publicPrompt(room.prompts[room.candle]) : null;
  return {
    sign: room.sign,
    phase: room.phase,
    config: { ...room.config },
    medium: mediumOf(room),
    you: viewer,
    sitters: room.sitters.map((s) => ({ ...s })),
    candle: room.candle,
    prompt,
    litAt: room.litAt,
    deadline: room.deadline,
    sealed: room.phase === 'candle' ? room.circle.filter((id) => room.seals[id]) : [],
    yours: mine ? { input: mine.input, answer: mine.answer, tier: mine.tier } : null,
    tries: room.phase === 'candle' ? [...(room.tries[viewer] ?? [])] : [],
    results: room.results,
    totals: { ...room.totals },
    heralds: [...room.heralds],
    now,
  };
}

/** A saved room from storage, if it is one this code can still run. */
export function reviveRoom(raw: unknown): Room | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Room;
  return r.v === 1 && typeof r.sign === 'string' && Array.isArray(r.sitters) ? r : null;
}
