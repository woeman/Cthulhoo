// The Séance's screens, worked out without the DOM: which questions to ask, the
// order the answers surface in, the circle's standings, and the small phrases
// the screens are made of. Everything here is pure, so it is tested on its own.

import { dateKeyForDay, hashString, practiceQueue, practiceRank } from '../../game/daily';
import { dealByTopic, fitBudget, topicsPhrase } from '../../game/topics';
import type { BankDay, PromptDef, ThemeCopy } from '../../game/types';
import type { CultBoard } from '../../party/cult';
import { candleOut, type PassState } from '../../party/passplay';
import { LONE_BONUS } from '../../party/room';
import type { CandleResult, SeanceView, Voice } from '../../party/types';
import type { Seat } from './types';

/**
 * The Drowned Script glyph each sitter carries, by their mark (join order, 0 to 11):
 * the twelve glyphs that are not letters of the city's true name, in the order
 * they stand round the séance table, clockwise from the top (docs/art/06-interface.md).
 */
export const MARK_GLYPHS = ['tide', 'fang', 'anchor', 'talon', 'sounding', 'maw', 'root', 'veil', 'spire', 'knot', 'hand', 'void'] as const;

/** The table has a chair for each mark. */
export const SEATS = MARK_GLYPHS.length;

const wrap = (n: number, m: number) => ((Math.trunc(n) % m) + m) % m;

/** The sprite id of a sitter's glyph. */
export const glyphId = (mark: number): string => `g-${MARK_GLYPHS[wrap(mark, MARK_GLYPHS.length)]}`;

/**
 * Each sitter's diver takes one of the six tier colours, the most distinct ones
 * first (cyan, amber, magenta, green, pearl, bone), so a small circle never
 * shares a colour. The glyph tells two sitters of one colour apart.
 */
const TINTS = [3, 2, 5, 4, 6, 1] as const;
export const tintOf = (mark: number): number => TINTS[wrap(mark, TINTS.length)];

/** Metres for each tier, [0] silence, as the relay and pass-and-play take them. */
export function tierDepths(theme: ThemeCopy): number[] {
  return [0, ...[1, 2, 3, 4, 5, 6].map((t) => theme.tiers.find((x) => x.tier === t)?.depth ?? 0)];
}

export interface Bankish {
  prompts: PromptDef[];
  byId: Map<string, PromptDef>;
  days: BankDay[];
}

/**
 * The questions for one sitting: a practice set (never today's daily questions,
 * nor the coming week's while the bank allows) cut to the candle count. The seed
 * comes from the sign and the sitting, so the same circle sitting again is asked
 * new questions; any asked before in this séance go to the back of the queue.
 */
export function choosePrompts(bank: Bankish, avoid: string[], key: string, sitting: number, today: number, count: number, asked: string[] = [], from: Chosen = {}): PromptDef[] {
  const seed = hashString(`${key.toUpperCase()}#${sitting}`);
  const skip = [...avoid, ...asked];
  // Chosen topics may be few questions: today's dive is left out of them outright, not just put last.
  const among = from.among?.filter((p) => !avoid.includes(p.id));
  let ids = practiceQueue(bank.prompts, skip, seed, today, bank.days, among ?? bank.prompts);
  if (among && from.topicOf) {
    const byId = new Map(among.map((p) => [p.id, p]));
    const topicOf = from.topicOf;
    ids = dealByTopic(ids, practiceRank(bank.prompts, skip, today, bank.days), (id) => topicOf(byId.get(id) ?? { id, category: '' }));
  }
  const found = ids.map((id) => bank.byId.get(id)).filter((p): p is PromptDef => !!p);
  return fitBudget(found, Math.max(1, count), from.budget ?? Infinity);
}

/** What a sitting's questions are drawn from, when the medium ticked topics. */
export interface Chosen {
  /** The questions of the ticked topics (class packs included). Absent: the whole daily bank. */
  among?: PromptDef[];
  /** A question's topic, so several topics are dealt evenly. */
  topicOf?: (p: Pick<PromptDef, 'id' | 'category'>) => string;
  /** The most characters the questions may come to as JSON (one message to the relay). */
  budget?: number;
}

/**
 * The questions of an online séance go to the relay in one message, which it
 * caps at 1,000,000 characters. Seven of the daily bank's longest come to under
 * half that; a class pack's list of every listed company is longer, so a sitting
 * that would not fit asks the next question in line instead.
 */
export const BEGIN_BUDGET = 900_000;

/** How the séance is held, in a line: candles, seconds, and the topics when some were chosen. */
export function configLine(config: SeanceView['config']): string {
  const base = `${capitalise(cardinal(config.candles))} candles · ${config.seconds} seconds each`;
  return config.topics?.length ? `${base} · ${topicsPhrase(config.topics)}` : base;
}

/** The order the answers surface in: silence first, then shallowest to deepest. Ties keep the circle's order. */
export function revealOrder(voices: Voice[]): Voice[] {
  return voices
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v.depth - b.v.depth || (a.v.input === null ? 0 : 1) - (b.v.input === null ? 0 : 1) || a.i - b.i)
    .map((x) => x.v);
}

/** The line under a voice: how alone it was. */
export function voiceNote(v: Pick<Voice, 'input' | 'voices'>): string {
  if (v.input === null) return 'The candle went out';
  if (v.voices <= 1) return `A lone voice · ×${LONE_BONUS}`;
  return `A chorus of ${v.voices} · the depth is shared`;
}

/** The same note as it is read aloud. */
export function voiceNoteSpoken(v: Pick<Voice, 'input' | 'voices'>): string {
  if (v.input === null) return 'the candle went out';
  if (v.voices <= 1) return `a lone voice, half as deep again`;
  return `a chorus of ${v.voices}, the depth shared`;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Whether what was typed reads as the answer it was taken for (so "taken as" need not be said). */
export const sameWords = (typed: string, answer: string): boolean => fold(typed) === fold(answer);

export interface Standing {
  id: string;
  total: number;
  /** What the last candle added. */
  gain: number;
  /** 1 is deepest; sitters on the same depth share a rank. */
  rank: number;
  tied: boolean;
}

/** The circle, deepest first; ties keep the circle's order and share their rank. */
export function standings(ids: string[], totals: Record<string, number>, gains: Record<string, number> = {}): Standing[] {
  const rows = ids.map((id, i) => ({ id, i, total: totals[id] ?? 0, gain: gains[id] ?? 0 }));
  rows.sort((a, b) => b.total - a.total || a.i - b.i);
  return rows.map((r) => {
    const rank = 1 + rows.filter((x) => x.total > r.total).length;
    const tied = rows.some((x) => x !== r && x.total === r.total);
    return { id: r.id, total: r.total, gain: r.gain, rank, tied };
  });
}

/** What each sitter's total was before a candle's answers surfaced. */
export function totalsBefore(totals: Record<string, number>, result: CandleResult | null | undefined): Record<string, number> {
  const out = { ...totals };
  for (const v of result?.voices ?? []) out[v.sitter] = Math.max(0, (out[v.sitter] ?? 0) - v.depth);
  return out;
}

export const gainsOf = (result: CandleResult | null | undefined): Record<string, number> => Object.fromEntries((result?.voices ?? []).map((v) => [v.sitter, v.depth]));

/** The deepest total in the circle. */
export const deepest = (totals: Record<string, number>, ids?: string[]): number => Math.max(0, ...(ids ?? Object.keys(totals)).map((id) => totals[id] ?? 0));

/** Whole seconds of candle left (it shows the full count before it catches). */
export function secondsLeft(now: number, litAt: number, deadline: number): number {
  const total = Math.max(0, deadline - litAt);
  const left = Math.min(total, deadline - Math.max(now, litAt));
  return Math.max(0, Math.ceil(left / 1000));
}

/** How much of the candle has burnt, 0 to 1. */
export function burnt(now: number, litAt: number, deadline: number): number {
  const total = deadline - litAt;
  if (!(total > 0)) return now >= deadline ? 1 : 0;
  return Math.max(0, Math.min(1, (now - litAt) / total));
}

/** "Ada", "Ada and Bram", "Ada, Bram and Cleo". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Ordinals for the lantern's turn: "first of four". */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
const CARDINALS = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
export const ordinal = (n: number): string => ORDINALS[n - 1] ?? `${n}th`;
export const cardinal = (n: number): string => CARDINALS[n] ?? String(n);
export const capitalise = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The game's own address with the sign on it, for sharing: …/?seance=DAGON-7 */
export function shareLink(href: string, sign: string, param = 'seance'): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return `?${param}=${encodeURIComponent(sign)}`;
  }
  url.search = '';
  url.hash = '';
  url.searchParams.set(param, sign);
  return url.toString();
}

/** The water column's depth at its foot: a round number a little below the deepest diver. */
export function columnScale(max: number): number {
  return Math.max(1000, Math.ceil((Math.max(0, max) * 1.12 + 1) / 500) * 500);
}

/** A depth for a small cell: 840, 1.2k, 12k. */
export function shortMetres(m: number): string {
  const v = Math.round(Math.max(0, m));
  if (v < 1000) return String(v);
  if (v < 10_000) return `${(Math.round(v / 100) / 10).toFixed(1).replace(/\.0$/, '')}k`;
  return `${Math.round(v / 1000)}k`;
}

/** A pass-and-play séance picked up after a reload: a candle that burnt out while away gutters. */
export function lanternResume(s: PassState, now: number): 'gutter' | null {
  return s.phase === 'speak' && now >= candleOut(s) ? 'gutter' : null;
}

export type DayState = 'past' | 'today' | 'future';

export interface DayCell {
  /** 0 is Monday. */
  index: number;
  day: number;
  state: DayState;
  depth: number | null;
}

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** One member's week, Monday to Sunday, with today marked and the days to come left empty. */
export function weekCells(board: Pick<CultBoard, 'week' | 'today'>, days: Array<number | null>): DayCell[] {
  return WEEKDAYS.map((_, i) => {
    const day = board.week + i;
    const state: DayState = day < board.today ? 'past' : day === board.today ? 'today' : 'future';
    return { index: i, day, state, depth: state === 'future' ? null : (days[i] ?? null) };
  });
}

/** The circle in a relay view, tables left out, in the order they sat down. */
export function seatsOf(view: Pick<SeanceView, 'sitters' | 'you' | 'medium'>): Seat[] {
  return view.sitters
    .filter((s) => !s.table)
    .map((s) => ({ id: s.id, name: s.name, mark: s.mark, online: s.online, you: s.id === view.you, medium: s.id === view.medium }));
}

/** The screens that share the room's view (tables) in a relay view. */
export const tablesOf = (view: Pick<SeanceView, 'sitters'>): number => view.sitters.filter((s) => s.table).length;

/** The chair a mark sits in at the séance table: seat N is mark N − 1, clockwise from the top. 0 for a table (no seat). */
export const seatOf = (mark: number): number => (mark >= 0 && Number.isFinite(mark) ? wrap(mark, SEATS) + 1 : 0);

/** Where a seat is round the table, as cos and sin of its angle (seat 1 at the top, then clockwise). */
export function seatAngle(seat: number): { cos: number; sin: number } {
  const a = -Math.PI / 2 + ((seat - 1) / SEATS) * Math.PI * 2;
  const r = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
  return { cos: r(Math.cos(a)), sin: r(Math.sin(a)) };
}

/** This device's mark as the relay takes it (lowercase letters, digits and dashes, 4 to 40 long). A table gets its own. */
export function relayId(playerId: string, table = false): string {
  const base = String(playerId ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 30);
  const id = base.length >= 4 ? base : `${base}seat`.padEnd(6, '0');
  return table ? `${id}-table` : id;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** The week that starts on this Monday, as a person says it: "23–29 November". */
export function weekSpan(week: number): string {
  const [ya, ma, da] = dateKeyForDay(week).split('-').map(Number);
  const [yb, mb, db] = dateKeyForDay(week + 6).split('-').map(Number);
  if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[ma - 1]}`;
  if (ya === yb) return `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]}`;
  return `${da} ${MONTHS[ma - 1]} ${ya} – ${db} ${MONTHS[mb - 1]} ${yb}`;
}

/** How a chair at the table is shown: nobody in it, or its sitter here, away, waiting to seal, sealed, out of the light or in it. */
export type SeatState = 'empty' | 'seated' | 'away' | 'waiting' | 'sealed' | 'dim' | 'lit';

export interface TableSeat {
  id: string;
  name: string;
  mark: number;
  state: SeatState;
}

/** The table in words, for a screen reader: "A séance table: four of twelve chairs taken, by Wren, Harrow, Ilse and Bram." */
export function tableWords(seats: TableSeat[]): string {
  const sat = seats.filter((s) => s.state !== 'empty' && seatOf(s.mark));
  const names = (state: SeatState) => sat.filter((s) => s.state === state).map((s) => s.name);
  let out = sat.length
    ? `A séance table: ${cardinal(sat.length)} of ${cardinal(SEATS)} chairs taken, by ${listNames(sat.map((s) => s.name))}.`
    : `A séance table: all ${cardinal(SEATS)} chairs empty.`;
  const sealed = names('sealed');
  const waiting = names('waiting');
  const away = names('away');
  if (sealed.length || waiting.length) out += ` ${sealed.length ? `Sealed: ${listNames(sealed)}.` : 'Nobody has sealed yet.'}${waiting.length ? ` Still to seal: ${listNames(waiting)}.` : ''}`;
  if (away.length) out += ` Stepped away: ${listNames(away)}.`;
  return out;
}
