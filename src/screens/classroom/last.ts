// Last diver standing, as the Convocation plays it: the tables (or, with no
// tables, the divers) take turns naming an answer nobody has named yet. Each
// turn burns a short candle. An answer already named, or a turn that runs out,
// puts out one of the side's lanterns, and the last side with one lit wins the
// bout. Here are its two screens: the big one for the room, and a diver's phone.

import { filedUnder } from '../../game/packs';
import { pickLine } from '../../game/theme';
import type { ClassLastView, ClassView } from '../../party/class-types';
import type { ClassHeard, ClassRefusal } from '../../party/class-link';
import { h } from '../../ui/dom';
import { questionBlock } from '../seance/candle';
import { sameWords } from '../seance/model';
import { addTry, answerForm, CandleRow, type FormParts } from '../seance/parts';
import { Scene, uniq, type Ctx } from '../seance/scene';
import { beatLine, boutLine, mySide, namedChips, questionOf, sideName, sideStyle, sidesStrip } from './parts';

/** The candle of the turn being taken: a fresh one is lit for each turn. */
class TurnCandle {
  readonly el = h('div', { class: 'cv-turn-candle' });
  private clock: CandleRow | null = null;
  private key = '';

  constructor(
    private ctx: Ctx,
    private grand: boolean,
    private onSecond: (secs: number) => void,
  ) {}

  /** Light the candle for the turn as it stands. Returns whether it was lit afresh (a new turn, or one begun again). */
  set(last: ClassLastView): boolean {
    const key = `${last.turnN}:${last.turn}:${last.turnLit}:${last.turnEnds}`;
    if (key === this.key) return false;
    this.key = key;
    this.clock?.stop();
    this.clock = null;
    if (last.turn < 0) {
      this.el.replaceChildren();
      return true;
    }
    this.clock = new CandleRow({ now: () => this.ctx.now(), litAt: last.turnLit, deadline: last.turnEnds, reduced: this.ctx.reduced, count: 1, index: 0, grand: this.grand, onSecond: this.onSecond });
    this.el.replaceChildren(this.clock.el);
    this.clock.start();
    return true;
  }

  stop() {
    this.clock?.stop();
  }
}

/** Each turn's outcome is told once: this names it. */
const beatKey = (last: ClassLastView | undefined): string => (last?.beat ? `${last.turnN}:${last.beat.kind}:${last.beat.side}` : '');

/** Whether the first side is still reading the question. */
const reading = (last: ClassLastView, now: number): boolean => last.turnN === 0 && last.turn >= 0 && now < last.turnLit;

const overLine = (last: ClassLastView, tables: boolean): string => boutLine({ ended: last.ended ?? 'host', sides: last.sides, winner: last.winner ?? -1, turns: last.turnN }, tables);

// ------------------------------------------------------------------ the big screen

export interface HostLastActions {
  /** End the bout now: the answers surface. */
  reveal(): void;
}

export class HostLastScene extends Scene {
  readonly key: string;
  private view: ClassView;
  private candle: TurnCandle;
  private turnPanel: HTMLElement;
  private who: HTMLElement;
  private sub: HTMLElement;
  private beat: HTMLElement;
  private sidesSlot: HTMLElement;
  private wallSlot: HTMLElement;
  private wallCount: HTMLElement;
  private endBtn: HTMLButtonElement;
  private told: string;
  private shown: number;
  private readTimer = 0;

  constructor(ctx: Ctx, key: string, view: ClassView, actions: HostLastActions) {
    super(ctx);
    this.key = key;
    this.view = view;
    const prompt = view.prompt!;
    const qid = uniq('cv-lq');
    const rid = uniq('cv-lrules');
    const { q, rules, flavor } = questionBlock(prompt, qid, rid, 'question cv-hq-text cv-lq-text');
    const filed = filedUnder(this.env.theme, prompt);
    const madCat = filed ? h('p', { class: 'category' }, filed) : null;
    this.candle = new TurnCandle(ctx, true, (secs) => {
      if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
    });
    this.who = h('p', { class: 'cv-turn-who' });
    this.sub = h('p', { class: 'cv-turn-sub' });
    this.turnPanel = h('div', { class: 'cv-turn' }, h('div', { class: 'cv-turn-words' }, this.who, this.sub), this.candle.el);
    this.beat = h('p', { class: 'cv-beat', role: 'status' });
    this.wallCount = h('span', { class: 'sc-count' });
    this.wallSlot = h('div', { class: 'cv-wall-slot' });
    this.sidesSlot = h('div', { class: 'cv-sides-slot' });
    this.endBtn = h('button', { class: 'btn ghost cv-reveal-now cv-end-bout', type: 'button' }, 'End the bout') as HTMLButtonElement;
    this.endBtn.addEventListener('click', () => {
      if (this.endBtn.disabled) return;
      this.click();
      this.endBtn.disabled = true;
      actions.reveal();
      // If the line was down, offer it again.
      this.later(() => (this.view.last?.turn ?? -1) >= 0 && (this.endBtn.disabled = false), 2500);
    });
    this.el = h(
      'div',
      { class: 'sc-scene cv-host-last', 'aria-labelledby': qid },
      h('div', { class: 'plate question-plate cv-hq cv-lq' }, h('p', { class: 'kicker' }, `${questionOf(view)} · Last diver standing`), madCat, q, rules, flavor),
      h(
        'div',
        { class: 'cv-bout' },
        h('div', { class: 'cv-bout-turn' }, this.turnPanel, this.beat),
        h('section', { class: 'cv-wall', 'aria-label': 'Named so far' }, h('h3', { class: 'sc-h' }, 'Named so far', this.wallCount), this.wallSlot),
      ),
      this.sidesSlot,
      h('div', { class: 'sc-actions cv-bout-acts' }, this.endBtn),
    );
    this.focus = q;
    this.stops.push(() => {
      this.candle.stop();
      clearTimeout(this.readTimer);
    });
    this.later(() => this.mad(madCat), 50);
    // Arriving in the middle of a bout (a reload): what has happened already is shown, not played again.
    this.told = '';
    this.shown = view.last?.saidN ?? 0;
    this.paint(false);
  }

  update(view: ClassView) {
    this.view = view;
    this.paint(true);
  }

  private paint(live: boolean) {
    const L = this.view.last;
    if (!L) return;
    const tables = !!this.view.config.tables;
    this.candle.set(L);
    const side = L.turn >= 0 ? L.sides[L.turn] : undefined;
    this.turnPanel.style.cssText = side ? sideStyle(side, L.turn) : '';
    this.turnPanel.classList.toggle('is-over', !side);
    this.turnPanel.classList.toggle('is-away', !!L.away);
    if (side) {
      const first = reading(L, this.ctx.now());
      this.who.textContent = first ? `${sideName(side)} goes first` : `${sideName(side)}’s turn`;
      this.sub.textContent = L.away ? (tables ? 'Nobody of this table is here. Waiting a moment…' : 'Not here. Waiting a moment…') : first ? 'Read the question. The candle is about to be lit.' : tables ? 'Anyone at the table may answer. Name one nobody has named.' : 'Name one nobody has named.';
      clearTimeout(this.readTimer);
      if (first) this.readTimer = this.later(() => this.paint(false), L.turnLit - this.ctx.now() + 40);
    } else {
      this.who.textContent = `${overLine(L, tables)}.`;
      this.sub.textContent = 'The answers are surfacing…';
      this.endBtn.disabled = true;
    }
    const bk = beatKey(L);
    if (L.beat && bk !== this.told) {
      this.beat.textContent = beatLine(this.env.theme, L.beat, L, tables);
      this.beat.dataset.kind = L.beat.kind;
      const at = L.sides[L.beat.side];
      this.beat.style.cssText = at ? sideStyle(at, L.beat.side) : '';
      if (live) {
        // The big screen is the room's voice: a named answer rings, a lost lantern does not.
        if (L.beat.kind === 'said') this.env.sound?.accept?.(L.beat.tier);
        else this.env.sound?.refuse?.();
        if (!this.ctx.reduced) {
          this.beat.classList.remove('is-new');
          void this.beat.offsetWidth;
          this.beat.classList.add('is-new');
        }
      }
    }
    this.told = bk;
    this.sidesSlot.replaceChildren(sidesStrip(L, { turn: L.turn }));
    const fresh = live ? Math.max(0, L.saidN - this.shown) : 0;
    this.shown = L.saidN;
    this.wallSlot.replaceChildren(L.said.length ? namedChips(this.env.theme, L.said, this.ctx.reduced ? 0 : fresh) : h('p', { class: 'cv-roll-empty' }, 'Nothing yet. The deep is listening.'));
    this.wallCount.textContent = L.saidN ? `${L.saidN} · ${L.left.toLocaleString('en-GB')} still down there` : '';
  }
}

// ------------------------------------------------------------------ a diver's phone

export interface DiverLastActions {
  /** Say an answer to the deep. False when it could not be said (the line is down). */
  say(text: string): boolean;
}

type Standing = 'in' | 'out' | 'watch' | 'over';

export class DiverLastScene extends Scene {
  readonly key: string;
  private view: ClassView;
  private candle: TurnCandle;
  private parts: FormParts;
  private slot: HTMLElement;
  private turnPanel: HTMLElement;
  private who: HTMLElement;
  private sub: HTMLElement;
  private beat: HTMLElement;
  private sidesSlot: HTMLElement;
  private namedSlot: HTMLElement;
  private namedCount: HTMLElement;
  private pending = 0;
  private told: string;
  private shown: number;
  private readTimer = 0;
  private standing: Standing | null = null;
  private myTurn = false;
  /** The word under the line is only "not your turn yet": it goes when the turn comes. */
  private waiting = false;

  constructor(
    ctx: Ctx,
    key: string,
    view: ClassView,
    private actions: DiverLastActions,
  ) {
    super(ctx);
    this.key = key;
    this.view = view;
    const prompt = view.prompt!;
    const qid = uniq('cv-lq');
    const rid = uniq('cv-lrules');
    const { q, rules, flavor } = questionBlock(prompt, qid, rid);
    const filed = filedUnder(this.env.theme, prompt);
    const madCat = filed ? h('p', { class: 'category' }, filed) : null;
    this.parts = answerForm(prompt.rules ? `${qid} ${rid}` : qid, () => this.env.sound?.key?.());
    this.parts.input.placeholder = 'Name one…';
    this.parts.button.textContent = 'Name it';
    this.candle = new TurnCandle(ctx, false, (secs) => {
      if (!this.myTurn) return;
      if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
      if (secs === 5) this.env.announce('Five seconds.');
    });
    this.who = h('p', { class: 'cv-turn-who' });
    this.sub = h('p', { class: 'cv-turn-sub' });
    this.turnPanel = h('div', { class: 'cv-turn is-phone' }, h('div', { class: 'cv-turn-words' }, this.who, this.sub), this.candle.el);
    this.slot = h('div', { class: 'sc-answer-slot' });
    this.beat = h('p', { class: 'cv-beat is-phone' });
    this.sidesSlot = h('div', { class: 'cv-sides-slot' });
    this.namedCount = h('span', { class: 'sc-count' });
    this.namedSlot = h('div', { class: 'cv-wall-slot' });
    const plate = h(
      'div',
      { class: 'plate question-plate sc-qplate' },
      h('p', { class: 'kicker' }, `${questionOf(view)} · Last diver standing`),
      madCat,
      q,
      rules,
      flavor,
      this.turnPanel,
      this.slot,
      this.parts.feedback,
      this.beat,
      this.sidesSlot,
      h('section', { class: 'cv-wall is-phone', 'aria-label': 'Named so far' }, h('h3', { class: 'sc-h' }, 'Named so far', this.namedCount), this.namedSlot),
      this.parts.tries,
    );
    this.el = h('div', { class: 'sc-scene sc-candle-scene cv-last', 'aria-labelledby': qid }, plate);
    this.parts.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.bindKeyboard();
    this.stops.push(() => {
      this.candle.stop();
      clearTimeout(this.readTimer);
    });
    for (const t of view.you?.tries ?? []) addTry(this.parts.tries, t);
    this.focus = q;
    this.later(() => this.mad(madCat), 50);
    this.told = beatKey(view.last);
    this.shown = view.last?.saidN ?? 0;
    this.paint(false);
    // Arriving on this diver's own turn: the line is theirs at once.
    if (this.myTurn) this.focus = this.parts.input;
  }

  update(view: ClassView) {
    this.view = view;
    for (const t of view.you?.tries ?? []) addTry(this.parts.tries, t);
    this.paint(true);
  }

  private submit() {
    if (this.pending || this.standing !== 'in') return;
    const text = this.parts.input.value.trim();
    if (!text) {
      this.parts.input.focus();
      return;
    }
    // Typed ahead of the turn: it is kept on the line, ready.
    if (!this.myTurn) return this.note(this.view.config.tables ? 'Not your table’s turn yet. Keep it ready.' : 'Not your turn yet. Keep it ready.', true);
    if (!this.actions.say(text)) return this.note('The line to the surface is lost. Say it again when it comes back.');
    this.parts.button.setAttribute('aria-busy', 'true');
    this.pending = this.later(() => this.release(), 5000);
  }

  private release() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = 0;
    this.parts.button.removeAttribute('aria-busy');
  }

  /** The deep took it: the turn passes on. */
  heard(hd: ClassHeard) {
    this.release();
    if (this.gone) return;
    this.waiting = false;
    const fb = this.parts.feedback;
    fb.textContent = '';
    fb.append(h('span', { class: 'cv-took' }, 'Named: ', h('q', {}, hd.answer), sameWords(hd.input, hd.answer) ? '.' : `, from “${hd.input}”.`));
    this.parts.input.value = '';
    this.env.announce(`Named: ${hd.answer}.`);
    this.env.buzz?.(20);
  }

  /** The deep would not take it: not this diver's turn, a name already named (a lantern is out), or no answer at all. */
  refuse(r: ClassRefusal) {
    this.release();
    if (this.gone) return;
    if (r.verdict === 'wait') return this.note(r.reason ?? 'It is not your turn.', true);
    this.waiting = false;
    const fb = this.parts.feedback;
    fb.textContent = '';
    const shake = () => {
      const form = this.parts.form;
      form.classList.remove('shake');
      void form.offsetWidth;
      if (!this.ctx.reduced) form.classList.add('shake');
    };
    if (r.verdict === 'burnt') {
      const words = r.reason ?? 'That one has been named already. A lantern goes dark.';
      fb.append(h('span', { class: 'said' }, `“${r.text}”.`), ' ', words);
      this.env.shout(words);
      this.env.buzz?.([70, 40, 70]);
      shake();
      this.parts.input.value = '';
      return;
    }
    const lines = this.env.theme.refused.lines;
    const line = r.verdict === 'trap' && r.reason ? r.reason : r.verdict === 'ambiguous' && r.reason ? r.reason : pickLine(r.verdict === 'decoy' ? lines.decoy : r.verdict === 'ambiguous' ? lines.ambiguous : lines.unknown, this.view.prompt?.id ?? '', r.text);
    fb.append(h('span', { class: 'said' }, `${this.env.theme.refused.name}: “${r.text}”.`), ' ', line, ' ', h('span', { class: 'sc-note' }, 'Try another: the candle still burns.'));
    this.env.shout(`${this.env.theme.refused.name}: ${r.text}. ${line} Try another.`);
    addTry(this.parts.tries, r.text);
    this.env.sound?.refuse?.();
    this.env.buzz?.(45);
    shake();
    this.parts.input.value = '';
    this.parts.input.focus();
    requestAnimationFrame(() => this.keepInView());
  }

  /** A quiet word under the line that is not a refusal. `waiting`: it only says the turn has not come. */
  note(message: string, waiting = false) {
    this.release();
    this.waiting = waiting;
    const fb = this.parts.feedback;
    fb.textContent = '';
    fb.append(h('span', { class: 'sc-note' }, message));
    this.env.announce(message);
  }

  private paint(live: boolean) {
    const L = this.view.last;
    if (!L) return;
    const tables = !!this.view.config.tables;
    const mine = mySide(this.view, L.sides);
    const my = mine >= 0 ? L.sides[mine] : undefined;
    const lit = this.candle.set(L);
    const side = L.turn >= 0 ? L.sides[L.turn] : undefined;
    const wasTurn = this.myTurn;
    this.myTurn = !!side && L.turn === mine && !!my && my.lanterns > 0;
    this.turnPanel.style.cssText = side ? sideStyle(side, L.turn) : '';
    this.turnPanel.classList.toggle('is-mine', this.myTurn);
    this.turnPanel.classList.toggle('is-over', !side);
    this.turnPanel.classList.toggle('is-away', !!L.away);
    const standing: Standing = !side ? 'over' : !my ? 'watch' : my.lanterns <= 0 ? 'out' : 'in';
    if (side) {
      const first = reading(L, this.ctx.now());
      this.who.textContent = this.myTurn ? (first ? (tables ? 'Your table goes first' : 'You go first') : tables ? 'Your table’s turn' : 'Your turn') : first ? `${sideName(side)} goes first` : `${sideName(side)}’s turn`;
      this.sub.textContent = this.myTurn
        ? tables
          ? `Anyone at ${sideName(side)} may answer. Name one nobody has named.`
          : 'Name one nobody has named.'
        : L.away
          ? 'Nobody there. Waiting a moment…'
          : standing === 'in'
            ? 'Have yours ready.'
            : '';
      clearTimeout(this.readTimer);
      if (first) this.readTimer = this.later(() => this.paint(false), L.turnLit - this.ctx.now() + 40);
    } else {
      this.who.textContent = `${overLine(L, tables)}.`;
      this.sub.textContent = 'The answers are surfacing…';
    }
    if (standing !== this.standing) {
      this.standing = standing;
      if (standing === 'in') this.slot.replaceChildren(this.parts.form);
      else {
        const words =
          standing === 'over'
            ? ['The bout is over.', 'Watch the big screen.']
            : standing === 'out'
              ? [tables ? 'Your table’s lanterns are out.' : 'Your lanterns are out.', 'Watch the rest from here. Your answers still count.']
              : [tables ? 'Your table sits this bout out.' : 'You sat down after this bout began.', 'You play in the next.'];
        this.release();
        this.slot.replaceChildren(h('div', { class: 'sc-sealed is-out', role: 'status' }, h('p', { class: 'sc-sealed-line' }, words[0]), h('p', { class: 'sc-sealed-sub' }, words[1])));
        if (standing !== 'over') this.parts.feedback.textContent = '';
        if (live) this.env.announce(words.join(' '));
      }
    }
    this.parts.form.classList.toggle('is-waiting', !this.myTurn);
    if (this.myTurn && this.waiting) {
      this.waiting = false;
      this.parts.feedback.textContent = '';
    }
    if (live && this.myTurn && (lit || !wasTurn)) {
      this.env.buzz?.([40, 30, 40]);
      this.env.announce(tables ? 'Your table’s turn.' : 'Your turn.');
      // Only a line already in the hand is kept there: a phone's keyboard opens on a touch, not on our word.
      if (document.activeElement === document.body || document.activeElement === this.parts.input) this.parts.input.focus({ preventScroll: true });
    }
    const bk = beatKey(L);
    if (L.beat && bk !== this.told) {
      this.beat.textContent = beatLine(this.env.theme, L.beat, L, tables);
      this.beat.dataset.kind = L.beat.kind;
      const at = L.sides[L.beat.side];
      this.beat.style.cssText = at ? sideStyle(at, L.beat.side) : '';
      // A phone speaks only of its own side: a lantern of ours going dark is felt.
      if (live && L.beat.side === mine && L.beat.kind !== 'said') {
        this.env.sound?.refuse?.();
        this.env.buzz?.([70, 40, 70]);
      }
    } else if (!L.beat) this.beat.textContent = '';
    this.told = bk;
    this.sidesSlot.replaceChildren(sidesStrip(L, { turn: L.turn, you: mine, compact: true }));
    const fresh = live ? Math.max(0, L.saidN - this.shown) : 0;
    this.shown = L.saidN;
    const more = L.saidN - L.said.length;
    this.namedSlot.replaceChildren(
      L.said.length ? namedChips(this.env.theme, L.said, this.ctx.reduced ? 0 : fresh) : h('p', { class: 'cv-roll-empty' }, 'Nothing yet.'),
      more > 0 ? h('p', { class: 'cv-answer-more' }, `and ${more} more, on the big screen`) : '',
    );
    this.namedCount.textContent = L.saidN ? String(L.saidN) : '';
  }

  /** Keep the turn, the answer line and what the deep said back in sight above a phone's keyboard. */
  private keepInView() {
    const input = this.parts.input;
    if (this.gone || document.activeElement !== input) return;
    const screen = this.ctx.screen;
    const view = screen.getBoundingClientRect();
    const below = (el: Element) => el.getBoundingClientRect().bottom + 8 - view.bottom;
    const top = this.turnPanel.getBoundingClientRect().top - 6;
    const room = Math.max(0, top - view.top);
    const down = Math.max(below(this.parts.form), this.parts.feedback.textContent ? Math.min(below(this.parts.feedback), room) : 0);
    if (down > 0) screen.scrollTop += down;
    else if (top < view.top) screen.scrollTop -= Math.min(view.top - top, Math.max(0, -below(this.parts.form)));
  }

  private bindKeyboard() {
    const onView = () => {
      const f = requestAnimationFrame(() => this.keepInView());
      this.frames.push(f);
    };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onView);
    vv?.addEventListener('scroll', onView);
    window.addEventListener('resize', onView);
    this.parts.input.addEventListener('focus', () => this.later(() => this.keepInView(), 320));
    this.stops.push(() => {
      vv?.removeEventListener('resize', onView);
      vv?.removeEventListener('scroll', onView);
      window.removeEventListener('resize', onView);
    });
  }
}
