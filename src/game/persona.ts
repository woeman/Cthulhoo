import type { DayRecord, ThemeCopy } from './types';
import type { Career } from './career';
import { definingSigils, type Sigil } from './sigils';
import { pickLine } from './theme';

// Who the deep thinks you are: a title built from depth, the lantern and your
// strongest topic, and a short synopsis rewritten each week. Every choice comes
// from a stable seed (the player's id), so a title only changes when the player
// does, and the synopsis only when the week turns.

export interface Persona {
  title: string;
  epithet: string;
  role: string;
  place: string;
  synopsis: string[];
  /** The week the synopsis belongs to (1 = the first week of the game). */
  week: number;
}

/** Hours that count as night for the synopsis. */
const isNight = (hour: number) => hour >= 22 || hour < 5;
const LONG_LANTERN = 30;
const FAST_MS = 7000;
const SLOW_MS = 15000;

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const fill = (line: string, values: Record<string, string>) => line.replace(/\{(\w+)\}/g, (all, k: string) => values[k] ?? all);

export function weekOf(day: number): number {
  return Math.floor((Math.max(1, day) - 1) / 7) + 1;
}

export function personaFor(career: Career, sigils: Sigil[], days: Record<number, DayRecord>, theme: ThemeCopy, seed: string, today: number): Persona {
  const copy = theme.career;
  const ranked = definingSigils(sigils);
  const top = ranked[0];
  const weakest = ranked.length > 1 ? ranked[ranked.length - 1] : undefined;
  const marks = [...copy.milestones].sort((a, b) => a.depth - b.depth);

  // ---- the title
  let epithets: string[];
  if (career.daysPlayed < 3) epithets = copy.stateEpithets.newcomer;
  else if (career.away && career.away.drift > 0) epithets = copy.stateEpithets.surfacing;
  else if (career.streak >= LONG_LANTERN) epithets = copy.stateEpithets.unsleeping;
  else epithets = [...copy.epithets].reverse().find((e) => career.depth >= e.from)?.words ?? copy.epithets[0]?.words ?? ['Damp'];
  const epithet = pickLine(epithets, seed, 'epithet');
  const roles = (top && copy.roles[top.topic]) || copy.roles.none || ['Diver'];
  const role = pickLine(roles, seed, 'role', top?.topic ?? 'none');
  const last = career.passed[career.passed.length - 1];
  const place = last && marks[last.index] ? marks[last.index].place : copy.surfacePlace;
  const title = fill(copy.title, { epithet, role, place }).replace(/\s+/g, ' ').trim();

  // ---- the synopsis
  const week = weekOf(today);
  const key = (k: string) => [seed, week, k] as const;
  const values = { topic: top?.name ?? '', streak: String(career.streak), days: String(career.daysPlayed) };
  const say = (lines: string[] | undefined, k: string) => (lines?.length ? fill(pickLine(lines, ...key(k)), values) : '');
  const syn = copy.synopsis;
  const lines: string[] = [];

  if (career.daysPlayed < 3) {
    lines.push(say(syn.newcomer, 'newcomer'));
    if (top) lines.push(say(syn.strong[top.topic], 'strong'));
    return { title, epithet, role, place, synopsis: lines.filter(Boolean), week };
  }

  if (top) lines.push(say(syn.strong[top.topic], 'strong'));

  // The stats that stand out most this week, one or two of them.
  const answers = Object.values(days).flatMap((r) => (r && !r.practice ? r.answers : []));
  const accepted = answers.filter((a) => a.tier > 0);
  const rareShare = answers.length ? answers.filter((a) => a.tier >= 5).length / answers.length : 0;
  const commonShare = answers.length ? answers.filter((a) => a.tier <= 1).length / answers.length : 0;
  const speed = median(accepted.map((a) => a.timeMs).filter((t) => t > 0));
  const hours = Object.values(days)
    .filter((r) => r && !r.practice && typeof r.playedAt === 'number')
    .map((r) => new Date(r.playedAt as number).getHours());
  const nightShare = hours.length ? hours.filter(isNight).length / hours.length : NaN;
  const recentWard = career.events.some((e) => e.kind === 'ward-spent' && today - e.day <= 7);

  const candidates: Array<{ score: number; line: string }> = [];
  if (career.away && career.away.drift > 0) candidates.push({ score: 3, line: say(syn.drifting, 'drifting') });
  if (recentWard) candidates.push({ score: 2.5, line: say(syn.warded, 'warded') });
  if (career.streak >= 7) candidates.push({ score: 1 + career.streak / 30, line: say(syn.streak, 'streak') });
  if (rareShare >= 0.25) candidates.push({ score: 1 + rareShare * 2, line: say(syn.rare, 'rare') });
  else if (commonShare >= 0.5) candidates.push({ score: commonShare * 2, line: say(syn.common, 'common') });
  if (speed < FAST_MS) candidates.push({ score: 1 + (FAST_MS - speed) / FAST_MS, line: say(syn.fast, 'fast') });
  else if (speed > SLOW_MS) candidates.push({ score: 1 + Math.min(1, (speed - SLOW_MS) / SLOW_MS), line: say(syn.slow, 'slow') });
  if (hours.length >= 3 && nightShare >= 0.6) candidates.push({ score: 1.2 + nightShare, line: say(syn.night, 'night') });
  else if (hours.length >= 3 && nightShare <= 0.1) candidates.push({ score: 0.8, line: say(syn.day, 'day') });
  // A seeded nudge, so two equal candidates take turns from week to week.
  const nudge = (line: string) => (parseInt(pickLine(['0', '1', '2', '3'], ...key(line)), 10) || 0) / 10;
  candidates
    .filter((c) => c.line)
    .sort((a, b) => b.score + nudge(b.line) - (a.score + nudge(a.line)))
    .slice(0, top ? 1 : 2)
    .forEach((c) => lines.push(c.line));

  if (weakest && weakest.topic !== top?.topic) {
    lines.push(fill(pickLine(syn.weak[weakest.topic] ?? [], ...key('weak')), { ...values, topic: weakest.name }));
  }
  return { title, epithet, role, place, synopsis: [...new Set(lines.filter(Boolean))], week };
}
