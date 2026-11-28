// The Séance, the party mode: up to twelve sitters answer the same question by
// candlelight, across phones through the surface relay (one of them the medium,
// who lights the candles, and perhaps a shared screen as the table), or on one
// device passed round the room. The rules live in src/party; this is the screen.
//
//   const s = seanceScreen(env, { sign, table, onExit });
//   stage.append(s.el);   // a <section class="screen seance-screen">
//   …
//   s.destroy();          // stops every timer and closes the link

import '../styles/seance.css';
import { parseSign } from '../party/codes';
import { clearSeat, hasRelay, loadSeat, openSeance, peekSeance, RelayError, saveSeat, SeanceLink, type Hello, type LinkHandlers, type LinkStatus, type Seat as SavedSeat } from '../party/online';
import { addSitter, againPass, candleOut, gutter, holder, newPass, nextCandle, passOn, removeSitter, revivePass, speakPass, startPass, takeLantern, type PassState } from '../party/passplay';
import { cleanName, publicPrompt } from '../party/room';
import type { ErrorCode, SeanceView } from '../party/types';
import { icon } from '../ui/art';
import { h } from '../ui/dom';
import { installSeanceArt } from './seance/art';
import { CandleScene, TableCandleScene, type CandleData } from './seance/candle';
import { CallingScene, EntryScene, NO_RELAY_LINK, type EntryInit } from './seance/entry';
import { HandoffScene, LanternSealedScene, LanternSetupScene } from './seance/lantern';
import { LobbyScene, TableLobbyScene } from './seance/lobby';
import { BEGIN_BUDGET, choosePrompts, deepest, lanternResume, listNames, relayId, seatsOf, tierDepths } from './seance/model';
import { dropStore, loadName, readJson, writeStore } from './seance/parts';
import { EndScene, RevealScene, TableEndScene, TableRevealScene, type Role } from './seance/reveal';
import type { Ctx, Scene } from './seance/scene';
import type { PromptDef } from '../game/types';
import type { LinkFactory, LinkLike, SeanceDeps, SeanceEnv, SeanceOpts, Seat } from './seance/types';

export type { SeanceDeps, SeanceEnv, SeanceOpts, SeanceSound } from './seance/types';
export { cultBody, postDiveToCult } from './cult';

export const PASS_KEY = 'cthulhoo.v1.pass';
const ASKED_KEY = 'cthulhoo.v1.seanceAsked';
/** How long the line may stay lost before we ask the surface whether the séance still exists. */
const LOST_CHECK_MS = 15_000;
/** A new medium is announced only once it has held this long: a reload hands the candles straight back. */
const MEDIUM_SETTLE_MS = 2_500;
/** How long news of the circle stays under the bar. */
const NOTICE_MS = 7_000;

const realLink: LinkFactory = (sign, hello, on, rejoin) => new SeanceLink(sign, hello, on, rejoin);

/** The questions already asked under a sign (or by the lantern), so sitting again asks new ones. */
interface Asked {
  key: string;
  sittings: number;
  asked: string[];
}

function loadAsked(key: string): Asked {
  const a = readJson<Asked>(ASKED_KEY);
  return a && a.key === key && Array.isArray(a.asked) && typeof a.sittings === 'number' ? a : { key, sittings: 0, asked: [] };
}

const saveAsked = (a: Asked) => writeStore(ASKED_KEY, JSON.stringify({ ...a, asked: a.asked.slice(-60) }));

export function loadPass(): PassState | null {
  return revivePass(readJson<unknown>(PASS_KEY));
}

const savePass = (s: PassState) => writeStore(PASS_KEY, JSON.stringify(s));

/** The words for a refusal from the relay that is not the deep's. */
function errorWords(code: ErrorCode, message: string): string {
  if (code === 'late') return 'The candle had already gone out.';
  if (code === 'medium') return 'Only the medium can do that.';
  return message;
}

export function seanceScreen(env: SeanceEnv, opts: SeanceOpts, deps: SeanceDeps = {}): { el: HTMLElement; destroy(): void } {
  installSeanceArt();
  const screen = new SeanceScreen(env, opts, deps);
  return { el: screen.el, destroy: () => screen.destroy() };
}

type Mode = 'entry' | 'online' | 'lantern';

class SeanceScreen {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private backBtn: HTMLButtonElement;
  private backLabel: HTMLElement;
  private barSign: HTMLElement;
  private confirmBox: HTMLElement;
  private lostEl: HTMLElement;
  private noticeEl: HTMLElement;
  private noticeOff = 0;
  private noticeStays = false;
  /** The medium the circle was last told of, so a reload's flicker is never announced. */
  private toldMedium: string | null = null;
  private scene: Scene | null = null;
  private ctx: Ctx;
  private relay: boolean;
  private reduced: boolean;
  private depthNow = 0;
  private mode: Mode = 'entry';
  private dead = false;
  private timers: number[] = [];
  // online
  private link: LinkLike | null = null;
  private sign = '';
  private table = false;
  private view: SeanceView | null = null;
  private lostCheck = 0;
  // pass the lantern
  private pass: PassState | null = null;

  constructor(
    private env: SeanceEnv,
    private opts: SeanceOpts,
    private deps: SeanceDeps,
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
    this.confirmBox = h('div', { class: 'sc-confirm', hidden: true, role: 'group', 'aria-label': 'Leave the circle?' });
    this.lostEl = h('p', { class: 'sc-lost', hidden: true }, h('span', { class: 'sc-lost-dot', 'aria-hidden': 'true' }), 'The line to the surface is lost. Calling again…');
    this.noticeEl = h('p', { class: 'sc-notice', hidden: true });
    const rail = h('div', { class: 'sc-notice-rail' }, this.noticeEl);
    this.stage = h('div', { class: 'sc-stage' });
    this.el = h(
      'section',
      { class: `screen seance-screen${this.reduced ? ' is-reduced' : ''}`, 'aria-label': 'The Séance' },
      h('div', { class: `sc-bar${opts.barEnd ? ' has-end' : ''}` }, this.backBtn, h('p', { class: 'sc-bar-title' }, h('span', { class: 't' }, 'The Séance'), this.barSign), opts.barEnd ?? null),
      this.confirmBox,
      this.lostEl,
      rail,
      this.stage,
    );
    this.ctx = {
      env,
      reduced: this.reduced,
      screen: this.el,
      depth: () => this.depthNow,
      now: () => this.now(),
      sink: (m) => this.sink(m),
    };
    this.open();
  }

  // ------------------------------------------------------------ plumbing

  private now(): number {
    if (this.mode === 'online' && this.link) return this.link.now();
    return this.deps.now?.() ?? Date.now();
  }

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

  private setBar(mode: Mode, sign = '') {
    this.backLabel.textContent = mode === 'entry' ? 'Back' : 'Leave';
    this.backBtn.setAttribute('aria-label', mode === 'entry' ? 'Back to the surface' : mode === 'lantern' ? 'Put out the lantern' : this.table ? 'Clear the table' : 'Leave the circle');
    this.barSign.textContent = sign;
    this.el.classList.toggle('is-table', mode === 'online' && this.table);
  }

  // ------------------------------------------------------------ opening

  private open() {
    const opts = this.opts;
    const seat = this.relay ? loadSeat() : null;
    if (opts.sign) {
      const sign = parseSign(opts.sign, 'seance');
      if (!this.relay) return this.entry({ message: NO_RELAY_LINK });
      if (sign && seat && seat.sign === sign) return void this.rejoin(seat);
      if (sign && opts.table) return void this.sitTable(sign);
      return this.entry({ panel: opts.table ? 'table' : 'join', sign: sign ?? opts.sign, message: sign ? undefined : 'That is not a séance’s sign. It looks like DAGON-7: a word and one number.' });
    }
    if (seat) return void this.rejoin(seat);
    const saved = loadPass();
    if (saved && saved.phase !== 'setup') {
      this.pass = saved;
      this.mode = 'lantern';
      this.setBar('lantern');
      // Questions from a class pack are not in the bank until their pack is fetched again.
      const lost = saved.promptIds.filter((id) => !this.env.byId.has(id));
      if (lost.length && this.env.topics) return void this.env.topics.ensure(lost).then(() => this.renderLantern());
      return this.renderLantern();
    }
    this.entry({ panel: opts.table && this.relay ? 'table' : 'ways' });
  }

  private entry(init: EntryInit = {}) {
    this.closeLink(false);
    this.mode = 'entry';
    this.table = false;
    this.setBar('entry');
    this.showLost(false);
    this.sink(0);
    this.show(
      new EntryScene(this.ctx, this.relay, init, {
        hold: (name) => void this.hold(name),
        join: (name, sign) => void this.join(name, sign),
        table: (sign) => void this.sitTable(sign),
        tableNew: () => void this.tableNew(),
        lantern: (name) => this.lantern(name),
      }),
    );
  }

  private get entryScene(): EntryScene | null {
    return this.scene instanceof EntryScene ? this.scene : null;
  }

  private nameOk(name: string): string | null {
    const clean = cleanName(name);
    if (!clean) {
      this.entryScene?.error('Give the circle a name to call you by.', 'name');
      return null;
    }
    return clean;
  }

  private failEntry(e: unknown) {
    const msg = e instanceof RelayError ? e.message : 'The surface relay did not answer. Try again.';
    const s = this.entryScene;
    if (s) {
      s.busy(false);
      s.error(msg);
    } else this.entry({ message: msg });
  }

  private async hold(name: string) {
    if (!this.nameOk(name)) return;
    this.entryScene?.busy(true);
    try {
      const sign = await (this.deps.open ?? openSeance)();
      if (this.dead) return;
      this.connect(sign, false, false);
    } catch (e) {
      if (!this.dead) this.failEntry(e);
    }
  }

  private async join(name: string, raw: string) {
    if (!this.nameOk(name)) return;
    const sign = parseSign(raw, 'seance');
    if (!sign) return this.entryScene?.error('That is not a séance’s sign. It looks like DAGON-7: a word and one number.', 'sign');
    this.entryScene?.busy(true);
    try {
      const peek = await (this.deps.peek ?? peekSeance)(sign);
      if (this.dead) return;
      const known = loadSeat()?.sign === sign;
      const why = !peek ? 'No séance has that sign. Check it with the medium.' : known ? null : peek.full ? 'The circle is full: twelve is all a séance can hold.' : peek.phase === 'ended' ? 'That séance is over. Ask the medium to sit again, then join.' : null;
      if (why) {
        this.entryScene?.busy(false);
        this.entryScene?.error(why, 'sign');
        return;
      }
      this.connect(sign, false, known);
    } catch (e) {
      if (!this.dead) this.failEntry(e);
    }
  }

  private async sitTable(raw: string) {
    const sign = parseSign(raw, 'seance');
    if (!sign) {
      if (!this.entryScene) this.entry({ panel: 'table' });
      this.entryScene?.error('That is not a séance’s sign. It looks like DAGON-7: a word and one number.', 'sign');
      return;
    }
    this.entryScene?.busy(true);
    try {
      const peek = await (this.deps.peek ?? peekSeance)(sign);
      if (this.dead) return;
      if (!peek) {
        if (!this.entryScene) this.entry({ panel: 'table', sign });
        this.entryScene?.busy(false);
        this.entryScene?.error('No séance has that sign. Check it with the medium.', 'sign');
        return;
      }
      this.connect(sign, true, false);
    } catch (e) {
      if (!this.dead) this.failEntry(e);
    }
  }

  private async tableNew() {
    this.entryScene?.busy(true);
    try {
      const sign = await (this.deps.open ?? openSeance)();
      if (!this.dead) this.connect(sign, true, false);
    } catch (e) {
      if (!this.dead) this.failEntry(e);
    }
  }

  /** Back to a séance after a reload: the seat this device last sat in. */
  private async rejoin(seat: SavedSeat) {
    this.mode = 'online';
    this.sign = seat.sign;
    this.table = seat.table;
    this.setBar('online', seat.sign);
    this.show(new CallingScene(this.ctx, seat.sign, seat.table, () => this.giveUp(), () => this.connect(seat.sign, seat.table, true)));
    try {
      const peek = await (this.deps.peek ?? peekSeance)(seat.sign);
      if (this.dead) return;
      if (!peek) {
        clearSeat();
        this.entry({ panel: seat.table ? 'table' : 'join', message: 'That séance has ended.' });
        return;
      }
    } catch {
      /* the link calls again by itself until the surface answers */
    }
    if (!this.dead) this.connect(seat.sign, seat.table, true);
  }

  // ------------------------------------------------------------ online

  private connect(sign: string, table: boolean, rejoin: boolean) {
    this.closeLink(false);
    this.mode = 'online';
    this.sign = sign;
    this.table = table;
    this.view = null;
    this.toldMedium = null;
    this.notice('');
    this.setBar('online', sign);
    if (!(this.scene instanceof CallingScene)) this.show(new CallingScene(this.ctx, sign, table, () => this.giveUp(), () => this.connect(sign, table, true)));
    const hello: Hello = { id: relayId(this.env.playerId, table), name: table ? '' : cleanName(loadName()), table };
    const handlers: LinkHandlers = {
      view: (v) => this.onView(v),
      refused: (r) => {
        if (this.scene instanceof CandleScene) this.scene.refuse(r.text, r.verdict, r.reason);
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
    this.closeLink(false);
    clearSeat();
    this.entry({ panel: this.table ? 'table' : 'join', sign: this.sign });
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

  /** Lost a while: ask whether the séance is still being held at all. */
  private async stillThere() {
    if (!this.link || this.link.status !== 'lost') return;
    try {
      const peek = await (this.deps.peek ?? peekSeance)(this.sign);
      if (!peek && this.link) this.onError('gone', 'That séance has ended.', true);
      else if (this.link?.status === 'lost') this.lostCheck = this.later(() => void this.stillThere(), LOST_CHECK_MS);
    } catch {
      if (this.link?.status === 'lost') this.lostCheck = this.later(() => void this.stillThere(), LOST_CHECK_MS);
    }
  }

  private showLost(on: boolean) {
    this.lostEl.hidden = !on;
    this.el.classList.toggle('is-lost', on);
  }

  private onError(code: ErrorCode, message: string, final: boolean) {
    if (this.dead) return;
    if (final) {
      this.closeLink(false);
      clearSeat();
      const field = code === 'name' ? 'name' : undefined;
      this.entry({ panel: code === 'name' ? 'ways' : this.table ? 'table' : 'join', sign: this.sign, message });
      if (field) this.entryScene?.error(message, 'name');
      return;
    }
    const words = errorWords(code, message);
    const s = this.scene;
    if (s instanceof CandleScene) {
      if (code !== 'sealed') s.note(words);
    } else if (s instanceof LobbyScene) s.fail(words);
    else if (s instanceof RevealScene || s instanceof EndScene) {
      s.fail();
      this.env.announce(words);
    } else this.env.announce(words);
  }

  private onView(v: SeanceView) {
    if (this.dead) return;
    const prev = this.view;
    const first = !prev;
    this.view = v;
    if (first) {
      saveSeat(this.sign, this.table);
      this.toldMedium = v.medium;
    } else this.noteCircle(prev, v);
    if (v.results.length) {
      const a = loadAsked(v.sign);
      let changed = false;
      for (const r of v.results)
        if (!a.asked.includes(r.prompt.id)) {
          a.asked.push(r.prompt.id);
          changed = true;
        }
      if (changed) saveAsked(a);
    }
    this.renderOnline(v);
  }

  private renderOnline(v: SeanceView) {
    const me = v.sitters.find((s) => s.id === v.you);
    const table = this.table || !!me?.table;
    const role: Role = table ? 'table' : v.medium === v.you ? 'medium' : 'sitter';
    const seats = seatsOf(v);
    const t = table ? 't' : '';
    const cur = this.scene;
    this.setBar('online', v.sign);
    switch (v.phase) {
      case 'lobby': {
        this.sink(0);
        if (table) {
          if (cur instanceof TableLobbyScene) cur.update(v);
          else this.show(new TableLobbyScene(this.ctx, v));
        } else {
          const key = `lobby:${role === 'medium' ? 'medium' : 'sitter'}`;
          if (cur instanceof LobbyScene && cur.key === key) cur.update(v);
          else this.show(new LobbyScene(this.ctx, v, { config: (c, s, topics) => this.link?.send({ t: 'config', candles: c, seconds: s, topics }), begin: () => void this.begin() }));
        }
        return;
      }
      case 'candle': {
        if (!v.prompt) return;
        this.sink(deepest(v.totals));
        const key = `${t}candle:${v.candle}`;
        const data: CandleData = {
          prompt: v.prompt,
          index: v.candle,
          count: Math.max(v.config.candles, v.candle + 1),
          litAt: v.litAt,
          deadline: v.deadline,
          seats,
          sealed: v.sealed,
          yours: v.yours ? { answer: v.yours.answer } : null,
          tries: v.tries,
          sign: v.sign,
        };
        if (cur && cur.key === key && (cur instanceof CandleScene || cur instanceof TableCandleScene)) cur.update(data);
        else if (table) this.show(new TableCandleScene(this.ctx, key, data));
        else this.show(new CandleScene(this.ctx, key, data, { speak: (text) => this.link?.send({ t: 'speak', text }) ?? false }));
        return;
      }
      case 'reveal': {
        const result = v.results[v.candle] ?? v.results[v.results.length - 1];
        if (!result) return;
        const key = `${t}reveal:${v.candle}`;
        if (cur && cur.key === key) {
          if (cur instanceof RevealScene) cur.setRole(role);
          return;
        }
        const data = { result, index: v.candle, count: Math.max(v.config.candles, v.candle + 1), seats, totals: v.totals, role, sign: v.sign };
        this.show(table ? new TableRevealScene(this.ctx, key, data) : new RevealScene(this.ctx, key, data, { next: () => this.link?.send({ t: 'next' }) }));
        return;
      }
      case 'ended': {
        const key = `${t}end`;
        if (cur && cur.key === key) {
          if (cur instanceof EndScene) cur.setRole(role);
          return;
        }
        const data = { heralds: v.heralds, seats, totals: v.totals, role, sign: v.sign };
        this.show(table ? new TableEndScene(this.ctx, key, data) : new EndScene(this.ctx, key, data, { again: () => this.link?.send({ t: 'again' }), leave: () => this.leaveNow() }));
        return;
      }
    }
  }

  /**
   * Who left, and who holds the candles now. A departure is said at once; a new medium only once it has
   * held for a moment, so a phone that reloads and sits straight back down changes nothing anyone hears.
   */
  private noteCircle(prev: SeanceView, v: SeanceView) {
    const gone = prev.sitters.filter((s) => !s.table && !v.sitters.some((x) => x.id === s.id)).map((s) => s.name);
    if (gone.length) this.tell(`${listNames(gone)} ${gone.length === 1 ? 'leaves' : 'leave'} the circle.`);
    // Only a table can watch the last phone go: it keeps saying so until someone sits back down.
    const here = (x: SeanceView) => x.sitters.some((s) => !s.table && s.online);
    if (here(prev) && !here(v) && v.phase !== 'lobby') this.tell(`Everyone has left the circle. Join again with ${v.sign}.`, 0);
    else if (!here(prev) && here(v) && this.noticeStays) this.notice('');
    if (v.medium === prev.medium) return;
    const medium = v.medium;
    this.later(() => {
      const now = this.view;
      if (!now || !medium || now.medium !== medium || medium === this.toldMedium) return;
      // With nobody left, the rules hand the candles to the first to arrive; that is no news to tell.
      const who = now.sitters.find((s) => s.id === medium);
      if (!who?.online) return;
      this.toldMedium = medium;
      this.tell(medium === now.you ? 'The candles pass to you: you are the medium now.' : `The candles pass to ${who.name}: ${who.name} is the medium now.`);
    }, MEDIUM_SETTLE_MS);
  }

  private tell(words: string, ms = NOTICE_MS) {
    this.env.announce(words);
    this.notice(words, ms);
  }

  /** A line over the top of the screen, for news the circle would otherwise only hear. 0 ms keeps it up. */
  private notice(words: string, ms = NOTICE_MS) {
    clearTimeout(this.noticeOff);
    this.noticeEl.textContent = words;
    this.noticeEl.hidden = !words;
    this.noticeStays = !!words && !ms;
    if (words && ms) this.noticeOff = this.later(() => (this.noticeEl.hidden = true), ms);
  }

  /**
   * A sitting's questions: from the whole daily bank, or from the topics ticked
   * on this device (class packs are fetched first). Rejects when a ticked pack
   * cannot be had.
   */
  private async pick(choice: string[], key: string, a: { sittings: number; asked: string[] }, count: number, budget?: number): Promise<PromptDef[]> {
    const topics = this.env.topics;
    if (!topics || !choice.length) return choosePrompts(this.env, this.env.avoid, key, a.sittings, this.env.today, count, a.asked, { budget });
    const among = await topics.pool(choice);
    return choosePrompts(this.env, this.env.avoid, key, a.sittings, this.env.today, count, a.asked, { among, topicOf: (p) => topics.topicOf(p), budget });
  }

  /** The medium lights the first candle: the questions are chosen on this device and sent whole. */
  private async begin() {
    const v = this.view;
    const lobby = this.scene instanceof LobbyScene ? this.scene : null;
    if (!v) return;
    const a = loadAsked(v.sign);
    let prompts: PromptDef[];
    try {
      prompts = await this.pick(lobby?.choice() ?? [], v.sign, a, v.config.candles, BEGIN_BUDGET);
    } catch {
      lobby?.fail('A class pack you ticked could not be fetched. Check the connection, or tick other topics.');
      return;
    }
    // The packs may have taken a moment: the séance may have moved on without this device.
    if (this.dead || this.scene !== lobby || this.view?.phase !== 'lobby') return;
    if (!prompts.length) {
      lobby?.fail('The deep has nothing to ask: the question bank is empty.');
      return;
    }
    const sent = this.link?.send({ t: 'begin', prompts, depths: tierDepths(this.env.theme) }) ?? false;
    if (!sent) {
      lobby?.fail('The line to the surface is lost. Try again in a moment.');
      return;
    }
    saveAsked({ key: v.sign, sittings: a.sittings + 1, asked: [...a.asked, ...prompts.map((p) => p.id)] });
  }

  // ------------------------------------------------------------ pass the lantern

  private lantern(name: string) {
    let s = loadPass();
    if (s && s.phase !== 'setup') againPass(s);
    s ??= newPass();
    const first = cleanName(name);
    if (!s.sitters.length && first) addSitter(s, first);
    this.pass = s;
    savePass(s);
    this.mode = 'lantern';
    this.setBar('lantern');
    this.renderLantern();
  }

  private lanternSeats(s: PassState): Seat[] {
    return s.sitters.map((x) => ({ id: x.id, name: x.name, mark: x.mark, online: true, you: false, medium: false }));
  }

  private renderLantern() {
    const s = this.pass;
    if (!s || this.dead) return;
    const now = this.now();
    if (lanternResume(s, now) === 'gutter') {
      gutter(s);
      savePass(s);
    }
    const promptAt = (i: number) => this.env.byId.get(s.promptIds[i]);
    if (s.phase !== 'setup' && s.phase !== 'ended' && !promptAt(s.candle)) {
      // The bank changed under a séance in progress: start the circle again.
      againPass(s);
      savePass(s);
    }
    const cur = this.scene;
    const turn = `${s.candle}:${s.turn}`;
    switch (s.phase) {
      case 'setup': {
        this.sink(0);
        if (cur instanceof LanternSetupScene) cur.update(s);
        else
          this.show(
            new LanternSetupScene(this.ctx, s, {
              add: (name) => {
                const why = addSitter(s, name);
                if (!why) this.saveAndRender();
                return why;
              },
              remove: (id) => {
                removeSitter(s, id);
                this.saveAndRender();
              },
              config: (candles, seconds) => {
                s.config = { candles, seconds };
                this.saveAndRender();
              },
              begin: () => void this.beginLantern(),
            }),
          );
        return;
      }
      case 'pass': {
        this.sink(deepest(s.totals));
        const key = `l-pass:${turn}`;
        if (cur?.key !== key)
          this.show(
            new HandoffScene(this.ctx, key, s, () => {
              takeLantern(s, this.now());
              this.saveAndRender();
            }),
          );
        return;
      }
      case 'speak': {
        const def = promptAt(s.candle);
        const who = holder(s);
        if (!def || !who) return;
        this.sink(deepest(s.totals));
        const key = `l-speak:${turn}`;
        if (cur?.key === key) return;
        const data: CandleData = {
          prompt: publicPrompt(def),
          index: s.candle,
          count: s.promptIds.length,
          litAt: s.litAt,
          deadline: candleOut(s),
          seats: null,
          sealed: [],
          yours: null,
          tries: s.tries[who.id] ?? [],
          holder: { name: who.name, mark: who.mark },
        };
        this.show(
          new CandleScene(this.ctx, key, data, {
            speak: (text) => this.lanternSpeak(text),
            out: () => {
              gutter(s);
              this.saveAndRender();
            },
          }),
        );
        return;
      }
      case 'sealed': {
        const who = holder(s);
        const def = promptAt(s.candle);
        const key = `l-sealed:${turn}`;
        if (!who || !def || cur?.key === key) return;
        this.sink(deepest(s.totals));
        this.show(
          new LanternSealedScene(this.ctx, key, s, !!s.seals[who.id], () => {
            passOn(s, def);
            this.saveAndRender();
          }),
        );
        return;
      }
      case 'reveal': {
        const key = `l-reveal:${s.candle}`;
        const result = s.results[s.candle] ?? s.results[s.results.length - 1];
        if (!result || cur?.key === key) return;
        this.show(
          new RevealScene(this.ctx, key, { result, index: s.candle, count: s.promptIds.length, seats: this.lanternSeats(s), totals: s.totals, role: 'lantern' }, {
            next: () => {
              nextCandle(s);
              this.saveAndRender();
            },
          }),
        );
        return;
      }
      case 'ended': {
        if (cur?.key === 'l-end') return;
        this.show(
          new EndScene(this.ctx, 'l-end', { heralds: s.heralds, seats: this.lanternSeats(s), totals: s.totals, role: 'lantern' }, {
            again: () => {
              againPass(s);
              this.saveAndRender();
            },
            leave: () => this.leaveNow(),
          }),
        );
        return;
      }
    }
  }

  private saveAndRender() {
    if (!this.pass) return;
    savePass(this.pass);
    this.renderLantern();
  }

  private async beginLantern() {
    const s = this.pass;
    const setup = this.scene instanceof LanternSetupScene ? this.scene : null;
    if (!s) return;
    const a = loadAsked('LANTERN');
    let prompts: PromptDef[];
    try {
      prompts = await this.pick(setup?.choice() ?? [], 'lantern', a, s.config.candles);
    } catch {
      const why = 'A class pack you ticked could not be fetched. Check the connection, or tick other topics.';
      setup?.fail(why);
      this.env.shout(why);
      return;
    }
    if (this.dead || this.pass !== s || s.phase !== 'setup') return;
    const why = startPass(
      s,
      prompts.map((p) => p.id),
      tierDepths(this.env.theme),
      s.config,
    );
    if (why) {
      this.env.shout(why);
      return;
    }
    saveAsked({ key: 'LANTERN', sittings: a.sittings + 1, asked: [...a.asked, ...prompts.map((p) => p.id)] });
    this.saveAndRender();
  }

  private lanternSpeak(text: string): boolean {
    const s = this.pass;
    const def = s ? this.env.byId.get(s.promptIds[s.candle]) : undefined;
    if (!s || !def) return false;
    const heard = speakPass(s, def, text, this.now());
    savePass(s);
    const scene = this.scene;
    if (heard?.kind === 'refused' && scene instanceof CandleScene) scene.refuse(text, heard.verdict, heard.reason);
    else if (heard?.kind === 'sealed') {
      this.env.sound?.click?.();
      this.env.buzz?.(20);
      this.renderLantern();
    }
    return true;
  }

  // ------------------------------------------------------------ leaving

  /** Whether leaving now would walk out on a séance that is under way. */
  private underway(): boolean {
    if (this.mode === 'online') return !!this.view && (this.view.phase === 'candle' || this.view.phase === 'reveal');
    if (this.mode === 'lantern') return !!this.pass && this.pass.phase !== 'setup' && this.pass.phase !== 'ended';
    return false;
  }

  private back() {
    if (this.mode === 'entry') {
      const e = this.entryScene;
      if (e && e.current !== 'ways') return e.show('ways');
      return this.exit();
    }
    if (this.scene instanceof CallingScene) return this.giveUp();
    if (this.underway()) return this.askToLeave();
    this.leaveNow();
  }

  private askToLeave() {
    const words =
      this.mode === 'lantern'
        ? 'Put out the lantern? This séance will end.'
        : this.table
          ? 'Clear the table? The séance goes on without this screen.'
          : this.view?.medium === this.view?.you
            ? 'Leave the circle? Your depth stays on the record, and the candles pass to the next sitter.'
            : 'Leave the circle? Your depth stays on the record.';
    const yes = h('button', { class: 'btn primary', type: 'button' }, this.mode === 'lantern' ? 'Put it out' : 'Leave');
    const no = h('button', { class: 'btn ghost', type: 'button' }, 'Stay');
    yes.addEventListener('click', () => {
      this.env.sound?.click?.();
      this.leaveNow();
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

  /** Stand up for good: the seat is given up, the lantern put out. */
  private leaveNow() {
    if (this.mode === 'online') {
      this.closeLink(true);
      clearSeat();
    } else if (this.mode === 'lantern') {
      dropStore(PASS_KEY);
      this.pass = null;
    }
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
  }
}
