// One day's Census of the Deep: how many divers gave each answer to each of the
// day's questions. Plain requests, no sockets. Storage is two tables: the tally
// of answers, and one-way marks that stop a device counting twice, which are
// dropped once the day cannot be played anywhere. While the census is awake the
// tally is also held in memory, so reading it costs no storage at all.
//
// The Workers Free plan allows 100,000 rows written and 5 million read a day,
// shared with every séance and cult. A counted answer writes two rows (its mark
// and its tally) and forgetting the mark later writes one more, so each question
// counts at most CENSUS_DIVERS_MAX divers a day and the rest of the relay never
// runs short. Raise that on a paid plan.

import { DurableObject } from 'cloudflare:workers';
import { CENSUS_ANSWERS_MAX, CENSUS_DIVERS_MAX, CENSUS_PROMPTS_MAX, CENSUS_TOP, type CensusCount } from '../../src/party/census';
import { EPOCH_UTC } from '../../src/game/daily';
import type { Env } from './index';

const DAY_MS = 86_400_000;

/** When a day's marks go: an hour after the relay stops taking that day's answers (see relayDay). */
export const forgetAt = (day: number): number => EPOCH_UTC + (day + 1) * DAY_MS + 3_600_000;

/** A one-way mark for a device and a question: the census never keeps the device's own. */
async function markFor(device: string, prompt: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${device}|${prompt}`)));
  return Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

export class Census extends DurableObject<Env> {
  private sql: SqlStorage;
  /** question → answer → divers, as the tally table holds it. */
  private tally: Map<string, Map<string, number>> | null = null;
  /** question → divers, everyone who faced it. */
  private totals = new Map<string, number>();
  private armed = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS seen (mark TEXT PRIMARY KEY) WITHOUT ROWID');
    this.sql.exec('CREATE TABLE IF NOT EXISTS tally (prompt TEXT NOT NULL, answer TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (prompt, answer)) WITHOUT ROWID');
  }

  /**
   * One diver's answer to one question ('' for out of air), counted once per
   * device. Returns the question's count as it now stands, without the list.
   */
  async report(day: number, device: string, prompt: string, answer: string): Promise<CensusCount> {
    await this.hear(day, device, prompt, answer);
    return this.count(prompt, answer, 0);
  }

  /**
   * Counts for some of the day's questions, each with the share of the answer
   * asked about and the answers most given. With a device, any of its answers the
   * census has not heard yet are counted first (a report lost on the way, say).
   */
  async read(day: number, device: string | null, items: Array<{ prompt: string; answer: string }>): Promise<CensusCount[]> {
    if (device) for (const i of items) await this.hear(day, device, i.prompt, i.answer);
    return items.map((i) => this.count(i.prompt, i.answer, CENSUS_TOP));
  }

  /** Every question counted that day, for anyone curious (the question bank, say). */
  async all(): Promise<CensusCount[]> {
    return [...this.load().keys()].sort().map((p) => this.count(p, null, CENSUS_TOP));
  }

  async alarm(): Promise<void> {
    this.sql.exec('DELETE FROM seen');
  }

  private load(): Map<string, Map<string, number>> {
    if (this.tally) return this.tally;
    const tally = new Map<string, Map<string, number>>();
    this.totals = new Map();
    for (const r of this.sql.exec<{ prompt: string; answer: string; n: number }>('SELECT prompt, answer, n FROM tally')) {
      let answers = tally.get(r.prompt);
      if (!answers) tally.set(r.prompt, (answers = new Map()));
      answers.set(r.answer, r.n);
      this.totals.set(r.prompt, (this.totals.get(r.prompt) ?? 0) + r.n);
    }
    return (this.tally = tally);
  }

  private async hear(day: number, device: string, prompt: string, answer: string): Promise<void> {
    if (Date.now() >= forgetAt(day)) return; // too late: the marks that stop a second count are gone
    const mark = await markFor(device, prompt);
    // From here to the end nothing waits, so no other request can come between.
    const tally = this.load();
    const answers = tally.get(prompt);
    if (!answers && tally.size >= CENSUS_PROMPTS_MAX) return;
    if (answers && !answers.has(answer) && answers.size >= CENSUS_ANSWERS_MAX) return;
    if ((this.totals.get(prompt) ?? 0) >= CENSUS_DIVERS_MAX) return;
    const counted = this.ctx.storage.transactionSync(() => {
      if (this.sql.exec('INSERT OR IGNORE INTO seen (mark) VALUES (?)', mark).rowsWritten === 0) return false;
      this.sql.exec('INSERT INTO tally (prompt, answer, n) VALUES (?, ?, 1) ON CONFLICT (prompt, answer) DO UPDATE SET n = n + 1', prompt, answer);
      return true;
    });
    if (counted) {
      const row = answers ?? new Map<string, number>();
      if (!answers) tally.set(prompt, row);
      row.set(answer, (row.get(answer) ?? 0) + 1);
      this.totals.set(prompt, (this.totals.get(prompt) ?? 0) + 1);
    }
    if (!this.armed) {
      this.armed = true;
      if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(forgetAt(day));
    }
  }

  private count(prompt: string, answer: string | null, top: number): CensusCount {
    const answers = this.load().get(prompt);
    const total = this.totals.get(prompt) ?? 0;
    const mine = answer === null ? 0 : (answers?.get(answer) ?? 0);
    const list =
      top && answers
        ? [...answers].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).slice(0, top)
        : [];
    return { prompt, total, mine, top: list };
  }
}
