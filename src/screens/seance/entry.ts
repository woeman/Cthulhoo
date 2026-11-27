// The way in: a name, and four ways to sit (hold, join, be the table, pass the
// lantern). And the short wait while the surface answers.

import { icon } from '../../ui/art';
import { h } from '../../ui/dom';
import { NAME_MAX } from '../../party/types';
import { SEATS, type SeatState, type TableSeat } from './model';
import { loadName, saveName, SeanceTable } from './parts';
import { Scene, uniq, type Ctx } from './scene';

export type EntryPanel = 'ways' | 'join' | 'table';

export interface EntryInit {
  panel?: EntryPanel;
  sign?: string;
  message?: string;
}

export interface EntryActions {
  hold(name: string): void;
  join(name: string, sign: string): void;
  table(sign: string): void;
  tableNew(): void;
  lantern(name: string): void;
}

/** A shared screen: the house icon line, a screen with a candle on it. */
const TABLE_ICON =
  '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.8" y="4.2" width="18.4" height="12.4" rx="1"/><path d="M8.6 20.2 H15.4 M12 16.6 V20.2"/><path d="M12 7.2 C13.3 8.7 14 9.9 13.9 11.1 C13.8 12.1 13 12.8 12 12.8 C11 12.8 10.2 12.1 10.1 11.1 C10 9.9 10.7 8.7 12 7.2 Z"/></g></svg>';

export const NO_RELAY = 'Séances across phones need the surface relay, which is not set up yet.';
/** A séance's link opened where no relay is set up: say what the link was for, and what can be done here. */
export const NO_RELAY_LINK = 'That link is to a séance across phones, and those cannot be held here yet. Pass the lantern round one phone instead.';

/** Every chair at the table, as the scene wants it: for the table drawn as a crest. */
const allSeats = (state: (mark: number) => SeatState): TableSeat[] => Array.from({ length: SEATS }, (_, m) => ({ id: `chair-${m}`, name: '', mark: m, state: state(m) }));

/** The table as a crest, not a circle anyone sits at: its words are left to the heading. */
function crestTable(cls: string): SeanceTable {
  const t = new SeanceTable(allSeats(() => 'empty'), { cls });
  t.el.setAttribute('aria-hidden', 'true');
  t.describe('');
  return t;
}

export class EntryScene extends Scene {
  readonly key = 'entry';
  private nameInput: HTMLInputElement;
  private nameField: HTMLElement;
  private msg: HTMLElement;
  private panels: Record<EntryPanel, HTMLElement>;
  private joinSign: HTMLInputElement;
  private tableSign: HTMLInputElement;
  private buttons: HTMLButtonElement[] = [];
  private panel: EntryPanel = 'ways';
  private crest!: SeanceTable;

  constructor(
    ctx: Ctx,
    relay: boolean,
    init: EntryInit,
    private actions: EntryActions,
  ) {
    super(ctx);
    const nameId = uniq('sc-name');
    this.nameInput = h('input', {
      class: 'sc-input',
      id: nameId,
      type: 'text',
      name: 'sitter-name',
      maxlength: NAME_MAX,
      autocomplete: 'nickname',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      placeholder: 'What the circle calls you',
    }) as HTMLInputElement;
    this.nameInput.value = loadName();
    this.nameInput.addEventListener('change', () => saveName(this.nameInput.value.trim()));
    this.nameInput.addEventListener('input', () => this.clearError());
    this.nameField = h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: nameId }, 'Your name'), this.nameInput);
    this.msg = h('p', { class: 'sc-msg', hidden: true });

    const way = (kind: string, glyph: string, title: string, line: string, onPick: () => void, opts: { lead?: boolean; off?: boolean } = {}) => {
      const b = h(
        'button',
        { class: `sc-way${opts.lead ? ' is-lead' : ''}`, type: 'button', 'data-way': kind, disabled: !!opts.off },
        h('span', { class: 'sc-way-icon', html: glyph }),
        h('span', { class: 'sc-way-text' }, h('span', { class: 't' }, title), h('span', { class: 'd' }, line)),
        h('span', { class: 'sc-way-go', 'aria-hidden': 'true', html: icon('back') }),
      ) as HTMLButtonElement;
      b.addEventListener('click', () => {
        if (this.isBusy) return;
        this.click();
        onPick();
      });
      this.buttons.push(b);
      return b;
    };

    const hold = way('hold', icon('seance'), 'Hold a séance', 'You light the candles. Friends join with your sign.', () => this.pickHold(), { lead: relay, off: !relay });
    const join = way('join', icon('cult'), 'Join a séance', 'Sit at a friend’s circle with the sign they give you.', () => this.show('join'), { off: !relay });
    const table = way('table', TABLE_ICON, 'Be the table', 'Show the circle on a television or laptop. No name, no answers.', () => this.show('table'), { off: !relay });
    const lantern = way('lantern', icon('streak'), 'Pass the lantern', 'One phone, handed round the room. Two to eight sitters.', () => this.actions.lantern(this.name()), { lead: !relay });
    const ways = h(
      'div',
      { class: 'sc-panel sc-ways', role: 'group', 'aria-label': 'Ways to sit' },
      ...(relay ? [hold, join, table, lantern] : [lantern, hold, join, table]),
      relay ? null : h('p', { class: 'sc-norelay' }, NO_RELAY),
    );

    const joinId = uniq('sc-join-sign');
    this.joinSign = this.signInput(joinId, init.sign ?? '');
    const joinForm = h(
      'form',
      { class: 'sc-panel sc-join', hidden: true, novalidate: true },
      h('h3', { class: 'sc-panel-k', tabindex: '-1' }, 'Join a séance'),
      h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: joinId }, 'The séance’s sign'), this.joinSign),
      h('p', { class: 'sc-panel-note' }, 'The medium has it: a word and one number, like DAGON-7.'),
      h('div', { class: 'sc-row' }, this.submit('Sit down'), this.backBtn()),
    ) as HTMLFormElement;
    joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.isBusy) return;
      this.click();
      this.actions.join(this.name(), this.joinSign.value);
    });

    const tableId = uniq('sc-table-sign');
    this.tableSign = this.signInput(tableId, init.panel === 'table' ? (init.sign ?? '') : '');
    const fresh = h('button', { class: 'btn', type: 'button' }, 'Open a new séance here') as HTMLButtonElement;
    fresh.addEventListener('click', () => {
      if (this.isBusy) return;
      this.click();
      this.actions.tableNew();
    });
    this.buttons.push(fresh);
    const tableForm = h(
      'form',
      { class: 'sc-panel sc-tablejoin', hidden: true, novalidate: true },
      h('h3', { class: 'sc-panel-k', tabindex: '-1' }, 'Be the table'),
      h('p', { class: 'sc-panel-note' }, 'This screen shows the room the sign, the candle and the answers as they surface. It never answers.'),
      h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: tableId }, 'The séance’s sign'), this.tableSign),
      h('div', { class: 'sc-row' }, this.submit('Set the table'), this.backBtn()),
      h('p', { class: 'sc-or' }, h('span', {}, 'No séance yet? Open one here, and the first phone to join lights the candles.')),
      fresh,
    ) as HTMLFormElement;
    tableForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.isBusy) return;
      this.click();
      this.actions.table(this.tableSign.value);
    });

    this.panels = { ways, join: joinForm, table: tableForm };
    this.crest = crestTable('sc-crest-table');
    this.gather();
    const title = this.heading('h2', 'The Séance', 'sc-title');
    const steps = [
      'Each candle asks one question. Seal one true answer before it burns out.',
      'Nobody sees an answer until the candle is out. Then they surface together.',
      'Rarer answers sink deeper. A lone voice sinks half as deep again; a chorus shares its depth.',
      'Whoever is deepest when the last candle is out is the Herald of the Deep.',
    ];
    this.el = h(
      'div',
      { class: 'sc-scene sc-entry' },
      h(
        'header',
        { class: 'sc-crest' },
        this.crest.el,
        title,
        h('p', { class: 'sc-lede' }, 'Sit in a circle and answer by candlelight. The rarest true answer sinks deepest, and one nobody else gives sinks deeper still.'),
      ),
      h('div', { class: 'plate sc-entry-plate' }, this.nameField, this.msg, ways, joinForm, tableForm),
      h('details', { class: 'sc-how' }, h('summary', {}, h('span', {}, 'How a séance goes')), h('ol', { class: 'howto-steps' }, ...steps.map((s) => h('li', {}, h('span', {}, s))))),
    );
    if (init.panel && init.panel !== 'ways') this.show(init.panel, false);
    if (init.message) this.error(init.message);
  }

  /** The circle gathers at the crest's table, one hand after another, clockwise from the top. */
  private gather() {
    const rest = (m: number, n: number): SeatState => (m < n ? 'waiting' : 'empty');
    if (this.ctx.reduced) {
      this.crest.set(allSeats((m) => rest(m, SEATS)), false);
      return;
    }
    for (let n = 1; n <= SEATS; n++) this.later(() => this.crest.set(allSeats((m) => rest(m, n)), false), 260 + n * 140);
  }

  private signInput(id: string, value: string): HTMLInputElement {
    const input = h('input', {
      class: 'sc-input sc-sign-input',
      id,
      type: 'text',
      maxlength: 16,
      autocomplete: 'off',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      placeholder: 'DAGON-7',
    }) as HTMLInputElement;
    input.value = value;
    input.addEventListener('input', () => this.clearError());
    return input;
  }

  private submit(label: string) {
    const b = h('button', { class: 'btn primary', type: 'submit' }, label) as HTMLButtonElement;
    this.buttons.push(b);
    return b;
  }

  private backBtn() {
    const b = h('button', { class: 'btn ghost', type: 'button' }, 'Back') as HTMLButtonElement;
    b.addEventListener('click', () => {
      this.click();
      this.show('ways');
    });
    return b;
  }

  private name(): string {
    const v = this.nameInput.value.trim();
    saveName(v);
    return v;
  }

  private pickHold() {
    this.actions.hold(this.name());
  }

  /** Open one of the panels: the ways, the join form or the table's. */
  show(panel: EntryPanel, focus = true) {
    this.panel = panel;
    this.clearError();
    for (const [k, el] of Object.entries(this.panels)) el.hidden = k !== panel;
    // The table has no name: it only shows the circle.
    this.nameField.hidden = panel === 'table';
    if (!focus) {
      this.focus = panel === 'join' ? this.joinSign : panel === 'table' ? this.tableSign : this.focus;
      return;
    }
    const target = panel === 'join' ? this.joinSign : panel === 'table' ? this.tableSign : this.buttons.find((b) => !b.disabled);
    target?.focus({ preventScroll: true });
  }

  get current(): EntryPanel {
    return this.panel;
  }

  /** Something went wrong: say it under the name, and point at the field to mend. */
  error(message: string, field?: 'name' | 'sign') {
    this.msg.textContent = message;
    this.msg.hidden = !message;
    this.env.shout(message);
    if (field === 'name') {
      if (this.panel === 'table') this.show('ways', false);
      this.nameInput.focus();
      this.nameInput.setAttribute('aria-invalid', 'true');
    } else if (field === 'sign') {
      const input = this.panel === 'table' ? this.tableSign : this.joinSign;
      input.focus();
      input.select();
      input.setAttribute('aria-invalid', 'true');
    }
  }

  private clearError() {
    this.msg.hidden = true;
    this.msg.textContent = '';
    for (const i of [this.nameInput, this.joinSign, this.tableSign]) i.removeAttribute('aria-invalid');
  }

  private get isBusy() {
    return this.el.classList.contains('is-busy');
  }

  /** While the surface is asked: buttons rest, and the one pressed says what is happening. */
  busy(on: boolean) {
    this.el.classList.toggle('is-busy', on);
    this.el.setAttribute('aria-busy', String(on));
    for (const b of this.buttons) b.toggleAttribute('data-busy-off', on);
  }
}

/** While the surface answers. If it takes too long, say so and offer the way back. */
export class CallingScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, sign: string, table: boolean, onBack: () => void, onRetry: () => void) {
    super(ctx);
    this.key = `calling:${sign || 'new'}:${table}`;
    const slow = h('div', { class: 'sc-slow', hidden: true });
    const retry = h('button', { class: 'btn primary', type: 'button' }, 'Call again');
    const back = h('button', { class: 'btn ghost', type: 'button' }, 'Back');
    retry.addEventListener('click', () => {
      this.click();
      onRetry();
    });
    back.addEventListener('click', () => {
      this.click();
      onBack();
    });
    slow.append(h('p', {}, 'The surface does not answer yet. Check your connection, or call again.'), h('div', { class: 'sc-row' }, retry, back));
    const art = crestTable('sc-calling-table');
    if (ctx.reduced) art.set(allSeats(() => 'dim'), false);
    else {
      // A light goes round the table, chair by chair, while the surface is asked.
      let k = 0;
      const go = () => {
        art.set(allSeats((m) => (m === k % SEATS ? 'seated' : m === (k + SEATS - 1) % SEATS ? 'waiting' : 'dim')), false);
        k++;
        this.later(go, 420);
      };
      this.later(go, 120);
    }
    this.el = h(
      'div',
      { class: 'sc-scene sc-calling', role: 'status' },
      art.el,
      this.heading('h2', 'Calling the surface…', 'sc-title sc-calling-title'),
      h('p', { class: 'sc-calling-sign' }, !sign ? 'Opening a new séance' : table ? `Setting the table for ${sign}` : `Sitting down at ${sign}`),
      slow,
    );
    this.later(() => (slow.hidden = false), 12_000);
  }
}
