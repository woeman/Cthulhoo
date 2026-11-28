// The Census of the Deep: how many divers gave each answer to a daily question.
// The surface relay keeps one tally per day number and knows nobody. A report
// carries the device's random mark only so that a reload cannot count twice;
// the relay keeps a one-way hash of it per question, and forgets even that once
// the day is over everywhere. Pure, like cult.ts: the relay counts, the game draws.

/** Answers the relay sends back for one question, most given first. */
export const CENSUS_TOP = 40;
/** Distinct answers one question may hold in a day's tally. */
export const CENSUS_ANSWERS_MAX = 2000;
/** Distinct questions one day may hold (seven a day, and room for the bank changing mid-day). */
export const CENSUS_PROMPTS_MAX = 64;
/** Questions one read may ask about. */
export const CENSUS_READ_MAX = 12;
/** Below this many divers on a question, shares are not shown: a handful of divers says little. */
export const CENSUS_MIN = 20;
/**
 * Divers counted on one question in a day. Past it the shares are those of the
 * first this many, which keeps the census inside the relay's free allowance
 * (see worker/src/census.ts). A thousand divers is plenty to tell rare from common.
 */
export const CENSUS_DIVERS_MAX = 1000;

const ANSWER_MAX = 120;

export interface CensusCount {
  prompt: string;
  /** Divers who faced the question that day, those who ran out of air included. */
  total: number;
  /** How many gave the answer asked about, one's own included. For no answer, how many ran out of air. */
  mine: number;
  /** The most given answers, most first, as [answer, divers]. An empty answer is out of air. */
  top: Array<[string, number]>;
}

/** A question's id as the bank writes them. */
export const cleanPromptId = (v: unknown): string | null => (typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,79}$/i.test(v) ? v : null);

/**
 * An answer as the census counts it: the bank's own spelling, trimmed, or '' for
 * running out of air. Null when it is not something the census can count.
 */
export function cleanCensusAnswer(v: unknown): string | null {
  if (v === null || v === undefined) return '';
  if (typeof v !== 'string') return null;
  const s = v.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (s.length > ANSWER_MAX || /[\u0000-\u001f\u007f]/.test(s)) return null;
  return s;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A count as the relay sent it, checked: the game trusts nobody's JSON either. */
export function cleanCount(raw: unknown): CensusCount | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const prompt = cleanPromptId(r.prompt);
  if (!prompt) return null;
  const top: Array<[string, number]> = [];
  for (const row of Array.isArray(r.top) ? r.top.slice(0, CENSUS_TOP) : []) {
    if (!Array.isArray(row)) continue;
    const answer = cleanCensusAnswer(row[0]);
    const n = count(row[1]);
    if (answer !== null && n > 0) top.push([answer, n]);
  }
  const total = count(r.total);
  return { prompt, total, mine: Math.min(count(r.mine), total), top };
}

const people = (n: number) => n.toLocaleString('en-GB');

/** A share as a whole percentage, never claiming all or none unless it is so. */
export function percent(n: number, total: number): string {
  if (!(total > 0) || !(n > 0)) return '0%';
  if (n >= total) return '100%';
  const p = (n / total) * 100;
  if (p < 1) return 'under 1%';
  return `${Math.min(99, Math.round(p))}%`;
}

/** Whether a question has stopped counting for the day: its shares are those of the first divers. */
export const censusFull = (c: Pick<CensusCount, 'total'>): boolean => c.total >= CENSUS_DIVERS_MAX;

/** How many have faced a question so far, before there are enough for shares. */
export function censusSoFar(total: number): string {
  return total <= 1 ? 'The first diver to face this today.' : `One of ${people(total)} divers to face this today.`;
}

/**
 * The line under a revealed answer: what share of today's divers said it.
 * `answered` is false when the air ran out. Below `min` divers it says how many
 * have faced the question so far instead. With `then`, it speaks of a day gone
 * ("the 212 divers that day"), as the Reliquary does.
 */
export function censusLine(c: Pick<CensusCount, 'total' | 'mine'>, min: number, answered: boolean, then = false): string {
  if (c.total < min) return censusSoFar(c.total);
  const when = then ? 'that day' : 'today';
  const full = censusFull(c);
  // "today’s 212 divers", "the 212 divers that day", "the first 1,000 divers today"
  const divers = full ? `the first ${people(CENSUS_DIVERS_MAX)} divers ${when}` : then ? `the ${people(c.total)} divers that day` : `today’s ${people(c.total)} divers`;
  const others = full ? `the first ${people(CENSUS_DIVERS_MAX)} ${when}` : then ? `the ${people(c.total)} that day` : `today’s ${people(c.total)}`;
  if (!answered) return `${percent(Math.max(0, c.total - c.mine), c.total)} of ${divers} found an answer.`;
  if (c.mine >= c.total) return `Every one of ${divers} said it.`;
  if (c.mine <= 1) return `No other diver of ${others} said it.`;
  const p = percent(c.mine, c.total);
  return p === 'under 1%' ? `Fewer than 1 in 100 of ${divers} said it.` : `${p} of ${divers} said it.`;
}

/** Below the share threshold, for the log of a dive: how many so far, and when shares show. */
export function censusWait(total: number, min: number): string {
  return `${censusSoFar(total)} Shares show once ${people(min)} have.`;
}

/** The heading over the answers most given: "Today’s 212 divers said:". */
export function diversSaid(c: Pick<CensusCount, 'total'>): string {
  return censusFull(c) ? `The first ${people(CENSUS_DIVERS_MAX)} divers today said:` : `Today’s ${people(c.total)} ${c.total === 1 ? 'diver' : 'divers'} said:`;
}

/** The line under that list for those whose air ran out, the player among them or not. */
export function airLine(air: number, total: number, mineToo: boolean): string {
  const share = percent(air, total);
  return mineToo ? `${share} ran out of air, you among them.` : `${share} ran out of air.`;
}

/** The share in a word or two, for the log of a dive: "4% said it", "only you". Null without enough divers, or no answer. */
export function shareTag(c: Pick<CensusCount, 'total' | 'mine'>, min: number, answered: boolean): string | null {
  if (c.total < min || !answered) return null;
  if (c.mine >= c.total) return 'everyone said it';
  if (c.mine <= 1) return 'only you said it';
  return `${percent(c.mine, c.total)} said it`;
}

export interface CensusRow {
  answer: string;
  share: string;
  /** The share as a fraction of the day's divers, 0 to 1, for drawing it. */
  part: number;
  /** This is the answer the player gave. */
  yours: boolean;
}

/**
 * The answers most divers gave, for the log of a dive: only answers the bank
 * knows (the relay counts whatever it is sent, so anything else is left out),
 * most given first, and the player's own answer even if it is not among them.
 */
export function censusRows(c: CensusCount, known: Set<string>, mine: string | null, k = 5): CensusRow[] {
  const row = (answer: string, n: number, yours: boolean): CensusRow => ({ answer, share: percent(n, c.total), part: c.total > 0 ? Math.min(1, n / c.total) : 0, yours });
  const rows: CensusRow[] = [];
  for (const [answer, n] of c.top) {
    if (rows.length >= k) break;
    if (!answer || !known.has(answer)) continue;
    rows.push(row(answer, n, answer === mine));
  }
  if (mine && !rows.some((r) => r.yours)) rows.push(row(mine, c.mine, true));
  return rows;
}

/** How many of the day's divers ran out of air on the question, as far as the list says. */
export const outOfAir = (c: CensusCount): number => c.top.find(([a]) => a === '')?.[1] ?? 0;
