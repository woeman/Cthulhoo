// The Convocation's rules, as pure functions over one room: a class-sized
// séance with a host who never answers. The surface relay runs them. Nothing
// here may touch the DOM or the bundler: the relay imports this file.

import type { PromptDef } from '../game/types';
import {
  CLASS_LANTERNS,
  CLASS_MAX_SEATS,
  CLASS_MAX_TABLES,
  CLASS_MODES,
  CLASS_SECONDS,
  CLASS_TABLES,
  DEFAULT_CLASS_CONFIG,
  LAST_MAX_ALONE,
  type ClassAnswerRow,
  type ClassConfig,
  type ClassErrorCode,
  type ClassLastBeat,
  type ClassLastEnd,
  type ClassLastSide,
  type ClassLastView,
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
/** A table's deepest different answers that count on one question. In a bout of last diver standing, every answer a table names counts. */
export const TABLE_COUNTS: Record<ClassMode, number> = { classic: 3, blitz: 10, last: Infinity };
/** A table's counted answers a reveal lists. */
const TABLE_LISTED = 10;
/** Refused answers a diver is shown again after a reload. */
const TRIES_KEPT = 6;
/** Answers one diver may send to one question, right or wrong: a script gets no further. */
export const CLASS_SHOTS_MAX = 400;
/** Once every diver here has answered a classic question, it is revealed this soon. */
export const ALL_IN_MS = 1500;

// Last diver standing.
/** The first side is given this long to read the question before its clock starts. */
export const LAST_READ_MS = 4000;
/** Between turns: long enough to see what the last one came to. */
export const LAST_BEAT_MS = 1400;
/** A side with nobody here when its turn comes is waited for only this long. */
export const LAST_AWAY_MS = 6000;
/** Once a bout is decided, its last turn stays on show this long before the answers surface. */
export const LAST_END_MS = 2600;
/** Turns a bout may take before it is called. */
export const LAST_TURN_CAP = 200;
/** Metres for standing last. */
export const LAST_BONUS = 1000;
/** Named answers a diver's phone is sent (the big screen is sent them all). */
export const LAST_SEAT_SAID = 14;

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

/** A bout of last diver standing, while it is on. */
export interface LastBout {
  /** The sides in the order they take their turns: a table's number, or a diver's id when the class has no tables. */
  order: Array<number | string>;
  /** Lanterns still lit, by side. */
  lanterns: number[];
  /** The lanterns each began with. */
  lives: number;
  /** Whose turn it is, as a place in the order; -1 once the bout is decided. */
  turn: number;
  turnN: number;
  turnLit: number;
  turnEnds: number;
  /** Nobody of the side was here when its turn came: it is waited for a moment only. */
  away: boolean;
  /** The answers named, as places in the question's list, in the order named; and the side that named each. */
  said: number[];
  who: number[];
  /** The sides that have gone dark, in the order they fell. */
  out: number[];
  beat: ClassLastBeat | null;
  ended: ClassLastEnd | null;
  /** The side that stood last; -1 when none did. */
  winner: number;
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
  /** The bout of last diver standing being played, if one is. */
  last: LastBout | null;
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
    last: null,
  };
}

/** A room read back from storage: null when it is not one. */
export function reviveClass(v: unknown): ClassRoom | null {
  const r = v as ClassRoom | null | undefined;
  if (!r || r.v !== 1 || typeof r.sign !== 'string' || typeof r.key !== 'string' || !Array.isArray(r.seats)) return null;
  r.earlyAt ??= 0;
  r.last ??= null;
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

/**
 * The table with the fewest at it: the lowest number on a tie. While a bout of
 * last diver standing is on, a newcomer is sat at a table that is still in it.
 */
function emptiestTable(room: ClassRoom): number {
  if (!room.config.tables) return 0;
  const counts = tableSeats(room);
  const bout = room.phase === 'asking' ? room.last : null;
  const lit = bout ? bout.order.filter((t, k): t is number => typeof t === 'number' && bout.lanterns[k] > 0) : [];
  const among = lit.length ? lit : Array.from({ length: room.config.tables }, (_, i) => i + 1);
  let best = among[0];
  for (const t of among) if (counts[t] < counts[best]) best = t;
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

export function cleanClassConfig(raw: { mode?: unknown; seconds?: unknown; tables?: unknown; questions?: unknown; topics?: unknown; lanterns?: unknown }, was: ClassConfig): ClassConfig | null {
  const mode = CLASS_MODES.includes(raw.mode as ClassMode) ? (raw.mode as ClassMode) : null;
  if (!mode) return null;
  const seconds = CLASS_SECONDS[mode].includes(raw.seconds as number) ? (raw.seconds as number) : null;
  const tables = (CLASS_TABLES as readonly number[]).includes(raw.tables as number) ? (raw.tables as number) : null;
  const questions = typeof raw.questions === 'number' && Number.isInteger(raw.questions) && raw.questions >= 1 && raw.questions <= 30 ? raw.questions : null;
  if (seconds === null || tables === null || questions === null) return null;
  const topics = cleanTopicNames(raw.topics) ?? was.topics;
  // The lanterns are kept through the other modes, so coming back to last diver standing finds them as they were.
  const lanterns = (CLASS_LANTERNS as readonly number[]).includes(raw.lanterns as number) ? (raw.lanterns as number) : was.lanterns;
  return { mode, seconds, tables, questions, ...(topics?.length ? { topics } : {}), ...(lanterns && lanterns !== CLASS_LANTERNS[0] ? { lanterns } : {}) };
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
  const sides = room.config.mode === 'last' ? boutSides(room) : null;
  if (sides && !sides.ok) return sides;
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
  room.last = sides ? newBout(room, sides.order) : null;
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

/** What saying an answer came to. `turn` is set when it moved a bout of last diver standing on ('over': it decided the bout). */
export type ClassSaid = { heard: ClassHeard; turn?: 'next' | 'over' };

/**
 * A diver says an answer. Classic takes one; blitz takes every different one.
 * In a bout of last diver standing only the side whose turn it is may speak: a
 * new right answer passes the turn on, one already named costs a lantern, and
 * a wrong one costs nothing but the time.
 */
export function say(room: ClassRoom, id: string, rawText: unknown, now: number): ClassOutcomeOf<ClassSaid> {
  const seat = seatOf(room, id);
  if (!seat) return fail('bad', 'Sit down first.');
  const prompt = room.prompt;
  if (room.phase !== 'asking' || !prompt) return fail('phase', 'No question is burning.');
  const bout = room.config.mode === 'last' ? room.last : null;
  if (!bout && now > room.deadline + GRACE_MS) return fail('late', 'The time is out.');
  const text = String(rawText ?? '').trim().slice(0, SPEAK_MAX);
  if (!text) return { ok: true, heard: { kind: 'empty' } };
  const classic = room.config.mode === 'classic';
  if (classic && seat.said.length) return fail('sealed', 'Your answer is sealed.');
  let side = -1;
  if (bout) {
    // Out of turn costs nothing and is not kept: the screens only offer the line to the side whose turn it is.
    const wait = (reason: string): ClassOutcomeOf<ClassSaid> => ({ ok: true, heard: { kind: 'refused', text, verdict: 'wait', reason } });
    if (bout.turn < 0) return wait('The bout is over.');
    side = sideOfSeat(room, bout, seat);
    if (side < 0) return wait(room.config.tables ? 'Your table sits this bout out.' : 'You sat down after this bout began. You play in the next.');
    if (bout.lanterns[side] <= 0) return wait(room.config.tables ? 'Your table’s lanterns are out.' : 'Your lanterns are out.');
    if (side !== bout.turn) return wait(room.config.tables ? 'It is not your table’s turn.' : 'It is not your turn.');
    if (now > bout.turnEnds + GRACE_MS) return fail('late', 'The turn’s time ran out.');
  }
  if (seat.shots >= CLASS_SHOTS_MAX) return fail('late', 'The deep has heard enough from you on this one.');
  seat.shots++;
  room.touched = now;
  const refuse = (verdict: ClassVerdict, reason?: string): ClassOutcomeOf<ClassSaid> => {
    if (!seat.tries.includes(text)) seat.tries = [...seat.tries, text].slice(-TRIES_KEPT);
    return { ok: true, heard: { kind: 'refused', text, verdict, ...(reason ? { reason } : {}) } };
  };
  const res = hear(prompt, text);
  if (res.kind === 'empty') return { ok: true, heard: { kind: 'empty' } };
  if (res.kind === 'refused') return refuse(res.verdict, res.reason);
  const place = placeOf(prompt, res.answer);
  if (place < 0) return refuse('unknown');
  if (bout) {
    if (bout.said.includes(place)) {
      dim(bout, side);
      bout.beat = { kind: 'repeat', side, name: seat.name, answer: res.answer };
      const over = settle(room, bout, now);
      return { ok: true, heard: { kind: 'refused', text, verdict: 'burnt', reason: `${res.answer} has been named already. A lantern goes dark.` }, turn: over ? 'over' : 'next' };
    }
    bout.said.push(place);
    bout.who.push(side);
    seat.said.push(place);
    seat.typed.push(text);
    bout.beat = { kind: 'said', side, name: seat.name, answer: res.answer, tier: res.tier, depth: depthOf(room, prompt, place, false) };
    const over = settle(room, bout, now);
    return { ok: true, heard: { kind: 'sealed', input: text, answer: res.answer, sealed: seat.said.length }, turn: over ? 'over' : 'next' };
  }
  if (seat.said.includes(place)) return refuse('said', `You have already given ${res.answer}.`);
  seat.said.push(place);
  seat.typed.push(text);
  // The last of the class to answer closes a classic question a moment early.
  if (!room.earlyAt && everyoneIn(room)) room.earlyAt = now + ALL_IN_MS;
  return { ok: true, heard: { kind: 'sealed', input: text, answer: res.answer, sealed: seat.said.length } };
}

// ---------------------------------------------------- last diver standing

/** The sides a bout would have: the tables with somebody here, or every diver here when there are no tables. */
function boutSides(room: ClassRoom): ClassOutcomeOf<{ order: Array<number | string> }> {
  const here = room.seats.filter((s) => s.online);
  if (room.config.tables) {
    const order: number[] = [];
    for (let t = 1; t <= room.config.tables; t++) if (here.some((s) => s.table === t)) order.push(t);
    if (!order.length) return fail('phase', 'Last diver standing needs somebody here to take a turn.');
    return { ok: true, order };
  }
  if (!here.length) return fail('phase', 'Last diver standing needs somebody here to take a turn.');
  if (here.length > LAST_MAX_ALONE) return fail('phase', `Last diver standing takes turns: with more than ${LAST_MAX_ALONE} divers, choose tables first.`);
  return { ok: true, order: here.map((s) => s.id) };
}

function newBout(room: ClassRoom, order: Array<number | string>): LastBout {
  const lives = room.config.lanterns ?? CLASS_LANTERNS[0];
  // Another side goes first each question.
  const first = (room.n - 1) % order.length;
  const turnLit = room.litAt + LAST_READ_MS;
  const bout: LastBout = {
    order,
    lanterns: order.map(() => lives),
    lives,
    turn: first,
    turnN: 0,
    turnLit,
    turnEnds: turnLit + room.config.seconds * 1000,
    away: false,
    said: [],
    who: [],
    out: [],
    beat: null,
    ended: null,
    winner: -1,
  };
  room.deadline = bout.turnEnds;
  return bout;
}

/** The side a diver plays for in this bout, as a place in its order; -1 when they only watch. */
function sideOfSeat(room: ClassRoom, bout: LastBout, seat: ClassSeat): number {
  return bout.order.indexOf(room.config.tables ? seat.table : seat.id);
}

/** Whether anybody of a side is here. */
function sideHere(room: ClassRoom, bout: LastBout, side: number): boolean {
  const key = bout.order[side];
  return typeof key === 'number' ? room.seats.some((s) => s.online && s.table === key) : !!room.seats.find((s) => s.id === key)?.online;
}

/** One of a side's lanterns goes dark. */
function dim(bout: LastBout, side: number) {
  if (bout.lanterns[side] <= 0) return;
  bout.lanterns[side]--;
  if (bout.lanterns[side] <= 0) bout.out.push(side);
}

/** Whether the bout is decided as it stands; if so, it is ended (the answers surface a moment later). */
function decided(room: ClassRoom, bout: LastBout, now: number): boolean {
  const lit = bout.order.map((_, k) => k).filter((k) => bout.lanterns[k] > 0);
  let why: ClassLastEnd | null = null;
  if (!lit.length) why = 'none';
  else if (bout.order.length >= 2 && lit.length === 1) why = 'last';
  else if (bout.said.length >= (room.prompt?.answers.length ?? 0)) why = 'dry';
  else if (bout.turnN >= LAST_TURN_CAP) why = 'cap';
  if (!why) return false;
  bout.ended = why;
  bout.winner = why === 'last' ? lit[0] : -1;
  bout.turn = -1;
  bout.away = false;
  bout.turnLit = now;
  bout.turnEnds = now + LAST_END_MS;
  room.deadline = bout.turnEnds;
  return true;
}

/** A turn is over: the bout ends, or the next side with a lantern lit takes its turn. Returns whether the bout is decided. */
function settle(room: ClassRoom, bout: LastBout, now: number): boolean {
  bout.turnN++;
  if (decided(room, bout, now)) return true;
  const n = bout.order.length;
  let next = bout.turn;
  for (let i = 1; i <= n; i++) {
    const k = (bout.turn + i) % n;
    if (bout.lanterns[k] > 0) {
      next = k;
      break;
    }
  }
  bout.turn = next;
  bout.away = !sideHere(room, bout, next);
  bout.turnLit = now + LAST_BEAT_MS;
  bout.turnEnds = bout.turnLit + (bout.away ? LAST_AWAY_MS : room.config.seconds * 1000);
  room.deadline = bout.turnEnds;
  return false;
}

/**
 * A diver has come back. If their side's turn was being waited out because
 * nobody of it was here, the turn starts again with its whole time. Returns
 * whether the turn changed.
 */
export function boutBack(room: ClassRoom, id: string, now: number): boolean {
  const bout = room.phase === 'asking' ? room.last : null;
  const seat = seatOf(room, id);
  if (!bout || !seat || bout.turn < 0 || !bout.away || sideOfSeat(room, bout, seat) !== bout.turn) return false;
  bout.away = false;
  bout.turnLit = now + 400;
  bout.turnEnds = bout.turnLit + room.config.seconds * 1000;
  room.deadline = bout.turnEnds;
  room.touched = now;
  return true;
}

/**
 * A diver alone has left the class or been sent out in the middle of a bout:
 * their lanterns go dark at once, so nobody waits for them. Returns how the
 * bout moved, or null when it did not.
 */
export function boutGone(room: ClassRoom, id: string, now: number): 'next' | 'over' | null {
  const bout = room.phase === 'asking' ? room.last : null;
  if (!bout || bout.turn < 0 || room.config.tables) return null;
  const side = bout.order.indexOf(id);
  if (side < 0 || bout.lanterns[side] <= 0) return null;
  bout.lanterns[side] = 0;
  bout.out.push(side);
  room.touched = now;
  if (bout.turn === side) {
    bout.beat = { kind: 'away', side };
    return settle(room, bout, now) ? 'over' : 'next';
  }
  return decided(room, bout, now) ? 'over' : 'next';
}

/** The sides as they stand: lanterns, answers named, and the metres those are worth. */
function boutSideRows(room: ClassRoom, bout: LastBout): ClassLastSide[] {
  const prompt = room.prompt;
  const rows: ClassLastSide[] = bout.order.map((key, k) => {
    const seat = typeof key === 'string' ? room.seats.find((s) => s.id === key) : undefined;
    return { table: typeof key === 'number' ? key : 0, ...(typeof key === 'string' ? { id: key, name: seat?.name ?? 'A diver who left' } : {}), lanterns: bout.lanterns[k], said: 0, gain: 0 };
  });
  bout.said.forEach((place, i) => {
    const row = rows[bout.who[i]];
    if (!row || !prompt) return;
    row.said++;
    row.gain += depthOf(room, prompt, place, false);
  });
  return rows;
}

/** A bout as the screens are shown it, with the newest `max` answers named. */
export function boutView(room: ClassRoom, max = Infinity): ClassLastView | null {
  const bout = room.last;
  const prompt = room.prompt;
  if (!bout || !prompt) return null;
  const said: ClassLastView['said'] = [];
  for (let i = bout.said.length - 1; i >= 0 && said.length < max; i--) {
    const a = prompt.answers[bout.said[i]];
    if (a) said.push({ answer: a.answer, tier: a.tier, side: bout.who[i] });
  }
  return {
    sides: boutSideRows(room, bout),
    turn: bout.turn,
    turnN: bout.turnN,
    turnLit: bout.turnLit,
    turnEnds: bout.turnEnds,
    lanterns: bout.lives,
    said,
    saidN: bout.said.length,
    left: Math.max(0, prompt.answers.length - bout.said.length),
    ...(bout.away ? { away: true } : {}),
    ...(bout.beat ? { beat: bout.beat } : {}),
    ...(bout.ended ? { ended: bout.ended, winner: bout.winner } : {}),
  };
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
  // A bout of last diver standing: the host may call it before it is decided.
  const bout = mode === 'last' ? room.last : null;
  if (bout && !bout.ended) {
    bout.ended = 'host';
    bout.turn = -1;
  }
  // In a bout every answer is named once, so none is a lone voice: each is worth its plain depth.
  const lone = (i: number) => !bout && voices.get(i)?.length === 1;
  // A bout keeps its own record of what was named and for which side. It stands even when the diver who named it has since been sent out.
  const given: { has(i: number): boolean } = bout ? new Set(bout.said) : voices;
  const winnerKey = bout && bout.winner >= 0 ? bout.order[bout.winner] : undefined;
  for (const s of room.seats) {
    s.gain = s.said.reduce((n, i) => n + depthOf(room, prompt, i, lone(i)), 0);
    if (winnerKey === s.id) s.gain += LAST_BONUS;
    s.total += s.gain;
  }

  let tableGains: ClassTableGain[] | undefined;
  if (tables > 0) {
    const gave = Array.from({ length: tables + 1 }, () => new Set<number>());
    if (bout) {
      bout.said.forEach((place, k) => {
        const key = bout.order[bout.who[k]];
        if (typeof key === 'number') gave[key]?.add(place);
      });
    } else {
      for (const s of room.seats) if (s.table >= 1 && s.table <= tables) for (const i of s.said) gave[s.table].add(i);
    }
    const tablesGave = new Map<number, number>();
    for (let t = 1; t <= tables; t++) for (const i of gave[t]) tablesGave.set(i, (tablesGave.get(i) ?? 0) + 1);
    tableGains = [];
    for (let t = 1; t <= tables; t++) {
      const counted = [...gave[t]]
        .map((i) => {
          const alone = !bout && tablesGave.get(i) === 1;
          return { i, answer: prompt.answers[i].answer, tier: prompt.answers[i].tier, depth: depthOf(room, prompt, i, alone), lone: alone };
        })
        .sort((a, b) => b.depth - a.depth || a.i - b.i)
        .slice(0, TABLE_COUNTS[mode]);
      const bonus = winnerKey === t ? LAST_BONUS : 0;
      const gain = counted.reduce((n, c) => n + c.depth, 0) + bonus;
      room.tables[t] = (room.tables[t] ?? 0) + gain;
      tableGains.push({ table: t, gain, total: room.tables[t], counted: counted.slice(0, TABLE_LISTED).map(({ answer, tier, depth, lone }) => ({ answer, tier, depth, lone })), ...(bonus ? { bonus } : {}) });
    }
    tableGains.sort((a, b) => b.gain - a.gain || a.table - b.table);
  }

  const rows: ClassAnswerRow[] = (bout ? bout.said : [...voices.keys()])
    .map((i) => {
      const seats = voices.get(i) ?? [];
      return {
        answer: prompt.answers[i].answer,
        tier: prompt.answers[i].tier,
        voices: bout ? 1 : seats.length,
        names: seats.slice(0, CLASS_NAMES).map((s) => s.name),
        depth: depthOf(room, prompt, i, lone(i)),
      };
    })
    .sort((a, b) => b.tier - a.tier || a.voices - b.voices || (a.answer < b.answer ? -1 : 1));
  const unsaid = prompt.answers
    .filter((_, i) => !given.has(i))
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
    ...(bout ? { last: { ended: bout.ended ?? 'host', sides: boutSideRows(room, bout), winner: bout.winner, bonus: LAST_BONUS, turns: bout.turnN, lanterns: bout.lives } } : {}),
  };
  room.phase = 'reveal';
  room.earlyAt = 0;
  room.last = null;
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
  room.last = null;
  room.phase = 'lobby';
  room.touched = now;
  return { ok: true };
}

/**
 * When a burning question next needs the relay: its time out, or sooner once
 * everyone is in. In a bout of last diver standing: the end of the turn, or
 * the moment a decided bout's answers surface.
 */
export function closesAt(room: ClassRoom): number {
  const bout = room.config.mode === 'last' ? room.last : null;
  if (bout) return bout.turn < 0 ? bout.turnEnds : bout.turnEnds + GRACE_MS;
  return Math.min(room.deadline + GRACE_MS, room.earlyAt || Infinity);
}

/** When the relay must wake: a burning question's end, or the room's own. */
export function classAlarmAt(room: ClassRoom): number {
  const expiry = room.touched + CLASS_TTL_MS;
  return room.phase === 'asking' ? Math.min(closesAt(room), expiry) : expiry;
}

/**
 * The alarm rang. A question whose time is out is revealed ('reveal'). In a
 * bout of last diver standing, a turn whose time is out costs its side a
 * lantern and the turn passes on ('turn'). False when nothing was due.
 */
export function classTick(room: ClassRoom, now: number): 'reveal' | 'turn' | false {
  if (room.phase !== 'asking' || now < closesAt(room)) return false;
  const bout = room.config.mode === 'last' ? room.last : null;
  if (bout && bout.turn >= 0) {
    const side = bout.turn;
    dim(bout, side);
    bout.beat = { kind: bout.away ? 'away' : 'dark', side };
    settle(room, bout, now);
    room.touched = now;
    return 'turn';
  }
  return reveal(room, now) ? 'reveal' : false;
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

/** A bout of last diver standing, when one is on, for a view. */
function boutPart(room: ClassRoom, max: number): { last?: ClassLastView } {
  const last = room.phase === 'asking' && room.config.mode === 'last' ? boutView(room, max) : null;
  return last ? { last } : {};
}

/** What the big screen is shown: the whole roll and every standing, never a diver's sealed answer. */
export function hostView(room: ClassRoom, snap: ClassSnap): ClassView {
  return {
    ...baseView(room, snap, 'host'),
    ...boutPart(room, Infinity),
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
    // In a bout of last diver standing every answer was named once, and is worth its plain depth.
    const bout = room.result?.mode === 'last';
    outcome = {
      answers: s.said.map((i, k) => {
        const n = snap.voices.get(i) ?? 1;
        return { input: s.typed[k] ?? '', answer: prompt.answers[i]?.answer ?? '', tier: prompt.answers[i]?.tier ?? 0, voices: n, depth: depthOf(room, prompt, i, !bout && n === 1) };
      }),
      gain: s.gain,
    };
  }
  const sealed = room.phase === 'asking' && prompt ? s.said.map((i, k) => ({ input: s.typed[k] ?? '', answer: prompt.answers[i]?.answer ?? '' })) : [];
  return {
    ...baseView(room, snap, 'seat'),
    ...boutPart(room, LAST_SEAT_SAID),
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
