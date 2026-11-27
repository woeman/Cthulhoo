// The Cult: a standing circle of friends, found by a sign like BRINE-42, and a
// board of how deep each of them dived this week. Pure, like room.ts: the
// surface relay keeps the board and the game draws it.

import { EPOCH_UTC } from '../game/daily';
import { cleanName, type Outcome } from './room';

export const CULT_MAX = 30;
/** How many weeks of dives a cult remembers. */
export const WEEKS_KEPT = 8;
/** No daily dive goes deeper than this, whatever the omens. */
export const DIVE_MAX = 20_000;
export const CULT_MARKS = 12;
const DAY_MS = 86_400_000;

export interface CultMember {
  id: string;
  name: string;
  mark: number;
  joined: number;
}

export interface Cult {
  v: 1;
  sign: string;
  created: number;
  touched: number;
  members: CultMember[];
  /** Each member's daily depths: member id, then day number, then metres. */
  dives: Record<string, Record<string, number>>;
  nextMark: number;
}

export interface CultRow {
  id: string;
  name: string;
  mark: number;
  /** Metres this week. */
  total: number;
  /** Monday to Sunday: the day's depth, or null for a day not dived (or still to come). */
  days: Array<number | null>;
}

export interface CultBoard {
  sign: string;
  /** The day number of this week's Monday. */
  week: number;
  today: number;
  /** Deepest this week first. */
  rows: CultRow[];
  /** The whole cult's metres this week. */
  total: number;
  /** Last week's deepest, more than one on a tie, and how deep they went. */
  lastWeek: { names: string[]; depth: number } | null;
  /** Whether the one asking is a member. */
  member: boolean;
}

const fail = (code: 'full' | 'gone' | 'name' | 'bad', message: string) => ({ ok: false as const, code, message });

/** The Monday of the week a day falls in. Day 1, 27 November 2026, was a Friday. */
export const weekOf = (day: number): number => day - ((((day + 3) % 7) + 7) % 7);

/** Today by the relay's clock, in UTC. A player's own day is never more than one away from it. */
export const relayDay = (now: number): number => Math.floor((now - EPOCH_UTC) / DAY_MS) + 1;

export function newCult(sign: string, now: number): Cult {
  return { v: 1, sign, created: now, touched: now, members: [], dives: {}, nextMark: 0 };
}

export function reviveCult(raw: unknown): Cult | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Cult;
  return c.v === 1 && typeof c.sign === 'string' && Array.isArray(c.members) && c.dives && typeof c.dives === 'object' ? c : null;
}

const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{4,40}$/.test(id);

export function joinCult(cult: Cult, id: unknown, rawName: unknown, now: number): Outcome<{ member: CultMember }> {
  if (!validId(id)) return fail('bad', 'That device has no proper mark.');
  const name = cleanName(rawName);
  const known = cult.members.find((m) => m.id === id);
  if (known) {
    if (name) known.name = name;
    cult.touched = now;
    return { ok: true, member: known };
  }
  if (!name) return fail('name', 'Give the cult a name to call you by.');
  if (cult.members.length >= CULT_MAX) return fail('full', `The cult is full: ${CULT_MAX} is as many as it can hold.`);
  const member: CultMember = { id, name, mark: cult.nextMark++ % CULT_MARKS, joined: now };
  cult.members.push(member);
  cult.touched = now;
  return { ok: true, member };
}

export function leaveCult(cult: Cult, id: string, now: number): void {
  cult.members = cult.members.filter((m) => m.id !== id);
  delete cult.dives[id];
  cult.touched = now;
}

/** A member's daily dive, as deep as it went. A second report of the same day keeps the deeper. */
export function recordDive(cult: Cult, id: unknown, day: unknown, depth: unknown, now: number): Outcome {
  if (!validId(id) || !cult.members.some((m) => m.id === id)) return fail('gone', 'You are not of this cult.');
  const today = relayDay(now);
  if (typeof day !== 'number' || !Number.isInteger(day) || Math.abs(day - today) > 1) return fail('bad', 'That dive is not from today.');
  if (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0) return fail('bad', 'That is not a depth.');
  const mine = (cult.dives[id] ??= {});
  mine[day] = Math.max(mine[day] ?? 0, Math.min(DIVE_MAX, Math.round(depth)));
  cult.touched = now;
  pruneCult(cult, today);
  return { ok: true };
}

/** Forget dives older than the weeks a cult remembers. */
export function pruneCult(cult: Cult, today: number): void {
  const oldest = weekOf(today) - 7 * (WEEKS_KEPT - 1);
  for (const id of Object.keys(cult.dives)) {
    if (!cult.members.some((m) => m.id === id)) {
      delete cult.dives[id];
      continue;
    }
    for (const d of Object.keys(cult.dives[id])) if (Number(d) < oldest) delete cult.dives[id][d];
  }
}

function weekTotal(cult: Cult, id: string, monday: number): number {
  let total = 0;
  for (let d = monday; d < monday + 7; d++) total += cult.dives[id]?.[d] ?? 0;
  return total;
}

/** The board for one week, as one member (or a passer-by with the sign) sees it. */
export function boardFor(cult: Cult, viewer: string, today: number): CultBoard {
  const week = weekOf(today);
  const rows: CultRow[] = cult.members.map((m) => ({
    id: m.id,
    name: m.name,
    mark: m.mark,
    total: weekTotal(cult, m.id, week),
    days: Array.from({ length: 7 }, (_, i) => cult.dives[m.id]?.[week + i] ?? null),
  }));
  rows.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  const last = cult.members.map((m) => ({ name: m.name, depth: weekTotal(cult, m.id, week - 7) }));
  const best = Math.max(0, ...last.map((l) => l.depth));
  return {
    sign: cult.sign,
    week,
    today,
    rows,
    total: rows.reduce((s, r) => s + r.total, 0),
    lastWeek: best > 0 ? { names: last.filter((l) => l.depth === best).map((l) => l.name), depth: best } : null,
    member: cult.members.some((m) => m.id === viewer),
  };
}
