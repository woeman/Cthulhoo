import type { DayRecord, ThemeCopy } from './types';
import { bellIndexFor, omenById, type OmenDef } from './omens';

export const BASE_TIME_MS = 25_000;
export const FLOOR_DEPTH = 7_000;

export function timeLimitMs(omen: OmenDef): number {
  return omen.timeMs ?? BASE_TIME_MS;
}

export function baseDepth(theme: ThemeCopy, tier: number): number {
  return theme.tiers.find((t) => t.tier === tier)?.depth ?? 0;
}

export function depthFor(theme: ThemeCopy, tier: number, omen: OmenDef, index: number, day: number, count = 7): number {
  let d = baseDepth(theme, tier);
  if (!d) return 0;
  d *= omen.tierMultiplier?.[tier] ?? 1;
  d *= omen.allMultiplier ?? 1;
  if (omen.bell && index === bellIndexFor(day, count)) d *= 2;
  return Math.round(d / 10) * 10;
}

export function totalDepth(rec: Pick<DayRecord, 'answers'>): number {
  return rec.answers.reduce((s, a) => s + a.depth, 0);
}

export function isBellQuestion(rec: Pick<DayRecord, 'omen' | 'day' | 'promptIds'>, index: number): boolean {
  const omen = omenById(rec.omen);
  return !!omen.bell && index === bellIndexFor(rec.day, rec.promptIds.length);
}

// Sanity is the price of knowledge. It never changes the score; it changes how
// the world looks and sounds, and it is reported on the share card.
export const SANITY = {
  start: 100,
  perThousandMetres: 7,
  unspeakable: 5,
  reject: 3,
  timeout: 9,
};

export function clampSanity(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}

export function sanityAfterAnswer(sanity: number, depth: number, tier: number): number {
  return clampSanity(sanity - (depth / 1000) * SANITY.perThousandMetres - (tier === 6 ? SANITY.unspeakable : 0));
}
