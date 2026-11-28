import * as built from 'virtual:daily-bank';
import placeholderBank from '../content/placeholder-bank.json';
import { PROMPTS_PER_DAY } from './daily';
import { PLACEHOLDER_THEME, buildTheme } from './theme';
import type { AnswerDef, BankDay, PromptDef, PromptMeta, ThemeCopy, TrapDef } from './types';

// The daily bank is every JSON file in data/ at the repo root with a "prompts"
// or "days" array; data/theme.json supplies the copy. The build
// (build/daily-bank.mjs) hands the script each question's words and topic at
// once, and publishes each question's answers as a file of its own, fetched when
// a dive, a séance or a log asks for them: the bank can grow without the game's
// first load growing with it. Where the data cannot fill a day, the placeholders
// in src/content make up the numbers.

export interface Bank {
  /** Every question of the daily bank, without its answers: the day's plan and the topics are made from these. */
  prompts: PromptMeta[];
  /** The questions that are here whole: those fetched so far, and a class pack's once it is loaded. */
  byId: Map<string, PromptDef>;
  days: BankDay[];
  theme: ThemeCopy;
  source: 'data' | 'placeholder';
  /** Whether the daily bank asks this question, fetched or not. */
  has(id: string): boolean;
  /** What is known of a question now: all of it when it is here, its words and topic when it is not. */
  about(id: string): PromptMeta | undefined;
  /**
   * These questions whole, fetching the ones that are not here yet. Resolves to
   * those that could be had, in the order asked for and each once: a question
   * the bank does not ask, or one the network would not give, is left out. Never
   * rejects, and a question that failed is asked for afresh the next time.
   */
  whole(ids: string[]): Promise<PromptDef[]>;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/**
 * A list of spellings. A bare string is one spelling: spread as a list it would
 * become single letters, each of them then accepted. Numbers count as text, as
 * they do in the reference matcher.
 */
const forms = (v: unknown): string[] =>
  (typeof v === 'string' ? [v] : Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'number' && Number.isFinite(x) ? String(x) : x))
    .filter((x): x is string => !!text(x));

function cleanAnswer(a: unknown): AnswerDef | null {
  if (!isObj(a) || !text(a.answer) || typeof a.tier !== 'number' || !Number.isFinite(a.tier)) return null;
  return { ...(a as unknown as AnswerDef), aliases: forms(a.aliases), lore: text(a.lore), tier: Math.max(1, Math.min(6, Math.round(a.tier))) };
}

/** Traps keep their reason; one without a reason to show is still wrong, so it is refused as a decoy. */
function cleanTraps(list: unknown): { traps: TrapDef[]; decoys: string[] } {
  const traps: TrapDef[] = [];
  const decoys: string[] = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t) || !text(t.answer)) continue;
    const answer = t.answer as string;
    const aliases = forms(t.aliases);
    const reason = text(t.reason);
    if (reason) traps.push({ ...(t as unknown as TrapDef), answer, aliases, reason });
    else decoys.push(answer, ...aliases);
  }
  return { traps, decoys };
}

export function cleanPrompt(p: unknown): PromptDef | null {
  if (!isObj(p) || !text(p.id) || !text(p.text) || !Array.isArray(p.answers)) return null;
  const answers = p.answers.map(cleanAnswer).filter((a): a is AnswerDef => !!a);
  if (!answers.length) return null;
  const { traps, decoys } = cleanTraps(p.traps);
  return {
    id: p.id as string,
    text: p.text as string,
    category: text(p.category) ?? 'misc',
    flavor: text(p.flavor),
    rules: text(p.rules),
    answers,
    traps: Array.isArray(p.traps) ? traps : undefined,
    decoys: p.decoys !== undefined || decoys.length ? [...forms(p.decoys), ...decoys] : undefined,
    exact: p.exact === true ? true : undefined,
    topic: text(p.topic),
    section: text(p.section),
    asOf: text(p.asOf),
    source: text(p.source),
  };
}

/** A question as the build lists it: no answers, and a stamp of the file that holds them. */
interface Entry {
  meta: PromptMeta;
  /** The stamp of its published file: a list that changes gets a new one. Empty when there is no file. */
  v: string;
}

/** One line of the build's list, checked. The words and the topic are read exactly as a whole question's are. */
function cleanEntry(raw: unknown): Entry | null {
  if (!isObj(raw) || !text(raw.id) || !text(raw.text)) return null;
  return {
    meta: { id: raw.id as string, text: raw.text as string, category: text(raw.category) ?? 'misc', flavor: text(raw.flavor), rules: text(raw.rules) },
    v: text(raw.v) ?? '',
  };
}

/** A whole question, less its lists. */
export function metaOf(p: PromptDef): PromptMeta {
  const { answers: _answers, traps: _traps, decoys: _decoys, exact: _exact, ...meta } = p;
  return meta;
}

function cleanDays(list: unknown): BankDay[] {
  const days: BankDay[] = [];
  for (const d of Array.isArray(list) ? list : []) {
    if (isObj(d) && typeof d.date === 'string' && Array.isArray(d.prompts)) {
      days.push({ date: d.date, prompts: d.prompts.filter((id): id is string => typeof id === 'string') });
    }
  }
  return days;
}

/**
 * Makes questions findable by id without adding them to the daily bank: class
 * packs, loaded when asked for. A dive, a séance and a reveal can then look them
 * up, and the daily plan (which reads `prompts`) never sees them. An id the
 * daily bank asks keeps the bank's question, fetched or not.
 */
export function adoptPrompts(bank: Pick<Bank, 'byId' | 'has'>, prompts: PromptDef[]): void {
  for (const p of prompts) if (!bank.has(p.id) && !bank.byId.has(p.id)) bank.byId.set(p.id, p);
}

/** Prompts (first file to use an id wins) and fixed days from a list of bank files. */
export function collectBank(files: unknown[]): { prompts: PromptDef[]; days: BankDay[] } {
  const byId = new Map<string, PromptDef>();
  const days: BankDay[] = [];
  for (const f of files) {
    if (!isObj(f)) continue;
    for (const raw of Array.isArray(f.prompts) ? f.prompts : []) {
      const p = cleanPrompt(raw);
      if (p && !byId.has(p.id)) byId.set(p.id, p);
    }
    days.push(...cleanDays(f.days));
  }
  return { prompts: [...byId.values()], days };
}

/**
 * The prompts and fixed days to play from. When the data cannot fill a day,
 * the placeholders make up the numbers, listed after the data so the data's
 * own version of a prompt both share wins.
 */
export function bankFrom(files: unknown[], fallback: unknown): { prompts: PromptDef[]; days: BankDay[]; source: Bank['source'] } {
  const data = collectBank(files);
  if (data.prompts.length >= PROMPTS_PER_DAY) return { ...data, source: 'data' };
  return { ...collectBank([...files, fallback]), source: 'placeholder' };
}

// ------------------------------------------------------------ fetching a question

/** Fetches one published question (bank/<id>.json) as JSON. `v` is the stamp of its file. Rejects when it cannot be had. */
export type BankFetcher = (id: string, v: string) => Promise<unknown>;

/** How long one question may take to arrive before the wait is given up. */
export const BANK_FETCH_MS = 12_000;

/**
 * Fetches from bank/ beside the game. The address carries the file's stamp, so
 * a copy the browser kept is good until the list changes. With no line to the
 * surface, or one too slow, any copy the browser still holds is taken.
 */
export function bankFetcher(base: string): BankFetcher {
  // On a first visit the day's questions are fetched before the service worker has the page in hand,
  // so it never sees them to keep. Once it has the page they are asked for again (the browser still
  // holds them), and a dive begun later with no line to the surface finds them kept.
  const worker = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  const unseen: URL[] = [];
  worker?.addEventListener('controllerchange', () => {
    for (const url of unseen.splice(0)) void fetch(url).catch(() => {});
  });
  return async (id, v) => {
    const url = new URL(`bank/${encodeURIComponent(id)}.json${v ? `?v=${encodeURIComponent(v)}` : ''}`, base);
    const read = async (res: Response): Promise<unknown> => {
      if (!res.ok) throw new Error(`bank/${id}.json: ${res.status}`);
      return res.json();
    };
    // The clock runs until the whole list has arrived, not only its first bytes.
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), BANK_FETCH_MS);
    try {
      const got = await read(await fetch(url, { signal: stop.signal }));
      if (worker && !worker.controller) unseen.push(url);
      return got;
    } catch {
      return await read(await fetch(url, { cache: 'only-if-cached', mode: 'same-origin' }));
    } finally {
      clearTimeout(timer);
    }
  };
}

// ------------------------------------------------------------ the bank

export interface BankParts {
  /** The build's list: every question without its answers, each with the stamp of its file. */
  index: unknown[];
  /** Fixed days, as written in the files. */
  days?: unknown[];
  /** Every question whole, by id, where the build published no files: nothing is then fetched. */
  bundled?: Record<string, unknown> | null;
  /** The placeholder bank, for data that cannot fill a day. */
  fallback?: unknown;
  /** How a question's file is fetched; without it, only what is bundled can be had. */
  fetchJson?: BankFetcher | null;
}

/** The bank's questions and how to have them whole: everything but the theme. */
export function makeBank(parts: BankParts): Omit<Bank, 'theme'> {
  const entries = new Map<string, Entry>();
  const byId = new Map<string, PromptDef>();
  for (const raw of parts.index) {
    const e = cleanEntry(raw);
    if (e && !entries.has(e.meta.id)) entries.set(e.meta.id, e);
  }
  if (parts.bundled) {
    for (const id of [...entries.keys()]) {
      const p = cleanPrompt(parts.bundled[id]);
      // Bundled, a question is whole from the start or it cannot be asked at all.
      if (p && p.id === id) byId.set(id, p);
      else entries.delete(id);
    }
  }
  let days = cleanDays(parts.days);
  let source: Bank['source'] = 'data';
  if (entries.size < PROMPTS_PER_DAY) {
    const extra = collectBank([parts.fallback]);
    for (const p of extra.prompts) {
      if (entries.has(p.id)) continue;
      entries.set(p.id, { meta: metaOf(p), v: '' });
      byId.set(p.id, p);
    }
    days = [...days, ...extra.days];
    source = 'placeholder';
  }

  const fetchJson = parts.fetchJson ?? null;
  const loads = new Map<string, Promise<PromptDef | undefined>>();
  const one = (id: string): Promise<PromptDef | undefined> => {
    const here = byId.get(id);
    if (here) return Promise.resolve(here);
    const entry = entries.get(id);
    if (!entry || !fetchJson) return Promise.resolve(undefined);
    let load = loads.get(id);
    if (!load) {
      load = fetchJson(id, entry.v)
        .then(
          (raw) => {
            const p = cleanPrompt(raw);
            // The file must hold the question asked for, and nothing else may have taken its place meanwhile.
            if (!p || p.id !== id) return undefined;
            const kept = byId.get(id) ?? p;
            byId.set(id, kept);
            return kept;
          },
          () => undefined,
        )
        .finally(() => loads.delete(id));
      loads.set(id, load);
    }
    return load;
  };

  return {
    prompts: [...entries.values()].map((e) => e.meta),
    byId,
    days,
    source,
    has: (id) => entries.has(id),
    about: (id) => byId.get(id) ?? entries.get(id)?.meta,
    whole: async (ids) => (await Promise.all([...new Set(ids)].map(one))).filter((p): p is PromptDef => !!p),
  };
}

/** A bank of questions that are all here whole, with nothing to fetch: for the tests and the benches. */
export function wholeBank(prompts: PromptDef[], days: BankDay[] = []): Omit<Bank, 'theme'> {
  const own = new Map(prompts.map((p) => [p.id, p]));
  const byId = new Map(own);
  return {
    prompts,
    byId,
    days,
    source: 'data',
    has: (id) => own.has(id),
    about: (id) => byId.get(id),
    whole: async (ids) => [...new Set(ids)].flatMap((id) => byId.get(id) ?? []),
  };
}

/** The bank the build made. In a page, questions are fetched from beside it; elsewhere only bundled ones can be had. */
export function loadBank(fetchJson: BankFetcher | null = typeof document === 'undefined' ? null : bankFetcher(document.baseURI)): Bank {
  const theme = built.theme ? buildTheme(built.theme) : PLACEHOLDER_THEME;
  return { ...makeBank({ index: built.prompts, days: built.days, bundled: built.bundled, fallback: placeholderBank, fetchJson }), theme };
}
