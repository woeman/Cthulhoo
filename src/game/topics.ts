// Topics: what a dive or a party may be asked about. The daily bank's categories
// are topics, and so is each class pack (see packs.ts). A choice is a list of
// topic ids; nothing ticked means the whole daily deep, as it always was.

import type { PromptDef, ThemeCopy } from './types';

export interface Topic {
  /** A daily category's key ("science"), or "pack:" and a class pack's id ("pack:finance"). */
  id: string;
  /** The tick-box label. */
  name: string;
  /** The heading it is listed under. */
  group: string;
  /** Questions in it. */
  count: number;
  /** Its own grander name, where it has one ("The Ledger of Drowned Fortunes"). */
  title?: string;
  /** One line on what is in it (class packs). */
  blurb?: string;
  /** The date its lists were true, when lists date (class packs). */
  asOf?: string;
}

/** The heading over the daily bank's categories. */
export const DAILY_GROUP = 'The daily deep';
/** Topics one choice may hold, and names one room may show. */
export const TOPICS_MAX = 24;

const PACK = 'pack:';
export const packTopic = (packId: string): string => `${PACK}${packId}`;
/** The class pack a topic id names, or null for a daily category. */
export const packOfTopic = (topic: string): string | null => (topic.startsWith(PACK) ? topic.slice(PACK.length) : null);

/** The daily bank's categories as topics, in the theme's order: only those with questions. */
export function dailyTopics(prompts: Array<Pick<PromptDef, 'category'>>, theme: Pick<ThemeCopy, 'categories'>): Topic[] {
  const counts = new Map<string, number>();
  for (const p of prompts) counts.set(p.category, (counts.get(p.category) ?? 0) + 1);
  const named = Object.keys(theme.categories).filter((k) => counts.has(k));
  const rest = [...counts.keys()].filter((k) => !(k in theme.categories)).sort();
  return [...named, ...rest].map((k) => ({
    id: k,
    name: theme.categories[k]?.name ?? k,
    title: theme.categories[k]?.title,
    group: DAILY_GROUP,
    count: counts.get(k) ?? 0,
  }));
}

/** A saved or sent choice, cut to topics that exist, each once. */
export function cleanChoice(raw: unknown, topics: Topic[]): string[] {
  const known = new Set(topics.map((t) => t.id));
  const out: string[] = [];
  for (const id of Array.isArray(raw) ? raw : []) {
    if (typeof id === 'string' && known.has(id) && !out.includes(id)) out.push(id);
    if (out.length >= TOPICS_MAX) break;
  }
  return out;
}

/** What a choice draws from. Nothing ticked means every topic of the daily deep. */
export function chosenTopics(choice: string[], topics: Topic[]): Topic[] {
  const picked = topics.filter((t) => choice.includes(t.id));
  return picked.length ? picked : topics.filter((t) => t.group === DAILY_GROUP);
}

/** Whether a choice is the plain daily deep: every daily topic and nothing else, or nothing ticked at all. */
export function isWholeDeep(choice: string[], topics: Topic[]): boolean {
  const picked = chosenTopics(choice, topics);
  const daily = topics.filter((t) => t.group === DAILY_GROUP);
  return picked.length === daily.length && picked.every((t) => t.group === DAILY_GROUP);
}

/** The names a room shows for a choice: none for the plain daily deep. */
export function choiceNames(choice: string[], topics: Topic[]): string[] {
  return isWholeDeep(choice, topics) ? [] : chosenTopics(choice, topics).map((t) => t.name);
}

/** Topic names as one phrase: "Every topic", "Finance", "Finance and Myth", "Finance, Myth and 2 more". */
export function topicsPhrase(names: string[]): string {
  if (!names.length) return 'Every topic';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** How many questions a choice draws from. */
export const choiceCount = (choice: string[], topics: Topic[]): number => chosenTopics(choice, topics).reduce((n, t) => n + t.count, 0);

/**
 * A queue kept in its ranks but dealt round the topics within each rank: the
 * first of every topic, then the second of every topic. A topic of eight
 * questions is then asked as often as one of three thousand. `ids` must already
 * be in rank order (see practiceQueue).
 */
export function dealByTopic(ids: string[], rank: (id: string) => number, topic: (id: string) => string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < ids.length) {
    const r = rank(ids[i]);
    let j = i;
    const piles = new Map<string, string[]>();
    while (j < ids.length && rank(ids[j]) === r) {
      const t = topic(ids[j]);
      const pile = piles.get(t);
      if (pile) pile.push(ids[j]);
      else piles.set(t, [ids[j]]);
      j++;
    }
    const lists = [...piles.values()];
    for (let k = 0; lists.some((l) => k < l.length); k++) for (const l of lists) if (k < l.length) out.push(l[k]);
    i = j;
  }
  return out;
}

/**
 * A queue without the same question twice. A class pack may carry a question of
 * the daily bank under an id of its own; `same` names the question a prompt is,
 * and only the first of each stays.
 */
export function dropCopies(ids: string[], same: (id: string) => string): string[] {
  const seen = new Set<string>();
  return ids.filter((id) => {
    const key = same(id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Questions that fit one message to the relay: taken in order, skipping any that
 * would carry the total past the budget (a class pack's list of every listed
 * company is long). The first is always taken.
 */
export function fitBudget(prompts: PromptDef[], count: number, budget: number): PromptDef[] {
  const out: PromptDef[] = [];
  let size = 0;
  for (const p of prompts) {
    if (out.length >= count) break;
    const n = JSON.stringify(p).length;
    if (out.length && size + n > budget) continue;
    out.push(p);
    size += n;
  }
  return out;
}
