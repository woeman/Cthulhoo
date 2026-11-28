import type { ActivePrompt, AnswerRecord, DayRecord, Settings } from './types';
import type { Dispute } from './disputes';
import type { Sighting } from './bestiary';

// Everything lives in the player's own browser. Every access is guarded, because
// storage can be missing or throw (private windows, blocked site data, previews).

const NS = 'cthulhoo.v1';
const mem = new Map<string, string>();
// Keys whose last write reached memory only (quota full, storage blocked). The
// copy left in localStorage is older, so memory is the truth for them.
const unsaved = new Set<string>();
let ephemeral = false;

/** Keep everything in memory only (used by ?fresh for previews and tests). */
export function setEphemeral(on: boolean): void {
  ephemeral = on;
}

/** Whether nothing is being kept (?fresh): such a dive is not told to the census either. */
export const isEphemeral = (): boolean => ephemeral;

function read(key: string): string | null {
  if (ephemeral || unsaved.has(key)) return mem.get(key) ?? null;
  try {
    const v = localStorage.getItem(`${NS}.${key}`);
    if (v !== null) return v;
  } catch {
    /* fall through to memory */
  }
  return mem.get(key) ?? null;
}

function write(key: string, value: string): void {
  mem.set(key, value);
  if (ephemeral) return;
  try {
    localStorage.setItem(`${NS}.${key}`, value);
    unsaved.delete(key);
  } catch {
    unsaved.add(key); // the memory copy keeps the session working
  }
}

function readJson(key: string): unknown {
  const raw = read(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

type Json = Record<string, unknown>;
const asObject = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter(isStr) : []);

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 0.8, reducedMotion: 'auto', haptics: true, music: true };
const MOTION: Array<Settings['reducedMotion']> = ['auto', 'on', 'off'];

export function loadSettings(): Settings {
  const s = asObject(readJson('settings'));
  const motion = MOTION.find((m) => m === s.reducedMotion);
  return {
    muted: typeof s.muted === 'boolean' ? s.muted : DEFAULT_SETTINGS.muted,
    volume: isNum(s.volume) ? Math.max(0, Math.min(1, s.volume)) : DEFAULT_SETTINGS.volume,
    reducedMotion: motion ?? DEFAULT_SETTINGS.reducedMotion,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULT_SETTINGS.haptics,
    music: typeof s.music === 'boolean' ? s.music : DEFAULT_SETTINGS.music,
  };
}

export function saveSettings(s: Settings): void {
  write('settings', JSON.stringify(s));
}

function cleanAnswer(v: unknown): AnswerRecord | null {
  const a = asObject(v);
  if (!isStr(a.promptId) || !isNum(a.depth) || !Number.isInteger(a.tier) || (a.tier as number) < 0 || (a.tier as number) > 6) return null;
  return {
    ...(a as unknown as AnswerRecord),
    input: isStr(a.input) ? a.input : null,
    answer: isStr(a.answer) ? a.answer : null,
    rejects: strings(a.rejects),
    timeMs: isNum(a.timeMs) ? a.timeMs : 0,
  };
}

function cleanActive(v: unknown): ActivePrompt | null {
  const a = asObject(v);
  if (!Number.isInteger(a.index) || !isNum(a.startedAt)) return null;
  return { ...(a as unknown as ActivePrompt), rejects: strings(a.rejects) };
}

/** A saved day as the game can use it, or null when it is too damaged to trust. */
function cleanDay(v: unknown, key: string): DayRecord | null {
  const r = asObject(v);
  if (!Number.isInteger(r.day) || String(r.day) !== key || r.practice) return null;
  if (!Array.isArray(r.promptIds) || !r.promptIds.every(isStr) || !Array.isArray(r.answers)) return null;
  const answers = r.answers.map(cleanAnswer);
  if (!answers.every((a): a is AnswerRecord => !!a)) return null;
  return {
    ...(r as unknown as DayRecord),
    date: isStr(r.date) ? r.date : '',
    omen: isStr(r.omen) ? r.omen : 'still',
    answers,
    sanity: isNum(r.sanity) ? Math.max(0, Math.min(100, Math.round(r.sanity))) : 100,
    finished: r.finished === true,
    active: cleanActive(r.active),
  };
}

/** Saved daily dives by day. Parseable but damaged data is dropped rather than crashing the game. */
export function loadDays(): Record<number, DayRecord> {
  const out: Record<number, DayRecord> = {};
  for (const [key, v] of Object.entries(asObject(readJson('days')))) {
    const rec = cleanDay(v, key);
    if (rec) out[rec.day] = rec;
  }
  return out;
}

/** True when `next` only adds to `prev`: every stored answer kept, a finished dive still finished. */
function extendsDive(prev: DayRecord | undefined, next: DayRecord): boolean {
  if (!prev) return true;
  if (prev.finished && !next.finished) return false;
  return prev.answers.every((a, i) => {
    const b = next.answers[i];
    return !!b && b.promptId === a.promptId && b.answer === a.answer && b.tier === a.tier;
  });
}

/**
 * Saves a daily dive and says whether it did. Practice dives are never
 * recorded. A save that would undo progress, such as a second tab still on a
 * question this one has answered, is refused, so a stale copy cannot overwrite
 * or re-answer a question.
 */
export function saveDay(rec: DayRecord): boolean {
  if (rec.practice) return false;
  const all = loadDays();
  if (!extendsDive(all[rec.day], rec)) return false;
  all[rec.day] = rec;
  write('days', JSON.stringify(all));
  return true;
}

export function loadFlag(name: string): boolean {
  return read(`flag.${name}`) === '1';
}

export function saveFlag(name: string, on = true): void {
  write(`flag.${name}`, on ? '1' : '0');
}

/** A small number kept between visits (such as the day a telegram was last shown). */
export function loadNumber(name: string): number | null {
  const raw = read(`num.${name}`);
  const v = raw === null ? NaN : Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function saveNumber(name: string, value: number): void {
  write(`num.${name}`, String(value));
}

/** The topics last ticked for a dive or a party, as topic ids. Checked against the topics there are when used. */
export function loadTopics(): string[] {
  const raw = readJson('topics');
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').slice(0, 64) : [];
}

export function saveTopics(choice: string[]): void {
  write('topics', JSON.stringify(choice.slice(0, 64)));
}

const VERDICTS = ['unknown', 'decoy', 'trap', 'ambiguous'];

/** Answers the player says the deep was wrong to refuse, oldest first. */
export function loadDisputes(): Dispute[] {
  const raw = readJson('disputes');
  if (!Array.isArray(raw)) return [];
  return raw
    .map(asObject)
    .filter((d) => isStr(d.promptId) && isStr(d.input) && isStr(d.question) && VERDICTS.includes(d.verdict as string) && Number.isInteger(d.day) && isNum(d.at))
    .map((d) => d as unknown as Dispute);
}

export function saveDisputes(list: Dispute[]): void {
  write('disputes', JSON.stringify(list));
}

/** The creatures the player has seen, by id. */
export function loadSightings(): Record<string, Sighting> {
  const out: Record<string, Sighting> = {};
  for (const [id, v] of Object.entries(asObject(readJson('sightings')))) {
    const s = asObject(v);
    if (Number.isInteger(s.day) && isNum(s.depth) && isNum(s.at) && isStr(s.promptId)) out[id] = { id, day: s.day as number, depth: s.depth, at: s.at, promptId: s.promptId };
  }
  return out;
}

/** Keep a sighting. The first sighting of a creature is the one that stays. */
export function saveSighting(s: Sighting): void {
  const all = loadSightings();
  if (all[s.id]) return;
  all[s.id] = s;
  write('sightings', JSON.stringify(all));
}

/** A daily question's census as this browser last heard it: divers that day, and how many gave your answer. */
export interface CensusKept {
  total: number;
  mine: number;
}

const CENSUS_KEPT_MAX = 3000; // about a year of dives; the oldest days go first

const censusKey = (day: number, promptId: string) => `${day}|${promptId}`;

/** The census shares heard for past daily answers, by day and question ("12|cap-1"). */
export function loadCensusKept(): Record<string, CensusKept> {
  const out: Record<string, CensusKept> = {};
  for (const [key, v] of Object.entries(asObject(readJson('census')))) {
    const c = asObject(v);
    if (!/^\d+\|/.test(key) || !isNum(c.total) || !isNum(c.mine) || c.total < 0 || c.mine < 0) continue;
    out[key] = { total: Math.floor(c.total), mine: Math.floor(Math.min(c.mine, c.total)) };
  }
  return out;
}

/** The census for one daily answer as heard. Counts only grow in a day, so the larger is kept. */
export function keepCensus(day: number, promptId: string, c: CensusKept): void {
  const all = loadCensusKept();
  const key = censusKey(day, promptId);
  const was = all[key];
  if (was && was.total >= c.total) return;
  all[key] = { total: c.total, mine: Math.min(c.mine, c.total) };
  const keys = Object.keys(all);
  if (keys.length > CENSUS_KEPT_MAX) {
    keys.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    for (const k of keys.slice(0, keys.length - CENSUS_KEPT_MAX)) delete all[k];
  }
  write('census', JSON.stringify(all));
}

/** The kept census for one daily answer, if any was heard. */
export const censusKeptFor = (kept: Record<string, CensusKept>, day: number, promptId: string): CensusKept | undefined => kept[censusKey(day, promptId)];

const ID_RE = /^[a-z0-9]{8,32}$/;

/**
 * A random name for this browser, made once and kept: the seed for the Logbook's
 * title and synopsis, and later the player's mark in a séance. Not an account.
 */
export function playerId(): string {
  const saved = read('id');
  if (saved && ID_RE.test(saved)) return saved;
  const bytes = new Uint8Array(12);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const id = Array.from(bytes, (b) => (b % 36).toString(36)).join('');
  write('id', id);
  return id;
}

// ---------------------------------------------------------------- riddles
// The Whispering Deep keeps one attempt a day, keyed by day like the dives.

type RiddleAttempt = import('./riddles').RiddleAttempt;
type RiddleTry = import('./riddles').RiddleTry;
const RIDDLE_STATES = ['playing', 'solved', 'sunk'];

function cleanRiddleTry(v: unknown): RiddleTry | null {
  const t = asObject(v);
  if (!isStr(t.text) || !t.text.trim()) return null;
  return t.near === true ? { text: t.text, near: true } : { text: t.text };
}

/** A saved riddle attempt as the game can use it, or null when it is too damaged to trust. */
function cleanRiddleAttempt(v: unknown, key: string): RiddleAttempt | null {
  const a = asObject(v);
  if (!Number.isInteger(a.day) || String(a.day) !== key || !isStr(a.riddleId) || !a.riddleId || !RIDDLE_STATES.includes(a.status as string)) return null;
  if (!Array.isArray(a.tries) || !Number.isInteger(a.hints) || (a.hints as number) < 0) return null;
  const tries = a.tries.map(cleanRiddleTry);
  if (!tries.every((t): t is RiddleTry => !!t)) return null;
  const page = asObject(a.page);
  return {
    day: a.day as number,
    date: isStr(a.date) ? a.date : '',
    riddleId: a.riddleId,
    tries,
    hints: a.hints as number,
    status: a.status as RiddleAttempt['status'],
    ...(a.gaveUp === true ? { gaveUp: true } : {}),
    ...(isStr(a.answer) ? { answer: a.answer } : {}),
    ...(isStr(a.input) ? { input: a.input } : {}),
    ...(isNum(a.metres) && a.metres >= 0 ? { metres: a.metres } : {}),
    ...(isStr(page.title) && isStr(page.text) ? { page: { title: page.title, text: page.text } } : {}),
    ...(isNum(a.startedAt) ? { startedAt: a.startedAt } : {}),
    ...(isNum(a.endedAt) ? { endedAt: a.endedAt } : {}),
  };
}

/** Saved riddle attempts by day. Parseable but damaged entries are dropped rather than crashing the game. */
export function loadRiddles(): Record<number, RiddleAttempt> {
  const out: Record<number, RiddleAttempt> = {};
  for (const [key, v] of Object.entries(asObject(readJson('riddles')))) {
    const rec = cleanRiddleAttempt(v, key);
    if (rec) out[rec.day] = rec;
  }
  return out;
}

/**
 * True when `next` only adds to `prev`: every refused guess kept in order, no
 * whisper forgotten, and a finished riddle left as it ended. An unfinished attempt
 * at a riddle the bank has since lost may be replaced by today's riddle.
 */
function extendsRiddle(prev: RiddleAttempt | undefined, next: RiddleAttempt): boolean {
  if (!prev) return true;
  if (prev.riddleId !== next.riddleId) return prev.status === 'playing';
  if (prev.status !== 'playing') return next.status === prev.status && next.hints === prev.hints && next.tries.length === prev.tries.length;
  return next.hints >= prev.hints && prev.tries.every((t, i) => next.tries[i]?.text === t.text);
}

/**
 * Saves a day's riddle attempt and says whether it did. A save that would undo
 * progress, such as a second tab still a guess behind, is refused, so a stale copy
 * can never give back a breath, unhear a whisper or play a finished riddle again.
 */
export function saveRiddle(a: RiddleAttempt): boolean {
  if (!Number.isInteger(a.day)) return false;
  const all = loadRiddles();
  if (!extendsRiddle(all[a.day], a)) return false;
  all[a.day] = a;
  write('riddles', JSON.stringify(all));
  return true;
}
