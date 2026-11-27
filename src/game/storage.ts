import type { DayRecord, Settings } from './types';

// Everything lives in the player's own browser. Every access is guarded, because
// storage can be missing or throw (private windows, blocked site data, previews).

const NS = 'cthulhoo.v1';
const mem = new Map<string, string>();
let ephemeral = false;

/** Keep everything in memory only (used by ?fresh for previews and tests). */
export function setEphemeral(on: boolean): void {
  ephemeral = on;
}

function read(key: string): string | null {
  if (ephemeral) return mem.get(key) ?? null;
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
  } catch {
    /* memory copy keeps the session working */
  }
}

function readJson<T>(key: string, fallback: T): T {
  const raw = read(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export const DEFAULT_SETTINGS: Settings = { muted: false, volume: 0.8, reducedMotion: 'auto', haptics: true };

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...readJson<Partial<Settings>>('settings', {}) };
}

export function saveSettings(s: Settings): void {
  write('settings', JSON.stringify(s));
}

export function loadDays(): Record<number, DayRecord> {
  return readJson<Record<number, DayRecord>>('days', {});
}

export function saveDay(rec: DayRecord): void {
  if (rec.practice) return; // practice dives are never recorded
  const all = loadDays();
  all[rec.day] = rec;
  write('days', JSON.stringify(all));
}

export function loadFlag(name: string): boolean {
  return read(`flag.${name}`) === '1';
}

export function saveFlag(name: string, on = true): void {
  write(`flag.${name}`, on ? '1' : '0');
}
