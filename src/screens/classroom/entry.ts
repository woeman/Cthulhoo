// The way into the Convocation: hold a class on the big screen, or join one
// from a phone with the sign the big screen shows. And the moment of calling
// the surface while either is arranged.

import { NAME_MAX } from '../../party/types';
import { icon } from '../../ui/art';
import { h } from '../../ui/dom';
import { allSeats, crestTable } from '../seance/entry';
import { SEATS, type SeatState } from '../seance/model';
import { loadName, saveName } from '../seance/parts';
import { Scene, uniq, type Ctx } from '../seance/scene';

export type ClassPanel = 'ways' | 'join';

export interface ClassEntryInit {
  panel?: ClassPanel;
  sign?: string;
  message?: string;
  /** Classes are kept on this device: their results are offered. */
  past?: boolean;
}

export interface ClassEntryActions {
  hold(): void;
  join(name: string, sign: string): void;
  /** The host's own question sets, and what past classes came to: both live on this device and need no relay. */
  sets(): void;
  past(): void;
}

export const NO_CLASS_RELAY = 'A class is held across phones through the surface relay, which is not set up here yet.';
export const BAD_CLASS_SIGN = 'That is not a class’s sign. It looks like DAGON-247: a word and three numbers.';

export class ClassEntryScene extends Scene {
  readonly key = 'cv-entry';
  private nameInput: HTMLInputElement;
  private signInput: HTMLInputElement;
  private msg: HTMLElement;
  private ways: HTMLElement;
  private joinForm: HTMLFormElement;
  private buttons: HTMLButtonElement[] = [];
  private panel: ClassPanel = 'ways';

  constructor(
    ctx: Ctx,
    relay: boolean,
    init: ClassEntryInit,
    private actions: ClassEntryActions,
  ) {
    super(ctx);
    this.msg = h('p', { class: 'sc-msg', hidden: true });
    const way = (kind: string, glyph: string, title: string, line: string, onPick: () => void, lead = false, needsRelay = true) => {
      const b = h(
        'button',
        { class: `sc-way${lead ? ' is-lead' : ''}`, type: 'button', 'data-way': kind, disabled: needsRelay && !relay },
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
    this.ways = h(
      'div',
      { class: 'sc-panel sc-ways', role: 'group', 'aria-label': 'Ways into a class' },
      way('hold', icon('seance'), 'Hold a class', 'This screen goes at the front of the room. The class joins on their phones.', () => this.actions.hold(), true),
      way('join', icon('cult'), 'Join a class', 'Sit in with the sign on the big screen.', () => this.show('join')),
      relay ? null : h('p', { class: 'sc-norelay' }, NO_CLASS_RELAY),
      h('p', { class: 'cv-ways-k' }, 'For whoever holds the class'),
      way('sets', icon('riddle'), 'Your question sets', 'Write your own questions, and tick them when you hold a class.', () => this.actions.sets(), false, false),
      init.past ? way('past', icon('stats'), 'Past classes', 'What each class came to: read it, print it, or take it as a spreadsheet.', () => this.actions.past(), false, false) : null,
    );

    const nameId = uniq('cv-name');
    this.nameInput = h('input', {
      class: 'sc-input',
      id: nameId,
      type: 'text',
      name: 'diver-name',
      maxlength: NAME_MAX,
      autocomplete: 'nickname',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'next',
      placeholder: 'What the class calls you',
    }) as HTMLInputElement;
    this.nameInput.value = loadName();
    this.nameInput.addEventListener('change', () => saveName(this.nameInput.value.trim()));
    this.nameInput.addEventListener('input', () => this.clearError());
    const signId = uniq('cv-sign');
    this.signInput = h('input', {
      class: 'sc-input sc-sign-input',
      id: signId,
      type: 'text',
      maxlength: 18,
      autocomplete: 'off',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      placeholder: 'DAGON-247',
    }) as HTMLInputElement;
    this.signInput.value = init.sign ?? '';
    this.signInput.addEventListener('input', () => this.clearError());
    const sit = h('button', { class: 'btn primary', type: 'submit' }, 'Sit down') as HTMLButtonElement;
    const back = h('button', { class: 'btn ghost', type: 'button' }, 'Back') as HTMLButtonElement;
    back.addEventListener('click', () => {
      this.click();
      this.show('ways');
    });
    this.buttons.push(sit);
    this.joinForm = h(
      'form',
      { class: 'sc-panel sc-join', hidden: true, novalidate: true },
      h('h3', { class: 'sc-panel-k', tabindex: '-1' }, 'Join a class'),
      h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: nameId }, 'Your name'), this.nameInput),
      h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: signId }, 'The class’s sign'), this.signInput),
      h('p', { class: 'sc-panel-note' }, 'It is on the big screen: a word and three numbers, like DAGON-247.'),
      h('div', { class: 'sc-row' }, sit, back),
    ) as HTMLFormElement;
    this.joinForm.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.isBusy) return;
      this.click();
      const name = this.nameInput.value.trim();
      saveName(name);
      this.actions.join(name, this.signInput.value);
    });

    const crest = crestTable('sc-crest-table');
    const rest = (m: number, n: number): SeatState => (m < n ? 'waiting' : 'empty');
    if (ctx.reduced) crest.set(allSeats((m) => rest(m, SEATS)), false);
    else for (let n = 1; n <= SEATS; n++) this.later(() => crest.set(allSeats((m) => rest(m, n)), false), 260 + n * 140);
    const steps = [
      'The host’s screen goes at the front of the room. It shows a sign and a square to point a camera at.',
      'Everyone joins on their own phone, in the browser. Nothing to download, no account.',
      'The host asks a question. Seal a true answer before the candle burns out: nobody sees it until the answers surface.',
      'Rarer answers sink deeper, and one nobody else gives sinks half as deep again. In a blitz, give every answer you can.',
      'With tables, each table also wins its deepest different answers.',
      'In last diver standing the tables, or the divers, take turns naming an answer nobody has named. One already named, or a turn that runs out, puts out a lantern.',
      'Whoever is deepest at the end is the Herald of the Deep.',
    ];
    this.el = h(
      'div',
      { class: 'sc-scene sc-entry cv-entry' },
      h(
        'header',
        { class: 'sc-crest' },
        crest.el,
        this.heading('h2', 'The Convocation', 'sc-title'),
        h('p', { class: 'sc-lede' }, 'A séance for a whole class. One screen at the front of the room asks; everyone answers on their own phone.'),
      ),
      h('div', { class: 'plate sc-entry-plate' }, this.msg, this.ways, this.joinForm),
      h('details', { class: 'sc-how' }, h('summary', {}, h('span', {}, 'How a class goes')), h('ol', { class: 'howto-steps' }, ...steps.map((s) => h('li', {}, h('span', {}, s))))),
    );
    if (init.panel === 'join') this.show('join', false);
    if (init.message) this.error(init.message);
  }

  show(panel: ClassPanel, focus = true) {
    this.panel = panel;
    this.clearError();
    this.ways.hidden = panel !== 'ways';
    this.joinForm.hidden = panel !== 'join';
    // A name already kept: the sign is all that is wanted.
    const target = panel === 'join' ? (this.nameInput.value.trim() ? this.signInput : this.nameInput) : this.buttons.find((b) => !b.disabled);
    if (!focus) {
      this.focus = panel === 'join' ? (target ?? this.focus) : this.focus;
      return;
    }
    target?.focus({ preventScroll: true });
  }

  get current(): ClassPanel {
    return this.panel;
  }

  /** Something went wrong: say it, and point at the field to mend. */
  error(message: string, field?: 'name' | 'sign') {
    this.msg.textContent = message;
    this.msg.hidden = !message;
    this.env.shout(message);
    const input = field === 'name' ? this.nameInput : field === 'sign' ? this.signInput : null;
    if (!input) return;
    if (this.panel !== 'join') this.show('join', false);
    this.msg.textContent = message;
    this.msg.hidden = false;
    input.focus();
    if (field === 'sign') input.select();
    input.setAttribute('aria-invalid', 'true');
  }

  private clearError() {
    this.msg.hidden = true;
    this.msg.textContent = '';
    for (const i of [this.nameInput, this.signInput]) i.removeAttribute('aria-invalid');
  }

  private get isBusy() {
    return this.el.classList.contains('is-busy');
  }

  /** While the surface is asked: buttons rest. */
  busy(on: boolean) {
    this.el.classList.toggle('is-busy', on);
    this.el.setAttribute('aria-busy', String(on));
    for (const b of this.buttons) b.toggleAttribute('data-busy-off', on);
  }
}

/** While the surface answers. If it takes too long, say so and offer the way back. */
export class ClassCallingScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, line: string, onBack: () => void, onRetry: () => void) {
    super(ctx);
    this.key = `cv-calling:${line}`;
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
    this.el = h('div', { class: 'sc-scene sc-calling', role: 'status' }, art.el, this.heading('h2', 'Calling the surface…', 'sc-title sc-calling-title'), h('p', { class: 'sc-calling-sign' }, line), slow);
    this.later(() => (slow.hidden = false), 12_000);
  }
}
