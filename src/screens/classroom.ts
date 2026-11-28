// The Convocation: a séance for a whole class. One screen at the front of the
// room is the host: it shows the way in, asks the questions and surfaces the
// answers, and never answers itself. Everyone else sits on their own phone in
// a browser, up to three hundred of them. The rules live in src/party/classroom.ts
// and run on the surface relay; this is the screen, for the host and for a diver.
//
//   const c = classScreen(env, { sign, onExit });
//   stage.append(c.el);   // a <section class="screen seance-screen class-screen">
//   …
//   c.destroy();          // stops every timer and closes the link

import '../styles/seance.css';
import '../styles/classroom.css';
import type { PromptDef } from '../game/types';
import { ClassLink, clearClassPlace, loadClassPlace, openClass, peekClass, saveClassPlace, type ClassHandlers, type ClassHello, type ClassLinkLike, type ClassPeek, type ClassPlace, type ViewCause } from '../party/class-link';
import { CLASS_MAX_SEATS, type ClassErrorCode, type ClassView } from '../party/class-types';
import { parseSign, signKind } from '../party/codes';
import { hasRelay, RelayError, type LinkStatus } from '../party/online';
import { cleanName } from '../party/room';
import { icon } from '../ui/art';
import { h } from '../ui/dom';
import { DiverAskScene, DiverEndScene, DiverLobbyScene, DiverRevealScene } from './classroom/diver';
import { BAD_CLASS_SIGN, ClassCallingScene, ClassEntryScene, NO_CLASS_RELAY, type ClassEntryInit } from './classroom/entry';
import { HostAskScene, HostEndScene, HostLobbyScene, HostRevealScene } from './classroom/host';
import { DiverLastScene, HostLastScene } from './classroom/last';
import { installSeanceArt } from './seance/art';
import { NO_QUESTIONS, choosePrompts, relayId, tierDepths } from './seance/model';
import { loadName, readJson, writeStore } from './seance/parts';
import type { Ctx, Scene } from './seance/scene';
import type { SeanceEnv } from './seance/types';

export interface ClassOpts {
  /** A sign from the address (?class=SIGN): the screen opens on Join with it filled. */
  sign?: string;
  /** Something of the app's for the end of the bar (its sound switch). */
  barEnd?: HTMLElement;
  onExit(): void;
}

export type ClassLinkFactory = (sign: string, hello: ClassHello, on: ClassHandlers, rejoin: boolean) => ClassLinkLike;

/** Stand-ins for the relay. The app never passes these; a bench does. */
export interface ClassDeps {
  relay?: boolean;
  link?: ClassLinkFactory;
  open?: () => Promise<{ sign: string; key: string }>;
  peek?: (sign: string) => Promise<ClassPeek | null>;
}

const ASKED_KEY = 'cthulhoo.v1.classAsked';
/** How long the line may stay lost before we ask the surface whether the class still exists. */
const LOST_CHECK_MS = 15_000;

const realLink: ClassLinkFactory = (sign, hello, on, rejoin) => new ClassLink(sign, hello, on, rejoin);

/** The questions already asked under a sign, so the same class is asked new ones. */
interface Asked {
  key: string;
  sittings: number;
  asked: string[];
}

function loadAsked(key: string): Asked {
  const a = readJson<Asked>(ASKED_KEY);
  return a && a.key === key && Array.isArray(a.asked) && typeof a.sittings === 'number' ? a : { key, sittings: 0, asked: [] };
}

const saveAsked = (a: Asked) => writeStore(ASKED_KEY, JSON.stringify({ ...a, asked: a.asked.slice(-120) }));

/** The words for a refusal from the relay that is not the deep's. */
function errorWords(code: ClassErrorCode, message: string): string {
  if (code === 'late') return 'The candle had already gone out.';
  if (code === 'host') return 'Only the host can do that.';
  return message;
}

export function classScreen(env: SeanceEnv, opts: ClassOpts, deps: ClassDeps = {}): { el: HTMLElement; destroy(): void } {
  installSeanceArt();
  const screen = new ClassScreen(env, opts, deps);
  return { el: screen.el, destroy: () => screen.destroy() };
}

type Mode = 'entry' | 'host' | 'seat';

class ClassScreen {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private backBtn: HTMLButtonElement;
  private backLabel: HTMLElement;
  private barSign: HTMLElement;
  private confirmBox: HTMLElement;
  private lostEl: HTMLElement;
  private scene: Scene | null = null;
  private ctx: Ctx;
  private relay: boolean;
  private reduced: boolean;
  private depthNow = 0;
  private mode: Mode = 'entry';
  private dead = false;
  private timers: number[] = [];
  private link: ClassLinkLike | null = null;
  private sign = '';
  private key: string | undefined;
  private view: ClassView | null = null;
  private lostCheck = 0;
  /** The host's questions still to ask, chosen on this device. */
  private queue: PromptDef[] = [];
  private asking = false;
  /** While a class is on, the screen is kept awake: a phone that sleeps drops its line, and the big screen must not dim. */
  private wake: WakeLockSentinel | null = null;
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.stayAwake();
  };

  constructor(
    private env: SeanceEnv,
    private opts: ClassOpts,
    private deps: ClassDeps,
  ) {
    this.relay = deps.relay ?? hasRelay();
    let mq = false;
    try {
      mq = matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* no media queries here */
    }
    this.reduced = env.reduced || mq;
    this.backLabel = h('span', {}, 'Back');
    this.backBtn = h('button', { class: 'btn ghost sc-back', type: 'button', html: icon('back') }, this.backLabel) as HTMLButtonElement;
    this.backBtn.addEventListener('click', () => {
      this.env.sound?.click?.();
      this.back();
    });
    this.barSign = h('span', { class: 'sc-bar-sign' });
    this.confirmBox = h('div', { class: 'sc-confirm', hidden: true, role: 'group', 'aria-label': 'Leave the class?' });
    this.lostEl = h('p', { class: 'sc-lost', hidden: true }, h('span', { class: 'sc-lost-dot', 'aria-hidden': 'true' }), 'The line to the surface is lost. Calling again…');
    this.stage = h('div', { class: 'sc-stage' });
    this.el = h(
      'section',
      { class: `screen seance-screen class-screen${this.reduced ? ' is-reduced' : ''}`, 'aria-label': 'The Convocation' },
      h('div', { class: `sc-bar${opts.barEnd ? ' has-end' : ''}` }, this.backBtn, h('p', { class: 'sc-bar-title' }, h('span', { class: 't' }, 'The Convocation'), this.barSign), opts.barEnd ?? null),
      this.confirmBox,
      this.lostEl,
      this.stage,
    );
    this.ctx = {
      env,
      reduced: this.reduced,
      screen: this.el,
      depth: () => this.depthNow,
      now: () => this.link?.now() ?? Date.now(),
      sink: (m) => this.sink(m),
    };
    // A browser lets go of the screen whenever the page is hidden: ask again when it is back.
    document.addEventListener('visibilitychange', this.onVisible);
    this.open();
  }

  // ------------------------------------------------------------ plumbing

  private sink(metres: number) {
    const m = Math.max(0, Math.round(metres));
    if (m === this.depthNow) return;
    this.depthNow = m;
    this.env.onDepth?.(m);
  }

  private later(fn: () => void, ms: number) {
    const id = window.setTimeout(() => !this.dead && fn(), ms);
    this.timers.push(id);
    return id;
  }

  /** No class is on this screen: it is at the way in, or gone. */
  private get idle(): boolean {
    return this.dead || this.mode === 'entry';
  }

  private async stayAwake() {
    if (this.idle || this.wake || document.visibilityState !== 'visible') return;
    try {
      const lock = await navigator.wakeLock?.request('screen');
      if (!lock) return;
      // The class may have ended while the browser was asked.
      if (this.idle || this.wake) return void lock.release().catch(() => {});
      this.wake = lock;
      lock.addEventListener('release', () => {
        if (this.wake === lock) this.wake = null;
      });
    } catch {
      /* this browser will not hold the screen (an old phone, a low battery): the class goes on */
    }
  }

  private sleepAgain() {
    const lock = this.wake;
    this.wake = null;
    void lock?.release().catch(() => {});
  }

  /** One scene gives way to the next: the old drifts off as the new one surfaces. */
  private show(next: Scene) {
    const old = this.scene;
    this.scene = next;
    if (old) {
      old.destroy();
      const el = old.el;
      if (this.reduced) el.remove();
      else {
        el.inert = true;
        el.classList.add('sc-leaving');
        window.setTimeout(() => el.remove(), 420);
      }
    }
    if (!this.reduced) next.el.classList.add('sc-arriving');
    this.stage.append(next.el);
    this.el.scrollTop = 0;
    this.hideConfirm();
    const target = next.focus;
    if (target) this.later(() => next === this.scene && target.isConnected && target.focus({ preventScroll: true }), Math.max(60, this.reduced ? 0 : next.focusDelay));
  }

  private setBar() {
    const mode = this.mode;
    this.backLabel.textContent = mode === 'entry' ? 'Back' : mode === 'host' ? 'Close' : 'Leave';
    this.backBtn.setAttribute('aria-label', mode === 'entry' ? 'Back to the surface' : mode === 'host' ? 'Close the class' : 'Leave the class');
    this.barSign.textContent = mode === 'entry' ? '' : this.sign;
    // The host's screen is for the whole room: wide, with letters the back row can read.
    this.el.classList.toggle('is-host', mode === 'host');
    this.el.classList.toggle('is-table', mode === 'host');
  }

  // ------------------------------------------------------------ opening

  private open() {
    const place = this.relay ? loadClassPlace() : null;
    const raw = this.opts.sign;
    if (raw) {
      const sign = parseSign(raw, 'class');
      if (!this.relay) return this.entry({ message: NO_CLASS_RELAY });
      if (sign && place && place.sign === sign) return void this.rejoin(place);
      return this.entry({ panel: 'join', sign: sign ?? raw, message: sign ? undefined : BAD_CLASS_SIGN });
    }
    if (place) return void this.rejoin(place);
    this.entry({});
  }

  private entry(init: ClassEntryInit = {}) {
    this.closeLink(false);
    this.sleepAgain();
    this.mode = 'entry';
    this.view = null;
    this.queue = [];
    this.setBar();
    this.showLost(false);
    this.sink(0);
    this.show(new ClassEntryScene(this.ctx, this.relay, init, { hold: () => void this.hold(), join: (name, sign) => void this.join(name, sign) }));
  }

  private get entryScene(): ClassEntryScene | null {
    return this.scene instanceof ClassEntryScene ? this.scene : null;
  }

  private failEntry(e: unknown) {
    const msg = e instanceof RelayError ? e.message : 'The surface relay did not answer. Try again.';
    const s = this.entryScene;
    if (s) {
      s.busy(false);
      s.error(msg);
    } else this.entry({ message: msg });
  }

  private async hold() {
    this.entryScene?.busy(true);
    try {
      const { sign, key } = await (this.deps.open ?? openClass)();
      if (this.dead) return;
      saveClassPlace(sign, key);
      this.connect(sign, key, false);
    } catch (e) {
      if (!this.dead) this.failEntry(e);
    }
  }

  private async join(name: string, raw: string) {
    if (!cleanName(name)) return this.entryScene?.error('Give the class a name to call you by.', 'name');
    const sign = parseSign(raw, 'class');
    if (!sign) return this.entryScene?.error(signKind(raw) === 'seance' ? 'That is a séance’s sign. Go back and choose the Séance to sit at it.' : BAD_CLASS_SIGN, 'sign');
    this.entryScene?.busy(true);
    try {
      const peek = await (this.deps.peek ?? peekClass)(sign);
      if (this.dead) return;
      const place = loadClassPlace();
      const known = place?.sign === sign && !place.key;
      const why = !peek
        ? 'No class has that sign. Check it on the big screen.'
        : known
          ? null
          : peek.phase === 'ended'
            ? 'That class has surfaced. If the host holds another round, give the sign again.'
            : peek.full
              ? `The hall is full: ${CLASS_MAX_SEATS} is all a class can hold.`
              : null;
      if (why) {
        this.entryScene?.busy(false);
        this.entryScene?.error(why, 'sign');
        return;
      }
      this.connect(sign, undefined, known);
    } catch (e) {
      if (!this.dead) this.failEntry(e);
    }
  }

  /** Back to a class after a reload: as its host if this device holds the key, else to this device's seat. */
  private async rejoin(place: ClassPlace) {
    this.mode = place.key ? 'host' : 'seat';
    this.sign = place.sign;
    this.key = place.key;
    this.setBar();
    this.show(this.calling(place.sign, place.key, true));
    try {
      const peek = await (this.deps.peek ?? peekClass)(place.sign);
      if (this.dead) return;
      if (!peek) {
        clearClassPlace();
        this.entry({ panel: place.key ? 'ways' : 'join', message: 'That class has ended.' });
        return;
      }
    } catch {
      /* the link calls again by itself until the surface answers */
    }
    if (!this.dead) this.connect(place.sign, place.key, true);
  }

  private calling(sign: string, key: string | undefined, rejoin: boolean): ClassCallingScene {
    const line = key ? (rejoin ? `Returning to your class, ${sign}` : 'Opening a class') : `Sitting down at ${sign}`;
    return new ClassCallingScene(this.ctx, line, () => this.giveUp(), () => this.connect(sign, key, true));
  }

  // ------------------------------------------------------------ the link

  private connect(sign: string, key: string | undefined, rejoin: boolean) {
    this.closeLink(false);
    this.mode = key ? 'host' : 'seat';
    this.sign = sign;
    this.key = key;
    this.view = null;
    this.setBar();
    void this.stayAwake();
    if (!(this.scene instanceof ClassCallingScene)) this.show(this.calling(sign, key, rejoin));
    const hello: ClassHello = key ? { host: true, key } : { id: relayId(this.env.playerId), name: cleanName(loadName()) };
    const handlers: ClassHandlers = {
      view: (v, cause) => this.onView(v, cause),
      heard: (hd) => {
        if (this.scene instanceof DiverAskScene || this.scene instanceof DiverLastScene) this.scene.heard(hd);
      },
      refused: (r) => {
        if (this.scene instanceof DiverAskScene || this.scene instanceof DiverLastScene) this.scene.refuse(r);
      },
      error: (code, message, final) => this.onError(code, message, final),
      status: (s) => this.onStatus(s),
    };
    this.link = (this.deps.link ?? realLink)(sign, hello, handlers, rejoin);
  }

  private closeLink(leave: boolean) {
    clearTimeout(this.lostCheck);
    const link = this.link;
    this.link = null;
    try {
      link?.close(leave);
    } catch {
      /* already gone */
    }
  }

  /** Stop calling and go back to the way in. */
  private giveUp() {
    const host = this.mode === 'host';
    this.closeLink(false);
    // The host's key is kept: the class is still theirs to come back to from the title.
    if (!host) clearClassPlace();
    this.entry({ panel: host ? 'ways' : 'join', sign: host ? undefined : this.sign });
  }

  private onStatus(s: LinkStatus) {
    if (this.dead) return;
    if (s === 'lost') {
      if (this.lostEl.hidden) this.env.announce('The line to the surface is lost. Calling again.');
      this.showLost(true);
      clearTimeout(this.lostCheck);
      this.lostCheck = this.later(() => void this.stillThere(), LOST_CHECK_MS);
    } else if (s === 'open') {
      if (!this.lostEl.hidden) this.env.announce('The line to the surface is back.');
      this.showLost(false);
      clearTimeout(this.lostCheck);
    }
  }

  /** Lost a while: ask whether the class is still being held at all. */
  private async stillThere() {
    if (!this.link || this.link.status !== 'lost') return;
    try {
      const peek = await (this.deps.peek ?? peekClass)(this.sign);
      if (!peek && this.link) this.onError('gone', 'That class has ended.', true);
      else if (this.link?.status === 'lost') this.lostCheck = this.later(() => void this.stillThere(), LOST_CHECK_MS);
    } catch {
      if (this.link?.status === 'lost') this.lostCheck = this.later(() => void this.stillThere(), LOST_CHECK_MS);
    }
  }

  private showLost(on: boolean) {
    this.lostEl.hidden = !on;
    this.el.classList.toggle('is-lost', on);
  }

  private onError(code: ClassErrorCode, message: string, final: boolean) {
    if (this.dead) return;
    if (final) {
      const host = this.mode === 'host';
      this.closeLink(false);
      clearClassPlace();
      this.entry({ panel: host || code === 'removed' ? 'ways' : 'join', sign: host ? undefined : this.sign, message });
      if (code === 'name') this.entryScene?.error(message, 'name');
      return;
    }
    const words = errorWords(code, message);
    const s = this.scene;
    if (s instanceof DiverAskScene) {
      if (code !== 'sealed') s.note(words);
    } else if (s instanceof DiverLastScene) s.note(code === 'late' ? message : words);
    else if (s instanceof HostLobbyScene || s instanceof HostRevealScene) s.fail(words);
    else this.env.announce(words);
  }

  private onView(v: ClassView, cause: ViewCause) {
    if (this.dead) return;
    const was = this.view;
    this.view = v;
    // The host's key is kept until the class is closed. A diver's seat is kept only while the
    // class lasts, so a reload after the end does not sit them back down at a finished one.
    if (this.key) {
      if (!was) saveClassPlace(this.sign, this.key);
    } else if (v.phase === 'ended') clearClassPlace();
    else if (!was || was.phase === 'ended') saveClassPlace(this.sign);
    const cur = this.scene;
    // Only the numbers or the roll moved: the scene on show takes them in.
    if (cause !== 'full') {
      if (cur instanceof HostLobbyScene || cur instanceof HostAskScene || cur instanceof DiverLobbyScene || cur instanceof DiverAskScene || cur instanceof HostLastScene || cur instanceof DiverLastScene) cur.update(v);
      return;
    }
    this.render(v);
  }

  private render(v: ClassView) {
    const host = v.role === 'host';
    const cur = this.scene;
    switch (v.phase) {
      case 'lobby': {
        this.sink(0);
        // A new round is asked afresh, from whatever is ticked now.
        if (!v.n) this.queue = [];
        if (host) {
          if (cur instanceof HostLobbyScene) cur.update(v);
          else
            this.show(
              new HostLobbyScene(this.ctx, v, {
                config: (c, topics) => {
                  // Other topics: the questions lined up were for the old ones.
                  if (topics.join('|') !== (this.view?.config.topics ?? []).join('|')) this.queue = [];
                  this.link?.send({ t: 'config', ...c, topics });
                },
                begin: () => void this.askNext(),
                remove: (id) => this.link?.send({ t: 'remove', id }),
              }),
            );
        } else if (cur instanceof DiverLobbyScene) cur.update(v);
        else this.show(new DiverLobbyScene(this.ctx, v, { table: (table) => this.link?.send({ t: 'table', table }) }));
        return;
      }
      case 'asking': {
        if (!v.prompt) return;
        // Last diver standing has screens of its own: the bout is on them from its first turn to its last.
        if (v.last) {
          const key = `cv-last:${v.n}`;
          if (cur?.key === key && (cur instanceof HostLastScene || cur instanceof DiverLastScene)) return cur.update(v);
          this.show(host ? new HostLastScene(this.ctx, key, v, { reveal: () => this.link?.send({ t: 'reveal' }) }) : new DiverLastScene(this.ctx, key, v, { say: (text) => this.link?.send({ t: 'say', text }) ?? false }));
          return;
        }
        const key = `cv-ask:${v.n}`;
        if (cur?.key === key && (cur instanceof HostAskScene || cur instanceof DiverAskScene)) return cur.update(v);
        this.show(host ? new HostAskScene(this.ctx, key, v, { reveal: () => this.link?.send({ t: 'reveal' }) }) : new DiverAskScene(this.ctx, key, v, { say: (text) => this.link?.send({ t: 'say', text }) ?? false }));
        return;
      }
      case 'reveal': {
        const key = `cv-reveal:${v.n}`;
        if (cur?.key === key) return;
        this.show(host ? new HostRevealScene(this.ctx, key, v, { next: () => void this.askNext(), end: () => this.endClass(v.n < v.config.questions) }) : new DiverRevealScene(this.ctx, key, v));
        return;
      }
      case 'ended': {
        if (cur instanceof HostEndScene || cur instanceof DiverEndScene) return;
        this.show(
          host
            ? new HostEndScene(this.ctx, v, {
                again: () => {
                  this.queue = [];
                  this.link?.send({ t: 'again' });
                },
                close: () => this.leaveNow(),
              })
            : new DiverEndScene(this.ctx, v, { leave: () => this.leaveNow() }),
        );
        return;
      }
    }
  }

  // ------------------------------------------------------------ the host's questions

  /**
   * The questions for the rest of the class: from the whole daily bank, or from
   * the topics ticked on this device (class packs are fetched first). Rejects
   * when a ticked pack cannot be had.
   */
  private async pick(choice: string[], key: string, a: Asked, count: number): Promise<PromptDef[]> {
    const topics = this.env.topics;
    if (!topics || !choice.length) return choosePrompts(this.env, this.env.avoid, key, a.sittings, this.env.today, count, a.asked);
    const among = await topics.pool(choice);
    return choosePrompts(this.env, this.env.avoid, key, a.sittings, this.env.today, count, a.asked, { among, topicOf: (p) => topics.topicOf(p), sameAs: (id) => topics.sameAs(id) });
  }

  /** The host asks the next question: it is chosen on this device and sent whole, one at a time. */
  private async askNext() {
    const v = this.view;
    if (!v || this.asking) return;
    this.asking = true;
    const fail = (message: string) => {
      const s = this.scene;
      if (s instanceof HostLobbyScene || s instanceof HostRevealScene) s.fail(message);
      else this.env.shout(message);
    };
    try {
      if (!this.queue.length) {
        const a = loadAsked(v.sign);
        const choice = this.scene instanceof HostLobbyScene ? this.scene.choice() : (this.env.topics?.load() ?? []);
        let prompts: PromptDef[];
        try {
          prompts = await this.pick(choice, v.sign, a, Math.max(1, v.config.questions - v.n));
        } catch {
          return fail('A class pack you ticked could not be fetched. Check the connection, or tick other topics.');
        }
        if (this.dead) return;
        if (!prompts.length) return fail(NO_QUESTIONS);
        this.queue = prompts;
        saveAsked({ ...a, sittings: a.sittings + 1 });
      }
      // The packs may have taken a moment: the class may have moved on without this screen.
      const now = this.view;
      if (!now || now.phase === 'asking' || now.phase === 'ended') return;
      const prompt = this.queue[0];
      if (!(this.link?.send({ t: 'ask', prompt, depths: tierDepths(this.env.theme) }) ?? false)) return fail('The line to the surface is lost. Try again in a moment.');
      this.queue.shift();
      const a = loadAsked(v.sign);
      saveAsked({ ...a, asked: [...a.asked, prompt.id] });
    } finally {
      this.asking = false;
    }
  }

  /** The host ends the class: asked first when questions are still to come. */
  private endClass(ask: boolean) {
    if (!ask) return void this.link?.send({ t: 'end' });
    this.confirm('End the class now? The standings become final.', 'End the class', () => this.link?.send({ t: 'end' }));
  }

  // ------------------------------------------------------------ leaving

  private back() {
    if (this.mode === 'entry') {
      const e = this.entryScene;
      if (e && e.current !== 'ways') return e.show('ways');
      return this.exit();
    }
    if (this.scene instanceof ClassCallingScene) return this.giveUp();
    const v = this.view;
    if (this.mode === 'host') {
      if (!v || v.phase === 'ended' || (v.phase === 'lobby' && !v.seats)) return this.leaveNow();
      return this.confirm('Close the class? It ends for everyone in it.', 'Close the class', () => this.leaveNow());
    }
    if (v && (v.phase === 'asking' || v.phase === 'reveal')) return this.confirm('Leave the class? Your depth stays on the record.', 'Leave', () => this.leaveNow());
    this.leaveNow();
  }

  private confirm(words: string, yesLabel: string, onYes: () => void) {
    const yes = h('button', { class: 'btn primary', type: 'button' }, yesLabel);
    const no = h('button', { class: 'btn ghost', type: 'button' }, 'Stay');
    yes.addEventListener('click', () => {
      this.env.sound?.click?.();
      this.hideConfirm();
      onYes();
    });
    no.addEventListener('click', () => {
      this.env.sound?.click?.();
      this.hideConfirm();
      this.backBtn.focus();
    });
    this.confirmBox.replaceChildren(h('p', {}, words), h('div', { class: 'sc-row' }, yes, no));
    this.confirmBox.hidden = false;
    this.el.scrollTop = 0;
    yes.focus();
    this.env.announce(words);
  }

  private hideConfirm() {
    this.confirmBox.hidden = true;
    this.confirmBox.textContent = '';
  }

  /** Leave for good: the host's class ends for everyone, a diver's seat is given up. */
  private leaveNow() {
    if (this.mode === 'host') {
      if (this.view && this.view.phase !== 'ended') this.link?.send({ t: 'end' });
      this.closeLink(false);
    } else this.closeLink(true);
    clearClassPlace();
    this.exit();
  }

  private exit() {
    this.sink(0);
    this.opts.onExit();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.scene?.destroy();
    this.scene = null;
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.closeLink(false);
    document.removeEventListener('visibilitychange', this.onVisible);
    this.sleepAgain();
  }
}
