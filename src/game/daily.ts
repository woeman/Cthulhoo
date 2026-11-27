import type { BankDay, PromptDef } from './types';

// Day 1 is launch day, 27 November 2026. A new dive begins at local midnight.
export const EPOCH_UTC = Date.UTC(2026, 10, 27);
export const PROMPTS_PER_DAY = 7;
export const MAX_PER_CATEGORY = 2;
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

/**
 * Plans one full cycle through the bank: every prompt is used once before any
 * repeats, and no day has more than MAX_PER_CATEGORY prompts of one category
 * (relaxed only when the leftovers make it impossible).
 */
export function planCycle(prompts: PromptDef[], cycle: number): string[][] {
  const sig = `${cycle}|${prompts.length}|${prompts.map((p) => p.id).join(',')}`;
  const hit = scheduleCache.get(sig);
  if (hit) return hit;

  const sorted = prompts.slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const pool = seededShuffle(sorted, SEED + cycle * 7919);
  const days: string[][] = [];
  const perDay = Math.min(PROMPTS_PER_DAY, pool.length);
  const dayCount = Math.max(1, Math.floor(pool.length / perDay));
  for (let d = 0; d < dayCount; d++) {
    const chosen: PromptDef[] = [];
    const counts = new Map<string, number>();
    for (let pass = 0; pass < 2 && chosen.length < perDay; pass++) {
      for (let i = 0; i < pool.length && chosen.length < perDay; i++) {
        const p = pool[i];
        const c = counts.get(p.category) ?? 0;
        if (pass === 0 && c >= MAX_PER_CATEGORY) continue;
        chosen.push(p);
        counts.set(p.category, c + 1);
        pool.splice(i, 1);
        i--;
      }
    }
    days.push(chosen.map((p) => p.id));
  }
  scheduleCache.set(sig, days);
  return days;
}

export function promptsForDay(prompts: PromptDef[], day: number, fixed: BankDay[] = [], dateKey?: string): string[] {
  if (!prompts.length) return [];
  if (dateKey) {
    const f = fixed.find((d) => d.date === dateKey);
    if (f) {
      const ids = f.prompts.filter((id) => prompts.some((p) => p.id === id));
      if (ids.length) return ids.slice(0, PROMPTS_PER_DAY);
    }
  }
  const perDay = Math.min(PROMPTS_PER_DAY, prompts.length);
  const daysPerCycle = Math.max(1, Math.floor(prompts.length / perDay));
  const n = Math.max(0, day - 1);
  const cycle = Math.floor(n / daysPerCycle);
  const within = n % daysPerCycle;
  return planCycle(prompts, cycle)[within];
}

/** Random practice set that avoids today's prompts where possible. */
export function practicePrompts(prompts: PromptDef[], avoid: string[], seed: number): string[] {
  const pool = prompts.filter((p) => !avoid.includes(p.id));
  const src = pool.length >= PROMPTS_PER_DAY ? pool : prompts;
  return seededShuffle(src, seed).slice(0, PROMPTS_PER_DAY).map((p) => p.id);
}
