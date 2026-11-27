// One séance room. Each device holds a WebSocket to it; the Hibernation API lets
// the room sleep (and cost nothing) while nobody speaks, and an alarm puts the
// candle out on time even while it sleeps.

import { DurableObject } from 'cloudflare:workers';
import {
  ROOM_TTL_MS,
  advance,
  again,
  alarmAt,
  begin,
  configure,
  join,
  leave,
  newRoom,
  reviveRoom,
  setOnline,
  settle,
  speak,
  tick,
  viewFor,
  type Room,
} from '../../src/party/room';
import type { ClientMsg, ErrorCode, ServerMsg } from '../../src/party/types';
import type { Env } from './index';

/** A sign whose room has been quiet this long may be given to a new séance. */
const SIGN_RESTS_MS = 2 * 60 * 60 * 1000;
const MAX_MESSAGE = 512 * 1024;

interface Attachment {
  id: string;
}

export interface Peek {
  phase: Room['phase'];
  sitters: number;
  full: boolean;
}

export class Seance extends DurableObject<Env> {
  private room: Room | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    void ctx.blockConcurrencyWhile(async () => {
      this.room = reviveRoom(await ctx.storage.get('room'));
    });
  }

  /** Open a new séance under this sign, unless one is still using it. */
  async open(sign: string): Promise<boolean> {
    const now = Date.now();
    const r = this.room;
    if (r && (now - r.touched < SIGN_RESTS_MS || this.ctx.getWebSockets().length > 0)) return false;
    for (const ws of this.ctx.getWebSockets()) this.hangUp(ws, 'gone', 'That séance has ended.');
    this.room = newRoom(sign, now);
    await this.save();
    return true;
  }

  /** What the join form needs to know, without taking a seat. */
  async peek(): Promise<Peek | null> {
    const r = this.room;
    if (!r || Date.now() - r.touched > ROOM_TTL_MS) return null;
    const sitters = r.sitters.filter((s) => !s.table);
    return { phase: r.phase, sitters: sitters.length, full: sitters.length >= 12 };
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected a WebSocket.', { status: 426 });
    if (!this.room || Date.now() - this.room.touched > ROOM_TTL_MS) return new Response('No séance has that sign.', { status: 404 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    const room = this.room;
    if (!room) return this.hangUp(ws, 'gone', 'That séance has ended.');
    if (typeof data !== 'string' || data.length > MAX_MESSAGE) return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep could not read that.' });
    let msg: ClientMsg;
    try {
      msg = JSON.parse(data) as ClientMsg;
    } catch {
      return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep could not read that.' });
    }
    const now = Date.now();
    const me = (ws.deserializeAttachment() as Attachment | null)?.id ?? null;

    if (msg.t === 'hello') {
      const known = room.sitters.some((s) => s.id === msg.id);
      // Coming back to a sign whose séance has since been given to strangers.
      if (msg.rejoin === true && !known) return this.hangUp(ws, 'gone', 'That séance has ended.');
      const res = join(room, String(msg.id ?? ''), msg.name, msg.table === true, now);
      if (!res.ok) return this.hangUp(ws, res.code, res.message);
      ws.serializeAttachment({ id: res.sitter.id } satisfies Attachment);
      return this.commit();
    }
    if (!me) return this.tell(ws, { t: 'error', code: 'bad', message: 'Say who you are first.' });

    switch (msg.t) {
      case 'config':
        return this.after(ws, configure(room, me, msg.candles, msg.seconds, now));
      case 'begin':
        return this.after(ws, begin(room, me, msg.prompts, msg.depths, now));
      case 'next':
        return this.after(ws, advance(room, me, now));
      case 'again':
        return this.after(ws, again(room, me, now));
      case 'leave':
        leave(room, me, now);
        ws.serializeAttachment(null);
        await this.commit();
        try {
          ws.close(1000, 'Left the séance.');
        } catch {
          /* already closed */
        }
        return;
      case 'speak': {
        const res = speak(room, me, msg.text, now);
        if (!res.ok) return this.tell(ws, { t: 'error', code: res.code, message: res.message });
        if (res.heard.kind === 'refused') {
          await this.save();
          return this.tell(ws, { t: 'refused', text: String(msg.text ?? '').trim().slice(0, 80), verdict: res.heard.verdict, reason: res.heard.reason });
        }
        if (res.heard.kind === 'empty') return;
        return this.commit();
      }
      default:
        return this.tell(ws, { t: 'error', code: 'bad', message: 'The deep does not know that rite.' });
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
    if (now - room.touched >= ROOM_TTL_MS) {
      for (const ws of this.ctx.getWebSockets()) this.hangUp(ws, 'gone', 'That séance has ended.');
      this.room = null;
      await this.ctx.storage.deleteAll();
      return;
    }
    if (tick(room, now)) return this.commit();
    await this.schedule();
  }

  // ------------------------------------------------------------------

  private dropped(ws: WebSocket) {
    const room = this.room;
    const id = (ws.deserializeAttachment() as Attachment | null)?.id;
    if (!room || !id) return;
    ws.serializeAttachment(null);
    const still = this.ctx.getWebSockets().some((other) => other !== ws && (other.deserializeAttachment() as Attachment | null)?.id === id);
    if (still) return;
    if (setOnline(room, id, false)) {
      settle(room);
      void this.commit();
    }
  }

  private async after(ws: WebSocket, res: { ok: true } | { ok: false; code: ErrorCode; message: string }) {
    if (!res.ok) return this.tell(ws, { t: 'error', code: res.code, message: res.message });
    return this.commit();
  }

  /** Save, set the clock, and show every device its view. */
  private async commit() {
    await this.save();
    this.broadcast();
  }

  private async save() {
    if (!this.room) return;
    await this.ctx.storage.put('room', this.room);
    await this.schedule();
  }

  private async schedule() {
    const room = this.room;
    if (!room) return;
    const candle = alarmAt(room);
    const expiry = room.touched + ROOM_TTL_MS;
    await this.ctx.storage.setAlarm(Math.min(candle ?? expiry, expiry));
  }

  private broadcast() {
    const room = this.room;
    if (!room) return;
    const now = Date.now();
    for (const ws of this.ctx.getWebSockets()) {
      const id = (ws.deserializeAttachment() as Attachment | null)?.id;
      if (id) this.tell(ws, { t: 'view', view: viewFor(room, id, now) });
    }
  }

  private tell(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* the socket went while we spoke */
    }
  }

  private hangUp(ws: WebSocket, code: ErrorCode, message: string) {
    this.tell(ws, { t: 'error', code, message });
    ws.serializeAttachment(null);
    try {
      ws.close(4000, message.slice(0, 100));
    } catch {
      /* already closed */
    }
  }
}
