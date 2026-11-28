// A diver's side of the Convocation, on their own phone: waiting for the host,
// answering by candlelight (one answer in a classic question, every one they can
// in a blitz), and reading how they and the class did once the answers surface.

import { filedUnder } from '../../game/packs';
import { pickLine } from '../../game/theme';
import type { ClassAnswerRow, ClassView } from '../../party/class-types';
import type { ClassHeard, ClassRefusal } from '../../party/class-link';
import { signSpoken } from '../../party/codes';
import { fmtMetres, h } from '../../ui/dom';
import { handSvg } from '../seance/art';
import { questionBlock, riseMs } from '../seance/candle';
import { sameWords } from '../seance/model';
import { addTry, answerForm, CandleRow, sealEl, signEl, tierName, unsaidList, type FormParts } from '../seance/parts';
import { Scene, uniq, type Ctx } from '../seance/scene';
import { answerList, boutLine, classLine, classStandings, lanternsEl, MODE_COPY, mySide, nth, placeOf, plural, questionOf, tableBoard, tableName, tableRows, tableStyle } from './parts';

/** Where this diver's table stands, in words: "Kraken is 2nd of 4 tables". */
function tableLine(view: ClassView): string | null {
  const t = view.you?.table;
  if (!t || !view.config.tables) return null;
  const rows = tableRows(view);
  const mine = rows.find((r) => r.table === t);
  if (!mine) return null;
  return `${tableName(t)} is ${nth(mine.rank)} of ${rows.length} tables, at ${fmtMetres(mine.total)} m.`;
}

// ------------------------------------------------------------------ the lobby

export interface DiverLobbyActions {
  table(table: number): void;
}

/** Seated and waiting: who you are to the class, your table if there are tables, and how it will be held. */
export class DiverLobbyScene extends Scene {
  readonly key = 'cv-lobby';
  private count: HTMLElement;
  private read: HTMLElement;
  private tables: HTMLElement;
  private view: ClassView;

  constructor(
    ctx: Ctx,
    view: ClassView,
    private actions: DiverLobbyActions,
  ) {
    super(ctx);
    this.view = view;
    const titleId = uniq('cv-lobby');
    this.count = h('p', { class: 'cv-here' });
    this.read = h('p', { class: 'sc-config-read' });
    this.tables = h('section', { class: 'plate cv-pick-table', 'aria-label': 'Your table', hidden: true });
    this.el = h(
      'div',
      { class: 'sc-scene cv-diver-lobby', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'sc-sign-block cv-seated' },
        h('p', { class: 'kicker' }, 'You are in'),
        this.heading('h2', view.you?.name ?? 'Seated', 'cv-seated-name', titleId),
        signEl(view.sign, signSpoken(view.sign), 'sc-sign cv-seated-sign'),
        this.count,
      ),
      this.tables,
      h('div', { class: 'sc-wait' }, h('p', { class: 'sc-wait-line' }, view.n ? 'Watch the big screen. The host will ask the next question.' : 'Watch the big screen. The host will ask the first question.'), this.read),
    );
    this.update(view);
  }

  update(view: ClassView) {
    const tablesWere = this.view.config.tables;
    this.view = view;
    this.count.textContent = view.seats <= 1 ? 'You are the first to sit down.' : `${plural(view.seats, 'diver')} seated.`;
    this.read.textContent = `${classLine(view.config)}. ${MODE_COPY[view.config.mode].how}`;
    const n = view.config.tables;
    this.tables.hidden = !n;
    if (!n) return;
    const mine = view.you?.table ?? 0;
    const row = h('div', { class: 'cv-table-opts', role: 'group', 'aria-label': 'Move to another table' });
    for (let t = 1; t <= n; t++) {
      const b = h(
        'button',
        { class: `cv-table-opt${t === mine ? ' is-mine' : ''}`, type: 'button', style: tableStyle(t), 'aria-pressed': String(t === mine) },
        h('span', { class: 'cv-table-opt-n' }, tableName(t)),
        h('span', { class: 'cv-table-opt-c' }, plural(view.tableSeats?.[t] ?? 0, 'diver')),
      );
      b.addEventListener('click', () => {
        if (t === this.view.you?.table) return;
        this.click();
        this.actions.table(t);
      });
      row.append(b);
    }
    const focused = this.tables.contains(document.activeElement) ? [...this.tables.querySelectorAll('button')].indexOf(document.activeElement as HTMLButtonElement) : -1;
    this.tables.replaceChildren(h('h3', { class: 'sc-h' }, 'Your table ', h('span', { class: 'sc-count', style: tableStyle(mine) }, tableName(mine))), row, h('p', { class: 'cv-table-note' }, `Sit with your friends: tap a table to move to it. ${view.config.mode === 'last' ? 'Your table takes its turns together, and anyone at it may answer.' : 'A table wins its deepest different answers.'}`));
    if (focused >= 0) (row.children[focused] as HTMLElement | undefined)?.focus({ preventScroll: true });
    if (tablesWere !== n || (mine && mine !== this.told)) {
      this.told = mine;
      this.env.announce(`You are at table ${tableName(mine)}.`);
    }
  }

  private told = 0;
}

// ------------------------------------------------------------------ a question burning

export interface DiverAskActions {
  /** Say an answer to the deep. False when it could not be said (the line is down). */
  say(text: string): boolean;
}

export class DiverAskScene extends Scene {
  readonly key: string;
  private clock: CandleRow;
  private parts: FormParts;
  private slot: HTMLElement;
  private count: HTMLElement;
  private mine: HTMLElement;
  private tally: HTMLElement;
  private sealed: string[] = [];
  private pending = 0;
  private locked = false;
  private warned = new Set<number>();
  private blitz: boolean;
  private view: ClassView;

  constructor(
    ctx: Ctx,
    key: string,
    view: ClassView,
    private actions: DiverAskActions,
  ) {
    super(ctx);
    this.key = key;
    this.view = view;
    this.blitz = view.config.mode === 'blitz';
    const prompt = view.prompt!;
    const qid = uniq('cv-q');
    const rid = uniq('cv-rules');
    const { q, rules, flavor } = questionBlock(prompt, qid, rid);
    const filed = filedUnder(this.env.theme, prompt);
    this.parts = answerForm(prompt.rules ? `${qid} ${rid}` : qid, () => this.env.sound?.key?.());
    if (this.blitz) {
      this.parts.input.placeholder = 'Another name…';
      this.parts.input.setAttribute('enterkeyhint', 'send');
    }
    this.clock = new CandleRow({
      now: () => this.ctx.now(),
      litAt: view.litAt,
      deadline: view.deadline,
      reduced: ctx.reduced,
      count: Math.max(view.n, view.config.questions),
      index: view.n - 1,
      onSecond: (secs) => this.second(secs),
      onOut: () => this.burntOut(),
    });
    this.count = h('p', { class: 'cv-in' });
    this.tally = h('p', { class: 'cv-tally', hidden: true });
    this.mine = h('ul', { class: 'cv-mine', 'aria-label': 'Your sealed answers' });
    this.slot = h('div', { class: 'sc-answer-slot' }, this.parts.form);
    const madCat = filed ? h('p', { class: 'category' }, filed) : null;
    const plate = h(
      'div',
      { class: 'plate question-plate sc-qplate' },
      h('p', { class: 'kicker' }, `${questionOf(view)}${this.blitz ? ' · Blitz' : ''}`),
      madCat,
      q,
      rules,
      flavor,
      h('div', { class: 'sc-wick' }, this.clock.el, h('div', { class: 'sc-wick-side' }, this.count)),
      this.slot,
      this.parts.feedback,
      this.blitz ? h('div', { class: 'cv-mine-wrap' }, this.tally, this.mine) : null,
      this.parts.tries,
    );
    this.el = h('div', { class: `sc-scene sc-candle-scene cv-ask${this.blitz ? ' is-blitz' : ''}`, 'aria-labelledby': qid }, plate);
    this.parts.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.bindKeyboard();
    this.stops.push(() => this.clock.stop());
    for (const t of view.you?.tries ?? []) addTry(this.parts.tries, t);
    const had = view.you?.sealed ?? [];
    for (const s of had) this.seal(s.input, s.answer, false);
    if (had.length && !this.blitz) this.focus = q;
    else {
      this.focus = this.parts.input;
      this.focusDelay = Math.min(riseMs(prompt.text, ctx.reduced), 900);
    }
    this.clock.start();
    this.later(() => this.mad(madCat), 50);
    this.update(view);
  }

  private submit() {
    if (this.locked || this.pending || (!this.blitz && this.sealed.length)) return;
    const text = this.parts.input.value.trim();
    if (!text) {
      this.parts.input.focus();
      return;
    }
    if (!this.actions.say(text)) {
      this.note('The line to the surface is lost. Say it again when it comes back.');
      return;
    }
    // The deep answers from the surface: hold the line until it does.
    this.parts.button.setAttribute('aria-busy', 'true');
    this.pending = this.later(() => this.release(), 5000);
  }

  private release() {
    if (this.pending) clearTimeout(this.pending);
    this.pending = 0;
    this.parts.button.removeAttribute('aria-busy');
  }

  /** The deep took it. */
  heard(hd: ClassHeard) {
    this.release();
    if (this.gone) return;
    this.seal(hd.input, hd.answer, true);
  }

  /** The deep would not take it: the daily's own words for why. */
  refuse(r: ClassRefusal) {
    this.release();
    if (this.gone || (!this.blitz && this.sealed.length)) return;
    const fb = this.parts.feedback;
    fb.textContent = '';
    if (r.verdict === 'said') {
      const words = r.reason ?? 'You have already given that one.';
      fb.append(h('span', { class: 'sc-note' }, words));
      this.env.announce(words);
    } else {
      const lines = this.env.theme.refused.lines;
      const line = r.verdict === 'trap' && r.reason ? r.reason : pickLine(r.verdict === 'decoy' ? lines.decoy : r.verdict === 'ambiguous' ? lines.ambiguous : lines.unknown, this.view.prompt?.id ?? '', r.text);
      fb.append(h('span', { class: 'said' }, `${this.env.theme.refused.name}: “${r.text}”.`), ' ', line);
      this.env.shout(`${this.env.theme.refused.name}: ${r.text}. ${line}`);
      addTry(this.parts.tries, r.text);
      this.env.sound?.refuse?.();
      this.env.buzz?.(45);
      const form = this.parts.form;
      form.classList.remove('shake');
      void form.offsetWidth;
      if (!this.ctx.reduced) form.classList.add('shake');
    }
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

  private seal(input: string, answer: string, say: boolean) {
    if (this.sealed.includes(answer)) return;
    this.sealed.push(answer);
    const style = this.view.you?.table ? tableStyle(this.view.you.table) : '--sitter: var(--color-glow)';
    if (!this.blitz) {
      const panel = h(
        'div',
        { class: 'sc-sealed', role: 'status', style },
        h('span', { class: 'sc-sealed-hand', html: handSvg() }),
        h('p', { class: 'sc-sealed-line' }, 'Sealed: ', h('q', {}, answer), '.'),
        h('p', { class: 'sc-sealed-sub' }, this.clock.isOut ? 'The candle is out. The answers are surfacing.' : 'It stays sealed until the candle is out.'),
      );
      this.parts.input.blur();
      this.slot.replaceChildren(panel);
      this.parts.feedback.textContent = '';
      if (say) this.env.announce(`Sealed: ${answer}. It stays sealed until the candle is out.`);
    } else {
      this.mine.prepend(h('li', { class: 'cv-mine-a' }, answer));
      this.tally.hidden = false;
      this.tally.textContent = `${plural(this.sealed.length, 'answer')} sealed`;
      const fb = this.parts.feedback;
      fb.textContent = '';
      fb.append(h('span', { class: 'cv-took' }, 'Sealed: ', h('q', {}, answer), sameWords(input, answer) ? '.' : `, from “${input}”.`));
      this.parts.input.value = '';
      if (say) {
        this.env.announce(`Sealed: ${answer}. ${plural(this.sealed.length, 'answer')} so far.`);
        if (!this.locked) this.parts.input.focus();
      }
    }
    if (say) {
      this.env.sound?.click?.();
      this.env.buzz?.(20);
    }
  }

  /** The class as it answers, and anything of this diver's sealed on another of their screens. */
  update(view: ClassView) {
    this.view = view;
    this.count.textContent = this.blitz ? `${plural(view.said, 'answer')} from the class` : `${view.answered} of ${Math.max(view.here, view.answered)} have answered`;
    for (const s of view.you?.sealed ?? []) this.seal(s.input, s.answer, false);
    for (const t of view.you?.tries ?? []) addTry(this.parts.tries, t);
  }

  private second(secs: number) {
    if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
    if ((secs === 10 || secs === 5) && !this.warned.has(secs) && (this.blitz || !this.sealed.length)) {
      this.warned.add(secs);
      this.env.announce(secs === 10 ? 'Ten seconds of candle left.' : 'Five seconds left.');
    }
  }

  private burntOut() {
    this.locked = true;
    this.release();
    this.parts.input.disabled = true;
    this.parts.button.disabled = true;
    if (this.blitz) {
      const n = this.sealed.length;
      this.slot.replaceChildren(h('div', { class: 'sc-sealed is-out', role: 'status' }, h('p', { class: 'sc-sealed-line' }, 'The candle is out.'), h('p', { class: 'sc-sealed-sub' }, n ? `You sealed ${plural(n, 'answer')}. They are surfacing.` : 'Nothing was sealed this time.')));
      this.parts.feedback.textContent = '';
      this.env.announce(`The candle is out. You sealed ${plural(n, 'answer')}.`);
      this.env.buzz?.([60, 40, 60]);
    } else if (!this.sealed.length) {
      this.slot.replaceChildren(h('div', { class: 'sc-sealed is-out', role: 'status' }, h('p', { class: 'sc-sealed-line' }, 'The candle went out.'), h('p', { class: 'sc-sealed-sub' }, 'The answers are surfacing.')));
      this.env.announce('The candle went out.');
      this.env.buzz?.([60, 40, 60]);
    } else {
      const sub = this.slot.querySelector('.sc-sealed-sub');
      if (sub) sub.textContent = 'The candle is out. The answers are surfacing.';
    }
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

// ------------------------------------------------------------------ the answers surface

/** One of this diver's own answers, once revealed: what they said, how rare, how many said it, how deep. */
function myAnswer(theme: Ctx['env']['theme'], a: { input: string; answer: string; tier: number; voices: number; depth: number }, bout = false): HTMLElement {
  return h(
    'li',
    { class: `cv-answer${a.voices === 1 && !bout ? ' is-lone' : ''}`, 'data-tier': String(a.tier), style: `--tier-color: var(--color-tier-${a.tier})` },
    sealEl(a.tier, 'seal cv-answer-seal'),
    h('span', { class: 'cv-answer-a' }, a.answer, a.input && !sameWords(a.input, a.answer) ? h('span', { class: 'cv-answer-from' }, ` from “${a.input}”`) : null),
    h('span', { class: 'cv-answer-t' }, tierName(theme, a.tier)),
    // In a bout every answer is named once, so there is no chorus to count.
    h('span', { class: 'cv-answer-who' }, bout ? '' : a.voices === 1 ? 'a lone voice' : `${a.voices} voices`),
    h('span', { class: 'cv-answer-d' }, `+${fmtMetres(a.depth)}`, h('span', { class: 'u' }, ' m')),
  );
}

/** Where this diver stands in the class, as a sentence. */
function placeLine(view: ClassView): string {
  const you = view.you;
  if (!you) return '';
  return `You are ${placeOf(you.rank, view.seats)}, at ${fmtMetres(you.total)} m.`;
}

/** The deepest few, with this diver's own row added below when they are not among them. */
function deepestBoard(view: ClassView, gains: boolean, marks?: (id: string) => HTMLElement | null): HTMLElement {
  const rows = [...(view.standings ?? [])];
  const you = view.you;
  if (you && !rows.some((r) => r.id === you.id)) rows.push({ id: you.id, name: you.name, table: you.table, total: you.total, gain: you.outcome?.gain ?? 0, rank: you.rank });
  return classStandings(rows, { you: you?.id, gains, tables: !!view.config.tables, ...(marks ? { marks } : {}) });
}

export class DiverRevealScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, key: string, view: ClassView) {
    super(ctx);
    this.key = key;
    const theme = this.env.theme;
    const result = view.result;
    const out = view.you?.outcome;
    const titleId = uniq('cv-reveal');
    // A bout of last diver standing: who stood last, and whether that was this diver's side.
    const bout = result?.last;
    const tables = !!view.config.tables;
    const side = bout ? mySide(view, bout.sides) : -1;
    const stood = !!bout && bout.winner >= 0 && bout.winner === side;
    const won = bout ? (stood ? (tables ? 'Your table is the last standing' : 'You are the last diver standing') : boutLine(bout, tables)) : '';
    const mine = h('section', { class: 'plate cv-yours', 'aria-label': bout ? 'What you named' : 'Your answer' });
    const gave = out?.answers ?? [];
    const gained = h('span', { class: 'sc-count cv-gain' }, `+${fmtMetres(out?.gain ?? 0)} m`);
    if (!gave.length) {
      mine.append(h('p', { class: 'cv-yours-none' }, bout ? (stood && !tables ? 'You named nothing, and still stood last.' : 'You named nothing in this bout.') : 'The candle went out before you sealed an answer.'));
      if (bout && out?.gain) mine.prepend(h('h3', { class: 'sc-h' }, 'For standing last', gained));
    } else {
      const best = [...gave].sort((a, b) => b.depth - a.depth);
      mine.append(
        h('h3', { class: 'sc-h' }, bout ? (gave.length === 1 ? 'You named' : `You named ${gave.length}`) : gave.length === 1 ? 'Your answer' : `Your ${gave.length} answers`, gained),
        h('ul', { class: 'cv-answers is-mine' }, ...best.slice(0, 12).map((a) => myAnswer(theme, a, !!bout))),
      );
      if (best.length > 12) mine.append(h('p', { class: 'cv-answer-more' }, `and ${plural(best.length - 12, 'more')}`));
      if (bout && stood && !tables) mine.append(h('p', { class: 'cv-answer-more' }, `and ${fmtMetres(bout.bonus)} m for standing last`));
    }
    const place = h('p', { class: 'cv-place' }, placeLine(view));
    const tline = tableLine(view);
    const rows: ClassAnswerRow[] = result?.answers ?? [];
    const lit = (pick: (s: NonNullable<typeof bout>['sides'][number]) => boolean) => {
      const at = bout?.sides.find(pick);
      return bout && at ? lanternsEl(at.lanterns, bout.lanterns, 'cv-board-lanterns') : null;
    };
    const parts: Array<HTMLElement | null> = [
      h(
        'header',
        { class: 'sc-reveal-head' },
        h('p', { class: 'kicker' }, `${questionOf(view)} · ${bout ? 'the bout is over' : 'the answers surface'}`),
        this.heading('h2', result?.prompt.text ?? view.prompt?.text ?? '', 'sc-reveal-q cv-reveal-q', titleId),
        bout ? h('p', { class: `cv-hr-won${stood ? ' is-yours' : ''}` }, `${won}.`, stood && tables ? h('span', { class: 'cv-hr-bonus' }, ` +${fmtMetres(bout.bonus)} m for the table`) : null) : null,
      ),
      mine,
      h('div', { class: 'cv-place-block' }, place, tline ? h('p', { class: 'cv-place-table' }, tline) : null),
      rows.length
        ? h(
            'section',
            { class: 'plate cv-said', 'aria-label': bout ? 'What was named' : 'What the class said' },
            h('h3', { class: 'sc-h' }, bout ? 'What was named' : 'What the class said', h('span', { class: 'sc-count' }, bout ? plural(result?.given ?? rows.length, 'answer') : plural(result?.given ?? rows.length, 'different answer'))),
            answerList(theme, rows, { given: result?.given, bout: !!bout }),
          )
        : null,
      result?.unsaid.length ? h('section', { class: 'sc-unsaid' }, h('h3', { class: 'sc-h sc-unsaid-k' }, 'What the deep knew'), h('p', { class: 'sc-unsaid-sub' }, bout ? 'The rarest answers nobody named.' : 'The rarest answers nobody gave.'), unsaidList(theme, result.unsaid)) : null,
      tables ? h('section', { class: 'plate cv-board', 'aria-label': 'The tables' }, h('h3', { class: 'sc-h' }, 'The tables'), tableBoard(tableRows(view, result?.tables), { you: view.you?.table, gains: true, ...(bout ? { marks: (t: number) => lit((s) => s.table === t) } : {}) })) : null,
      h('section', { class: 'plate cv-board', 'aria-label': 'The deepest divers' }, h('h3', { class: 'sc-h' }, 'The deepest'), deepestBoard(view, true, bout && !tables ? (id: string) => lit((s) => s.id === id) : undefined)),
      h('div', { class: 'sc-wait' }, h('p', { class: 'sc-wait-line' }, 'Watch the big screen. The host asks the next question.')),
    ];
    this.el = h('div', { class: `sc-scene cv-reveal${bout ? ' is-bout' : ''}`, 'aria-labelledby': titleId }, ...parts);
    const gain = out?.gain ?? 0;
    this.env.announce(`${bout ? `The bout is over. ${won}. ` : ''}${gave.length || gain ? `You sank ${fmtMetres(gain)} metres.` : bout ? 'You named nothing.' : 'You sealed nothing.'} ${placeLine(view)}`);
    if (gain > 0) this.later(() => this.env.sound?.accept?.(Math.max(1, ...gave.map((a) => a.tier))), 300);
    this.ctx.sink(view.you?.total ?? 0);
  }
}

// ------------------------------------------------------------------ the end

export interface DiverEndActions {
  leave(): void;
}

export class DiverEndScene extends Scene {
  readonly key = 'cv-end';

  constructor(ctx: Ctx, view: ClassView, actions: DiverEndActions) {
    super(ctx);
    const titleId = uniq('cv-end');
    const you = view.you;
    const first = (view.standings ?? []).filter((s) => s.rank === 1 && s.total > 0);
    const won = !!you && first.some((s) => s.id === you.id);
    const leave = h('button', { class: 'btn ghost', type: 'button' }, 'Leave the class');
    leave.addEventListener('click', () => {
      this.click();
      actions.leave();
    });
    const tline = tableLine(view);
    this.el = h(
      'div',
      { class: 'sc-scene cv-end', 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'sc-reveal-head cv-end-head' },
        h('p', { class: 'kicker' }, 'The class has surfaced'),
        this.heading('h2', won ? 'You are the Herald of the Deep' : you ? `You finished ${placeOf(you.rank, view.seats)}` : 'The class is over', 'cv-end-title', titleId),
        you ? h('p', { class: 'cv-end-depth' }, fmtMetres(you.total), h('span', { class: 'u' }, ' m')) : null,
        tline ? h('p', { class: 'cv-place-table' }, tline) : null,
      ),
      view.config.tables ? h('section', { class: 'plate cv-board', 'aria-label': 'The tables' }, h('h3', { class: 'sc-h' }, 'The tables'), tableBoard(tableRows(view), { you: you?.table })) : null,
      h('section', { class: 'plate cv-board', 'aria-label': 'The deepest divers' }, h('h3', { class: 'sc-h' }, 'The deepest'), deepestBoard(view, false)),
      h('div', { class: 'sc-actions' }, h('p', { class: 'sc-hint' }, 'Stay seated if the host holds another round.'), leave),
    );
    this.env.announce(you ? `The class has surfaced. You finished ${placeOf(you.rank, view.seats)}, at ${fmtMetres(you.total)} metres.` : 'The class has surfaced.');
    this.ctx.sink(you?.total ?? 0);
  }
}
