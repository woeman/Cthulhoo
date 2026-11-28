// One convocation: a class-sized séance. A host holds it on the big screen and
// never answers; up to three hundred divers sit on phones. The rules live in
// src/party/classroom.ts; this is the room they run in.
//
// It differs from a séance's room where a class differs from a circle:
//   - An answer is told only to the diver who gave it, and the host is sent a
//     count now and then. Everyone is shown the whole picture only when the
//     question changes, so three hundred answers are three hundred small
//     messages and not ninety thousand.
//   - The room is kept in memory and written down in pieces a moment later
//     (the divers in groups, the question once), so a busy blitz writes a
//     handful of rows a second however fast the answers come.

import { DurableObject } from 'cloudflare:workers';
import {
  CLASS_TTL_MS,
  againClass,
  ask,
  boutBack,
  boutGone,
  boutView,
  classAlarmAt,
  classCount,
  classTick,
  configureClass,
  endClass,
  hostView,
  leaveSeat,
  newClass,
  publicSeat,
  removeSeat,
  reveal,
  reviveClass,
  say,
  seatOnline,
  seatView,
  setTable,
  snapshot,
  tableSeats,
  takeSeat,
  LAST_SEAT_SAID,
  type ClassRoom,
  type ClassSeat,
} from '../../src/party/classroom';
import { CLASS_MAX_SEATS, type ClassClientMsg, type ClassErrorCode, type ClassPhase, type ClassServerMsg } from '../../src/party/class-types';
import type { Env } from './index';

/** A sign whose room has been quiet this long may be given to a new class. */
const SIGN_RESTS_MS = 2 * 60 * 60 * 1000;
/** The host's `ask` carries one question whole: the longest in the class packs is about 250,000 characters. */
const HOST_MESSAGE = 1_000_000;
/** A diver only ever sends a name, an answer or a table. */
const SEAT_MESSAGE = 2_000;
/** Divers written down together. */
const CHUNK = 25;
/** How long a change may wait in memory before it is written down. */
const FLUSH_MS = 500;
/** How often the host, and the class, may be sent the count of answers. */
const HOST_COUNT_MS = 250;
const CLASS_COUNT_MS = 1500;

type Attachment = { host: true } | { id: string };

type Meta = Omit<ClassRoom, 'seats' | 'prompt' | 'result'> & { chunks: number };

export interface ClassPeek {
  phase: ClassPhase;
  seats: number;
  full: boolean;
}

const seatKey = (i: number) => `seats:${i}`;

export class Classroom extends DurableObject<Env> {
  private room: ClassRoom | null = null;
  /** What has changed since it was last written down. */
  private dirty = { meta: false, prompt: false, result: false, all: false, chunks: new Set<number>() };
  private savedChunks = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private countTimer: ReturnType<typeof setTimeout> | null = null;
  private hostStale = false;
  private classStale = false;
  private hostSent = 0;
  private classSent = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      const meta = await ctx.storage.get<Meta>('meta');
      if (!meta) return;
      const keys = ['prompt', 'result', ...Array.from({ length: meta.chunks }, (_, i) => seatKey(i))];
      const got = await ctx.storage.get<unknown>(keys);
      const seats: ClassSeat[] = [];
      for (let i = 0; i < meta.chunks; i++) seats.push(...((got.get(seatKey(i)) as ClassSeat[] | undefined) ?? []));
      const { chunks, ...rest } = meta;
      this.room = reviveClass({ ...rest, prompt: got.get('prompt') ?? null, result: got.get('result') ?? null, seats });
      this.savedChunks = chunks;
      // Whose line is up is whoever holds a socket now, not whoever did when this was written.
      const here = new Set<string>();
      for (const ws of ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (a && 'id' in a) here.add(a.id);
      }
      for (const s of this.room?.seats ?? []) s.online = here.has(s.id);
    });
  }

  /** Open a new convocation under this sign, unless one is still using it. */
  async open(sign: string, key: string): Promise<boolean> {
    const now = Date.now();
    const r = this.room;
    if (r && (now - r.touched < SIGN_RESTS_MS || this.ctx.getWebSockets().length > 0)) return false;
    for (const ws of this.ctx.getWebSockets()) this.hangUp(ws, 'gone', 'That class has ended.');
    await this.ctx.storage.deleteAll();
    this.room = newClass(sign, key, now);
    this.savedChunks = 0;
    this.dirty.meta = true;
    await this.flush();
    await this.schedule();
    return true;
  }

  /** What the join form needs to know, without taking a seat. */
  async peek(): Promise<ClassPeek | null> {
    const r = this.room;
    if (!r || Date.now() - r.touched > CLASS_TTL_MS) return null;
    return { phase: r.phase, seats: r.seats.length, full: r.seats.length >= CLASS_MAX_SEATS };
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    if (!this.room || Date.now() - this.room.touched > CLASS_TTL_MS) return new Response('No class has that sign.', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    if (!room) return this.hangUp(ws, 'gone', 'That class has ended.');
    const who = ws.deserializeAttachment() as Attachment | null;
    const host = !!who && 'host' in who;
    // Until a device has shown the host's key, it may send no more than a diver may.
    if (typeof data !== 'string' || data.length > (host ? HOST_MESSAGE : SEAT_MESSAGE)) return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep could not read that.' });
    let msg: ClassClientMsg;
    try {
      msg = JSON.parse(data) as ClassClientMsg;
    } catch {
      return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep could not read that.' });
    }
    if (!msg || typeof msg !== 'object') return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep could not read that.' });
    const now = Date.now();

    if (msg.t === 'host') {
      if (typeof msg.key !== 'string' || msg.key !== room.key) return this.hangUp(ws, 'host', 'That is not the key to this class.');
      ws.serializeAttachment({ host: true } satisfies Attachment);
      room.touched = now;
      return this.tell(ws, { t: 'view', view: hostView(room, snapshot(room, now)) });
    }

    if (msg.t === 'hello') {
      if (host) return this.tell(ws, { t: 'error', code: 'bad', message: 'The host does not take a seat.' });
      const id = String(msg.id ?? '');
      const known = room.seats.some((s) => s.id === id);
      // Coming back to a sign whose class has since been given to strangers.
      if (msg.rejoin === true && !known) return this.hangUp(ws, 'gone', 'That class has ended.');
      const res = takeSeat(room, id, msg.name, now);
      if (!res.ok) return this.hangUp(ws, res.code, res.message);
      ws.serializeAttachment({ id: res.seat.id } satisfies Attachment);
      this.touchSeat(res.seat);
      // In a bout of last diver standing, a side that was being waited for gets its whole turn now somebody is back.
      const back = boutBack(room, res.seat.id, now);
      const view = seatView(room, res.seat.id, snapshot(room, now));
      if (view) this.tell(ws, { t: 'view', view });
      this.toHosts({ t: 'seat', seat: publicSeat(res.seat), ...this.tablesNow() });
      this.bump();
      if (back) return this.turnPassed();
      return;
    }

    if (!who) return this.tell(ws, { t: 'error', code: 'bad', message: 'Say who you are first.' });

    if (host) {
      switch (msg.t) {
        case 'config': {
          const res = configureClass(room, msg, now);
          if (!res.ok) return this.fail(ws, res);
          this.dirty.meta = true;
          if (res.dealt) this.dirty.all = true;
          return this.turned();
        }
        case 'ask': {
          const res = ask(room, msg.prompt, msg.depths, now);
          if (!res.ok) return this.fail(ws, res);
          this.dirty.meta = this.dirty.prompt = this.dirty.result = this.dirty.all = true;
          return this.turned();
        }
        case 'reveal':
          if (!reveal(room, now)) return this.tell(ws, { t: 'error', code: 'phase', message: 'No question is burning.' });
          return this.revealed();
        case 'end': {
          const res = endClass(room, now);
          if (!res.ok) return this.fail(ws, res);
          return this.revealed();
        }
        case 'again': {
          const res = againClass(room, now);
          if (!res.ok) return this.fail(ws, res);
          this.dirty.meta = this.dirty.prompt = this.dirty.result = this.dirty.all = true;
          return this.turned();
        }
        case 'remove': {
          const id = String(msg.id ?? '');
          if (!removeSeat(room, id, now)) return;
          for (const other of this.ctx.getWebSockets()) {
            const a = other.deserializeAttachment() as Attachment | null;
            if (a && 'id' in a && a.id === id) this.hangUp(other, 'removed', 'The host has asked you to leave this class.');
          }
          this.dirty.meta = this.dirty.all = true;
          this.later();
          this.toHosts({ t: 'gone', id, ...this.tablesNow() });
          this.bump();
          if (boutGone(room, id, now)) return this.turnPassed();
          return;
        }
        default:
          return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep does not know that rite.' });
      }
    }

    const me = who.id;
    switch (msg.t) {
      case 'say': {
        const early = room.earlyAt;
        const res = say(room, me, msg.text, now);
        if (!res.ok) return this.fail(ws, res);
        const h = res.heard;
        if (h.kind === 'empty') return;
        const seat = room.seats.find((s) => s.id === me);
        if (seat) this.touchSeat(seat);
        if (h.kind === 'refused') this.tell(ws, { t: 'refused', text: h.text, verdict: h.verdict, ...(h.reason ? { reason: h.reason } : {}) });
        else this.tell(ws, { t: 'heard', input: h.input, answer: h.answer, sealed: h.sealed });
        // Last diver standing: the turn has passed, and everyone is told at once.
        if (res.turn) return this.turnPassed();
        if (h.kind === 'refused') return;
        this.bump();
        // Everyone is in: the question closes in a moment.
        if (room.earlyAt && room.earlyAt !== early) {
          this.dirty.meta = true;
          await this.schedule();
        }
        return;
      }
      case 'table': {
        const res = setTable(room, me, msg.table, now);
        if (!res.ok) return this.fail(ws, res);
        const seat = room.seats.find((s) => s.id === me);
        if (!seat) return;
        this.touchSeat(seat);
        const view = seatView(room, me, snapshot(room, now));
        // Every device of this diver's moves with them.
        for (const [other, id] of this.seatSockets()) if (id === me && view) this.tell(other, { t: 'view', view });
        this.toHosts({ t: 'seat', seat: publicSeat(seat), ...this.tablesNow() });
        this.bump();
        return;
      }
      case 'leave': {
        const left = leaveSeat(room, me, now);
        ws.serializeAttachment(null);
        if (left === 'gone') {
          this.dirty.all = true;
          this.later();
          this.toHosts({ t: 'gone', id: me, ...this.tablesNow() });
        } else if (left === 'away') {
          const seat = room.seats.find((s) => s.id === me);
          if (seat) this.toHosts({ t: 'seat', seat: publicSeat(seat) });
        }
        this.bump();
        try {
          ws.close(1000, 'Left the class.');
        } catch {
          /* already closed */
        }
        if (left && boutGone(room, me, now)) return this.turnPassed();
        return;
      }
      default:
        return this.tell(ws, { t: 'error', code: 'host', message: 'Only the host can do that.' });
    }
  }

  async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    this.dropped(ws);
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, 'Goodbye.');
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropped(ws);
  }

  async alarm(): Promise<void> {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    if (now - room.touched >= CLASS_TTL_MS) {
      for (const ws of this.ctx.getWebSockets()) this.hangUp(ws, 'gone', 'That class has ended.');
      this.room = null;
      this.stopTimers();
      await this.ctx.storage.deleteAll();
      return;
    }
    const due = classTick(room, now);
    if (due === 'reveal') return this.revealed();
    if (due === 'turn') return this.turnPassed();
    await this.schedule();
  }

  // ------------------------------------------------------------------

  private dropped(ws: WebSocket) {
    const room = this.room;
    const who = ws.deserializeAttachment() as Attachment | null;
    if (!room || !who || !('id' in who)) return;
    const id = who.id;
    ws.serializeAttachment(null);
    for (const [other, otherId] of this.seatSockets()) if (other !== ws && otherId === id) return;
    if (!seatOnline(room, id, false)) return;
    const seat = room.seats.find((s) => s.id === id);
    if (seat) this.toHosts({ t: 'seat', seat: publicSeat(seat) });
    this.bump();
  }

  private fail(ws: WebSocket, res: { code: ClassErrorCode; message: string }) {
    this.tell(ws, { t: 'error', code: res.code, message: res.message });
  }

  /** The answers have surfaced (or the class has ended): write it all down and show everyone. */
  private async revealed() {
    this.dirty.meta = this.dirty.result = this.dirty.all = true;
    return this.turned();
  }

  /** The class has turned a page: write it down now, set the clock, and show every device its view. */
  private async turned() {
    await this.flush();
    await this.schedule();
    this.broadcast();
  }

  /**
   * A turn has passed in a bout of last diver standing: write it down, set the
   * clock for the next, and tell every device. The divers are all sent the same
   * small message, so a class of three hundred is one string sent three hundred times.
   */
  private async turnPassed() {
    const room = this.room;
    if (!room) return;
    this.dirty.meta = true;
    await this.flush();
    await this.schedule();
    const now = Date.now();
    const count = classCount(room);
    let host: string | null = null;
    let seat: string | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      if ('host' in a) {
        const last = (host ??= this.turnText(room, Infinity, count, now));
        if (last) this.send(ws, last);
      } else {
        const last = (seat ??= this.turnText(room, LAST_SEAT_SAID, count, now));
        if (last) this.send(ws, last);
      }
    }
    // The turn carried the counts.
    this.hostStale = this.classStale = false;
    this.hostSent = this.classSent = now;
  }

  private turnText(room: ClassRoom, max: number, count: ReturnType<typeof classCount>, now: number): string {
    const last = boutView(room, max);
    return last ? JSON.stringify({ t: 'turn', last, ...count, now } satisfies ClassServerMsg) : '';
  }

  /** One diver changed: their group is written down in a moment. */
  private touchSeat(seat: ClassSeat) {
    const i = this.room?.seats.indexOf(seat) ?? -1;
    if (i >= 0) this.dirty.chunks.add(Math.floor(i / CHUNK));
    this.later();
  }

  private later() {
    this.flushTimer ??= setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  private async flush() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const room = this.room;
    if (!room) return;
    const d = this.dirty;
    const chunks = Math.ceil(room.seats.length / CHUNK);
    const which = d.all ? Array.from({ length: chunks }, (_, i) => i) : [...d.chunks].filter((i) => i < chunks);
    const puts: Record<string, unknown> = {};
    for (const i of which) puts[seatKey(i)] = room.seats.slice(i * CHUNK, (i + 1) * CHUNK);
    if (d.prompt && room.prompt) puts.prompt = room.prompt;
    if (d.result && room.result) puts.result = room.result;
    if (d.meta || chunks !== this.savedChunks) {
      const { seats: _seats, prompt: _prompt, result: _result, ...rest } = room;
      puts.meta = { ...rest, chunks } satisfies Meta;
    }
    const drops: string[] = [];
    for (let i = chunks; i < this.savedChunks; i++) drops.push(seatKey(i));
    if (d.prompt && !room.prompt) drops.push('prompt');
    if (d.result && !room.result) drops.push('result');
    this.dirty = { meta: false, prompt: false, result: false, all: false, chunks: new Set() };
    this.savedChunks = chunks;
    if (Object.keys(puts).length) await this.ctx.storage.put(puts);
    if (drops.length) await this.ctx.storage.delete(drops);
  }

  private async schedule() {
    const room = this.room;
    if (room) await this.ctx.storage.setAlarm(classAlarmAt(room));
  }

  private stopTimers() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.countTimer) clearTimeout(this.countTimer);
    this.flushTimer = this.countTimer = null;
  }

  private *seatSockets(): Generator<[WebSocket, string]> {
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && 'id' in a) yield [ws, a.id];
    }
  }

  private tablesNow(): { tableSeats?: number[] } {
    const room = this.room;
    return room?.config.tables ? { tableSeats: tableSeats(room) } : {};
  }

  private toHosts(msg: ClassServerMsg) {
    const text = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && 'host' in a) this.send(ws, text);
    }
  }

  /** The count of the class has moved: tell the host soon, and the divers now and then. */
  private bump() {
    this.hostStale = this.classStale = true;
    this.pump();
  }

  private pump() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    const hostDue = this.hostStale && now - this.hostSent >= HOST_COUNT_MS;
    const classDue = this.classStale && now - this.classSent >= CLASS_COUNT_MS;
    if (hostDue || classDue) {
      const text = JSON.stringify({ t: 'count', ...classCount(room), ...this.tablesNow() } satisfies ClassServerMsg);
      for (const ws of this.ctx.getWebSockets()) {
        const a = ws.deserializeAttachment() as Attachment | null;
        if (!a) continue;
        if ('host' in a ? hostDue : classDue) this.send(ws, text);
      }
      if (hostDue) {
        this.hostSent = now;
        this.hostStale = false;
      }
      if (classDue) {
        this.classSent = now;
        this.classStale = false;
      }
    }
    if ((this.hostStale || this.classStale) && !this.countTimer) {
      const wait = Math.min(this.hostStale ? HOST_COUNT_MS - (now - this.hostSent) : Infinity, this.classStale ? CLASS_COUNT_MS - (now - this.classSent) : Infinity);
      this.countTimer = setTimeout(() => {
        this.countTimer = null;
        this.pump();
      }, Math.max(20, wait));
    }
  }

  /** Every device is shown the class as it now stands. */
  private broadcast() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    const snap = snapshot(room, now);
    let host: string | null = null;
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (!a) continue;
      if ('host' in a) {
        host ??= JSON.stringify({ t: 'view', view: hostView(room, snap) } satisfies ClassServerMsg);
        this.send(ws, host);
      } else {
        const view = seatView(room, a.id, snap);
        if (view) this.send(ws, JSON.stringify({ t: 'view', view } satisfies ClassServerMsg));
      }
    }
    // The views carried the counts.
    this.hostStale = this.classStale = false;
    this.hostSent = this.classSent = now;
  }

  private tell(ws: WebSocket, msg: ClassServerMsg) {
    this.send(ws, JSON.stringify(msg));
  }

  private send(ws: WebSocket, text: string) {
    try {
      ws.send(text);
    } catch {
      /* the socket went while we spoke */
    }
  }

  private hangUp(ws: WebSocket, code: ClassErrorCode, message: string) {
    this.tell(ws, { t: 'error', code, message });
    ws.serializeAttachment(null);
    try {
      ws.close(4000, message.slice(0, 100));
    } catch {
      /* already closed */
    }
  }
}
