// The host's record of a class. Once a question's answers have surfaced, the
// relay hands the host that question in full (a ledger: who gave what); the
// host's device keeps them, so a class can be read again afterwards, printed,
// and taken away as a spreadsheet. Nothing here is sent anywhere: the record
// lives in the browser that held the class.

import type { ClassConfig, ClassLastResult, ClassLedger, ClassLedgerRow, ClassMode, ClassStanding, ClassTableGain, ClassView } from './class-types';

/** One question of a class, as kept. */
export interface LogQuestion {
  n: number;
  mode: ClassMode;
  /** The host's clock when its answers surfaced. */
  at: number;
  prompt: { id: string; text: string; topic?: string; rules?: string };
  /** How many answers the deep knew, and the rarest of those nobody gave. */
  known: number;
  unsaid: Array<{ answer: string; tier: number }>;
  /** Every different answer given, rarest first. */
  answers: ClassLedger['answers'];
  /** Every diver seated when it surfaced, in the order they sat down. */
  rows: ClassLedgerRow[];
  tables?: ClassTableGain[];
  last?: ClassLastResult;
  cut?: ClassLedger['cut'];
}

/** One round of one class, as kept on the host's device. */
export interface ClassLog {
  v: 1;
  /** The class and its round (see logId). */
  id: string;
  sign: string;
  /** The host's clock when its first question surfaced. */
  at: number;
  ended: boolean;
  /** How it was held, as last seen. */
  config: ClassConfig;
  questions: LogQuestion[];
  /** Everyone as they stood when last seen, deepest first. */
  standings: ClassStanding[];
  /** Metres by table, [0] unused, when the class had tables. */
  tableTotals?: number[];
}

/** A kept class in a line, for the list of past classes. */
export interface ClassLogHead {
  id: string;
  sign: string;
  at: number;
  ended: boolean;
  divers: number;
  questions: number;
  modes: ClassMode[];
  topics: string[];
  /** How much of the device's storage it takes, in characters. */
  size: number;
}

/** The class and round a ledger belongs to: the sign may be given to another class in time, so its birth tells them apart. */
export const logId = (sign: string, ledger: Pick<ClassLedger, 'born' | 'round'>): string => `${sign}.${Math.max(0, Math.round(ledger.born)).toString(36)}.${ledger.round}`;

/** The record a host's view belongs to, when the view carries a ledger. */
export const ledgerId = (view: Pick<ClassView, 'sign' | 'ledger'>): string | null => (view.ledger ? logId(view.sign, view.ledger) : null);

/**
 * A host's view folded into the record of its class. `prev` is what is kept of
 * that class and round so far (null for its first question). A question already
 * kept stays as it was first seen; how everyone stands is always the latest.
 * Null when the view carries no ledger.
 */
export function withLedger(prev: ClassLog | null, view: ClassView, now: number): ClassLog | null {
  const ledger = view.ledger;
  const result = view.result;
  if (!ledger || !result) return null;
  const id = logId(view.sign, ledger);
  const base = prev && prev.id === id ? prev : null;
  const questions = base ? [...base.questions] : [];
  if (!questions.some((q) => q.n === ledger.n)) {
    questions.push({
      n: ledger.n,
      mode: result.mode,
      at: now,
      prompt: { id: result.prompt.id, text: result.prompt.text, ...(result.prompt.topic ? { topic: result.prompt.topic } : {}), ...(result.prompt.rules ? { rules: result.prompt.rules } : {}) },
      known: result.known,
      unsaid: result.unsaid,
      answers: ledger.answers,
      rows: ledger.rows,
      ...(result.tables ? { tables: result.tables } : {}),
      ...(result.last ? { last: result.last } : {}),
      ...(ledger.cut ? { cut: ledger.cut } : {}),
    });
    questions.sort((a, b) => a.n - b.n);
  }
  return {
    v: 1,
    id,
    sign: view.sign,
    at: base?.at ?? now,
    ended: view.phase === 'ended',
    config: view.config,
    questions,
    standings: view.standings ?? base?.standings ?? [],
    ...(view.config.tables && view.tableTotals ? { tableTotals: view.tableTotals } : {}),
  };
}

// ------------------------------------------------------------ reading a record

/** What one diver gave to one question. */
export interface LogCell {
  answers: Array<{ answer: string; tier: number; depth: number; voices: number; typed: string }>;
  tries: string[];
  gain: number;
  here: boolean;
}

/** One diver across the whole class. */
export interface LogDiver {
  id: string;
  name: string;
  table: number;
  total: number;
  /** 1 is the deepest; equal depths share a place. */
  rank: number;
  /** Questions they gave at least one answer to. */
  answered: number;
  /** By question, in the record's order: null where they were not seated for it. */
  cells: Array<LogCell | null>;
}

const cellOf = (q: LogQuestion, row: ClassLedgerRow): LogCell => ({
  answers: row.said.flatMap(([k, typed]) => {
    const a = q.answers[k];
    return a ? [{ answer: a.answer, tier: a.tier, depth: a.depth, voices: a.voices, typed }] : [];
  }),
  tries: row.tries,
  gain: row.gain,
  here: row.here,
});

/**
 * Everyone who sat in the class, deepest first. A diver the host sent out
 * part-way is still listed, with the depth they had reached.
 */
export function logDivers(log: ClassLog): LogDiver[] {
  const by = new Map<string, LogDiver>();
  log.questions.forEach((q, i) => {
    for (const row of q.rows) {
      let d = by.get(row.id);
      if (!d) {
        d = { id: row.id, name: row.name, table: row.table, total: 0, rank: 0, answered: 0, cells: log.questions.map(() => null) };
        by.set(row.id, d);
      }
      const cell = cellOf(q, row);
      d.cells[i] = cell;
      d.name = row.name;
      d.table = row.table;
      d.total = row.total;
      if (cell.answers.length) d.answered++;
    }
  });
  // Where the class stood when last seen is the truth for those still in it.
  for (const s of log.standings) {
    const d = by.get(s.id);
    if (!d) continue;
    d.name = s.name;
    d.table = s.table;
    d.total = s.total;
  }
  const out = [...by.values()].sort((a, b) => b.total - a.total || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1));
  out.forEach((d, i) => (d.rank = i > 0 && out[i - 1].total === d.total ? out[i - 1].rank : i + 1));
  return out;
}

/** The names of those who gave an answer of a question, by its place in the question's answers. */
export function givenBy(q: LogQuestion): string[][] {
  const out = q.answers.map((): string[] => []);
  for (const row of q.rows) for (const [k] of row.said) out[k]?.push(row.name);
  return out;
}

export interface LogRefusal {
  text: string;
  /** How many divers were refused it, and who. */
  count: number;
  names: string[];
}

const same = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** What the deep refused on a question: each different try once, the commonest first. */
export function refusedOf(q: LogQuestion): LogRefusal[] {
  const by = new Map<string, LogRefusal>();
  for (const row of q.rows) {
    const mine = new Set<string>();
    for (const t of row.tries) {
      const key = same(t);
      if (!key || mine.has(key)) continue;
      mine.add(key);
      const r = by.get(key);
      if (r) {
        r.count++;
        r.names.push(row.name);
      } else by.set(key, { text: t.trim(), count: 1, names: [row.name] });
    }
  }
  return [...by.values()].sort((a, b) => b.count - a.count || (same(a.text) < same(b.text) ? -1 : 1));
}

/**
 * Those a question took no answer from, by name: who tried and was refused
 * every time, who gave nothing, and who was not here for it. When the relay
 * sent no refused answers for the question (see `cut`), the refused cannot be
 * told from the silent: both are then under `silent`.
 */
export function uncountedOf(q: LogQuestion): { refused: string[]; silent: string[]; away: string[] } {
  const out = { refused: [] as string[], silent: [] as string[], away: [] as string[] };
  for (const r of q.rows) {
    if (r.said.length) continue;
    if (r.tries.some((t) => t.trim())) out.refused.push(r.name);
    else if (r.here) out.silent.push(r.name);
    else out.away.push(r.name);
  }
  return out;
}

/** How a question went, in numbers. */
export function questionCount(q: LogQuestion): { seated: number; here: number; answered: number; silent: number; given: number } {
  const answered = q.rows.filter((r) => r.said.length > 0).length;
  const here = q.rows.filter((r) => r.here || r.said.length > 0).length;
  return { seated: q.rows.length, here, answered, silent: here - answered, given: q.answers.length };
}

export const headOf = (log: ClassLog, size = 0): ClassLogHead => ({
  id: log.id,
  sign: log.sign,
  at: log.at,
  ended: log.ended,
  divers: new Set(log.questions.flatMap((q) => q.rows.map((r) => r.id))).size,
  questions: log.questions.length,
  modes: [...new Set(log.questions.map((q) => q.mode))],
  topics: log.config.topics ?? [],
  size,
});

// ------------------------------------------------------------ a spreadsheet

/** The words a spreadsheet needs that the theme and the screens own. */
export interface LogWords {
  tier(tier: number): string;
  table(table: number): string;
  mode(mode: ClassMode): string;
}

type Cell = string | number;

/**
 * Rows as a CSV file's text (RFC 4180, CRLF). A cell of text that a spreadsheet
 * would run as a formula (it begins with = + - or @) is given a leading
 * apostrophe: names and answers are typed by the class.
 */
export function csvOf(rows: Cell[][]): string {
  const cell = (v: Cell): string => {
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
    const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** One row a diver: their place, their depth, and what they gave to each question. */
export function marksCsv(log: ClassLog, words: LogWords): string {
  const tables = log.questions.some((q) => q.rows.some((r) => r.table > 0));
  const head: Cell[] = ['Place', 'Name', ...(tables ? ['Table'] : []), 'Depth (m)', 'Questions answered'];
  for (const q of log.questions) head.push(`Q${q.n}: ${q.prompt.text}`, `Q${q.n} depth (m)`);
  const rows: Cell[][] = [head];
  for (const d of logDivers(log)) {
    const row: Cell[] = [d.rank, d.name, ...(tables ? [d.table ? words.table(d.table) : ''] : []), d.total, d.answered];
    for (const cell of d.cells) row.push(cell ? cell.answers.map((a) => a.answer).join('; ') : '', cell ? cell.gain : '');
    rows.push(row);
  }
  return csvOf(rows);
}

/** One row an answer: everything every diver gave or was refused, question by question. */
export function answersCsv(log: ClassLog, words: LogWords): string {
  const tables = log.questions.some((q) => q.rows.some((r) => r.table > 0));
  const rows: Cell[][] = [['Question', 'Question text', 'Played as', 'Name', ...(tables ? ['Table'] : []), 'Result', 'Typed', 'Counted as', 'Rarity', 'Divers who gave it', 'Depth (m)']];
  for (const q of log.questions) {
    for (const r of q.rows) {
      const lead: Cell[] = [q.n, q.prompt.text, words.mode(q.mode), r.name, ...(tables ? [r.table ? words.table(r.table) : ''] : [])];
      for (const [k, typed] of r.said) {
        const a = q.answers[k];
        if (a) rows.push([...lead, 'counted', typed || a.answer, a.answer, words.tier(a.tier), a.voices, a.depth]);
      }
      for (const t of r.tries) rows.push([...lead, 'refused', t, '', '', '', 0]);
      if (!r.said.length && !r.tries.length) rows.push([...lead, r.here ? 'no answer' : 'not here', '', '', '', '', 0]);
    }
  }
  return csvOf(rows);
}

/** A name for a file of this class: "cthulhoo-DAGON-417-2026-11-28-marks.csv". */
export function logFileName(log: Pick<ClassLog, 'sign' | 'at'>, kind: string, ext = 'csv'): string {
  const d = new Date(log.at);
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : 'class';
  return `cthulhoo-${log.sign.replace(/[^A-Za-z0-9-]/g, '')}-${day}-${kind}.${ext}`;
}

// ------------------------------------------------------------ keeping records

/** Where records are kept: the browser's own storage, or a stand-in. */
export interface LogStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const INDEX_KEY = 'cthulhoo.v1.classLogs';
const logKey = (id: string) => `cthulhoo.v1.classLog.${id}`;
/**
 * Classes kept on one device, and the characters they may take between them:
 * the oldest make way. A browser gives a site some five million bytes, two a
 * character, and the game's own saves live there too: the classes take half at most.
 */
export const LOGS_KEPT = 30;
export const LOGS_SIZE = 1_200_000;

function browserStore(): LogStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readJson(store: LogStore | null, key: string): unknown {
  try {
    const raw = store?.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanHead(v: unknown): ClassLogHead | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.sign !== 'string' || typeof v.at !== 'number') return null;
  return {
    id: v.id,
    sign: v.sign,
    at: v.at,
    ended: v.ended === true,
    divers: typeof v.divers === 'number' ? v.divers : 0,
    questions: typeof v.questions === 'number' ? v.questions : 0,
    modes: Array.isArray(v.modes) ? (v.modes.filter((m) => m === 'classic' || m === 'blitz' || m === 'last') as ClassMode[]) : [],
    topics: Array.isArray(v.topics) ? v.topics.filter((t): t is string => typeof t === 'string') : [],
    size: typeof v.size === 'number' ? v.size : 0,
  };
}

/** The classes kept on this device, newest first. */
export function listClassLogs(store: LogStore | null = browserStore()): ClassLogHead[] {
  const raw = readJson(store, INDEX_KEY);
  const heads = (Array.isArray(raw) ? raw : []).map(cleanHead).filter((h): h is ClassLogHead => !!h);
  return heads.sort((a, b) => b.at - a.at);
}

/** One kept class, or null when it is not here (or not a record). */
export function loadClassLog(id: string, store: LogStore | null = browserStore()): ClassLog | null {
  const v = readJson(store, logKey(id));
  if (!isObj(v) || v.v !== 1 || v.id !== id || typeof v.sign !== 'string' || !Array.isArray(v.questions) || !Array.isArray(v.standings) || !isObj(v.config)) return null;
  return v as unknown as ClassLog;
}

function writeIndex(store: LogStore, heads: ClassLogHead[]): boolean {
  try {
    store.setItem(INDEX_KEY, JSON.stringify(heads));
    return true;
  } catch {
    return false;
  }
}

/**
 * Keeps a class. Older classes make way when there are too many or the device
 * is full; the one being kept is never dropped for another. False when it could
 * not be kept at all (no storage here, or not even room for this one).
 */
export function saveClassLog(log: ClassLog, store: LogStore | null = browserStore()): boolean {
  if (!store) return false;
  const text = JSON.stringify(log);
  const heads = listClassLogs(store).filter((h) => h.id !== log.id);
  const drop = (h: ClassLogHead) => {
    try {
      store.removeItem(logKey(h.id));
    } catch {
      /* it stays, uncounted */
    }
  };
  // The oldest first: past the count, or past the room they may take between them.
  const trim = () => {
    heads.sort((a, b) => b.at - a.at);
    while (heads.length && (heads.length >= LOGS_KEPT || heads.reduce((n, h) => n + h.size, text.length) > LOGS_SIZE)) drop(heads.pop()!);
  };
  trim();
  for (;;) {
    try {
      store.setItem(logKey(log.id), text);
      break;
    } catch {
      // The device is full: an older class makes way, and it is tried again.
      if (!heads.length) return false;
      drop(heads.pop()!);
    }
  }
  const head = headOf(log, text.length);
  while (!writeIndex(store, [head, ...heads])) {
    if (!heads.length) {
      // Not even the list could be written: the class is not left behind where nothing lists it.
      drop(head);
      return false;
    }
    drop(heads.pop()!);
  }
  return true;
}

/** Forgets a kept class. */
export function dropClassLog(id: string, store: LogStore | null = browserStore()): void {
  if (!store) return;
  try {
    store.removeItem(logKey(id));
  } catch {
    /* nothing to forget */
  }
  writeIndex(store, listClassLogs(store).filter((h) => h.id !== id));
}
