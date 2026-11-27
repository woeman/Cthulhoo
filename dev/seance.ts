// The Séance bench: every screen of the party mode with a made-up circle, for
// tuning by eye and for screenshots. The parameters are listed in seance.html.
//
// In place of the surface relay, a real room (src/party/room.ts) runs in this
// page, with bots for the other sitters, so every view is one the relay would
// send. The clock holds still (the candle stays where it is) until the medium
// lights a candle, or always runs with &run=1. ?live=1 uses the real relay.

import '../art/tokens/tokens.css';
import '../art/css/fonts.css';
import '../art/css/components.css';
import '../src/styles/app.css';
import { applyDepth } from '../art/js/depth.js';
import { loadBank } from '../src/game/bank';
import { dateKeyForDay, dayNumberFor, EPOCH_UTC, mulberry32, promptsForDay } from '../src/game/daily';
import { playerId } from '../src/game/storage';
import type { AnswerDef, PromptDef } from '../src/game/types';
import { makeSign } from '../src/party/codes';
import { boardFor, joinCult, leaveCult, newCult, weekOf, type Cult } from '../src/party/cult';
import { RelayError, saveSeat, type Hello, type LinkHandlers, type LinkStatus, type SeancePeek } from '../src/party/online';
import { addSitter, gutter, holder, newPass, nextCandle, passOn, speakPass, startPass, takeLantern, type PassState } from '../src/party/passplay';
import { advance, again, alarmAt, begin, configure, GRACE_MS, join, leave, newRoom, setOnline, settle, speak, tick, viewFor, type Room } from '../src/party/room';
import type { ClientMsg, ErrorCode, SeanceView, ServerMsg } from '../src/party/types';
import { Abyss } from '../src/render/abyss';
import { cultBody, PASS_KEY, postDiveToCult, seanceScreen, type SeanceDeps, type SeanceEnv, type SeanceOpts } from '../src/screens/seance';
import { CULT_KEY, type CultOpts } from '../src/screens/cult';
import { choosePrompts, relayId, tierDepths } from '../src/screens/seance/model';
import { NAME_KEY } from '../src/screens/seance/parts';
import type { CultDeps, LinkLike } from '../src/screens/seance/types';
import { icon, installArt } from '../src/ui/art';
import { h } from '../src/ui/dom';

// ------------------------------------------------------------------ the address

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.has(k) && q.get(k) !== '0';
const num = (k: string, d: number) => {
  const v = Number(q.get(k));
  return q.has(k) && q.get(k) !== '' && Number.isFinite(v) ? v : d;
};
const STATE = q.get('state') || 'entry';
const LIVE = flag('live');
const RUN = flag('run');
const reduced = flag('reduced');
const isCult = STATE.startsWith('cult');

const SIGN = 'DAGON-7';
const CULT_SIGN = 'BRINE-42';
const NAMES = ['Wren', 'Harrow', 'Ilse', 'Bram', 'Odile', 'Fen', 'Marisol', 'Bartholomew', 'Agathe', 'Silas', 'Juno', 'Cass'];
const SEAT_KEY = 'cthulhoo.v1.seat';
const ASKED_KEY = 'cthulhoo.v1.seanceAsked';

const GROUPS: Array<[string, string[]]> = [
  ['The way in', ['entry', 'entry-norelay', 'join', 'join-none', 'join-full', 'table-entry', 'calling']],
  ['Lobby', ['lobby', 'lobby-sitter', 'lobby-lost', 'table-lobby']],
  ['Candle', ['candle', 'candle-sealed', 'candle-low', 'candle-refused', 'candle-out', 'candle-sitter', 'lost', 'table-candle']],
  ['Reveal', ['reveal', 'reveal-sitter', 'reveal-last', 'table-reveal']],
  ['End', ['end', 'end-tie', 'end-sitter', 'table-end']],
  ['Pass the lantern', ['lantern-setup', 'lantern-pass', 'lantern-speak', 'lantern-sealed', 'lantern-out', 'lantern-reveal', 'lantern-end']],
  ['The Cult', ['cult', 'cult-out', 'cult-join', 'cult-loading', 'cult-gone', 'cult-fail', 'cult-norelay']],
];

const root = document.documentElement;
root.classList.toggle('reduced-motion', reduced);
root.classList.toggle('shot', flag('shot'));
installArt();

// ------------------------------------------------------------------ storage

const store = {
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private window */
    }
  },
  drop(k: string) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* private window */
    }
  },
};

// Each state starts clean: no seat to rejoin, no lantern burning, no cult.
if (!LIVE) for (const k of [SEAT_KEY, PASS_KEY, ASKED_KEY, CULT_KEY]) store.drop(k);
if (q.get('name')) store.set(NAME_KEY, q.get('name') ?? '');

const PID = playerId();
const ME = relayId(PID);
const botId = (name: string) => `bot-${name.toLowerCase()}`;
const isBot = (id: string) => id.startsWith('bot-');
const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const never = <T>(): Promise<T> => new Promise<T>(() => undefined);

// ------------------------------------------------------------------ what the bench saw

interface Said {
  how: 'polite' | 'assertive';
  msg: string;
  at: number;
}

const log = { said: [] as Said[], sound: [] as string[], buzz: [] as Array<number | number[]>, depth: [] as number[], exits: 0, changes: 0 };

// ------------------------------------------------------------------ the shell, as the app builds it

const appRoot = document.getElementById('app') ?? document.body;
const hud = h('header', { class: 'hud', hidden: true });
const stage = h('main', { class: 'stage' });
const shell = h('div', { class: 'app' }, hud, stage);
const live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
const alert = h('div', { class: 'visually-hidden', 'aria-live': 'assertive', 'aria-atomic': 'true' });
appRoot.append(shell, live, alert);

function say(region: HTMLElement, msg: string, how: Said['how']) {
  log.said.push({ how, msg, at: Date.now() });
  region.textContent = '';
  window.setTimeout(() => (region.textContent = msg), 60);
}

// The visible area: what the app's bindViewport sets (--vvh, and .short when a keyboard is up).
function bindViewport() {
  const vv = window.visualViewport;
  const update = () => {
    let visible = window.innerHeight;
    if (vv && Math.abs(vv.scale - 1) < 0.01) {
      visible = vv.height;
      root.style.setProperty('--kb', `${Math.round(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))}px`);
      root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
      root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
    } else {
      root.style.setProperty('--kb', '0px');
      root.style.setProperty('--vvh', `${window.innerHeight}px`);
      root.style.setProperty('--vv-top', '0px');
    }
    root.classList.toggle('short', visible < 560);
  };
  vv?.addEventListener('resize', update);
  vv?.addEventListener('scroll', update);
  window.addEventListener('resize', update);
  update();
}
bindViewport();

// The water behind, at the depth the circle has reached (the title's view above the surface at 0).
const floor = Math.max(0, num('depth', 0));
const cam = (m: number) => (m > 0 ? m + 40 : -32);
let abyss: Abyss | null = null;
if (q.get('abyss') !== '0') {
  abyss = new Abyss(document.body, { reducedMotion: reduced, pinScale: num('scale', 0) });
  if (!abyss.ok) root.classList.add('no-webgl');
  abyss.jumpTo(cam(floor));
  abyss.start();
} else root.classList.add('no-webgl');
applyDepth(root, floor);

function sinkTo(m: number) {
  log.depth.push(m);
  const d = Math.max(floor, m);
  applyDepth(root, d);
  void abyss?.descendTo(cam(d), reduced ? 0 : 2400);
}

// ------------------------------------------------------------------ the env

const bank = loadBank();
const today = Math.round(num('today', isCult ? 9 : dayNumberFor(new Date())));
const avoid = promptsForDay(bank.prompts, today, bank.days, dateKeyForDay(today));

const sound = (name: string) => () => log.sound.push(name);
const env: SeanceEnv = {
  prompts: bank.prompts,
  byId: bank.byId,
  days: bank.days,
  avoid,
  theme: bank.theme,
  today,
  reduced,
  playerId: PID,
  sound: {
    click: sound('click'),
    key: sound('key'),
    refuse: sound('refuse'),
    accept: (tier) => log.sound.push(`accept:${tier}`),
    tick: (urgent) => log.sound.push(urgent ? 'tick:urgent' : 'tick'),
    whisper: sound('whisper'),
    zone: sound('zone'),
  },
  announce: (m) => say(live, m, 'polite'),
  shout: (m) => say(alert, m, 'assertive'),
  buzz: (p) => log.buzz.push(p),
  onDepth: (m) => sinkTo(m),
};

// ------------------------------------------------------------------ the clock

/** The relay's clock in the bench: held still for a screenshot, or running. */
class Clock {
  private held: number | null;
  private offset = 0;
  private wakers: Array<() => void> = [];

  constructor(hold: boolean) {
    this.held = hold ? Date.now() : null;
  }

  now(): number {
    return this.held ?? Date.now() + this.offset;
  }

  get running(): boolean {
    return this.held === null;
  }

  /** Held, the clock stays at t; running, it runs on from t. */
  set(t: number) {
    if (this.held !== null) this.held = t;
    else this.offset = t - Date.now();
  }

  release() {
    if (this.held === null) return;
    this.offset = this.held - Date.now();
    this.held = null;
    for (const w of this.wakers) w();
  }

  hold() {
    if (this.held === null) this.held = this.now();
  }

  onRelease(fn: () => void) {
    this.wakers.push(fn);
  }
}

const clock = new Clock(!RUN);

// ------------------------------------------------------------------ who says what

const fraction = (a: number, b: number) => mulberry32(a * 7919 + b * 104729 + 17)();

/**
 * What each sitter says at a candle: a chorus or two, a lone voice from the deep,
 * someone typing it their own way, someone silent. It turns with the candle, so
 * a different sitter leads each time.
 */
function plan(p: PromptDef, n: number, candle: number): Array<string | null> {
  const all: AnswerDef[] = p.answers.length ? p.answers : [{ answer: 'Dagon', tier: 1 }];
  const by = (lo: number, hi: number) => all.filter((a) => a.tier >= lo && a.tier <= hi);
  const pick = (list: AnswerDef[], k: number) => (list.length ? list[k % list.length] : all[k % all.length]);
  const common = by(1, 2);
  const A = pick(common, candle);
  const B = pick(common, candle + 1);
  const roles = ['mid', 'A', 'rare', 'A', 'B', 'silent', 'A', 'B', 'mid', 'rare', 'mid', 'A'];
  const out: Array<string | null> = [];
  for (let i = 0; i < n; i++) {
    const role = roles[(i + candle * 3) % roles.length];
    const a = role === 'A' ? A : role === 'B' ? B : role === 'rare' ? pick(by(5, 6), candle * 2 + i) : role === 'mid' ? pick(by(3, 4), candle * 5 + i) : null;
    out.push(a ? (role === 'rare' && !p.exact && a.aliases?.length ? a.aliases[0] : a.answer) : null);
  }
  return out;
}

/** Something the deep refuses for this prompt: a trap (with its reason), a decoy, or nothing it knows. */
function refusals(p: PromptDef): string[] {
  const out: string[] = [];
  if (p.traps?.length) out.push(p.traps[0].answer);
  if (p.decoys?.length) out.push(p.decoys[0]);
  out.push('Mother Hydra');
  return out;
}

// ------------------------------------------------------------------ the relay, played in the page

const FINAL: ErrorCode[] = ['gone', 'full', 'name'];
const LATENCY = 45;

class BenchLink implements LinkLike {
  view: SeanceView | null = null;
  status: LinkStatus = 'connecting';
  id: string | null = null;
  closed = false;
  cut = false;

  constructor(
    private relay: BenchRelay,
    readonly sign: string,
    readonly hello: Hello,
    private on: LinkHandlers,
    public rejoin: boolean,
  ) {
    relay.links.add(this);
    if (!relay.silent) window.setTimeout(() => relay.greet(this), LATENCY * 4);
  }

  now(): number {
    return this.relay.clock.now();
  }

  send(msg: ClientMsg): boolean {
    if (this.status !== 'open' || this.cut || this.closed) return false;
    window.setTimeout(() => this.relay.message(this, msg), LATENCY);
    return true;
  }

  close(leave = false): void {
    if (this.closed) return;
    if (leave) this.send({ t: 'leave' });
    this.closed = true;
    this.setStatus('closed');
    window.setTimeout(() => this.relay.dropped(this), LATENCY * 3);
  }

  deliver(msg: ServerMsg) {
    if (this.closed || this.cut) return;
    if (msg.t === 'view') {
      this.view = msg.view;
      this.setStatus('open');
      this.on.view(msg.view);
    } else if (msg.t === 'refused') this.on.refused?.(msg);
    else {
      const final = FINAL.includes(msg.code) || (msg.code === 'bad' && !this.view);
      if (final) {
        this.closed = true;
        this.relay.links.delete(this);
      }
      this.on.error?.(msg.code, msg.message, final);
      if (final) this.setStatus('closed');
    }
  }

  /** The line drops: the device keeps its seat, and is shown as away. */
  lose() {
    if (this.closed || this.cut) return;
    this.cut = true;
    this.setStatus('lost');
    this.relay.away(this);
  }

  /** The line comes back, and says hello again. */
  mend() {
    if (this.closed || !this.cut) return;
    this.cut = false;
    this.rejoin = true;
    this.relay.greet(this);
  }

  private setStatus(s: LinkStatus) {
    if (s === this.status) return;
    this.status = s;
    this.on.status?.(s);
  }
}

class BenchRelay {
  rooms = new Map<string, Room>();
  links = new Set<BenchLink>();
  /** Peeks and links that never answer: the surface is slow to pick up. */
  silent = false;
  /** How many bots come to sit at a séance opened here. */
  arrivals = Math.max(0, Math.min(11, num('bots', 3)));
  private alarms = new Map<string, number>();
  private lit = new Map<string, string>();

  constructor(readonly clock: Clock) {
    clock.onRelease(() => {
      for (const r of this.rooms.values()) this.schedule(r);
    });
  }

  open = async (): Promise<string> => {
    await pause(350);
    let sign = makeSign('seance');
    while (this.rooms.has(sign)) sign = makeSign('seance');
    this.rooms.set(sign, newRoom(sign, this.clock.now()));
    this.gather(sign);
    return sign;
  };

  peek = async (sign: string): Promise<SeancePeek | null> => {
    if (this.silent) return never();
    await pause(250);
    const r = this.rooms.get(sign);
    if (!r) return null;
    const n = r.sitters.filter((s) => !s.table).length;
    return { sign, phase: r.phase, sitters: n, full: n >= 12 };
  };

  link = (sign: string, hello: Hello, on: LinkHandlers, rejoin: boolean): LinkLike => new BenchLink(this, sign, hello, on, rejoin);

  deps(extra: SeanceDeps = {}): SeanceDeps {
    return { relay: true, open: this.open, peek: this.peek, link: this.link, now: () => this.clock.now(), ...extra };
  }

  /** Bots come to sit, one by one, at a séance just opened. */
  private gather(sign: string) {
    const mine = (localStorage.getItem(NAME_KEY) ?? '').toLowerCase();
    const names = NAMES.filter((n) => n.toLowerCase() !== mine).slice(0, this.arrivals);
    names.forEach((name, i) =>
      window.setTimeout(
        () => {
          const room = this.rooms.get(sign);
          if (!room || room.phase !== 'lobby') return;
          if (join(room, botId(name), name, false, this.clock.now()).ok) this.commit(room);
        },
        2200 + i * 1700,
      ),
    );
  }

  greet(link: BenchLink) {
    const room = this.rooms.get(link.sign);
    if (!room) return link.deliver({ t: 'error', code: 'gone', message: 'That séance has ended.' });
    const known = room.sitters.some((s) => s.id === link.hello.id);
    if (link.rejoin && !known) return link.deliver({ t: 'error', code: 'gone', message: 'That séance has ended.' });
    const res = join(room, link.hello.id, link.hello.name, link.hello.table === true, this.clock.now());
    if (!res.ok) return link.deliver({ t: 'error', code: res.code, message: res.message });
    link.id = res.sitter.id;
    this.commit(room);
  }

  message(link: BenchLink, msg: ClientMsg) {
    const room = this.rooms.get(link.sign);
    if (!room) return link.deliver({ t: 'error', code: 'gone', message: 'That séance has ended.' });
    const me = link.id;
    if (!me) return link.deliver({ t: 'error', code: 'bad', message: 'Say who you are first.' });
    const now = this.clock.now();
    const after = (res: { ok: true } | { ok: false; code: ErrorCode; message: string }) => (res.ok ? this.commit(room) : link.deliver({ t: 'error', code: res.code, message: res.message }));
    switch (msg.t) {
      case 'config':
        return after(configure(room, me, msg.candles, msg.seconds, now));
      case 'begin':
        this.clock.release();
        return after(begin(room, me, msg.prompts, msg.depths, this.clock.now()));
      case 'next':
        this.clock.release();
        return after(advance(room, me, this.clock.now()));
      case 'again':
        this.clock.release();
        return after(again(room, me, this.clock.now()));
      case 'leave':
        leave(room, me, now);
        link.id = null;
        return this.commit(room);
      case 'speak': {
        const res = speak(room, me, msg.text, now);
        if (!res.ok) return link.deliver({ t: 'error', code: res.code, message: res.message });
        if (res.heard.kind === 'refused') return link.deliver({ t: 'refused', text: String(msg.text ?? '').trim().slice(0, 80), verdict: res.heard.verdict, reason: res.heard.reason });
        if (res.heard.kind === 'empty') return;
        return this.commit(room);
      }
      case 'hello':
        return;
    }
  }

  /** A device went: as the relay does when its socket closes. */
  dropped(link: BenchLink) {
    this.links.delete(link);
    this.away(link);
  }

  away(link: BenchLink) {
    const room = this.rooms.get(link.sign);
    const id = link.id;
    if (!room || !id) return;
    const still = [...this.links].some((l) => l !== link && l.id === id && !l.cut && !l.closed);
    if (still) return;
    if (setOnline(room, id, false)) {
      settle(room);
      this.commit(room);
    }
  }

  /** Save, set the clock, and show every device its view. */
  commit(room: Room) {
    const now = this.clock.now();
    for (const l of this.links) {
      if (l.sign !== room.sign || !l.id || l.closed || l.cut) continue;
      const view = viewFor(room, l.id, now);
      window.setTimeout(() => l.deliver({ t: 'view', view }), LATENCY);
    }
    this.schedule(room);
  }

  private schedule(room: Room) {
    clearTimeout(this.alarms.get(room.sign));
    if (!this.clock.running) return;
    const at = alarmAt(room);
    if (at !== null)
      this.alarms.set(
        room.sign,
        window.setTimeout(() => tick(room, this.clock.now()) && this.commit(room), Math.max(0, at - this.clock.now())),
      );
    const key = `${room.candle}:${room.litAt}`;
    if (room.phase === 'candle' && this.lit.get(room.sign) !== key) {
      this.lit.set(room.sign, key);
      this.botsSpeak(room, false);
    }
  }

  /** The bots answer as the candle burns (or all at once, now). */
  botsSpeak(room: Room, now: boolean) {
    if (room.phase !== 'candle') return;
    const circle = room.sitters.filter((s) => !s.table);
    const words = plan(room.prompts[room.candle], circle.length, room.candle);
    const key = `${room.candle}:${room.litAt}`;
    const span = room.config.seconds * 1000;
    circle.forEach((s, i) => {
      const text = words[i];
      if (!isBot(s.id) || !s.online || text === null || room.seals[s.id] || !room.circle.includes(s.id)) return;
      const go = () => {
        if (room.phase !== 'candle' || `${room.candle}:${room.litAt}` !== key) return;
        const res = speak(room, s.id, text, this.clock.now());
        if (res.ok && res.heard.kind === 'sealed') this.commit(room);
      };
      if (now) go();
      else window.setTimeout(go, Math.max(0, room.litAt + span * (0.12 + 0.7 * fraction(i, room.candle)) - this.clock.now()));
    });
  }
}

const relay = new BenchRelay(clock);

// ------------------------------------------------------------------ a circle, part way through

interface Sitting {
  n: number;
  /** Where this device sits in the circle, or -1 when it is the table. */
  me: number;
  phase: 'lobby' | 'candle' | 'reveal' | 'ended';
  /** The candle shown, from 0. */
  at: number;
  sealed?: boolean;
  tries?: boolean;
  tie?: boolean;
}

const CANDLES = [3, 5, 7].includes(num('candles', 5)) ? num('candles', 5) : 5;
const SECONDS = [20, 30, 45].includes(num('seconds', 30)) ? num('seconds', 30) : 30;
const span = SECONDS * 1000;

/** Everyone still here answers, and the candle goes out. Returns the time it went out. */
function burnOut(room: Room, ids: string[]): number {
  const words = plan(room.prompts[room.candle], ids.length, room.candle);
  let at = room.litAt + 1500;
  ids.forEach((id, i) => {
    const w = words[i];
    const here = room.sitters.find((s) => s.id === id)?.online;
    if (w !== null && here && room.phase === 'candle') speak(room, id, w, (at += 700));
  });
  if (room.phase === 'candle') tick(room, room.deadline + GRACE_MS + 1);
  return Math.max(at, room.deadline + GRACE_MS + 1);
}

/** Two sitters level at the top, for a shared Herald. */
function tieTop(room: Room) {
  const top = Object.entries(room.totals).sort((a, b) => b[1] - a[1]);
  if (top.length > 1) room.totals[top[1][0]] = top[0][1];
}

function seatRoom(s: Sitting): Room {
  let t = Date.now() - 20 * 60_000;
  const room = newRoom(SIGN, t);
  const ids: string[] = [];
  for (let i = 0; i < s.n; i++) {
    const name = NAMES[i % NAMES.length];
    const res = join(room, i === s.me ? ME : botId(name), name, false, (t += 900));
    if (res.ok) ids.push(res.sitter.id);
  }
  const medium = ids[0];
  configure(room, medium, CANDLES, SECONDS, t);
  const awayAt = flag('away') || (!q.has('away') && s.n >= 6) ? (s.me === 5 ? 4 : 5) : -1;
  const away = awayAt >= 0 ? ids[awayAt] : null;
  relay.rooms.set(SIGN, room);
  if (s.phase === 'lobby') {
    if (away) setOnline(room, away, false);
    clock.set(t + 1000);
    return room;
  }
  const prompts = choosePrompts(env, avoid, SIGN, 0, today, CANDLES);
  begin(room, medium, prompts, tierDepths(env.theme), (t += 4000));
  if (away) setOnline(room, away, false);
  const last = room.prompts.length - 1;
  const shown = Math.max(0, Math.min(s.at, last));
  const before = s.phase === 'ended' ? last + 1 : shown;
  for (let c = 0; c < before; c++) {
    t = burnOut(room, ids);
    if (c < last) advance(room, medium, (t += 9000));
  }
  if (s.phase === 'ended') {
    if (s.tie) tieTop(room);
    advance(room, medium, (t += 9000));
    clock.set(t + 2000);
    return room;
  }
  if (s.phase === 'reveal') {
    clock.set(burnOut(room, ids) + 600);
    return room;
  }
  // The candle burns: about half the circle has sealed.
  const p = room.prompts[room.candle];
  const words = plan(p, ids.length, room.candle);
  let at = room.litAt + 1200;
  ids.forEach((id, i) => {
    const mine = id === ME;
    if (mine ? !s.sealed : (i + room.candle) % 2 === 1) return;
    const w = words[i] ?? (mine ? (p.answers.find((a) => a.tier >= 3)?.answer ?? p.answers[0]?.answer ?? null) : null);
    if (w && room.sitters.find((x) => x.id === id)?.online) speak(room, id, w, (at += 800));
  });
  if (s.tries) for (const w of refusals(p).slice(1)) speak(room, ME, w, (at += 900));
  const left = STATE === 'candle-low' ? 4.2 : STATE === 'candle-out' ? -0.3 : (1 - Math.max(0, Math.min(0.98, num('burnt', 0.38)))) * SECONDS;
  clock.set(room.deadline - left * 1000);
  return room;
}

// ------------------------------------------------------------------ pass the lantern, part way round

type LanternAt = 'setup' | 'pass' | 'speak' | 'sealed' | 'out' | 'reveal' | 'ended';

function passRound(n: number, at: LanternAt): PassState {
  const s = newPass();
  s.config = { candles: CANDLES, seconds: SECONDS };
  for (let i = 0; i < Math.max(2, Math.min(8, n)); i++) addSitter(s, NAMES[i]);
  if (at === 'setup') return s;
  const ids = choosePrompts(env, avoid, 'lantern', 0, today, CANDLES).map((p) => p.id);
  startPass(s, ids, tierDepths(env.theme), s.config);
  let t = Date.now() - 20 * 60_000;
  const prompt = () => env.byId.get(s.promptIds[s.candle]) as PromptDef;
  const words = () => plan(prompt(), s.sitters.length, s.candle);
  const turn = () => {
    const who = holder(s);
    if (!who) return;
    const w = words()[s.sitters.indexOf(who)];
    takeLantern(s, (t += 4000));
    if (w !== null) speakPass(s, prompt(), w, (t += 7000));
    else gutter(s);
    passOn(s, prompt());
  };
  const last = s.promptIds.length - 1;
  const before = at === 'ended' ? last + 1 : Math.max(0, Math.min(num('at', 1), last));
  for (let c = 0; c < before; c++) {
    while (s.phase === 'pass') turn();
    nextCandle(s);
  }
  if (at === 'ended') return s;
  if (at === 'reveal') {
    while (s.phase === 'pass') turn();
    return s;
  }
  const k = Math.max(0, Math.min(s.sitters.length - 1, num('turn', 1)));
  for (let i = 0; i < k && s.phase === 'pass'; i++) turn();
  if (at === 'pass') return s;
  takeLantern(s, (t += 4000));
  if (at === 'speak') {
    clock.set(s.litAt + Math.max(0, Math.min(0.98, num('burnt', 0.38))) * span);
    return s;
  }
  if (at === 'out') gutter(s);
  else {
    const who = holder(s);
    const w = (who ? words()[s.sitters.indexOf(who)] : null) ?? prompt().answers[0]?.answer ?? '';
    speakPass(s, prompt(), w, (t += 5000));
  }
  return s;
}

// ------------------------------------------------------------------ the cult, played in the page

const DAY_MS = 86_400_000;
const dayNow = (day: number) => EPOCH_UTC + (day - 1) * DAY_MS + 12 * 3_600_000;

class BenchCult {
  cults = new Map<string, Cult>();
  mode: 'ok' | 'never' | 'fail' = 'ok';

  /** A cult of eight with most of a week dived, and last week's too. */
  seed(me: string, name: string) {
    const c = newCult(CULT_SIGN, dayNow(today - 9));
    const members: Array<[string, string]> = [[me, name], ...NAMES.slice(1, 8).map((n): [string, string] => [botId(n), n])];
    members.forEach(([id, n], i) => joinCult(c, id, n, dayNow(today - 9) + i * 1000));
    const week = weekOf(today);
    const rng = mulberry32(42);
    members.forEach(([id], i) => {
      const mine: Record<string, number> = (c.dives[id] = {});
      for (let d = Math.max(1, week - 7); d <= today; d++) {
        const r = rng();
        if (d === today ? i % 3 === 2 : r < (i === 0 ? 0.12 : 0.28)) continue;
        mine[d] = Math.round((900 + rng() * 4600) / 10) * 10;
      }
    });
    this.cults.set(CULT_SIGN, c);
  }

  deps(): CultDeps {
    const slow = <T>(fn: () => T): Promise<T> =>
      this.mode === 'never'
        ? never<T>()
        : pause(380).then(() => {
            if (this.mode === 'fail') throw new RelayError('The surface relay cannot be reached. Check your connection.', 0);
            return fn();
          });
    const find = (sign: string) => {
      const c = this.cults.get(sign);
      if (!c) throw new RelayError('No cult has that sign.', 404);
      return c;
    };
    return {
      relay: true,
      found: (id, name, day) =>
        slow(() => {
          let sign = makeSign('cult');
          while (this.cults.has(sign)) sign = makeSign('cult');
          const c = newCult(sign, dayNow(day));
          const r = joinCult(c, id, name, dayNow(day));
          if (!r.ok) throw new RelayError(r.message, 400);
          this.cults.set(sign, c);
          return { sign, board: boardFor(c, id, day) };
        }),
      join: (sign, id, name, day) =>
        slow(() => {
          const c = find(sign);
          const r = joinCult(c, id, name, dayNow(day));
          if (!r.ok) throw new RelayError(r.message, r.code === 'full' ? 409 : 400);
          return boardFor(c, id, day);
        }),
      board: (sign, id, day) => slow(() => boardFor(find(sign), id, day)),
      leave: (sign, id) =>
        slow(() => {
          const c = this.cults.get(sign);
          if (c) leaveCult(c, id, dayNow(today));
          return true;
        }),
      dive: (sign, id, day, depth) =>
        slow(() => {
          const c = find(sign);
          if (!c.members.some((m) => m.id === id)) throw new RelayError('You are not of this cult.', 403);
          const mine = (c.dives[id] ??= {});
          mine[day] = Math.max(mine[day] ?? 0, Math.round(depth));
          return boardFor(c, id, day);
        }),
    };
  }
}

const cult = new BenchCult();

// ------------------------------------------------------------------ mounting

let screen: { el: HTMLElement; destroy(): void } | null = null;

function surfaced(again: () => void) {
  const btn = h('button', { class: 'btn primary', type: 'button' }, 'Open the Séance again');
  btn.addEventListener('click', again);
  stage.replaceChildren(h('section', { class: 'screen', 'aria-label': 'The surface' }, h('p', { class: 'kicker', style: 'text-align:center;margin-top:30vh' }, 'Back on the surface'), btn));
  btn.focus();
}

function mount(opts: Omit<SeanceOpts, 'onExit'>, deps: SeanceDeps) {
  screen?.destroy();
  screen = seanceScreen(
    env,
    {
      ...opts,
      onExit: () => {
        log.exits++;
        screen?.destroy();
        screen = null;
        surfaced(() => mount({}, deps));
      },
    },
    deps,
  );
  stage.replaceChildren(screen.el);
}

function sheet(title: string, body: HTMLElement) {
  const id = 'sheet-title-1';
  const close = h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', html: icon('close') });
  const panel = h('div', { class: 'sheet-panel', tabindex: '-1' }, h('div', { class: 'sheet-head' }, h('h2', { id }, title), close), h('div', { class: 'sheet-body' }, body));
  const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id }, panel);
  const shut = () => {
    el.remove();
    shell.inert = false;
    const again = h('button', { class: 'btn', type: 'button', style: 'margin:30vh auto 0' }, 'Open the Cult');
    again.addEventListener('click', openCult);
    stage.replaceChildren(h('section', { class: 'screen' }, again));
    again.focus();
  };
  close.addEventListener('click', shut);
  el.addEventListener('click', (e) => e.target === el && shut());
  document.addEventListener('keydown', (e) => e.key === 'Escape' && el.isConnected && shut());
  document.body.append(el);
  shell.inert = true;
  panel.focus({ preventScroll: true });
}

const cultOpts: CultOpts = { onChange: () => log.changes++, sign: STATE === 'cult-join' ? (q.get('cult') ?? CULT_SIGN) : (q.get('cult') ?? undefined), todayDepth: q.has('dive') ? num('dive', 0) : undefined };
const cultDeps = (): CultDeps => (STATE === 'cult-norelay' ? { relay: false } : cult.deps());

function openCult() {
  stage.replaceChildren(h('section', { class: 'screen' }));
  sheet('The Cult', cultBody(env, cultOpts, cultDeps()));
}

async function waitFor<T extends Element>(sel: string, ms = 6000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const el = document.querySelector<T>(sel);
    if (el) return el;
    await pause(60);
  }
  return null;
}

// ------------------------------------------------------------------ the states

function nameFor(me: number) {
  store.set(NAME_KEY, q.get('name') || NAMES[Math.max(0, me) % NAMES.length]);
}

/** Sit down at a circle already gathered, as a reload does: the seat is saved, the screen rejoins. */
function sitAt(s: Sitting) {
  nameFor(s.me);
  seatRoom(s);
  saveSeat(SIGN, false);
  mount({}, relay.deps());
}

/** A shared screen opened on the sign (?seance=SIGN&table=1). */
function tableAt(s: Omit<Sitting, 'me'>) {
  seatRoom({ ...s, me: -1 });
  mount({ sign: SIGN, table: true }, relay.deps());
}

function lanternAt(at: LanternAt) {
  nameFor(0);
  const s = passRound(num('n', 4), at);
  store.set(PASS_KEY, JSON.stringify(s));
  mount({}, relay.deps({ relay: !flag('norelay') }));
  if (at === 'setup') void waitFor<HTMLButtonElement>('[data-way="lantern"]').then((b) => b?.click());
}

async function lose() {
  await waitFor('.sc-scene:not(.sc-calling)');
  await pause(500);
  for (const l of relay.links) l.lose();
}

async function refuseOnce() {
  const input = await waitFor<HTMLInputElement>('form.sc-form input.answer');
  const room = relay.rooms.get(SIGN);
  if (!input || !room) return;
  await pause(500);
  input.value = refusals(room.prompts[room.candle])[0];
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.form?.requestSubmit();
}

async function joinWith(sign: string) {
  const form = await waitFor<HTMLFormElement>('form.sc-join');
  const input = form?.querySelector<HTMLInputElement>('input');
  if (!form || !input) return;
  input.value = sign;
  form.requestSubmit();
}

function start() {
  const n = (d: number) => Math.max(1, Math.min(12, num('n', d)));
  const at = (d: number) => num('at', d);
  if (LIVE) {
    // The real relay (VITE_RELAY_URL), as the app opens the mode from the address.
    mount({ sign: q.get('seance') ?? undefined, table: flag('table') }, {});
    return;
  }
  const deps = relay.deps({ relay: !flag('norelay') });
  switch (STATE) {
    case 'entry-norelay':
      nameFor(0);
      return mount({}, relay.deps({ relay: false }));
    case 'join':
      nameFor(4);
      seatRoom({ n: n(4), me: -1, phase: 'lobby', at: 0 });
      return mount({ sign: SIGN }, deps);
    case 'join-none':
      nameFor(4);
      mount({ sign: 'KRAKEN-9' }, deps);
      return void joinWith('KRAKEN-9');
    case 'join-full':
      nameFor(4);
      seatRoom({ n: 12, me: -1, phase: 'lobby', at: 0 });
      mount({ sign: SIGN }, deps);
      return void joinWith(SIGN);
    case 'table-entry':
      seatRoom({ n: n(4), me: -1, phase: 'lobby', at: 0 });
      return mount({ table: true }, deps);
    case 'calling':
      nameFor(2);
      relay.silent = true;
      saveSeat(SIGN, false);
      return mount({}, deps);
    case 'lobby':
      return sitAt({ n: n(5), me: 0, phase: 'lobby', at: 0 });
    case 'lobby-sitter':
      return sitAt({ n: n(5), me: 2, phase: 'lobby', at: 0 });
    case 'lobby-lost':
      sitAt({ n: n(5), me: 0, phase: 'lobby', at: 0 });
      return void lose();
    case 'table-lobby':
      return tableAt({ n: n(6), phase: 'lobby', at: 0 });
    case 'candle':
    case 'candle-low':
    case 'candle-out':
      return sitAt({ n: n(5), me: 0, phase: 'candle', at: at(1) });
    case 'candle-sealed':
      return sitAt({ n: n(5), me: 0, phase: 'candle', at: at(1), sealed: true });
    case 'candle-sitter':
      return sitAt({ n: n(5), me: 2, phase: 'candle', at: at(1) });
    case 'candle-refused':
      sitAt({ n: n(5), me: 0, phase: 'candle', at: at(1), tries: true });
      return void refuseOnce();
    case 'lost':
      sitAt({ n: n(5), me: 0, phase: 'candle', at: at(1) });
      return void lose();
    case 'table-candle':
      return tableAt({ n: n(8), phase: 'candle', at: at(1) });
    case 'reveal':
      return sitAt({ n: n(5), me: 0, phase: 'reveal', at: at(2) });
    case 'reveal-sitter':
      return sitAt({ n: n(5), me: 2, phase: 'reveal', at: at(2) });
    case 'reveal-last':
      return sitAt({ n: n(5), me: 0, phase: 'reveal', at: CANDLES - 1 });
    case 'table-reveal':
      return tableAt({ n: n(8), phase: 'reveal', at: at(2) });
    case 'end':
      return sitAt({ n: n(5), me: 0, phase: 'ended', at: 0 });
    case 'end-tie':
      return sitAt({ n: n(5), me: 0, phase: 'ended', at: 0, tie: true });
    case 'end-sitter':
      return sitAt({ n: n(5), me: 2, phase: 'ended', at: 0 });
    case 'table-end':
      return tableAt({ n: n(8), phase: 'ended', at: 0 });
    case 'lantern-setup':
      return lanternAt('setup');
    case 'lantern-pass':
      return lanternAt('pass');
    case 'lantern-speak':
      return lanternAt('speak');
    case 'lantern-sealed':
      return lanternAt('sealed');
    case 'lantern-out':
      return lanternAt('out');
    case 'lantern-reveal':
      return lanternAt('reveal');
    case 'lantern-end':
      return lanternAt('ended');
    case 'cult':
    case 'cult-loading':
    case 'cult-gone':
    case 'cult-fail':
      nameFor(0);
      if (STATE !== 'cult-gone') cult.seed(relayId(PID), NAMES[0]);
      store.set(CULT_KEY, JSON.stringify({ sign: CULT_SIGN, name: NAMES[0] }));
      cult.mode = STATE === 'cult-loading' ? 'never' : STATE === 'cult-fail' ? 'fail' : 'ok';
      return openCult();
    case 'cult-out':
    case 'cult-join':
    case 'cult-norelay':
      nameFor(0);
      cult.seed(botId('Odile'), 'Odile');
      return openCult();
    default:
      nameFor(0);
      return mount({}, deps);
  }
}

// ------------------------------------------------------------------ the menu

function menu() {
  const keep = new URLSearchParams(q);
  keep.delete('state');
  const nav = h('nav', { 'aria-label': 'Bench states' });
  for (const [group, states] of GROUPS) {
    nav.append(h('strong', { style: 'color:#ccc;width:100%' }, group));
    for (const s of states) {
      keep.set('state', s);
      nav.append(h('a', { href: `?${keep.toString()}`, 'aria-current': s === STATE ? 'page' : undefined }, s));
    }
  }
  document.body.append(h('details', { class: 'bench-states' }, h('summary', {}, `Bench: ${LIVE ? 'live' : STATE}`), nav));
}

menu();
start();

/** For Playwright: what was said, the clock, the relay and the circle. */
Object.assign(window, {
  __bench: {
    state: STATE,
    log,
    clock,
    relay,
    cult,
    me: ME,
    room: () => relay.rooms.get(SIGN) ?? [...relay.rooms.values()].pop() ?? null,
    botsSpeak: () => {
      const r = relay.rooms.get(SIGN) ?? [...relay.rooms.values()].pop();
      if (r) relay.botsSpeak(r, true);
    },
    lose: () => {
      for (const l of relay.links) l.lose();
    },
    mend: () => {
      for (const l of relay.links) l.mend();
    },
    postDive: (depth: number) => postDiveToCult(env, today, depth, cultDeps()),
    openCult,
  },
});
