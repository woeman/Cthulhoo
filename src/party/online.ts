// The game's side of the surface relay: opening and joining séances, the socket
// a device sits on (it comes back by itself after a drop), and the cult board.
// The relay's address is set at build time (VITE_RELAY_URL). Without one, the
// Séance is played by passing one device round, and there is no cult board.

import type { CultBoard } from './cult';
import type { ClientMsg, ErrorCode, SeanceView, ServerMsg, Verdict } from './types';

export const RELAY_URL = String(import.meta.env.VITE_RELAY_URL ?? '').replace(/\/+$/, '');
export const hasRelay = (): boolean => /^https?:\/\//.test(RELAY_URL);

export class RelayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!hasRelay()) throw new RelayError('The surface relay is not set up yet.', 0);
  let res: Response;
  try {
    res = await fetch(`${RELAY_URL}${path}`, { ...init, headers: init.body ? { 'Content-Type': 'application/json' } : undefined });
  } catch {
    throw new RelayError('The surface relay cannot be reached. Check your connection.', 0);
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new RelayError(body.error ?? 'The surface relay did not answer.', res.status);
  return body as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) });

/** Open a new séance and get its sign. */
export const openSeance = (): Promise<string> => call<{ sign: string }>('/seance', { method: 'POST' }).then((r) => r.sign);

export interface SeancePeek {
  sign: string;
  phase: SeanceView['phase'];
  sitters: number;
  full: boolean;
}

/** Whether a séance with this sign is being held, without sitting down. */
export async function peekSeance(sign: string): Promise<SeancePeek | null> {
  try {
    return await call<SeancePeek>(`/seance/${encodeURIComponent(sign)}`);
  } catch (e) {
    if (e instanceof RelayError && e.status === 404) return null;
    throw e;
  }
}

// ------------------------------------------------------------------ the link

export type LinkStatus = 'connecting' | 'open' | 'lost' | 'closed';

export interface Refusal {
  text: string;
  verdict: Verdict;
  reason?: string;
}

export interface LinkHandlers {
  view(view: SeanceView): void;
  refused?(r: Refusal): void;
  /** `final` errors end the link: the séance is gone, full, or would not take the name. */
  error?(code: ErrorCode, message: string, final: boolean): void;
  status?(status: LinkStatus): void;
}

export interface Hello {
  id: string;
  name: string;
  table?: boolean;
}

const FINAL: ErrorCode[] = ['gone', 'full', 'name'];
const PING_MS = 25_000;

/** One device's seat at a séance. It reconnects by itself and says hello again. */
export class SeanceLink {
  view: SeanceView | null = null;
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
    private hello: Hello,
    private on: LinkHandlers,
    rejoin = false,
  ) {
    document.addEventListener('visibilitychange', this.onWake);
    this.connect(rejoin);
  }

  /** The relay's clock, as near as we can tell: the latest views, less the time they took to arrive. */
  now(): number {
    return Date.now() + (this.skew.length ? Math.max(...this.skew) : 0);
  }

  send(msg: ClientMsg): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  /** Stand up. With `leave`, the seat is given up too (before the first candle, the circle forgets you). */
  close(leave = false): void {
    if (leave) this.send({ t: 'leave' });
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
    const url = `${RELAY_URL.replace(/^http/, 'ws')}/seance/${encodeURIComponent(this.sign)}/socket`;
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
      ws.send(JSON.stringify({ t: 'hello', ...this.hello, rejoin } satisfies ClientMsg));
      this.stop();
      this.ping = window.setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), PING_MS);
    };
    ws.onmessage = (e) => {
      if (e.data === 'pong' || typeof e.data !== 'string') return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(e.data) as ServerMsg;
      } catch {
        return;
      }
      if (msg.t === 'view') {
        this.skew = [...this.skew.slice(-4), msg.view.now - Date.now()];
        this.view = msg.view;
        this.setStatus('open');
        this.on.view(msg.view);
      } else if (msg.t === 'refused') this.on.refused?.(msg);
      else if (msg.t === 'error') {
        const final = FINAL.includes(msg.code) || (msg.code === 'bad' && !this.view);
        if (final) this.done = true;
        this.on.error?.(msg.code, msg.message, final);
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
      // Coming back: the relay must still know this device, or the sign went to someone else.
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

// ------------------------------------------------------- a seat kept a while

const SEAT_KEY = 'cthulhoo.v1.seat';
const SEAT_MS = 6 * 60 * 60 * 1000;

export interface Seat {
  sign: string;
  table: boolean;
  at: number;
}

/** The séance this device last sat at, so a reload sits it back down. */
export function loadSeat(now = Date.now()): Seat | null {
  try {
    const s = JSON.parse(localStorage.getItem(SEAT_KEY) ?? 'null') as Seat | null;
    return s && typeof s.sign === 'string' && now - s.at < SEAT_MS ? s : null;
  } catch {
    return null;
  }
}

export function saveSeat(sign: string, table: boolean): void {
  try {
    localStorage.setItem(SEAT_KEY, JSON.stringify({ sign, table, at: Date.now() } satisfies Seat));
  } catch {
    /* a reload will simply not rejoin */
  }
}

export function clearSeat(): void {
  try {
    localStorage.removeItem(SEAT_KEY);
  } catch {
    /* nothing to clear */
  }
}

// ------------------------------------------------------------------ the cult

export const cultFound = (id: string, name: string, day: number) => call<{ sign: string; board: CultBoard }>('/cult', post({ id, name, day }));
export const cultJoin = (sign: string, id: string, name: string, day: number) => call<{ board: CultBoard }>(`/cult/${encodeURIComponent(sign)}/join`, post({ id, name, day })).then((r) => r.board);
export const cultDive = (sign: string, id: string, day: number, depth: number) => call<{ board: CultBoard }>(`/cult/${encodeURIComponent(sign)}/dive`, post({ id, day, depth })).then((r) => r.board);
export const cultBoard = (sign: string, id: string, day: number) =>
  call<{ board: CultBoard }>(`/cult/${encodeURIComponent(sign)}?id=${encodeURIComponent(id)}&day=${day}`).then((r) => r.board);
export const cultLeave = (sign: string, id: string) => call<{ left: boolean }>(`/cult/${encodeURIComponent(sign)}/leave`, post({ id })).then((r) => r.left);
