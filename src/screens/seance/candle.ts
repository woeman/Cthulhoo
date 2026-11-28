// A candle burning: the question rising as the daily's does, the night's candles
// with this one burning down as the clock, the answer line (sealing, not
// speaking), refusals in the daily's voice, and the circle's marks lighting one
// by one as each sitter seals. On the table, the hands light round the glass.

import { filedUnder } from '../../game/packs';
import { pickLine } from '../../game/theme';
import { h, risingWords } from '../../ui/dom';
import type { CandlePrompt, Verdict } from '../../party/types';
import { handSvg } from './art';
import { addTry, answerForm, CandleRow, CircleLine, SeanceTable, sitterStyle, tableSeats, type FormParts } from './parts';
import { Scene, uniq, type Ctx } from './scene';
import type { Seat } from './types';

export interface CandleData {
  prompt: CandlePrompt;
  /** From 0. */
  index: number;
  count: number;
  litAt: number;
  deadline: number;
  /** The circle, to light as they seal; null when one device is passed round. */
  seats: Seat[] | null;
  sealed: string[];
  yours: { answer: string } | null;
  tries: string[];
  /** Pass the lantern: whose turn it is. */
  holder?: { name: string; mark: number };
  sign?: string;
}

export interface CandleActions {
  /** Say an answer to the deep. False when it could not be said (the line is down). */
  speak(text: string): boolean;
  /** The candle went out by itself. */
  out?(): void;
}

/** How long the question takes to rise, word by word (the daily's own timing). */
export const riseMs = (text: string, reduced: boolean) => (reduced ? 0 : 180 + 700 + Math.min(text.split(/\s+/).length, 14) * 70);

function questionBlock(prompt: CandlePrompt, id: string, rulesId: string, cls = 'question') {
  return {
    q: h('h2', { class: cls, id, tabindex: '-1', style: '--rise-lead:180ms' }, risingWords(prompt.text)),
    rules: prompt.rules ? h('p', { class: 'rules', id: rulesId }, prompt.rules) : null,
    flavor: prompt.flavor ? h('p', { class: 'flavor' }, prompt.flavor) : null,
  };
}

export class CandleScene extends Scene {
  readonly key: string;
  private clock: CandleRow;
  private line: CircleLine | null = null;
  private parts: FormParts;
  private slot: HTMLElement;
  private plate: HTMLElement;
  private sealedAs: string | null = null;
  private pending = 0;
  private locked = false;
  private warned = new Set<number>();
  private madCat: HTMLElement | null = null;

  constructor(
    ctx: Ctx,
    key: string,
    private data: CandleData,
    private actions: CandleActions,
  ) {
    super(ctx);
    this.key = key;
    const { prompt, index, count } = data;
    const qid = uniq('sc-q');
    const rid = uniq('sc-rules');
    const { q, rules, flavor } = questionBlock(prompt, qid, rid);
    const filed = filedUnder(this.env.theme, prompt);
    this.parts = answerForm(prompt.rules ? `${qid} ${rid}` : qid, () => this.env.sound?.key?.());
    this.clock = new CandleRow({
      now: () => this.ctx.now(),
      litAt: data.litAt,
      deadline: data.deadline,
      reduced: ctx.reduced,
      count,
      index,
      onSecond: (secs) => this.second(secs),
      onOut: () => this.burntOut(),
    });
    const side = h('div', { class: 'sc-wick-side' });
    if (data.seats) {
      this.line = new CircleLine(data.seats, data.sealed);
      side.append(this.line.el);
    } else if (data.holder) {
      side.append(h('p', { class: 'sc-holder' }, `${data.holder.name} holds the lantern.`), h('p', { class: 'sc-holder-sub' }, 'Nobody else should see the screen.'));
    }
    this.slot = h('div', { class: 'sc-answer-slot' }, this.parts.form);
    this.madCat = filed ? h('p', { class: 'category' }, filed) : null;
    this.plate = h(
      'div',
      { class: 'plate question-plate sc-qplate' },
      h('p', { class: 'kicker' }, `Candle ${index + 1} of ${count}`),
      this.madCat,
      q,
      rules,
      flavor,
      h('div', { class: 'sc-wick' }, this.clock.el, side),
      this.slot,
      this.parts.feedback,
      this.parts.tries,
    );
    for (const t of data.tries) addTry(this.parts.tries, t);
    this.el = h('div', { class: 'sc-scene sc-candle-scene', 'aria-labelledby': qid }, this.plate);
    this.parts.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.bindKeyboard();
    this.stops.push(() => this.clock.stop());
    if (data.yours) {
      this.seal(data.yours.answer, false);
      this.focus = q;
    } else {
      this.focus = this.parts.input;
      this.focusDelay = Math.min(riseMs(prompt.text, ctx.reduced), 900);
    }
    this.clock.start();
    this.later(() => this.mad(this.madCat), 50);
  }

  private submit() {
    if (this.locked || this.sealedAs || this.pending) return;
    const text = this.parts.input.value.trim();
    if (!text) {
      this.parts.input.focus();
      return;
    }
    if (!this.actions.speak(text)) {
      this.note('The line to the surface is lost. Say it again when it comes back.');
      return;
    }
    // Online, the deep answers from the surface: hold the line until it does.
    if (this.data.seats) {
      this.parts.button.setAttribute('aria-busy', 'true');
      this.pending = this.later(() => this.release(), 5000);
    }
  }

  private release() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = 0;
    this.parts.button.removeAttribute('aria-busy');
  }

  /** The deep would not take it: the daily's own words for why. */
  refuse(text: string, verdict: Verdict, reason?: string) {
    this.release();
    if (this.sealedAs || this.gone) return;
    const lines = this.env.theme.refused.lines;
    const line = verdict === 'trap' && reason ? reason : pickLine(verdict === 'decoy' ? lines.decoy : verdict === 'ambiguous' ? lines.ambiguous : lines.unknown, this.data.prompt.id, text);
    const fb = this.parts.feedback;
    fb.textContent = '';
    fb.append(h('span', { class: 'said' }, `${this.env.theme.refused.name}: “${text}”.`), ' ', line);
    this.env.shout(`${this.env.theme.refused.name}: ${text}. ${line}`);
    addTry(this.parts.tries, text);
    this.env.sound?.refuse?.();
    this.env.buzz?.(45);
    const form = this.parts.form;
    form.classList.remove('shake');
    void form.offsetWidth;
    if (!this.ctx.reduced) form.classList.add('shake');
    this.parts.input.value = '';
    if (!this.locked) this.parts.input.focus();
    requestAnimationFrame(() => this.keepInView());
  }

  /** A quiet word under the line that is not a refusal (the line is down, the candle has gone out). */
  note(message: string) {
    this.release();
    const fb = this.parts.feedback;
    fb.textContent = '';
    fb.append(h('span', { class: 'sc-note' }, message));
    this.env.announce(message);
  }

  /** Sealed: the answer stays hidden from the others until the candle is out. */
  seal(answer: string, say = true) {
    if (this.sealedAs) return;
    this.release();
    this.sealedAs = answer;
    const mark = this.data.seats?.find((s) => s.you)?.mark ?? this.data.holder?.mark ?? 0;
    const panel = h(
      'div',
      { class: 'sc-sealed', role: 'status', style: sitterStyle(mark) },
      h('span', { class: 'sc-sealed-hand', html: handSvg() }),
      h('p', { class: 'sc-sealed-line' }, 'Sealed: ', h('q', {}, answer), '.'),
      h('p', { class: 'sc-sealed-sub' }, this.clock.isOut ? 'The candle is out. The answers are surfacing.' : 'It stays sealed until the candle is out.'),
    );
    this.parts.input.blur();
    this.slot.replaceChildren(panel);
    this.parts.feedback.textContent = '';
    if (say) {
      this.env.announce(`Sealed: ${answer}. It stays sealed until the candle is out.`);
      this.env.sound?.click?.();
      this.env.buzz?.(20);
    }
  }

  /** A new view of the same candle: who has sealed, who is here, what the deep refused. */
  update(data: CandleData) {
    this.data = { ...this.data, ...data };
    if (this.line && data.seats) {
      this.line.setSeats(data.seats);
      const fresh = this.line.set(data.sealed);
      const names = fresh.map((id) => data.seats?.find((s) => s.id === id)).filter((s): s is Seat => !!s && !s.you);
      if (names.length) this.env.announce(`${names.map((s) => s.name).join(' and ')} ${names.length === 1 ? 'has' : 'have'} sealed.`);
    }
    for (const t of data.tries) addTry(this.parts.tries, t);
    if (data.yours) this.seal(data.yours.answer);
  }

  private second(secs: number) {
    if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
    if ((secs === 10 || secs === 5) && !this.warned.has(secs) && !this.sealedAs) {
      this.warned.add(secs);
      this.env.announce(secs === 10 ? 'Ten seconds of candle left.' : 'Five seconds left.');
    }
  }

  private burntOut() {
    this.locked = true;
    this.parts.input.disabled = true;
    this.parts.button.disabled = true;
    if (!this.sealedAs) {
      this.slot.replaceChildren(h('div', { class: 'sc-sealed is-out', role: 'status' }, h('p', { class: 'sc-sealed-line' }, 'The candle went out.'), h('p', { class: 'sc-sealed-sub' }, this.data.seats ? 'The answers are surfacing.' : 'Nothing was sealed this time.')));
      this.env.announce('The candle went out.');
      this.env.buzz?.([60, 40, 60]);
    } else {
      const sub = this.slot.querySelector('.sc-sealed-sub');
      if (sub) sub.textContent = 'The candle is out. The answers are surfacing.';
    }
    this.actions.out?.();
  }

  /** Keep the candle, the answer line and any refusal in sight above a phone's keyboard. */
  private keepInView() {
    const input = this.parts.input;
    if (this.gone || document.activeElement !== input) return;
    const screen = this.ctx.screen;
    const view = screen.getBoundingClientRect();
    const below = (el: Element) => el.getBoundingClientRect().bottom + 8 - view.bottom;
    const wickTop = this.clock.el.getBoundingClientRect().top - 6;
    const room = Math.max(0, wickTop - view.top);
    const down = Math.max(below(this.parts.form), this.parts.feedback.textContent ? Math.min(below(this.parts.feedback), room) : 0);
    if (down > 0) screen.scrollTop += down;
    else if (wickTop < view.top) screen.scrollTop -= Math.min(view.top - wickTop, Math.max(0, -below(this.parts.form)));
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

/** The table while a candle burns: the question for the room, the night's candles, and the hands lighting round the glass as each sitter seals. */
export class TableCandleScene extends Scene {
  readonly key: string;
  private clock: CandleRow;
  private table: SeanceTable;
  private count: HTMLElement;
  private seats: Seat[];
  private sealed: string[];

  constructor(ctx: Ctx, key: string, data: CandleData) {
    super(ctx);
    this.key = key;
    this.seats = data.seats ?? [];
    this.sealed = data.sealed;
    const qid = uniq('sc-tq');
    const { q, rules, flavor } = questionBlock(data.prompt, qid, uniq('sc-trules'), 'question sc-tc-q');
    this.focus = q;
    this.table = new SeanceTable(this.chairs(), { names: true, cls: 'is-grand' });
    this.clock = new CandleRow({
      now: () => this.ctx.now(),
      litAt: data.litAt,
      deadline: data.deadline,
      reduced: ctx.reduced,
      count: data.count,
      index: data.index,
      grand: true,
      onSecond: (secs) => {
        if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
        this.table.glass(String(secs), 'secs');
      },
      onOut: () => {
        this.table.glass(null);
        this.table.el.classList.add('is-out');
      },
    });
    this.table.glass(String(this.clock.seconds || Math.round((data.deadline - data.litAt) / 1000)), 'secs');
    this.stops.push(() => this.clock.stop());
    this.count = h('p', { class: 'sc-tc-count' });
    const filed = filedUnder(this.env.theme, data.prompt);
    const catEl = filed ? h('span', { class: 'sc-tc-cat' }, filed) : null;
    this.el = h(
      'div',
      { class: 'sc-scene sc-table-candle', 'aria-labelledby': qid },
      h(
        'header',
        { class: 'sc-tc-head' },
        h('p', { class: 'kicker' }, `Candle ${data.index + 1} of ${data.count}`, catEl ? ' · ' : '', catEl),
        data.sign ? h('p', { class: 'sc-tc-sign' }, 'Join with ', h('b', {}, data.sign)) : null,
      ),
      h('div', { class: 'sc-tc-body' }, h('div', { class: 'sc-tc-question' }, q, rules, flavor, this.clock.el), h('div', { class: 'sc-tc-stage' }, this.table.el, this.count)),
    );
    this.setCount();
    this.clock.start();
    this.later(() => this.mad(catEl), 50);
  }

  /** Each sitter's chair: lit once sealed, waiting while the candle burns, dim if they stepped away. */
  private chairs() {
    const sealed = new Set(this.sealed);
    return tableSeats(this.seats, (s) => (sealed.has(s.id) ? 'sealed' : s.online ? 'waiting' : 'away'));
  }

  private setCount() {
    const n = this.seats.filter((s) => this.sealed.includes(s.id)).length;
    this.count.textContent = n === this.seats.length && n ? 'Every voice is sealed.' : `${n} of ${this.seats.length} ${this.seats.length === 1 ? 'has' : 'have'} sealed`;
  }

  update(data: CandleData) {
    this.seats = data.seats ?? [];
    this.sealed = data.sealed;
    const fresh = this.table.set(this.chairs());
    if (fresh.length) {
      const names = fresh.map((id) => this.seats.find((s) => s.id === id)?.name).filter((n): n is string => !!n);
      if (names.length) this.env.announce(`${names.join(' and ')} ${names.length === 1 ? 'has' : 'have'} sealed.`);
    }
    this.setCount();
  }
}
