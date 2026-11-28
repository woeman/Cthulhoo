// A teacher's own question sets. A set is written as plain text and kept on the
// device it was written on; a class is asked from it like any topic. The text is
// the set: what is typed is what is kept, downloaded and loaded, and the
// questions are read from it afresh each time.
//
//   Name a planet of the Solar System.
//   Earth
//   Mars
//   Jupiter | Jove
//   Mercury [5]
//   Note: The eight of today.
//   Not: Pluto -- Pluto was demoted in 2006.
//
// An empty line parts the questions. The first line of each is the question;
// each line after it is one answer, with its other spellings after "|". Answers
// are written commonest first: where one stands sets how deep it sinks, unless
// its line ends with a tier of its own, [1] to [6].

import { hashString } from './daily';
import { matchAnswer, normalize } from './matcher';
import { OWN_GROUP, ownOfTopic, ownTopic, type Topic } from './topics';
import type { AnswerDef, PromptDef, TrapDef } from './types';

export interface OwnSet {
  id: string;
  name: string;
  /** The set as its writer typed it. */
  text: string;
  /** When it was last changed, by this device's clock. */
  at: number;
}

/** Sets one device keeps, and how long one may be. */
export const OWN_SETS_MAX = 40;
export const OWN_TEXT_MAX = 60_000;
/** Letters all the sets of one device may take between them: the browser's storage is small, and the game's own saves live there too. */
export const OWN_TOTAL_MAX = 600_000;
/** A set's name is told to the class as a topic's is, so it is as short. */
export const OWN_NAME_MAX = 24;
export const OWN_QUESTIONS_MAX = 200;
/** As the relay takes them (see cleanPrompts): a question, an answer or spelling, a note or reason. */
export const OWN_QUESTION_MAX = 300;
export const OWN_WORDS_MAX = 200;
export const OWN_NOTE_MAX = 300;
export const OWN_ANSWERS_MAX = 400;

/** The category own questions are filed under; the set's name is their topic. */
export const OWN_CATEGORY = 'own';

/** Something in the text its writer should know of. The set still serves for the rest. */
export interface OwnProblem {
  /** The line it is on, from 1. */
  line: number;
  text: string;
}

export interface OwnQuestion {
  /** The line its question is on, from 1. */
  line: number;
  prompt: PromptDef;
  /** Its answers that no diver could type, by name (see the problems): they stand in the question all the same. */
  mute?: string[];
}

export interface OwnParsed {
  /** A name written at the top of the text ("Set: Week 3"), as a downloaded set carries it. */
  name?: string;
  questions: OwnQuestion[];
  problems: OwnProblem[];
}

/** Text as a room will show it: no control or direction characters, no runs of spaces. */
const tidy = (raw: string): string =>
  raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const cleanSetName = (raw: string): string => tidy(raw).slice(0, OWN_NAME_MAX).trim();

const HEADER = /^\s*(?:set\s*:|#+)\s*(.*)$/i;
const NOTE = /^\s*(?:note|rules?)\s*:\s*(.*)$/i;
const NOT = /^\s*(?:not|wrong)\s*:\s*(.*)$/i;
/** "1." "1)" "Q1:" "Question 1." before a question; a bullet or a list number before an answer. */
const Q_LEAD = /^\s*(?:(?:q(?:uestion)?\s*)?\d{1,3}\s*[.):]|q\s*[.):])\s+/i;
const A_LEAD = /^\s*(?:[-*•·–—]\s+|\d{1,3}[.)]\s+|[a-z]\)\s+)/i;
const TIER = /\s*\[([1-6])\]\s*$/;
const REASON = /^(.*?)\s+(?:--|—|–)\s+(.+)$/;

const spellings = (s: string): string[] => s.split(/[|\t]/).map(tidy).filter(Boolean);
/** A spelling as the deep reads it, so "Mars" and "mars." are one. */
const keyOf = (s: string): string => normalize(s) || s.toLowerCase();

/** The name written at the top of a set's text, when there is one, and the lines after it. */
function headed(text: string): { name?: string; from: number; lines: string[] } {
  const lines = text.replace(/^\ufeff/, '').replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const head = i < lines.length ? HEADER.exec(lines[i]) : null;
  if (!head) return { from: 0, lines };
  return { name: cleanSetName(head[1]) || undefined, from: i + 1, lines };
}

/** The tier an answer takes from where it stands among `n`, commonest first: six or fewer take a tier each, more are spread over the six. */
export const tierByPlace = (i: number, n: number): number => (n <= 6 ? i + 1 : 1 + Math.min(5, Math.floor((i * 6) / n)));

interface Line {
  n: number;
  text: string;
}

/**
 * The questions written in a set's text, each as the game asks any question.
 * A question's id comes from the set and the question's own words, so it stays
 * the same when the set is put in another order or its answers are added to.
 */
export function parseOwnSet(text: string, set: Pick<OwnSet, 'id' | 'name'>): OwnParsed {
  const top = headed(text);
  const lines: Line[] = top.lines.map((t, k) => ({ n: k + 1, text: t }));
  const problems: OwnProblem[] = [];
  const questions: OwnQuestion[] = [];
  const say = (line: number, words: string) => problems.push({ line, text: words });
  const name = top.name;
  let i = top.from;

  const seen = new Set<string>();
  const topic = cleanSetName(set.name);
  while (i < lines.length) {
    while (i < lines.length && !lines[i].text.trim()) i++;
    const block: Line[] = [];
    while (i < lines.length && lines[i].text.trim()) block.push(lines[i++]);
    if (!block.length) break;
    const at = block[0].n;
    if (questions.length >= OWN_QUESTIONS_MAX) {
      say(at, `A set holds ${OWN_QUESTIONS_MAX} questions at most: this one and those after it are left out.`);
      break;
    }

    let q = tidy(block[0].text).replace(Q_LEAD, '');
    const qt = TIER.exec(q);
    const qTier = qt ? Number(qt[1]) : 0;
    if (qt) q = q.slice(0, qt.index).trim();
    if (!q) {
      say(at, 'A question needs its words on its first line: this one is left out.');
      continue;
    }
    if (q.length > OWN_QUESTION_MAX) {
      say(at, `This question is longer than ${OWN_QUESTION_MAX} letters, so it is left out.`);
      continue;
    }

    let rules: string | undefined;
    const answers: Array<AnswerDef & { line: number; own: boolean }> = [];
    const traps: Array<TrapDef & { line: number }> = [];
    const decoys: string[] = [];
    /** Every spelling of the question so far, as the deep reads it, and where it stands. */
    const keys = new Map<string, string>();
    const fresh = (s: string, line: number, as: string): boolean => {
      if (s.length > OWN_WORDS_MAX) {
        say(line, `“${s.slice(0, 40)}…” is longer than ${OWN_WORDS_MAX} letters, so it is left out.`);
        return false;
      }
      const key = keyOf(s);
      const was = keys.get(key);
      if (was !== undefined) {
        if (was !== as) say(line, `“${s}” is already written under this question${was ? ` (for “${was}”)` : ''}: the first stands.`);
        return false;
      }
      keys.set(key, as);
      return true;
    };

    for (const l of block.slice(1)) {
      const note = NOTE.exec(l.text);
      if (note) {
        const words = tidy(note[1]);
        if (words.length > OWN_NOTE_MAX) say(l.n, `This note is longer than ${OWN_NOTE_MAX} letters, so it is left out.`);
        else if (words) rules = words;
        continue;
      }
      const not = NOT.exec(l.text);
      if (not) {
        const cut = REASON.exec(not[1]);
        const names = spellings(cut ? cut[1] : not[1]);
        const reason = cut ? tidy(cut[2]) : '';
        if (!names.length) continue;
        if (reason.length > OWN_NOTE_MAX) say(l.n, `This reason is longer than ${OWN_NOTE_MAX} letters, so it is left out.`);
        const kept = names.filter((s) => fresh(s, l.n, ''));
        if (!kept.length) continue;
        if (reason && reason.length <= OWN_NOTE_MAX) traps.push({ answer: kept[0], aliases: kept.slice(1), reason, line: l.n });
        else decoys.push(...kept);
        continue;
      }
      let a = l.text.replace(A_LEAD, '');
      const t = TIER.exec(a);
      if (t) a = a.slice(0, t.index);
      const parts = spellings(a);
      if (!parts.length) continue;
      const lead = parts[0];
      if (lead.length > OWN_WORDS_MAX) {
        say(l.n, `“${lead.slice(0, 40)}…” is longer than ${OWN_WORDS_MAX} letters, so it is left out.`);
        continue;
      }
      // An answer written a second time is still one answer: any new spellings on the line join it where it stands.
      const was = keys.get(keyOf(lead));
      if (was !== undefined) {
        const host = was ? answers.find((x) => x.answer === was) : undefined;
        if (!host) {
          say(l.n, `“${lead}” is written under Not: for this question, so it is refused: this line is left out.`);
          continue;
        }
        for (const sp of parts.slice(1)) if (fresh(sp, l.n, host.answer)) (host.aliases ??= []).push(sp);
        continue;
      }
      if (answers.length >= OWN_ANSWERS_MAX) {
        say(l.n, `A question holds ${OWN_ANSWERS_MAX} answers at most: “${lead}” and those after it are left out.`);
        break;
      }
      keys.set(keyOf(lead), lead);
      answers.push({ answer: lead, aliases: parts.slice(1).filter((sp) => fresh(sp, l.n, lead)), tier: t ? Number(t[1]) : 0, own: !!t, line: l.n });
    }

    if (!answers.length) {
      say(at, 'No answers are written under this question yet, so it is left out.');
      continue;
    }
    answers.forEach((a, k) => {
      if (!a.own) a.tier = qTier || tierByPlace(k, answers.length);
    });

    const id = `own-${set.id}-${hashString(normalize(q) || q).toString(36)}`;
    if (seen.has(id)) {
      say(at, 'This question is written twice in the set: the second is left out.');
      continue;
    }
    seen.add(id);

    const prompt: PromptDef = {
      id,
      text: q,
      category: OWN_CATEGORY,
      ...(rules ? { rules } : {}),
      answers: answers.map((a) => ({ answer: a.answer, ...(a.aliases?.length ? { aliases: a.aliases } : {}), tier: a.tier })),
      ...(traps.length ? { traps: traps.map((t) => ({ answer: t.answer, ...(t.aliases?.length ? { aliases: t.aliases } : {}), reason: t.reason })) } : {}),
      ...(decoys.length ? { decoys } : {}),
      ...(topic ? { topic } : {}),
    };

    // Each spelling is put to the deep as a diver would type it: what it would not take as written, the writer is told.
    const silent: string[] = [];
    for (const a of answers) {
      const spelt = [a.answer, ...(a.aliases ?? [])];
      let mute = 0;
      for (const s of spelt) {
        const r = matchAnswer(prompt, s);
        if (r.kind === 'accept' && r.answer.answer === a.answer) continue;
        if (r.kind === 'empty' || r.kind === 'reject') mute++;
        else if (r.kind === 'accept') say(a.line, `“${s}” reads to the deep as “${r.answer.answer}”, another answer here: whoever types it is given that.`);
        else if (r.kind === 'ambiguous') say(a.line, `“${s}” reads to the deep as more than one answer (${r.options.slice(0, 3).join(', ')}). Tell them apart with a longer spelling.`);
        else say(a.line, `“${s}” reads to the deep as something written under Not:, so it is refused.`);
      }
      // A name in other letters may stand for show (東京 | Tokyo): only an answer with no spelling a diver can type is a fault.
      if (mute === spelt.length) {
        say(a.line, `“${a.answer}” cannot be typed as an answer: the deep reads Latin letters and numbers. Give it a spelling in those after a |.`);
        silent.push(a.answer);
      }
    }
    questions.push({ line: at, prompt, ...(silent.length ? { mute: silent } : {}) });
  }
  return { ...(name ? { name } : {}), questions, problems };
}

// ------------------------------------------------------------ a set as a file

/** A set as a text file: its name on the first line, then the set as written. */
export const setFileText = (set: Pick<OwnSet, 'name' | 'text'>): string => `Set: ${set.name}\n\n${stripHeader(set.text).trim()}\n`;

function stripHeader(text: string): string {
  const top = headed(text);
  return top.lines.slice(top.from).join('\n');
}

/** A text file as a set: named by its first line ("Set: Week 3") when it has one, else by the file. */
export function readSetFile(text: string, fileName: string): { name: string; text: string } {
  const body = text.slice(0, OWN_TEXT_MAX * 2);
  const fromFile = cleanSetName(
    fileName
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/^cthulhoo-set-/i, '')
      .replace(/[-_]+/g, ' '),
  );
  return { name: headed(body).name ?? (fromFile || 'A set'), text: stripHeader(body).trim().slice(0, OWN_TEXT_MAX) };
}

/** A name for a set's file: "cthulhoo-set-week-3.txt". */
export function setFileName(set: Pick<OwnSet, 'name'>): string {
  const slug = set.name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `cthulhoo-set-${slug || 'questions'}.txt`;
}

// ------------------------------------------------------------ keeping sets

/** Where sets are kept: the browser's own storage, or a stand-in. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY = 'cthulhoo.v1.ownSets';

function browserStore(): KeyStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function cleanSet(v: unknown): OwnSet | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  if (typeof r.id !== 'string' || !/^[a-z0-9]{4,24}$/.test(r.id) || typeof r.text !== 'string') return null;
  return { id: r.id, name: cleanSetName(typeof r.name === 'string' ? r.name : '') || 'A set', text: r.text.slice(0, OWN_TEXT_MAX), at: typeof r.at === 'number' && Number.isFinite(r.at) ? r.at : 0 };
}

/** The sets kept on this device, in the order they were begun. */
export function loadOwnSets(store: KeyStore | null = browserStore()): OwnSet[] {
  let raw: unknown = null;
  try {
    const text = store?.getItem(KEY);
    raw = text ? JSON.parse(text) : null;
  } catch {
    raw = null;
  }
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { sets?: unknown }).sets) ? (raw as { sets: unknown[] }).sets : [];
  const out: OwnSet[] = [];
  for (const v of list) {
    const s = cleanSet(v);
    if (s && !out.some((o) => o.id === s.id)) out.push(s);
    if (out.length >= OWN_SETS_MAX) break;
  }
  return out;
}

function writeSets(sets: OwnSet[], store: KeyStore | null): boolean {
  if (!store) return false;
  try {
    store.setItem(KEY, JSON.stringify({ v: 1, sets }));
    return true;
  } catch {
    return false;
  }
}

/** A name no other set on the device bears: the second "Week 3" is "Week 3 (2)". */
export function uniqueSetName(name: string, sets: OwnSet[], id?: string): string {
  const base = cleanSetName(name) || 'A set';
  const taken = new Set(sets.filter((s) => s.id !== id).map((s) => s.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; n < 100; n++) {
    const tail = ` (${n})`;
    const next = `${base.slice(0, OWN_NAME_MAX - tail.length).trim()}${tail}`;
    if (!taken.has(next.toLowerCase())) return next;
  }
  return base;
}

/** A new, empty set, not yet kept. */
export function newOwnSet(name: string, text = '', now = Date.now(), sets: OwnSet[] = []): OwnSet {
  const id = `${Math.max(0, Math.round(now)).toString(36)}${Math.random().toString(36).slice(2, 6).padEnd(4, '0')}`;
  return { id, name: uniqueSetName(name, sets), text: text.slice(0, OWN_TEXT_MAX), at: now };
}

/**
 * Keeps a set (a new one, or one changed). 'many' when the device already holds
 * as many sets as it may, 'full' when its storage would not take it or the sets
 * together would pass what they may take.
 */
export function saveOwnSet(set: OwnSet, store: KeyStore | null = browserStore()): 'kept' | 'many' | 'full' {
  const sets = loadOwnSets(store);
  const clean: OwnSet = { ...set, name: uniqueSetName(set.name, sets, set.id), text: set.text.slice(0, OWN_TEXT_MAX) };
  const at = sets.findIndex((s) => s.id === set.id);
  if (at < 0 && sets.length >= OWN_SETS_MAX) return 'many';
  if (at < 0) sets.push(clean);
  else sets[at] = clean;
  if (sets.reduce((n, s) => n + s.text.length, 0) > OWN_TOTAL_MAX) return 'full';
  return writeSets(sets, store) ? 'kept' : 'full';
}

export function dropOwnSet(id: string, store: KeyStore | null = browserStore()): void {
  const sets = loadOwnSets(store);
  if (sets.some((s) => s.id === id)) writeSets(sets.filter((s) => s.id !== id), store);
}

// ------------------------------------------------------------ sets as topics

/** The sets a class can be asked from, as topics to tick: only those with a question in them. */
export function ownTopics(sets: OwnSet[] = loadOwnSets()): Topic[] {
  const out: Topic[] = [];
  for (const s of sets) {
    const count = parseOwnSet(s.text, s).questions.length;
    if (count) out.push({ id: ownTopic(s.id), name: s.name, group: OWN_GROUP, count });
  }
  return out;
}

/** The questions of the ticked sets, in the order the sets are kept and the questions are written. */
export function ownPrompts(choice: string[], sets: OwnSet[] = loadOwnSets()): PromptDef[] {
  const ids = new Set(choice.map(ownOfTopic).filter((id): id is string => !!id));
  return sets.filter((s) => ids.has(s.id)).flatMap((s) => parseOwnSet(s.text, s).questions.map((q) => q.prompt));
}

/**
 * The order a class is asked a teacher's own questions in: as written, those
 * this class has not been asked first; once all have been asked, round again
 * from the one asked longest ago.
 */
export function ownQueue(prompts: PromptDef[], asked: string[]): PromptDef[] {
  const when = new Map<string, number>();
  asked.forEach((id, i) => when.set(id, i));
  const fresh = prompts.filter((p) => !when.has(p.id));
  const stale = prompts.filter((p) => when.has(p.id)).sort((a, b) => when.get(a.id)! - when.get(b.id)!);
  return [...fresh, ...stale];
}

/** Two queues dealt in turn, the first leading, until `count` are had or both run out. */
export function dealTwo<T>(a: T[], b: T[], count: number): T[] {
  const out: T[] = [];
  for (let i = 0; out.length < count && (i < a.length || i < b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length && out.length < count) out.push(b[i]);
  }
  return out;
}

/**
 * A set's text with one more answer written under one of its questions, after
 * the last of its answers (the text as it is, when the set takes the answer
 * already). Null when the question is no longer in the set, the words cannot
 * stand on a line as an answer, or the deep would still not take them
 * (something written under Not:, or in letters it cannot read).
 */
export function addOwnAnswer(set: Pick<OwnSet, 'id' | 'name' | 'text'>, promptId: string, raw: string): string | null {
  const answer = tidy(raw.replace(/[|\t]/g, ' '));
  if (!answer || answer.length > OWN_WORDS_MAX || NOTE.test(answer) || NOT.test(answer) || TIER.test(answer) || A_LEAD.test(answer)) return null;
  const q = parseOwnSet(set.text, set).questions.find((x) => x.prompt.id === promptId);
  if (!q) return null;
  // What the set already takes needs no writing; what its writer named as wrong stays wrong until they say otherwise.
  const now = matchAnswer(q.prompt, answer);
  if (now.kind === 'accept') return set.text;
  if (now.kind === 'trap' || now.kind === 'decoy') return null;
  const lines = headed(set.text).lines;
  let end = q.line - 1;
  let last = end;
  while (end + 1 < lines.length && lines[end + 1].trim()) {
    end++;
    if (!NOTE.test(lines[end]) && !NOT.test(lines[end])) last = end;
  }
  lines.splice(last + 1, 0, answer);
  const text = lines.join('\n');
  if (text.length > OWN_TEXT_MAX) return null;
  const again = parseOwnSet(text, set).questions.find((x) => x.prompt.id === promptId);
  const r = again ? matchAnswer(again.prompt, answer) : null;
  return r && r.kind === 'accept' && r.answer.answer === answer ? text : null;
}

/** The set a question of a teacher's own came from, by the question's id. */
export const ownSetOf = (promptId: string, sets: OwnSet[]): OwnSet | undefined => sets.find((s) => promptId.startsWith(`own-${s.id}-`));

/** A set to begin from, and to show how one is written. */
export const OWN_EXAMPLE = `Name a stock exchange.
New York Stock Exchange | NYSE
Nasdaq
London Stock Exchange | LSE
ASX | Australian Securities Exchange
Tokyo Stock Exchange | TSE
Euronext
Not: Dow Jones | S&P 500 -- That is an index, not an exchange.

What does the E in ESG stand for? [3]
Environmental | Environment

Name one of the four Ps of marketing.
Price
Product
Promotion
Place | Distribution
Note: The classic four.
`;
