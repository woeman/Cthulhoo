import type { DayRecord, MilestoneDef } from './types';
import { totalDepth } from './scoring';

// Lifetime depth. Every daily dive adds to it, and the lantern (the streak)
// multiplies what each dive earns, a step for every full week it has burned.
// A missed day lets you drift back up by a third of an average day, unless a ward
// keeps the lantern lit, and milestones once passed are floors you never rise
// above again. A riddle of the Whispering Deep solved adds its metres on the
// day it was solved, as they are: riddles never light the lantern, spend a ward
// or change what an average day of drift is. Everything is worked out afresh
// from the saved dives and riddles, so there is no second store to fall out of
// step with them.

export const WEEK = 7;
export const MAX_WARDS = 2;
export const MULT_STEP = 0.1;
export const MAX_MULT = 2;
/** How much of an average day one missed day costs. */
export const DRIFT_SHARE = 1 / 3;
/** How many recent dives make the "average day" that drift is measured against. */
export const DRIFT_WINDOW = 7;

/** The multiplier a dive earns on the given day of an unbroken lantern (1 = first day). */
export function multiplierFor(streak: number): number {
  if (!(streak >= 1)) return 1;
  const m = 1 + MULT_STEP * Math.floor((streak - 1) / WEEK);
  return Math.min(MAX_MULT, Math.round(m * 10) / 10);
}

export type CareerEvent =
  | { kind: 'dive'; day: number; dive: number; mult: number; gained: number; streak: number }
  | { kind: 'ward-earned'; day: number; streak: number }
  | { kind: 'ward-spent'; day: number }
  | { kind: 'drift'; day: number; metres: number }
  | { kind: 'riddle'; day: number; metres: number }
  | { kind: 'milestone'; day: number; index: number };

/** What the career needs of a day's riddle (the riddles' own saved attempt fits). */
export interface RiddleSolve {
  day: number;
  status: string;
  /** What solving it earned, after the whispers heard. */
  metres?: number;
}

export interface CareerPoint {
  day: number;
  /** Career depth at the end of the day. */
  depth: number;
  kind: 'dive' | 'ward' | 'drift' | 'rest' | 'today';
}

export interface Career {
  depth: number;
  /** The deepest the career has ever been. */
  best: number;
  /** The depth of the deepest milestone passed: you never drift above it. */
  floor: number;
  /** Milestones passed, in order, with the day each was passed. */
  passed: Array<{ index: number; day: number }>;
  /** Index of the next milestone to pass, or -1 when all are behind you. */
  next: number;
  /** Days the lantern has burned, counting warded days as kept but not added. */
  streak: number;
  bestStreak: number;
  wards: number;
  /** What the next dive will earn at: today's, if today is not played yet. */
  nextMult: number;
  daysPlayed: number;
  /** Metres the riddles have added, all told. */
  fromRiddles: number;
  riddlesSolved: number;
  firstDay: number | null;
  lastPlayed: number | null;
  points: CareerPoint[];
  events: CareerEvent[];
  /** The run of missed days just before today, if today's dive has not been played. */
  away: { days: number; drift: number; wardsSpent: number } | null;
  /** True once today's dive has counted. */
  playedToday: boolean;
}

/** A riddle counts once solved, on its own day (never a day still to come). */
function riddleCounts(r: RiddleSolve | undefined, today: number): r is RiddleSolve & { metres: number } {
  return !!r && r.status === 'solved' && Number.isInteger(r.day) && r.day <= today && typeof r.metres === 'number' && r.metres > 0;
}

/** A dive counts for the career once it is finished, or if any answer was given before its day ended. */
function counts(rec: DayRecord | undefined, today: number): boolean {
  if (!rec || rec.practice || !Number.isInteger(rec.day) || rec.day > today) return false;
  if (rec.finished) return true;
  return rec.day < today && rec.answers.length > 0;
}

export function computeCareer(
  days: Record<number, DayRecord>,
  today: number,
  milestones: MilestoneDef[],
  riddles: Record<number, RiddleSolve> = {},
): Career {
  const dives = new Map<number, number>();
  for (const rec of Object.values(days)) if (counts(rec, today)) dives.set(rec.day, totalDepth(rec));
  const solved = new Map<number, number>();
  for (const r of Object.values(riddles)) if (riddleCounts(r, today)) solved.set(r.day, Math.round(r.metres));
  const marks = [...milestones].sort((a, b) => a.depth - b.depth);

  const career: Career = {
    depth: 0,
    best: 0,
    floor: 0,
    passed: [],
    next: marks.length ? 0 : -1,
    streak: 0,
    bestStreak: 0,
    wards: 0,
    nextMult: 1,
    daysPlayed: dives.size,
    fromRiddles: 0,
    riddlesSolved: solved.size,
    firstDay: null,
    lastPlayed: null,
    points: [],
    events: [],
    away: null,
    playedToday: dives.has(today),
  };
  if (!dives.size && !solved.size) return career;

  const first = Math.min(...dives.keys(), ...solved.keys());
  career.firstDay = first;
  const recent: number[] = [];
  let away = { days: 0, drift: 0, wardsSpent: 0 };

  for (let day = first; day <= today; day++) {
    let kind: CareerPoint['kind'] = 'rest';
    const dive = dives.get(day);
    if (dive !== undefined) {
      away = { days: 0, drift: 0, wardsSpent: 0 };
      career.streak += 1;
      career.bestStreak = Math.max(career.bestStreak, career.streak);
      const mult = multiplierFor(career.streak);
      const gained = Math.round(dive * mult);
      career.depth += gained;
      recent.push(gained);
      if (recent.length > DRIFT_WINDOW) recent.shift();
      career.events.push({ kind: 'dive', day, dive, mult, gained, streak: career.streak });
      if (career.streak % WEEK === 0 && career.wards < MAX_WARDS) {
        career.wards += 1;
        career.events.push({ kind: 'ward-earned', day, streak: career.streak });
      }
      career.lastPlayed = day;
      kind = 'dive';
    } else if (day < today) {
      // A whole day went by without a dive.
      away.days += 1;
      if (career.wards > 0 && career.streak > 0) {
        career.wards -= 1;
        away.wardsSpent += 1;
        career.events.push({ kind: 'ward-spent', day });
        kind = 'ward';
      } else {
        career.streak = 0;
        const average = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0;
        const before = career.depth;
        career.depth = Math.max(career.floor, career.depth - Math.round(average * DRIFT_SHARE));
        const metres = before - career.depth;
        if (metres > 0) {
          away.drift += metres;
          career.events.push({ kind: 'drift', day, metres });
          kind = 'drift';
        }
      }
    } else {
      kind = 'today';
    }

    const riddle = solved.get(day);
    if (riddle !== undefined) {
      career.depth += riddle;
      career.fromRiddles += riddle;
      career.events.push({ kind: 'riddle', day, metres: riddle });
    }

    while (career.next >= 0 && career.depth >= marks[career.next].depth) {
      career.passed.push({ index: career.next, day });
      career.events.push({ kind: 'milestone', day, index: career.next });
      career.floor = marks[career.next].depth;
      career.next = career.next + 1 < marks.length ? career.next + 1 : -1;
    }
    career.best = Math.max(career.best, career.depth);
    career.points.push({ day, depth: career.depth, kind });
  }

  // The lantern is still lit if yesterday was played or warded; the next dive
  // continues it. Otherwise it was put out by the last missed day (streak 0).
  career.nextMult = multiplierFor(career.streak + 1);
  // Away is from the dives: a diver who has only solved riddles has nothing to be away from.
  if (!career.playedToday && away.days > 0 && career.lastPlayed !== null) career.away = away;
  return career;
}

/** The week of the lantern a streak is in: 1 for days 1 to 7. */
export const lanternWeek = (streak: number): number => Math.max(1, Math.floor((Math.max(1, streak) - 1) / WEEK) + 1);

/** Metres still to go to the next milestone, or null when there is none. */
export function toNextMilestone(career: Career, milestones: MilestoneDef[]): number | null {
  const marks = [...milestones].sort((a, b) => a.depth - b.depth);
  return career.next >= 0 ? Math.max(0, marks[career.next].depth - career.depth) : null;
}

export interface CareerDay {
  /** What the day's dive scored, the lantern's multiplier, and what it added to the career. */
  dive: { dive: number; mult: number; gained: number; streak: number } | null;
  /** Metres the day's riddle added, 0 if none was solved. */
  riddle: number;
  /** Milestones passed that day, as indices into the milestones sorted by depth. */
  milestones: number[];
  wardEarned: boolean;
  /** Career depth at the end of the day before, and at the end of this one. */
  before: number;
  after: number;
}

/** What one day did to the career. */
export function careerDay(career: Career, day: number): CareerDay {
  let dive: CareerDay['dive'] = null;
  const milestones: number[] = [];
  let wardEarned = false;
  let riddle = 0;
  for (const e of career.events) {
    if (e.day !== day) continue;
    if (e.kind === 'dive') dive = { dive: e.dive, mult: e.mult, gained: e.gained, streak: e.streak };
    else if (e.kind === 'riddle') riddle += e.metres;
    else if (e.kind === 'milestone') milestones.push(e.index);
    else if (e.kind === 'ward-earned') wardEarned = true;
  }
  const i = career.points.findIndex((p) => p.day === day);
  const after = i >= 0 ? career.points[i].depth : career.depth;
  const before = i > 0 ? career.points[i - 1].depth : i === 0 ? 0 : career.depth;
  return { dive, riddle, milestones, wardEarned, before, after };
}
