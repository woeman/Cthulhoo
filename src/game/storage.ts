import type { ActivePrompt, AnswerRecord, DayRecord, Settings } from './types';

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

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 0.8, reducedMotion: 'auto', haptics: true };
const MOTION: Array<Settings['reducedMotion']> = ['auto', 'on', 'off'];

export function loadSettings(): Settings {
  const s = asObject(readJson('settings'));
  const motion = MOTION.find((m) => m === s.reducedMotion);
  return {
    muted: typeof s.muted === 'boolean' ? s.muted : DEFAULT_SETTINGS.muted,
    volume: isNum(s.volume) ? Math.max(0, Math.min(1, s.volume)) : DEFAULT_SETTINGS.volume,
    reducedMotion: motion ?? DEFAULT_SETTINGS.reducedMotion,
    haptics: typeof s.haptics === 'boolean' ? s.haptics : DEFAULT_SETTINGS.haptics,
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
