import type { BankDay, DayRecord, PromptDef } from './types';

/** All the plan reads of a question: its answers are never needed to deal the days. */
type Question = Pick<PromptDef, 'id' | 'category'>;

// Day 1 is launch day, 27 November 2026. A new dive begins at local midnight.
export const EPOCH_UTC = Date.UTC(2026, 10, 27);
export const PROMPTS_PER_DAY = 7;
export const MAX_PER_CATEGORY = 2;
/** Days ahead that a practice dive keeps clear of, while the bank is big enough. */
export const PRACTICE_HORIZON = 7;
const DAY_MS = 86_400_000;

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dayNumberFor(d: Date): number {
  const utc = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((utc - EPOCH_UTC) / DAY_MS) + 1;
}

export function dateForDay(day: number): Date {
  const utc = new Date(EPOCH_UTC + (day - 1) * DAY_MS);
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

/** The YYYY-MM-DD date of a day number. Pure calendar arithmetic, the same in every time zone. */
export function dateKeyForDay(day: number): string {
  return new Date(EPOCH_UTC + (day - 1) * DAY_MS).toISOString().slice(0, 10);
}

/** The day number of a YYYY-MM-DD date, or null when it is not a real date. */
export function dayNumberForKey(key: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const day = Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - EPOCH_UTC) / DAY_MS) + 1;
  return dateKeyForDay(day) === key ? day : null;
}

export function msUntilNextDay(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededShuffle<T>(list: T[], seed: number): T[] {
  const out = list.slice();
  const rnd = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const SEED = 0x0c7a1a; // the deep's own number
const scheduleCache = new Map<string, string[][]>();
const byId = (a: Question, b: Question) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const largestFirst = (groups: Question[][]) => groups.sort((a, b) => b.length - a.length);

function byCategory(pool: Question[]): Question[][] {
  const groups = new Map<string, Question[]>();
  for (const p of pool) {
    const g = groups.get(p.category);
    if (g) g.push(p);
    else groups.set(p.category, [p]);
  }
  return [...groups.values()];
}

/**
 * Plans one full cycle through the bank. No prompt is used twice, and each
 * category is dealt round the days like cards, so a day holds at most
 * MAX_PER_CATEGORY of one category whenever the bank allows it; when it does
 * not, the excess is spread as thinly as it can be. A bank that does not divide
 * into whole days leaves its spare prompts out of the cycle, taken from the
 * largest categories (different prompts each cycle).
 */
export function planCycle(prompts: Question[], cycle: number): string[][] {
  const sig = `${cycle}|${prompts.map((p) => `${p.id}:${p.category}`).join(',')}`;
  const hit = scheduleCache.get(sig);
  if (hit) return hit;

  const pool = seededShuffle(prompts.slice().sort(byId), SEED + cycle * 7919);
  const perDay = Math.min(PROMPTS_PER_DAY, pool.length);
  const dayCount = perDay ? Math.floor(pool.length / perDay) : 0;
  const groups = byCategory(pool);
  for (let spare = pool.length - perDay * dayCount; spare > 0; spare--) largestFirst(groups)[0].pop();
  const days: string[][] = Array.from({ length: dayCount }, () => []);
  largestFirst(groups).flat().forEach((p, i) => days[i % dayCount].push(p.id));
  const out = seededShuffle(days, SEED + cycle * 7919 + 1).map((d, i) => seededShuffle(d, hashString(`${cycle}:${i}`)));
  scheduleCache.set(sig, out);
  return out;
}

/** The bank's fixed days by day number: known prompts only, each once, at most a day's worth. */
function fixedDays(prompts: Question[], fixed: BankDay[]): Map<number, string[]> {
  const known = new Set(prompts.map((p) => p.id));
  const out = new Map<number, string[]>();
  for (const f of fixed) {
    const day = dayNumberForKey(f.date);
    if (day === null || out.has(day)) continue;
    const ids = [...new Set(f.prompts.filter((id) => known.has(id)))].slice(0, PROMPTS_PER_DAY);
    if (ids.length) out.set(day, ids);
  }
  return out;
}

/**
 * The open (not fixed) days of one cycle with their prompts. Prompts fixed to a
 * date inside the cycle are kept for that date, and the open days are planned
 * from the rest, so nothing repeats within the cycle. With `settle`, a cycle's
 * first day is swapped with a middle day if it would repeat a prompt from the
 * day before (the previous cycle's last day, which is never moved itself).
 */
function cycleDays(prompts: Question[], pins: Map<number, string[]>, cycle: number, length: number, settle: boolean): Map<number, string[]> {
  const first = cycle * length + 1;
  const reserved = new Set<string>();
  const open: number[] = [];
  for (let d = first; d < first + length; d++) {
    const ids = pins.get(d);
    if (ids) ids.forEach((id) => reserved.add(id));
    else open.push(d);
  }
  const pool = reserved.size ? prompts.filter((p) => !reserved.has(p.id)) : prompts;
  const plan = planCycle(pool, cycle).slice(0, open.length);
  if (settle && cycle > 0 && open[0] === first && plan.length >= 3) {
    const before = pins.get(first - 1) ?? cycleDays(prompts, pins, cycle - 1, length, false).get(first - 1) ?? [];
    const repeats = (ids: string[]) => ids.some((id) => before.includes(id));
    const swap = repeats(plan[0]) ? plan.findIndex((ids, i) => i > 0 && i < plan.length - 1 && !repeats(ids)) : -1;
    if (swap > 0) [plan[0], plan[swap]] = [plan[swap], plan[0]];
  }
  return new Map(open.map((d, i) => [d, plan[i] ?? []]));
}

/**
 * The day's prompts, the same for everyone. A fixed day from the bank wins.
 * Every other day comes from its cycle's plan, a pure function of the prompts'
 * ids and categories (not their order in the files) and of the fixed days.
 *
 * Changing the set of prompts re-plans every day that is not fixed, past days
 * and today included: the cycle is floor(prompts / 7) days long and the shuffle
 * covers the whole bank. Dives already saved keep their own prompt ids. To grow
 * the bank without moving a day anyone has played (or is playing), fix those
 * days first with freezeDays; the rest of their cycle is then planned from the
 * prompts not fixed in it, so it still repeats nothing.
 *
 * `dateKey`, when given, must be the local date of `day`.
 */
export function promptsForDay(prompts: Question[], day: number, fixed: BankDay[] = [], dateKey?: string): string[] {
  if (!prompts.length) return [];
  const pins = fixedDays(prompts, fixed);
  const own = pins.get(dateKey === undefined ? day : (dayNumberForKey(dateKey) ?? NaN));
  if (own) return own;
  if (day < 1) return promptsForDay(prompts, 1, fixed);
  const perDay = Math.min(PROMPTS_PER_DAY, prompts.length);
  const length = Math.max(1, Math.floor(prompts.length / perDay));
  return cycleDays(prompts, pins, Math.floor((day - 1) / length), length, true).get(day) ?? [];
}

/**
 * A run of days written out as fixed days, for the bank. Adding these before
 * the bank's prompts change keeps every one of those days exactly as it was.
 */
export function freezeDays(prompts: Question[], fixed: BankDay[], from: number, to: number): BankDay[] {
  const out: BankDay[] = [];
  for (let day = Math.max(1, from); day <= to; day++) {
    const date = dateKeyForDay(day);
    out.push({ date, prompts: promptsForDay(prompts, day, fixed, date) });
  }
  return out;
}

/**
 * How far off a prompt is from being asked in a dive: 0 for today's (and anything
 * else to keep clear of), 1 to PRACTICE_HORIZON for the days ahead, and one more
 * than that for a prompt nobody is due to meet soon.
 */
export function practiceRank(prompts: Question[], avoid: string[], day?: number, fixed: BankDay[] = []): (id: string) => number {
  const due = new Map<string, number>();
  if (day !== undefined) {
    for (let k = PRACTICE_HORIZON; k >= 1; k--) {
      for (const id of promptsForDay(prompts, day + k, fixed, dateKeyForDay(day + k))) due.set(id, k);
    }
  }
  for (const id of avoid) due.set(id, 0);
  return (id) => due.get(id) ?? PRACTICE_HORIZON + 1;
}

/**
 * Every prompt in the order practice would ask them: shuffled by the seed, then
 * the ones due soon moved to the back, the furthest off first and today's last.
 * `among` narrows what is drawn from (chosen topics, class packs) while the
 * days ahead are still read from the whole bank. `same` names the bank's
 * question that one from elsewhere copies, so a copy waits as long as its original.
 */
export function practiceQueue(
  prompts: Question[],
  avoid: string[],
  seed: number,
  day?: number,
  fixed: BankDay[] = [],
  among: Question[] = prompts,
  same: (id: string) => string = (id) => id,
): string[] {
  const rank = practiceRank(prompts, avoid, day, fixed);
  const ids = seededShuffle(among.map((p) => p.id), seed);
  return ids.sort((a, b) => rank(same(b)) - rank(same(a)));
}

/**
 * A practice set. It leaves out today's prompts and, when given the day, the
 * prompts due in the next PRACTICE_HORIZON days as well, so practice cannot
 * preview the coming dives. Only a bank too small for that falls back on them:
 * the furthest off first, today's last.
 */
export function practicePrompts(prompts: Question[], avoid: string[], seed: number, day?: number, fixed: BankDay[] = []): string[] {
  return practiceQueue(prompts, avoid, seed, day, fixed).slice(0, PROMPTS_PER_DAY);
}

/**
 * Fits a saved dive to the bank in use. Answered questions stay as they were,
 * and so does every unanswered prompt the bank still has, in its place. Only
 * prompts the bank has lost are swapped for unused ones from today's plan, or
 * dropped when there are none. If the question in progress is swapped, its
 * clock and refusals go with it, so the new question starts fresh.
 */
export function repairDive(rec: DayRecord, has: (id: string) => boolean, plan: string[]): DayRecord {
  const done = rec.answers.length;
  const ahead = rec.promptIds.slice(done);
  if (rec.finished || ahead.every(has)) return rec;
  const taken = new Set(rec.promptIds);
  const spare = plan.filter((id) => has(id) && !taken.has(id));
  const promptIds = rec.promptIds.slice(0, done);
  for (const id of ahead) {
    const next = has(id) ? id : spare.shift();
    if (next) promptIds.push(next);
  }
  const moved = promptIds[done] !== rec.promptIds[done];
  return { ...rec, promptIds, active: rec.active && rec.active.index === done && moved ? null : rec.active };
}
