// One cult: its members and this season's dives. Plain requests, no sockets:
// the board is read when the Logbook opens and written when a dive ends.

import { DurableObject } from 'cloudflare:workers';
import { boardFor, joinCult, leaveCult, newCult, recordDive, relayDay, reviveCult, type Cult as CultState, type CultBoard } from '../../src/party/cult';
import type { Env } from './index';

/** A cult nobody has touched for this long is forgotten. */
const CULT_TTL_MS = 120 * 24 * 60 * 60 * 1000;

export type CultReply = { ok: true; board: CultBoard } | { ok: false; status: number; message: string };

export class Cult extends DurableObject<Env> {
  private cult: CultState | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.cult = reviveCult(await ctx.storage.get('cult'));
    });
  }

  private live(): CultState | null {
    const c = this.cult;
    return c && Date.now() - c.touched < CULT_TTL_MS ? c : null;
  }

  /** Found a cult under this sign with its first member, unless the sign is taken. */
  async found(sign: string, id: string, name: string, day: number): Promise<CultReply | null> {
    if (this.live()) return null;
    const now = Date.now();
    const cult = newCult(sign, now);
    const res = joinCult(cult, id, name, now);
    if (!res.ok) return { ok: false, status: 400, message: res.message };
    this.cult = cult;
    await this.save();
    return { ok: true, board: boardFor(cult, id, this.day(day, now)) };
  }

  async join(id: string, name: string, day: number): Promise<CultReply> {
    const cult = this.live();
    if (!cult) return { ok: false, status: 404, message: 'No cult has that sign.' };
    const now = Date.now();
    const res = joinCult(cult, id, name, now);
    if (!res.ok) return { ok: false, status: res.code === 'full' ? 409 : 400, message: res.message };
    await this.save();
    return { ok: true, board: boardFor(cult, id, this.day(day, now)) };
  }

  async dive(id: string, day: number, depth: number): Promise<CultReply> {
    const cult = this.live();
    if (!cult) return { ok: false, status: 404, message: 'No cult has that sign.' };
    const now = Date.now();
    const res = recordDive(cult, id, day, depth, now);
    if (!res.ok) return { ok: false, status: res.code === 'gone' ? 403 : 400, message: res.message };
    await this.save();
    return { ok: true, board: boardFor(cult, id, this.day(day, now)) };
  }

  async board(id: string, day: number): Promise<CultReply> {
    const cult = this.live();
    if (!cult) return { ok: false, status: 404, message: 'No cult has that sign.' };
    return { ok: true, board: boardFor(cult, id, this.day(day, Date.now())) };
  }

  async leave(id: string): Promise<boolean> {
    const cult = this.live();
    if (!cult) return false;
    leaveCult(cult, id, Date.now());
    if (!cult.members.length) {
      this.cult = null;
      await this.ctx.storage.deleteAll();
      return true;
    }
    await this.save();
    return true;
  }

  async alarm(): Promise<void> {
    if (!this.live()) {
      this.cult = null;
      await this.ctx.storage.deleteAll();
    } else await this.ctx.storage.setAlarm(this.cult!.touched + CULT_TTL_MS);
  }

  /** The player's own day, as long as it is within a day of the relay's. */
  private day(day: number, now: number): number {
    const relay = relayDay(now);
    return Number.isInteger(day) && Math.abs(day - relay) <= 1 ? day : relay;
  }

  private async save() {
    if (!this.cult) return;
    await this.ctx.storage.put('cult', this.cult);
    await this.ctx.storage.setAlarm(this.cult.touched + CULT_TTL_MS);
  }
}
