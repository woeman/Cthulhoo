// Class packs: sets of questions on one subject (finance, economics, anatomy),
// written for a class. They live in packs/ at the repo root and are never part
// of the daily bank: the build publishes each as a file of its own, and the game
// fetches a pack when someone ticks it. A pack fix therefore reaches copies of
// the game that are already installed.

import { adoptPrompts, cleanPrompt, type Bank } from './bank';
import { DAILY_GROUP, chosenTopics, dailyTopics, packOfTopic, packTopic, type Topic } from './topics';
import type { PromptDef, PromptMeta, ThemeCopy } from './types';

export interface PackInfo {
  id: string;
  name: string;
  title?: string;
  blurb?: string;
  /** The heading its tick-box sits under ("Business", "Science"). */
  group: string;
  order: number;
  file: string;
  /** Questions and answers in it, as the index counts them. */
  prompts: number;
  answers: number;
  asOf?: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const FILE = /^[a-z0-9][a-z0-9._-]{0,79}\.json$/i;
const NAME_MAX = 24;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined);
const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** The list of packs as published (packs/index.json), checked. Packs with no questions yet are left out. */
export function cleanPackIndex(raw: unknown): PackInfo[] {
  const list = isObj(raw) && Array.isArray(raw.packs) ? raw.packs : [];
  const out: PackInfo[] = [];
  for (const r of list) {
    if (!isObj(r)) continue;
    const id = text(r.id, 40);
    const name = text(r.name, NAME_MAX);
    const file = text(r.file, 84);
    if (!id || !ID.test(id) || id === 'index' || !name || !file || !FILE.test(file) || file.toLowerCase() === 'index.json') continue;
    if (!count(r.prompts) || out.some((p) => p.id === id)) continue;
    out.push({
      id,
      name,
      title: text(r.title, 80),
      blurb: text(r.blurb, 200),
      group: text(r.group, 24) ?? 'Class packs',
      order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : 999,
      file,
      prompts: count(r.prompts),
      answers: count(r.answers),
      asOf: text(r.asOf, 10),
    });
  }
  return out.sort((a, b) => a.order - b.order || (a.name < b.name ? -1 : 1));
}

/**
 * One pack file's questions, each carrying the pack's name (and its date, unless
 * the question has its own). Only ids that start with the pack's id are taken,
 * so a pack can never stand in for a question of the daily bank or another pack.
 */
export function cleanPack(raw: unknown, info: Pick<PackInfo, 'id' | 'name' | 'asOf'>): PromptDef[] {
  const out: PromptDef[] = [];
  const seen = new Set<string>();
  for (const r of isObj(raw) && Array.isArray(raw.prompts) ? raw.prompts : []) {
    const p = cleanPrompt(r);
    if (!p || !p.id.startsWith(`${info.id}-`) || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push({ ...p, topic: info.name, asOf: p.asOf ?? info.asOf });
  }
  return out;
}

/** Fetches a published file under packs/ as JSON. Rejects when it is not there. */
export type PackFetcher = (file: string) => Promise<unknown>;

export function packFetcher(base: string): PackFetcher {
  return async (file) => {
    // Revalidate each time: a pack fix must not wait on the browser's own cache.
    const res = await fetch(new URL(`packs/${file}`, base), { cache: 'no-cache' });
    if (!res.ok) throw new Error(`packs/${file}: ${res.status}`);
    return res.json();
  };
}

/** The published packs, each loaded once when first asked for. */
export class Packs {
  private list: Promise<PackInfo[]> | null = null;
  private loads = new Map<string, Promise<PromptDef[]>>();
  private owner = new Map<string, string>();

  constructor(
    private fetchJson: PackFetcher,
    private onLoad: (prompts: PromptDef[]) => void = () => {},
  ) {}

  /** The packs there are. Empty when none are published or the line is down; asked again next time. */
  index(): Promise<PackInfo[]> {
    this.list ??= this.fetchJson('index.json').then(cleanPackIndex, () => {
      this.list = null;
      return [];
    });
    return this.list;
  }

  /** A pack's questions. Rejects when the pack cannot be had, so the caller can say so. */
  load(id: string): Promise<PromptDef[]> {
    let p = this.loads.get(id);
    if (!p) {
      p = this.index().then(async (list) => {
        const info = list.find((x) => x.id === id);
        if (!info) throw new Error(`No pack called ${id}.`);
        const prompts = cleanPack(await this.fetchJson(info.file), info);
        for (const q of prompts) this.owner.set(q.id, id);
        this.onLoad(prompts);
        return prompts;
      });
      p.catch(() => this.loads.delete(id));
      this.loads.set(id, p);
    }
    return p;
  }

  /** The pack a loaded question came from. */
  packOf(promptId: string): string | undefined {
    return this.owner.get(promptId);
  }

  /** Loads whichever packs hold these question ids (a pack's ids start with its own). Never rejects. */
  async ensure(promptIds: string[]): Promise<void> {
    const missing = promptIds.filter((id) => !this.owner.has(id));
    if (!missing.length) return;
    const list = await this.index();
    const wanted = list.filter((p) => missing.some((id) => id.startsWith(`${p.id}-`)));
    await Promise.all(wanted.map((p) => this.load(p.id).catch(() => [])));
  }
}

const packAsTopic = (p: PackInfo): Topic => ({ id: packTopic(p.id), name: p.name, title: p.title, blurb: p.blurb, group: p.group, count: p.prompts, asOf: p.asOf });

/**
 * Everything a dive or a party can be asked about: the daily bank's categories
 * and the class packs. Loading a pack makes its questions findable in the bank
 * by id, without adding them to the daily plan.
 */
export class TopicBook {
  readonly packs: Packs;
  /** The daily bank's own ids, before any pack was adopted into it. */
  private own: Set<string>;
  /** By a question's words, the first to ask it: the daily bank's own, then the pack loaded first. */
  private firstToAsk = new Map<string, string>();
  private indexed = 0;

  constructor(
    private bank: Pick<Bank, 'prompts' | 'byId' | 'has' | 'about' | 'whole'>,
    private theme: Pick<ThemeCopy, 'categories'>,
    fetchJson: PackFetcher,
  ) {
    this.own = new Set(bank.prompts.map((p) => p.id));
    // The daily bank asks first, whichever of its questions have been fetched: a pack that asks the same thing is its copy.
    for (const p of bank.prompts) {
      const words = wordsOf(p.text);
      if (!this.firstToAsk.has(words)) this.firstToAsk.set(words, p.id);
    }
    this.packs = new Packs(fetchJson, (prompts) => adoptPrompts(bank, prompts));
  }

  /** The daily topics: known at once. */
  daily(): Topic[] {
    return dailyTopics(this.bank.prompts, this.theme);
  }

  /** Every topic: the daily ones, then the class packs when there are any. */
  async all(): Promise<Topic[]> {
    return [...this.daily(), ...(await this.packs.index()).map(packAsTopic)];
  }

  /**
   * The questions a choice draws from, to choose among: the daily bank's come
   * without their answers (see Bank.whole), a class pack's are loaded with it.
   * Rejects when a ticked pack cannot be loaded: asking about something else
   * instead would not be what was chosen.
   */
  async pool(choice: string[]): Promise<PromptMeta[]> {
    const topics = await this.all();
    // A ticked pack that is not in the list means the list could not be fetched.
    if (choice.some((id) => packOfTopic(id) && !topics.some((t) => t.id === id))) throw new Error('A chosen class pack could not be reached.');
    const picked = chosenTopics(choice, topics);
    const cats = new Set(picked.filter((t) => t.group === DAILY_GROUP).map((t) => t.id));
    const out = this.bank.prompts.filter((p) => cats.has(p.category));
    for (const t of picked) {
      const pack = packOfTopic(t.id);
      if (pack) out.push(...(await this.packs.load(pack)));
    }
    return out;
  }

  /** A class pack's questions, whole. Rejects when the pack cannot be had. */
  pack(id: string): Promise<PromptDef[]> {
    return this.packs.load(id);
  }

  /** The topic a question belongs to: its pack's when it came from one, else its category. */
  topicOf(p: Pick<PromptDef, 'id' | 'category'>): string {
    const pack = this.packs.packOf(p.id);
    return pack ? packTopic(pack) : p.category;
  }

  /**
   * The question an id stands for. A pack may carry a daily question under its
   * own id ("anatomy-bones" for "bones"), and two packs may ask the very same
   * thing in the same words ("Name a part of the human brain." in anatomy and in
   * psychology): each such pair is the one question, and a session must not ask
   * it twice.
   */
  sameAs(id: string): string {
    const copied = this.copied(id);
    const p = this.bank.about(copied) ?? this.bank.about(id);
    if (!p) return copied;
    // What is here whole only grows (a pack is adopted when it loads, a daily question when it is fetched),
    // so the index is caught up when it has. The daily bank's own words were all indexed at the start.
    if (this.indexed < this.bank.byId.size) {
      let i = 0;
      for (const other of this.bank.byId.values()) {
        if (i++ < this.indexed) continue;
        const words = wordsOf(other.text);
        if (!this.firstToAsk.has(words)) this.firstToAsk.set(words, this.copied(other.id));
      }
      this.indexed = this.bank.byId.size;
    }
    return this.firstToAsk.get(wordsOf(p.text)) ?? copied;
  }

  /** The daily question a pack's copy stands for, by its id; any other id stands for itself. */
  private copied(id: string): string {
    const pack = this.packs.packOf(id);
    if (!pack) return id;
    const rest = id.slice(pack.length + 1);
    return this.own.has(rest) ? rest : id;
  }

  /**
   * Makes sure saved question ids can be found whole again after a reload: the
   * daily bank's are fetched, and so is whichever class pack holds the others.
   * Never rejects: what could not be had is simply still missing.
   */
  async ensure(promptIds: string[]): Promise<void> {
    const missing = promptIds.filter((id) => !this.bank.byId.has(id));
    if (!missing.length) return;
    await Promise.all([this.bank.whole(missing.filter((id) => this.bank.has(id))), this.packs.ensure(missing.filter((id) => !this.bank.has(id)))]);
  }
}

/** A question's words, for telling when two ask the same thing: case, spacing and the closing mark aside. */
function wordsOf(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.?!…]+$/, '')
    .trim();
}

/** What a question is filed under, for the line above it: its class pack (and section), or its category's title. */
export function filedUnder(theme: Pick<ThemeCopy, 'categories'>, p: Pick<PromptDef, 'category' | 'topic' | 'section'>): string | undefined {
  if (p.topic) return p.section ? `${p.topic} · ${p.section}` : p.topic;
  return theme.categories[p.category]?.title;
}
