// The game's side of a convocation (a class-sized séance): opening one, asking
// after one, and the socket the host's screen or a diver's phone sits on. It
// comes back by itself after a drop, as a séance's does.

import type { ClassClientMsg, ClassErrorCode, ClassPhase, ClassSeatPublic, ClassServerMsg, ClassVerdict, ClassView } from './class-types';
import { call, RELAY_URL, RelayError, type LinkStatus } from './online';

/** Open a new convocation: its sign for the class, and the key that makes this device its host. */
export const openClass = (): Promise<{ sign: string; key: string }> => call<{ sign: string; key: string }>('/class', { method: 'POST' });

export interface ClassPeek {
  sign: string;
  phase: ClassPhase;
  seats: number;
  full: boolean;
}

/** Whether a convocation with this sign is being held, without sitting down. */
export async function peekClass(sign: string): Promise<ClassPeek | null> {
  try {
    return await call<ClassPeek>(`/class/${encodeURIComponent(sign)}`);
  } catch (e) {
    if (e instanceof RelayError && e.status === 404) return null;
    throw e;
  }
}

/** Who this device is to the class: the host (by the key) or a diver (by its mark and a name). */
export type ClassHello = { host: true; key: string } | { host?: false; id: string; name: string };

/** Why a view arrived: the class turned a page, or only its numbers or its roll moved. */
export type ViewCause = 'full' | 'count' | 'roll';

export interface ClassRefusal {
  text: string;
  verdict: ClassVerdict;
  reason?: string;
}

export interface ClassHeard {
  input: string;
  answer: string;
  sealed: number;
}

export interface ClassHandlers {
  view(view: ClassView, cause: ViewCause): void;
  heard?(h: ClassHeard): void;
  refused?(r: ClassRefusal): void;
  /** `final` errors end the link: the class is gone or full, the name will not do, the key is wrong, the host sent this diver out. */
  error?(code: ClassErrorCode, message: string, final: boolean): void;
  status?(status: LinkStatus): void;
}

/** The parts of a ClassLink the screens use, so a bench can play the relay. */
export interface ClassLinkLike {
  view: ClassView | null;
  status: LinkStatus;
  now(): number;
  send(msg: ClassClientMsg): boolean;
  close(leave?: boolean): void;
}

const FINAL: ClassErrorCode[] = ['gone', 'full', 'name', 'host', 'removed'];
const PING_MS = 25_000;

/** The small news the relay sends between pages, folded into the view a device already holds. */
export function foldClassNews(view: ClassView, msg: Exclude<ClassServerMsg, { t: 'view' | 'heard' | 'refused' | 'error' }>): ClassView {
  if (msg.t === 'count') return { ...view, seats: msg.seats, here: msg.here, answered: msg.answered, said: msg.said, ...(msg.tableSeats ? { tableSeats: msg.tableSeats } : {}) };
  const tables = msg.tableSeats ? { tableSeats: msg.tableSeats } : {};
  const roll = view.roll ?? [];
  if (msg.t === 'seat') {
    const at = roll.findIndex((s) => s.id === msg.seat.id);
    const next: ClassSeatPublic[] = at < 0 ? [...roll, msg.seat] : roll.map((s, i) => (i === at ? msg.seat : s));
    return { ...view, ...tables, roll: next, seats: next.length, here: next.filter((s) => s.online).length };
  }
  const next = roll.filter((s) => s.id !== msg.id);
  return { ...view, ...tables, roll: next, seats: next.length, here: next.filter((s) => s.online).length, standings: view.standings?.filter((s) => s.id !== msg.id) };
}

/** One device's place at a convocation. It reconnects by itself and says who it is again. */
export class ClassLink implements ClassLinkLike {
  view: ClassView | null = null;
  status: LinkStatus = 'connecting';
  private ws: WebSocket | null = null;
  private skew: number[] = [];
  private attempts = 0;
  private retry = 0;
  private ping = 0;
  private done = false;
  private onWake = () => {
    if (document.visibilityState === 'visible' && !this.done && this.ws?.readyState !== WebSocket.OPEN) this.reconnect(0);
  };

  constructor(
    readonly sign: string,
    private hello: ClassHello,
    private on: ClassHandlers,
    rejoin = false,
  ) {
    document.addEventListener('visibilitychange', this.onWake);
    this.connect(rejoin);
  }

  /** The relay's clock, as near as we can tell: the latest views, less the time they took to arrive. */
  now(): number {
    return Date.now() + (this.skew.length ? Math.max(...this.skew) : 0);
  }

  send(msg: ClassClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Stand up. With `leave`, a diver's seat is given up too (before the first question, the class forgets them). */
  close(leave = false): void {
    if (leave && !this.hello.host) this.send({ t: 'leave' });
    this.done = true;
    this.stop();
    document.removeEventListener('visibilitychange', this.onWake);
    try {
      this.ws?.close(1000, 'Goodbye.');
    } catch {
      /* already closed */
    }
    this.setStatus('closed');
  }

  private connect(rejoin: boolean) {
    const url = `${RELAY_URL.replace(/^http/, 'ws')}/class/${encodeURIComponent(this.sign)}/socket`;
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.reconnect();
      return;
    }
    this.ws = ws;
    this.setStatus(this.view ? 'lost' : 'connecting');
    ws.onopen = () => {
      this.attempts = 0;
      const h = this.hello;
      ws.send(JSON.stringify((h.host ? { t: 'host', key: h.key } : { t: 'hello', id: h.id, name: h.name, rejoin }) satisfies ClassClientMsg));
      this.stop();
      this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong' || typeof e.data !== 'string') return;
      let msg: ClassServerMsg;
      try {
        msg = JSON.parse(e.data) as ClassServerMsg;
      } catch {
        return;
      }
      switch (msg.t) {
        case 'view':
          this.skew = [...this.skew.slice(-4), msg.view.now - Date.now()];
          this.view = msg.view;
          this.setStatus('open');
          this.on.view(msg.view, 'full');
          return;
        case 'count':
        case 'seat':
        case 'gone':
          if (!this.view) return;
          this.view = foldClassNews(this.view, msg);
          this.on.view(this.view, msg.t === 'count' ? 'count' : 'roll');
          return;
        case 'heard':
          return this.on.heard?.(msg);
        case 'refused':
          return this.on.refused?.(msg);
        case 'error': {
          const final = FINAL.includes(msg.code) || (msg.code === 'bad' && !this.view);
          if (final) this.done = true;
          return this.on.error?.(msg.code, msg.message, final);
        }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.stop();
      if (this.done) this.setStatus('closed');
      else this.reconnect();
    };
  }

  private reconnect(delay = Math.min(10_000, 400 * 2 ** this.attempts)) {
    if (this.done) return;
    clearTimeout(this.retry);
    this.setStatus(this.view ? 'lost' : 'connecting');
    this.retry = window.setTimeout(() => {
      this.attempts++;
      const old = this.ws;
      this.ws = null;
      try {
        old?.close();
      } catch {
        /* gone already */
      }
      // Coming back: the relay must still know this device, or the sign went to another class.
      this.connect(true);
    }, delay);
  }

  private stop() {
    clearInterval(this.ping);
    this.ping = 0;
  }

  private setStatus(s: LinkStatus) {
    if (s === this.status) return;
    this.status = s;
    this.on.status?.(s);
  }
}

// ------------------------------------------------------- a place kept a while

const PLACE_KEY = 'cthulhoo.v1.classPlace';
const PLACE_MS = 6 * 60 * 60 * 1000;

/** The convocation this device was last at, so a reload takes it back: as its host (with the key) or as a diver. */
export interface ClassPlace {
  sign: string;
  /** The host's key. Absent for a diver. */
  key?: string;
  at: number;
}

export function loadClassPlace(now = Date.now()): ClassPlace | null {
  try {
    const p = JSON.parse(localStorage.getItem(PLACE_KEY) ?? 'null') as ClassPlace | null;
    return p && typeof p.sign === 'string' && (p.key === undefined || typeof p.key === 'string') && now - p.at < PLACE_MS ? p : null;
  } catch {
    return null;
  }
}

export function saveClassPlace(sign: string, key?: string): void {
  try {
    localStorage.setItem(PLACE_KEY, JSON.stringify({ sign, ...(key ? { key } : {}), at: Date.now() } satisfies ClassPlace));
  } catch {
    /* a reload will simply not come back */
  }
}

export function clearClassPlace(): void {
  try {
    localStorage.removeItem(PLACE_KEY);
  } catch {
    /* nothing to clear */
  }
}
