// Pass the lantern: one device handed round the circle, at the same table (seats
// one to eight). The setup, the hand-off (nothing of the last answer left in
// sight, the holder's hand lit and their name in the glass), and the sealed
// screen to hide.

import { icon } from '../../ui/art';
import { h } from '../../ui/dom';
import { PASS_MAX, PASS_MIN, orderFor, type PassState } from '../../party/passplay';
import { CANDLE_CHOICES, NAME_MAX, SECONDS_CHOICES } from '../../party/types';
import { candleSvg, handSvg } from './art';
import { topicPicker, type TopicPicker } from '../../ui/topics';
import { cardinal, capitalise, ordinal, type SeatState } from './model';
import { choiceRow, markEl, SeanceTable, sitterStyle, tableSeats } from './parts';
import type { Seat } from './types';

/** A pass-and-play sitter as the table seats them. */
const asSeats = (state: PassState): Seat[] => state.sitters.map((s) => ({ id: s.id, name: s.name, mark: s.mark, online: true, you: false, medium: false }));
import { Scene, uniq, type Ctx } from './scene';

export interface SetupActions {
  /** Returns why the circle will not take them, or null. */
  add(name: string): string | null;
  remove(id: string): void;
  config(candles: number, seconds: number): void;
  begin(): void;
}

export class LanternSetupScene extends Scene {
  readonly key = 'l-setup';
  private list: HTMLElement;
  private count: HTMLElement;
  private msg: HTMLElement;
  private input: HTMLInputElement;
  private addBtn: HTMLButtonElement;
  private begin: HTMLButtonElement;
  private hint: HTMLElement;
  private candles: ReturnType<typeof choiceRow>;
  private seconds: ReturnType<typeof choiceRow>;
  private state: PassState;
  private table: SeanceTable;
  private picker?: TopicPicker;

  constructor(
    ctx: Ctx,
    state: PassState,
    private actions: SetupActions,
  ) {
    super(ctx);
    this.state = state;
    const topics = this.env.topics;
    if (topics) {
      this.picker = topicPicker({ topics: topics.daily(), choice: topics.load(), legend: 'Ask about', onTick: () => this.env.sound?.key?.(), onChange: (choice) => topics.save(choice) });
      let live = true;
      this.stops.push(() => (live = false));
      void topics.all().then((all) => live && this.picker?.setTopics(all));
    }
    const titleId = uniq('sc-lsetup');
    const inputId = uniq('sc-add');
    this.list = h('ul', { class: 'sc-sitters sc-lantern-list' });
    this.count = h('span', { class: 'sc-count' });
    this.msg = h('p', { class: 'sc-msg', hidden: true });
    this.input = h('input', {
      class: 'sc-input',
      id: inputId,
      type: 'text',
      maxlength: NAME_MAX,
      autocomplete: 'off',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      placeholder: 'A sitter’s name',
    }) as HTMLInputElement;
    this.input.addEventListener('input', () => (this.msg.hidden = true));
    this.addBtn = h('button', { class: 'btn', type: 'submit' }, 'Add') as HTMLButtonElement;
    const form = h('form', { class: 'sc-add', novalidate: true }, h('label', { class: 'visually-hidden', for: inputId }, 'Add a sitter'), this.input, this.addBtn);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.click();
      const why = this.actions.add(this.input.value);
      if (why) {
        this.msg.textContent = why;
        this.msg.hidden = false;
        this.env.shout(why);
      } else {
        this.env.announce(`${this.input.value.trim()} sits down.`);
        this.input.value = '';
      }
      this.input.focus();
    });
    this.candles = choiceRow('Candles', 'lcandles', CANDLE_CHOICES, state.config.candles, () => 'candles', (n) => this.pick(n, this.state.config.seconds));
    this.seconds = choiceRow('Each burns for', 'lseconds', SECONDS_CHOICES, state.config.seconds, () => 'seconds', (n) => this.pick(this.state.config.candles, n));
    this.begin = h('button', { class: 'btn primary sc-begin', type: 'button' }, 'Begin') as HTMLButtonElement;
    this.begin.addEventListener('click', () => {
      if (this.begin.getAttribute('aria-disabled') === 'true') {
        this.input.focus();
        return;
      }
      this.click();
      this.actions.begin();
    });
    this.hint = h('p', { class: 'sc-hint' });
    this.table = new SeanceTable(tableSeats(asSeats(state), () => 'seated'), { cls: 'sc-setup-table' });
    this.el = h(
      'div',
      { class: 'sc-scene sc-lantern-setup', 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'sc-crest is-small' },
        this.table.el,
        this.heading('h2', 'Pass the lantern', 'sc-title', titleId),
        h('p', { class: 'sc-lede' }, 'One phone, handed round. Each sitter answers alone with the lantern, and then the answers surface together.'),
      ),
      h('section', { class: 'plate sc-circle', 'aria-label': 'The circle' }, h('h3', { class: 'sc-h' }, 'The circle ', this.count), this.list, form, this.msg),
      h('section', { class: 'plate sc-config', 'aria-label': 'How the séance is held' }, h('h3', { class: 'sc-h' }, 'The candles'), this.candles.el, this.seconds.el),
      this.picker ? h('section', { class: 'plate sc-config sc-topics', 'aria-label': 'What the séance asks about' }, h('h3', { class: 'sc-h' }, 'The questions'), this.picker.el) : null,
      h('div', { class: 'sc-actions' }, this.begin, this.hint),
    );
    this.update(state);
    if (state.sitters.length < PASS_MIN) this.focus = this.input;
  }

  /** The topics ticked: empty for the whole daily deep. */
  choice(): string[] {
    return this.picker?.choice() ?? [];
  }

  /** The questions could not be had: say why. */
  fail(message: string) {
    this.hint.textContent = message;
  }

  private pick(candles: number, seconds: number) {
    this.click();
    this.actions.config(candles, seconds);
  }

  update(state: PassState) {
    this.state = state;
    this.table.set(tableSeats(asSeats(state), () => 'seated'), false);
    this.list.textContent = '';
    for (const s of state.sitters) {
      const rm = h('button', { class: 'icon-btn sc-remove', type: 'button', 'aria-label': `Remove ${s.name}`, title: `Remove ${s.name}`, html: icon('close') });
      rm.addEventListener('click', () => {
        this.click();
        this.actions.remove(s.id);
        this.env.announce(`${s.name} leaves the circle.`);
        this.input.focus();
      });
      this.list.append(h('li', { class: 'sc-sitter' }, markEl(s.mark), h('span', { class: 'sc-sitter-name' }, s.name), rm));
    }
    if (!state.sitters.length) this.list.append(h('li', { class: 'sc-sitter is-empty' }, 'Nobody is sitting yet. Add each name in turn.'));
    this.count.textContent = `${state.sitters.length} of ${PASS_MAX}`;
    const full = state.sitters.length >= PASS_MAX;
    this.input.disabled = full;
    this.addBtn.disabled = full;
    this.input.placeholder = full ? 'The circle is full' : 'A sitter’s name';
    this.candles.set(state.config.candles);
    this.seconds.set(state.config.seconds);
    const ready = state.sitters.length >= PASS_MIN;
    this.begin.setAttribute('aria-disabled', String(!ready));
    this.hint.textContent = ready
      ? `${capitalise(cardinal(state.config.candles))} candles of ${state.config.seconds} seconds. The lantern starts with ${state.sitters[0].name}.`
      : `A séance needs ${cardinal(PASS_MIN)} sitters at least.`;
  }
}

/** The lantern changes hands: whose turn, and a large button they press when they hold it. */
export class HandoffScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, key: string, state: PassState, onTake: () => void) {
    super(ctx);
    this.key = key;
    const order = orderFor(state);
    const who = order[state.turn];
    const titleId = uniq('sc-handoff');
    const take = h('button', { class: 'btn primary sc-iam', type: 'button', style: sitterStyle(who?.mark ?? 0) }, markEl(who?.mark ?? 0), h('span', {}, `I am ${who?.name ?? 'here'}`)) as HTMLButtonElement;
    take.addEventListener('click', () => {
      if (take.disabled) return;
      take.disabled = true;
      this.click();
      onTake();
    });
    const turns = h(
      'ol',
      { class: 'sc-turns', 'aria-label': 'The lantern’s way round this candle' },
      ...order.map((s, i) =>
        h(
          'li',
          { class: `sc-turn${i < state.turn ? ' is-done' : ''}${i === state.turn ? ' is-now' : ''}`, style: sitterStyle(s.mark) },
          markEl(s.mark),
          h('span', { class: 'n' }, s.name),
          h('span', { class: 'visually-hidden' }, i < state.turn ? ', has answered' : i === state.turn ? ', holds the lantern next' : ', still to come'),
        ),
      ),
    );
    this.focus = take;
    const done = new Set(order.slice(0, state.turn).map((s) => s.id));
    const table = new SeanceTable(
      tableSeats(asSeats(state), (s): SeatState => (s.id === who?.id ? 'lit' : done.has(s.id) ? 'sealed' : 'dim')),
      { cls: 'sc-handoff-table' },
    );
    table.glass(who?.name ?? null, 'name');
    table.describe(`The lantern goes to ${who?.name ?? 'the next sitter'}.`);
    this.el = h(
      'div',
      { class: 'sc-scene sc-handoff', 'aria-labelledby': titleId },
      h('p', { class: 'kicker' }, `Candle ${state.candle + 1} of ${state.promptIds.length}`),
      table.el,
      h('h2', { class: 'sc-handoff-to', id: titleId, tabindex: '-1' }, 'Pass the lantern to ', h('span', { class: 'sc-handoff-name', style: sitterStyle(who?.mark ?? 0) }, who?.name ?? 'the next sitter')),
      take,
      h('p', { class: 'sc-handoff-note' }, `${who?.name ?? 'They'} answers ${ordinal(state.turn + 1)} of ${cardinal(order.length)}. The candle catches as the question rises.`),
      turns,
    );
    this.env.announce(`Pass the lantern to ${who?.name ?? 'the next sitter'}.`);
  }
}

/** Sealed, or burnt out: hide the screen and hand it on. */
export class LanternSealedScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, key: string, state: PassState, sealed: boolean, onPass: () => void) {
    super(ctx);
    this.key = key;
    const order = orderFor(state);
    const who = order[state.turn];
    const last = state.turn + 1 >= order.length;
    const titleId = uniq('sc-lsealed');
    const pass = h('button', { class: 'btn primary', type: 'button' }, last ? 'Let the answers surface' : 'Pass the lantern on') as HTMLButtonElement;
    pass.addEventListener('click', () => {
      if (pass.disabled) return;
      pass.disabled = true;
      this.click();
      onPass();
    });
    this.focus = pass;
    this.el = h(
      'div',
      { class: `sc-scene sc-lantern-sealed${sealed ? '' : ' is-out'}`, 'aria-labelledby': titleId, style: sitterStyle(who?.mark ?? 0) },
      sealed ? h('span', { class: 'sc-sealed-hand is-large', html: handSvg() }) : h('span', { class: 'sc-spent', html: candleSvg() }),
      h('h2', { class: 'sc-title', id: titleId, tabindex: '-1' }, sealed ? 'Sealed.' : 'The candle went out.'),
      h('p', { class: 'sc-lede' }, last ? 'Hide the screen, and gather round: the answers are ready to surface.' : 'Hide the screen and pass the lantern on.'),
      pass,
    );
    this.env.announce(`${sealed ? 'Sealed.' : 'The candle went out.'} ${last ? 'Gather round: the answers are ready to surface.' : 'Hide the screen and pass the lantern on.'}`);
  }
}
