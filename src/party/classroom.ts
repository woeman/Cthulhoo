// The Convocation's rules, as pure functions over one room: a class-sized
// séance with a host who never answers. The surface relay runs them. Nothing
// here may touch the DOM or the bundler: the relay imports this file.

import type { PromptDef } from '../game/types';
import {
  CLASS_MAX_SEATS,
  CLASS_MAX_TABLES,
  CLASS_MODES,
  CLASS_SECONDS,
  CLASS_TABLES,
  DEFAULT_CLASS_CONFIG,
  type ClassAnswerRow,
  type ClassConfig,
  type ClassErrorCode,
  type ClassMode,
  type ClassOutcome,
  type ClassPhase,
  type ClassResult,
  type ClassSeatPublic,
  type ClassStanding,
  type ClassTableGain,
  type ClassVerdict,
  type ClassView,
} from './class-types';
import { GRACE_MS, LONE_BONUS, RISE_MS, ROOM_TTL_MS, cleanDepths, cleanName, cleanPrompts, cleanTopicNames, hear, publicPrompt } from './room';
import { NAME_MAX, SPEAK_MAX } from './types';

/** A convocation nobody has touched for this long is forgotten. */
export const CLASS_TTL_MS = ROOM_TTL_MS;
/** Answer rows a reveal carries: for the host's screen, and for a diver's phone. */
export const CLASS_HOST_ROWS = 60;
export const CLASS_SEAT_ROWS = 8;
/** Standings a diver is sent (the host is sent everyone's). */
export const CLASS_TOP = 5;
export const CLASS_UNSAID = 5;
/** Names shown beside an answer. */
export const CLASS_NAMES = 3;
/** A table's deepest different answers that count on one question. */
export const TABLE_COUNTS: Record<ClassMode, number> = { classic: 3, blitz: 10 };
/** Refused answers a diver is shown again after a reload. */
const TRIES_KEPT = 6;
/** Answers one diver may send to one question, right or wrong: a script gets no further. */
export const CLASS_SHOTS_MAX = 400;
/** Once every diver here has answered a classic question, it is revealed this soon. */
export const ALL_IN_MS = 1500;

const round10 = (n: number) => Math.round(n / 10) * 10;

export interface ClassSeat {
  id: string;
  name: string;
  joined: number;
  online: boolean;
  /** Its table, from 1; 0 when the class has no tables. */
  table: number;
  total: number;
  /** Metres won on the question last revealed. */
  gain: number;
  /** This question: the answers given, as places in the question's list, in the order given. */
  said: number[];
  /** What was typed for each of those. */
  typed: string[];
  /** What the deep refused, newest last. */
  tries: string[];
  /** Everything sent to this question, right or wrong. */
  shots: number;
}

export interface ClassRoom {
  v: 1;
  sign: string;
  /** The host's secret: whoever holds it runs the class. */
  key: string;
  created: number;
  touched: number;
  phase: ClassPhase;
  config: ClassConfig;
  /** The question being asked or last revealed, from 1; 0 before the first. */
  n: number;
  prompt: PromptDef | null;
  /** Metres for each tier, by tier number; [0] is silence. */
  depths: number[];
  litAt: number;
  deadline: number;
  /** When a classic question closes early because everyone here has answered; 0 while it has not. */
  earlyAt: number;
  /** In the order they sat down. */
  seats: ClassSeat[];
  /** Devices the host removed: they may not sit again. */
  banned: string[];
  result: ClassResult | null;
  /** Metres by table, [0] unused. */
  tables: number[];
}

export type ClassOutcomeOf<T = object> = ({ ok: true } & T) | { ok: false; code: ClassErrorCode; message: string };

const fail = (code: ClassErrorCode, message: string): { ok: false; code: ClassErrorCode; message: string } => ({ ok: false, code, message });

export function newClass(sign: string, key: string, now: number): ClassRoom {
  return {
    v: 1,
    sign,
    key,
    created: now,
    touched: now,
    phase: 'lobby',
    config: { ...DEFAULT_CLASS_CONFIG },
    n: 0,
    prompt: null,
    depths: [0, 0, 0, 0, 0, 0, 0],
    litAt: 0,
    deadline: 0,
    earlyAt: 0,
    seats: [],
    banned: [],
    result: null,
    tables: [0],
  };
}

/** A room read back from storage: null when it is not one. */
export function reviveClass(v: unknown): ClassRoom | null {
  const r = v as ClassRoom | null | undefined;
  if (!r || r.v !== 1 || typeof r.sign !== 'string' || typeof r.key !== 'string' || !Array.isArray(r.seats)) return null;
  r.earlyAt ??= 0;
  return r;
}

const seatOf = (room: ClassRoom, id: string) => room.seats.find((s) => s.id === id);

// -------------------------------------------------------------------- seats

const NUMERALS = ['II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII'];

/** Two divers may not share a name: the second Ada is Ada II. */
function uniqueName(room: ClassRoom, id: string, name: string): string {
  const taken = new Set(room.seats.filter((s) => s.id !== id).map((s) => s.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (const n of NUMERALS) {
    const next = `${name.slice(0, NAME_MAX - n.length - 1)} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  for (let n = 14; ; n++) {
    const next = `${name.slice(0, NAME_MAX - String(n).length - 1)} ${n}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
}

/** Members by table, [0] unused. */
export function tableSeats(room: ClassRoom): number[] {
  const out = new Array<number>(room.config.tables + 1).fill(0);
  for (const s of room.seats) if (s.table >= 1 && s.table <= room.config.tables) out[s.table]++;
  return out;
}

/** The table with the fewest at it: the lowest number on a tie. */
function emptiestTable(room: ClassRoom): number {
  if (!room.config.tables) return 0;
  const counts = tableSeats(room);
  let best = 1;
  for (let t = 2; t <= room.config.tables; t++) if (counts[t] < counts[best]) best = t;
  return best;
}

/** A device sits down, or comes back to its seat. */
export function takeSeat(room: ClassRoom, id: string, rawName: unknown, now: number): ClassOutcomeOf<{ seat: ClassSeat; fresh: boolean }> {
  if (!/^[a-z0-9-]{4,40}$/.test(id)) return fail('bad', 'That device has no proper mark.');
  if (room.banned.includes(id)) return fail('removed', 'The host has asked you to leave this class.');
  room.touched = now;
  const name = cleanName(rawName);
  const known = seatOf(room, id);
  if (known) {
    known.online = true;
    if (name && room.phase === 'lobby') known.name = uniqueName(room, id, name);
    return { ok: true, seat: known, fresh: false };
  }
  if (room.seats.length >= CLASS_MAX_SEATS) return fail('full', `The hall is full: ${CLASS_MAX_SEATS} is all a class can hold.`);
  if (!name) return fail('name', 'Give the class a name to call you by.');
  const seat: ClassSeat = { id, name: uniqueName(room, id, name), joined: now, online: true, table: emptiestTable(room), total: 0, gain: 0, said: [], typed: [], tries: [], shots: 0 };
  room.seats.push(seat);
  return { ok: true, seat, fresh: true };
}

/** A device's line is up or down. Returns whether anything changed. */
export function seatOnline(room: ClassRoom, id: string, online: boolean): boolean {
  const s = seatOf(room, id);
  if (!s || s.online === online) return false;
  s.online = online;
  return true;
}

/** Leaving before the first question gives the seat up; after it, the diver's depth stays on the record. */
export function leaveSeat(room: ClassRoom, id: string, now: number): 'gone' | 'away' | null {
  const s = seatOf(room, id);
  if (!s) return null;
  room.touched = now;
  if (room.phase === 'lobby' && room.n === 0) {
    room.seats = room.seats.filter((x) => x !== s);
    return 'gone';
  }
  s.online = false;
  return 'away';
}

/** The host sends a diver out: the seat goes, and the device may not sit again. */
export function removeSeat(room: ClassRoom, id: string, now: number): boolean {
  const s = seatOf(room, id);
  if (!s) return false;
  room.touched = now;
  room.seats = room.seats.filter((x) => x !== s);
  if (!room.banned.includes(id)) room.banned.push(id);
  if (room.banned.length > 200) room.banned.shift();
  return true;
}

/** A diver moves to another table, between questions. */
export function setTable(room: ClassRoom, id: string, table: unknown, now: number): ClassOutcomeOf {
  const s = seatOf(room, id);
  if (!s) return fail('bad', 'Sit down first.');
  if (room.phase === 'asking') return fail('phase', 'Tables may not change while a question burns.');
  if (!room.config.tables || typeof table !== 'number' || !Number.isInteger(table) || table < 1 || table > room.config.tables) return fail('bad', 'There is no such table.');
  s.table = table;
  room.touched = now;
  return { ok: true };
}

// ------------------------------------------------------------------- the host

export function cleanClassConfig(raw: { mode?: unknown; seconds?: unknown; tables?: unknown; questions?: unknown; topics?: unknown }, was: ClassConfig): ClassConfig | null {
  const mode = CLASS_MODES.includes(raw.mode as ClassMode) ? (raw.mode as ClassMode) : null;
  if (!mode) return null;
  const seconds = CLASS_SECONDS[mode].includes(raw.seconds as number) ? (raw.seconds as number) : null;
  const tables = (CLASS_TABLES as readonly number[]).includes(raw.tables as number) ? (raw.tables as number) : null;
  const questions = typeof raw.questions === 'number' && Number.isInteger(raw.questions) && raw.questions >= 1 && raw.questions <= 30 ? raw.questions : null;
  if (seconds === null || tables === null || questions === null) return null;
  const topics = cleanTopicNames(raw.topics) ?? was.topics;
  return { mode, seconds, tables, questions, ...(topics?.length ? { topics } : {}) };
}

/** The host sets how the class is held. Changing the number of tables seats everyone afresh. */
export function configureClass(room: ClassRoom, raw: Parameters<typeof cleanClassConfig>[0], now: number): ClassOutcomeOf<{ dealt: boolean }> {
  if (room.phase === 'asking') return fail('phase', 'Not while a question burns.');
  const next = cleanClassConfig(raw, room.config);
  if (!next) return fail('bad', 'The deep does not hold a class that way.');
  const dealt = next.tables !== room.config.tables;
  room.config = next;
  room.touched = now;
  if (dealt) {
    // Round the tables in the order the class sat down, so friends who came in together can still swap.
    room.seats.forEach((s, i) => (s.table = next.tables ? (i % next.tables) + 1 : 0));
    room.tables = new Array<number>(next.tables + 1).fill(0);
  }
  return { ok: true, dealt };
}

/** The host asks a question: it rises, then burns for the seconds chosen. */
export function ask(room: ClassRoom, rawPrompt: unknown, rawDepths: unknown, now: number): ClassOutcomeOf {
  if (room.phase === 'asking') return fail('phase', 'A question is already burning.');
  if (room.phase === 'ended') return fail('phase', 'This class has ended. Hold another round.');
  const prompt = cleanPrompts([rawPrompt], 1)[0];
  const depths = cleanDepths(rawDepths);
  if (!prompt || !depths) return fail('bad', 'The deep could not read that question.');
  for (const s of room.seats) {
    s.said = [];
    s.typed = [];
    s.tries = [];
    s.shots = 0;
    s.gain = 0;
  }
  room.prompt = prompt;
  room.depths = depths;
  room.n += 1;
  room.result = null;
  room.phase = 'asking';
  room.litAt = now + RISE_MS;
  room.deadline = room.litAt + room.config.seconds * 1000;
  room.earlyAt = 0;
  room.touched = now;
  return { ok: true };
}

// Where each answer sits in its question's list, worked out once per question.
const places = new WeakMap<PromptDef, Map<string, number>>();
function placeOf(prompt: PromptDef, answer: string): number {
  let m = places.get(prompt);
  if (!m) {
    m = new Map(prompt.answers.map((a, i) => [a.answer, i]));
    places.set(prompt, m);
  }
  return m.get(answer) ?? -1;
}

export type ClassHeard =
  | { kind: 'sealed'; input: string; answer: string; sealed: number }
  | { kind: 'refused'; text: string; verdict: ClassVerdict; reason?: string }
  | { kind: 'empty' };

/** A diver says an answer. Classic takes one; blitz takes every different one. */
export function say(room: ClassRoom, id: string, rawText: unknown, now: number): ClassOutcomeOf<{ heard: ClassHeard }> {
  const seat = seatOf(room, id);
  if (!seat) return fail('bad', 'Sit down first.');
  const prompt = room.prompt;
  if (room.phase !== 'asking' || !prompt) return fail('phase', 'No question is burning.');
  if (now > room.deadline + GRACE_MS) return fail('late', 'The time is out.');
  const text = String(rawText ?? '').trim().slice(0, SPEAK_MAX);
  if (!text) return { ok: true, heard: { kind: 'empty' } };
  const classic = room.config.mode === 'classic';
  if (classic && seat.said.length) return fail('sealed', 'Your answer is sealed.');
  if (seat.shots >= CLASS_SHOTS_MAX) return fail('late', 'The deep has heard enough from you on this one.');
  seat.shots++;
  room.touched = now;
  const refuse = (verdict: ClassVerdict, reason?: string): ClassOutcomeOf<{ heard: ClassHeard }> => {
    if (!seat.tries.includes(text)) seat.tries = [...seat.tries, text].slice(-TRIES_KEPT);
    return { ok: true, heard: { kind: 'refused', text, verdict, ...(reason ? { reason } : {}) } };
  };
  const res = hear(prompt, text);
  if (res.kind === 'empty') return { ok: true, heard: { kind: 'empty' } };
  if (res.kind === 'refused') return refuse(res.verdict, res.reason);
  const place = placeOf(prompt, res.answer);
  if (place < 0) return refuse('unknown');
  if (seat.said.includes(place)) return refuse('said', `You have already given ${res.answer}.`);
  seat.said.push(place);
  seat.typed.push(text);
  // The last of the class to answer closes a classic question a moment early.
  if (!room.earlyAt && everyoneIn(room)) room.earlyAt = now + ALL_IN_MS;
  return { ok: true, heard: { kind: 'sealed', input: text, answer: res.answer, sealed: seat.said.length } };
}

/** Whether a classic question has every diver's answer who is here to give one. */
export function everyoneIn(room: ClassRoom): boolean {
  if (room.phase !== 'asking' || room.config.mode !== 'classic') return false;
  const here = room.seats.filter((s) => s.online);
  return here.length > 0 && here.every((s) => s.said.length > 0);
}

/** How many divers gave each answer of the question, by its place in the list. */
function voicesOf(room: ClassRoom): Map<number, ClassSeat[]> {
  const voices = new Map<number, ClassSeat[]>();
  for (const s of room.seats) {
    for (const i of s.said) {
      const list = voices.get(i);
      if (list) list.push(s);
      else voices.set(i, [s]);
    }
  }
  return voices;
}

const depthOf = (room: ClassRoom, prompt: PromptDef, place: number, alone: boolean): number => round10((room.depths[prompt.answers[place]?.tier ?? 0] ?? 0) * (alone ? LONE_BONUS : 1));

/**
 * The answers surface. Each answer sinks its diver its tier's depth, half as
 * deep again when nobody else gave it. (A circle of friends splits a shared
 * answer; a class of forty would be left with nothing, so here it is whole.)
 * With tables, each table also wins its few deepest different answers.
 */
export function reveal(room: ClassRoom, now: number): boolean {
  const prompt = room.prompt;
  if (room.phase !== 'asking' || !prompt) return false;
  const { mode, tables } = room.config;
  const voices = voicesOf(room);
  for (const s of room.seats) {
    s.gain = s.said.reduce((n, i) => n + depthOf(room, prompt, i, voices.get(i)?.length === 1), 0);
    s.total += s.gain;
  }

  let tableGains: ClassTableGain[] | undefined;
  if (tables > 0) {
    const gave = Array.from({ length: tables + 1 }, () => new Set<number>());
    for (const s of room.seats) if (s.table >= 1 && s.table <= tables) for (const i of s.said) gave[s.table].add(i);
    const tablesGave = new Map<number, number>();
    for (let t = 1; t <= tables; t++) for (const i of gave[t]) tablesGave.set(i, (tablesGave.get(i) ?? 0) + 1);
    tableGains = [];
    for (let t = 1; t <= tables; t++) {
      const counted = [...gave[t]]
        .map((i) => {
          const lone = tablesGave.get(i) === 1;
          return { i, answer: prompt.answers[i].answer, tier: prompt.answers[i].tier, depth: depthOf(room, prompt, i, lone), lone };
        })
        .sort((a, b) => b.depth - a.depth || a.i - b.i)
        .slice(0, TABLE_COUNTS[mode])
        .map(({ answer, tier, depth, lone }) => ({ answer, tier, depth, lone }));
      const gain = counted.reduce((n, c) => n + c.depth, 0);
      room.tables[t] = (room.tables[t] ?? 0) + gain;
      tableGains.push({ table: t, gain, total: room.tables[t], counted });
    }
    tableGains.sort((a, b) => b.gain - a.gain || a.table - b.table);
  }

  const rows: ClassAnswerRow[] = [...voices.entries()]
    .map(([i, seats]) => ({
      answer: prompt.answers[i].answer,
      tier: prompt.answers[i].tier,
      voices: seats.length,
      names: seats.slice(0, CLASS_NAMES).map((s) => s.name),
      depth: depthOf(room, prompt, i, seats.length === 1),
    }))
    .sort((a, b) => b.tier - a.tier || a.voices - b.voices || (a.answer < b.answer ? -1 : 1));
  const unsaid = prompt.answers
    .filter((_, i) => !voices.has(i))
    .sort((a, b) => b.tier - a.tier)
    .slice(0, CLASS_UNSAID)
    .map((a) => ({ answer: a.answer, tier: a.tier }));
  const spoke = room.seats.filter((s) => s.said.length > 0).length;
  room.result = {
    n: room.n,
    mode,
    prompt: publicPrompt(prompt),
    answers: rows.slice(0, CLASS_HOST_ROWS),
    given: rows.length,
    known: prompt.answers.length,
    unsaid,
    silent: room.seats.filter((s) => s.online && !s.said.length).length,
    spoke,
    ...(tableGains ? { tables: tableGains } : {}),
  };
  room.phase = 'reveal';
  room.earlyAt = 0;
  room.touched = now;
  return true;
}

/** The host ends the class: the standings are final. A burning question is revealed first. */
export function endClass(room: ClassRoom, now: number): ClassOutcomeOf {
  if (room.phase === 'ended') return fail('phase', 'This class has already ended.');
  if (room.phase === 'asking') reveal(room, now);
  room.phase = 'ended';
  room.touched = now;
  return { ok: true };
}

/** The same class sits again: everyone keeps their seat and starts from the surface. */
export function againClass(room: ClassRoom, now: number): ClassOutcomeOf {
  if (room.phase === 'asking') return fail('phase', 'Not while a question burns.');
  for (const s of room.seats) {
    s.total = 0;
    s.gain = 0;
    s.said = [];
    s.typed = [];
    s.tries = [];
    s.shots = 0;
  }
  room.tables = new Array<number>(room.config.tables + 1).fill(0);
  room.n = 0;
  room.prompt = null;
  room.result = null;
  room.phase = 'lobby';
  room.touched = now;
  return { ok: true };
}

/** When a burning question closes: its time out, or sooner once everyone is in. */
export const closesAt = (room: ClassRoom): number => Math.min(room.deadline + GRACE_MS, room.earlyAt || Infinity);

/** When the relay must wake: a burning question's end, or the room's own. */
export function classAlarmAt(room: ClassRoom): number {
  const expiry = room.touched + CLASS_TTL_MS;
  return room.phase === 'asking' ? Math.min(closesAt(room), expiry) : expiry;
}

/** The alarm rang: reveal a question whose time is out. Returns whether the room changed. */
export function classTick(room: ClassRoom, now: number): boolean {
  return room.phase === 'asking' && now >= closesAt(room) && reveal(room, now);
}

// -------------------------------------------------------------------- views

/** The class as it stands, worked out once for everyone who is about to be shown it. */
export interface ClassSnap {
  now: number;
  standings: ClassStanding[];
  rank: Map<string, number>;
  here: number;
  answered: number;
  said: number;
  tableSeats?: number[];
  voices: Map<number, number>;
}

/** The numbers the class is told as it answers: who is here, who has answered, how many answers in all. */
export function classCount(room: ClassRoom): { seats: number; here: number; answered: number; said: number } {
  let here = 0;
  let answered = 0;
  let said = 0;
  for (const s of room.seats) {
    if (s.online) here++;
    if (s.said.length) answered++;
    said += s.said.length;
  }
  return { seats: room.seats.length, here, answered, said };
}

export function snapshot(room: ClassRoom, now: number): ClassSnap {
  const order = [...room.seats].sort((a, b) => b.total - a.total || a.joined - b.joined);
  const rank = new Map<string, number>();
  const standings: ClassStanding[] = [];
  let place = 0;
  let last = Infinity;
  order.forEach((s, i) => {
    if (s.total !== last) {
      place = i + 1;
      last = s.total;
    }
    rank.set(s.id, place);
    standings.push({ id: s.id, name: s.name, table: s.table, total: s.total, gain: s.gain, rank: place });
  });
  const voices = new Map<number, number>();
  if (room.phase !== 'asking') for (const [i, seats] of voicesOf(room)) voices.set(i, seats.length);
  const { here, answered, said } = classCount(room);
  return {
    now,
    standings,
    rank,
    here,
    answered,
    said,
    ...(room.config.tables ? { tableSeats: tableSeats(room) } : {}),
    voices,
  };
}

export const publicSeat = (s: ClassSeat): ClassSeatPublic => ({ id: s.id, name: s.name, online: s.online, table: s.table, total: s.total, answered: s.said.length > 0 });

function baseView(room: ClassRoom, snap: ClassSnap, role: 'host' | 'seat'): ClassView {
  const shown = room.phase === 'asking' || room.phase === 'reveal';
  return {
    sign: room.sign,
    role,
    phase: room.phase,
    config: room.config,
    n: room.n,
    prompt: shown && room.prompt ? publicPrompt(room.prompt) : null,
    litAt: room.litAt,
    deadline: room.deadline,
    seats: room.seats.length,
    here: snap.here,
    answered: snap.answered,
    said: snap.said,
    ...(snap.tableSeats ? { tableSeats: snap.tableSeats, tableTotals: room.tables } : {}),
    now: snap.now,
  };
}

/** What the big screen is shown: the whole roll and every standing, never a diver's sealed answer. */
export function hostView(room: ClassRoom, snap: ClassSnap): ClassView {
  return {
    ...baseView(room, snap, 'host'),
    ...(room.result && room.phase !== 'asking' ? { result: room.result } : {}),
    standings: snap.standings,
    roll: room.seats.map(publicSeat),
  };
}

/** What one diver is shown: their own corner, the deepest few, and a reveal cut to a phone. */
export function seatView(room: ClassRoom, id: string, snap: ClassSnap): ClassView | null {
  const s = seatOf(room, id);
  if (!s) return null;
  const prompt = room.prompt;
  const revealed = room.phase !== 'asking' && !!room.result && !!prompt;
  let outcome: ClassOutcome | undefined;
  if (revealed && prompt) {
    outcome = {
      answers: s.said.map((i, k) => {
        const n = snap.voices.get(i) ?? 1;
        return { input: s.typed[k] ?? '', answer: prompt.answers[i]?.answer ?? '', tier: prompt.answers[i]?.tier ?? 0, voices: n, depth: depthOf(room, prompt, i, n === 1) };
      }),
      gain: s.gain,
    };
  }
  const sealed = room.phase === 'asking' && prompt ? s.said.map((i, k) => ({ input: s.typed[k] ?? '', answer: prompt.answers[i]?.answer ?? '' })) : [];
  return {
    ...baseView(room, snap, 'seat'),
    ...(room.result && revealed ? { result: { ...room.result, answers: room.result.answers.slice(0, CLASS_SEAT_ROWS) } } : {}),
    standings: snap.standings.slice(0, CLASS_TOP),
    you: {
      id: s.id,
      name: s.name,
      table: s.table,
      total: s.total,
      rank: snap.rank.get(s.id) ?? room.seats.length,
      sealed,
      tries: room.phase === 'asking' ? s.tries : [],
      ...(outcome ? { outcome } : {}),
    },
  };
}

/** A fresh secret for a host: 24 characters nobody will guess. */
export function makeKey(rand: () => number): string {
  const letters = 'abcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 24; i++) out += letters[Math.floor(rand() * letters.length) % letters.length];
  return out;
}

export { CLASS_MAX_TABLES };
