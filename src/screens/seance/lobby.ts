// Before the first candle: the table with the sign in its glass and a hand for
// each sitter as they sit down, the sign shared or held up for the room, and for
// the medium, how many candles and how long each burns.

import { h } from '../../ui/dom';
import { icon } from '../../ui/art';
import { signSpoken } from '../../party/codes';
import { CANDLE_CHOICES, MAX_SITTERS, SECONDS_CHOICES, type SeanceView } from '../../party/types';
import { choiceNames } from '../../game/topics';
import { topicPicker, type TopicPicker } from '../../ui/topics';
import { cardinal, capitalise, configLine, seatsOf, shareLink, tablesOf } from './model';
import { choiceRow, markEl, SeanceTable, shareButton, signEl, tableSeats } from './parts';
import { Scene, uniq, type Ctx } from './scene';
import type { Seat } from './types';

export interface LobbyActions {
  /** `topics` are the names of the ticked topics, for the circle to read: none for the whole daily deep. */
  config(candles: number, seconds: number, topics: string[]): void;
  begin(): void;
}

/** The way to the séance, said plainly: the address with its sign. */
const linkText = (sign: string) => shareLink(location.href, sign).replace(/^https?:\/\//, '');

export const shareData = (sign: string) => ({
  title: 'The Séance',
  text: `Sit with us at a séance in Cthulhoo. The sign is ${sign}.`,
  url: shareLink(location.href, sign),
});

/** The lobby's table: a hand for everyone sitting, dimmer for those who stepped away. */
const lobbySeats = (seats: Seat[]) => tableSeats(seats, (s) => (s.online ? 'seated' : 'away'));

/** One sitter in the circle's list: glyph, name, who lights the candles, who stepped away. */
function sitterRow(s: Seat): HTMLElement {
  return h(
    'li',
    { class: `sc-sitter${s.online ? '' : ' is-away'}${s.you ? ' is-you' : ''}` },
    markEl(s.mark),
    h('span', { class: 'sc-sitter-name' }, s.name),
    h(
      'span',
      { class: 'sc-sitter-tags' },
      s.medium ? h('span', { class: 'sc-tag is-medium', html: `${icon('seance')}<span>medium</span>` }) : null,
      s.you ? h('span', { class: 'sc-tag is-you' }, 'you') : null,
    ),
    h('span', { class: 'sc-sitter-state' }, h('span', { class: 'sc-dot', 'aria-hidden': 'true' }), s.online ? 'here' : 'stepped away'),
  );
}

/**
 * The sign held up for the room: the whole screen, as large as it will go.
 * A tap, or Escape, puts it down.
 */
function holdUp(sign: string, opener: HTMLElement, onClose: () => void): HTMLElement {
  const [word, num] = sign.split('-');
  const el = h(
    'button',
    { class: 'sc-holdup', type: 'button', style: `--chars:${sign.length}`, 'aria-label': `The sign is ${signSpoken(sign)}. Put it down.` },
    h('span', { class: 'sc-holdup-k', 'aria-hidden': 'true' }, 'The sign'),
    h('span', { class: 'sc-holdup-sign', 'aria-hidden': 'true' }, h('span', { class: 'w' }, word), h('span', { class: 'd' }, '-'), h('span', { class: 'n' }, num ?? '')),
    h('span', { class: 'sc-holdup-say', 'aria-hidden': 'true' }, signSpoken(sign)),
    h('span', { class: 'sc-holdup-hint', 'aria-hidden': 'true' }, 'Tap to put it down'),
  );
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    el.remove();
    onClose();
    opener.focus({ preventScroll: true });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };
  el.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  return el;
}

export class LobbyScene extends Scene {
  readonly key: string;
  private table: SeanceTable;
  private list: HTMLElement;
  private count: HTMLElement;
  private tables: HTMLElement;
  private candles?: ReturnType<typeof choiceRow>;
  private seconds?: ReturnType<typeof choiceRow>;
  private begin?: HTMLButtonElement;
  private hint: HTMLElement;
  private read: HTMLElement;
  private view: SeanceView;
  private held: HTMLElement | null = null;
  private picker?: TopicPicker;
  /** The names of the ticked topics, as last worked out. */
  private names: string[] = [];

  constructor(
    ctx: Ctx,
    view: SeanceView,
    private actions: LobbyActions,
  ) {
    super(ctx);
    this.view = view;
    const medium = view.medium === view.you;
    this.key = `lobby:${medium ? 'medium' : 'sitter'}`;
    const titleId = uniq('sc-lobby');
    this.table = new SeanceTable(lobbySeats(seatsOf(view)), { cls: 'sc-lobby-table' });
    this.table.glass(view.sign, 'sign');
    this.list = h('ul', { class: 'sc-sitters' });
    this.count = h('span', { class: 'sc-count' });
    this.tables = h('p', { class: 'sc-tables' });
    this.hint = h('p', { class: 'sc-hint' });
    this.read = h('p', { class: 'sc-config-read' });
    const up = h('button', { class: 'btn ghost sc-holdup-btn', type: 'button' }, 'Hold up the sign') as HTMLButtonElement;
    up.addEventListener('click', () => {
      if (this.held) return;
      this.click();
      this.held = holdUp(view.sign, up, () => (this.held = null));
      this.el.append(this.held);
      this.held.focus({ preventScroll: true });
    });
    this.stops.push(() => this.held?.click());
    const head = h(
      'div',
      { class: 'sc-sign-block' },
      h('p', { class: 'kicker' }, medium ? 'You are the medium' : 'You are sitting'),
      this.heading('h2', 'The séance is open', 'visually-hidden', titleId),
      this.table.el,
      h('p', { class: 'sc-sign-say' }, h('span', { class: 'visually-hidden' }, `The sign is ${signSpoken(view.sign)}. `), 'Say the sign in the glass across the room, or share it.'),
      h('div', { class: 'sc-row sc-sign-acts' }, shareButton('Share the sign', () => shareData(view.sign), () => this.click(), (m) => this.env.announce(m)), up),
    );
    const circle = h('section', { class: 'plate sc-circle', 'aria-label': 'The circle' }, h('h3', { class: 'sc-h' }, 'The circle ', this.count), this.list, this.tables);
    const parts: HTMLElement[] = [head, circle];
    if (medium) {
      this.candles = choiceRow('Candles', 'candles', CANDLE_CHOICES, view.config.candles, (n) => (n === 1 ? 'candle' : 'candles'), (n) => this.pick(n, this.view.config.seconds));
      this.seconds = choiceRow('Each burns for', 'seconds', SECONDS_CHOICES, view.config.seconds, () => 'seconds', (n) => this.pick(this.view.config.candles, n));
      this.begin = h('button', { class: 'btn primary sc-begin', type: 'button' }, 'Light the first candle') as HTMLButtonElement;
      this.begin.addEventListener('click', () => {
        if (!this.begin || this.begin.disabled) return;
        this.click();
        this.begin.disabled = true;
        this.begin.setAttribute('aria-busy', 'true');
        this.begin.textContent = 'Lighting the candle…';
        this.actions.begin();
      });
      parts.push(h('section', { class: 'plate sc-config', 'aria-label': 'How the séance is held' }, h('h3', { class: 'sc-h' }, 'The candles'), this.candles.el, this.seconds.el));
      const topics = this.env.topics;
      if (topics) {
        this.names = view.config.topics ?? [];
        const retell = (all: ReturnType<typeof topics.daily>) => {
          const names = choiceNames(this.picker?.choice() ?? [], all);
          if (names.join('|') === this.names.join('|')) return;
          this.names = names;
          this.actions.config(this.view.config.candles, this.view.config.seconds, names);
        };
        let known = topics.daily();
        this.picker = topicPicker({
          topics: known,
          choice: topics.load(),
          legend: 'Ask about',
          onTick: () => this.env.sound?.key?.(),
          onChange: (choice) => {
            topics.save(choice);
            retell(known);
          },
        });
        // The class packs arrive a moment later; only then is this device's last choice told to the circle.
        let live = true;
        this.stops.push(() => (live = false));
        void topics.all().then((all) => {
          if (!live) return;
          known = all;
          this.picker?.setTopics(all);
          retell(all);
        });
        parts.push(h('section', { class: 'plate sc-config sc-topics', 'aria-label': 'What the séance asks about' }, h('h3', { class: 'sc-h' }, 'The questions'), this.picker.el));
      }
      parts.push(h('div', { class: 'sc-actions' }, this.begin, this.hint));
    } else {
      parts.push(h('div', { class: 'sc-wait' }, h('p', { class: 'sc-wait-line' }, 'The medium will light the first candle.'), this.read));
    }
    this.el = h('div', { class: 'sc-scene sc-lobby', 'aria-labelledby': titleId }, ...parts);
    this.update(view);
  }

  private pick(candles: number, seconds: number) {
    this.click();
    this.view = { ...this.view, config: { ...this.view.config, candles, seconds } };
    this.actions.config(candles, seconds, this.names);
  }

  /** The topics ticked on the medium's device: empty for the whole daily deep. */
  choice(): string[] {
    return this.picker?.choice() ?? [];
  }

  update(view: SeanceView) {
    const before = new Set(seatsOf(this.view).map((s) => s.id));
    this.view = view;
    const seats = seatsOf(view);
    this.table.set(lobbySeats(seats));
    this.list.textContent = '';
    for (const s of seats) this.list.append(sitterRow(s));
    this.count.textContent = `${seats.length} of ${MAX_SITTERS}`;
    const fresh = seats.filter((s) => !before.has(s.id) && !s.you);
    if (fresh.length) this.env.announce(`${fresh.map((s) => s.name).join(' and ')} ${fresh.length === 1 ? 'sits' : 'sit'} down.`);
    const t = tablesOf(view);
    this.tables.textContent = t ? `${t === 1 ? 'One screen is' : `${capitalise(cardinal(t))} screens are`} at the table, showing the room.` : '';
    this.tables.hidden = !t;
    this.candles?.set(view.config.candles);
    this.seconds?.set(view.config.seconds);
    this.read.textContent = configLine(view.config);
    const here = seats.filter((s) => s.online).length;
    this.hint.textContent = here <= 1 ? 'You are alone in the circle. Wait for the others, or begin alone.' : `${capitalise(cardinal(here))} are sitting. Light the candle when the circle is ready.`;
  }

  /** The relay would not begin: say why, and offer the button again. */
  fail(message: string) {
    if (!this.begin) return;
    this.begin.disabled = false;
    this.begin.removeAttribute('aria-busy');
    this.begin.textContent = 'Light the first candle';
    this.hint.textContent = message;
  }
}

/** The table before the first candle: the sign for the whole room, and the circle as it sits down. */
export class TableLobbyScene extends Scene {
  readonly key = 'table-lobby';
  private table: SeanceTable;
  private wait: HTMLElement;
  private read: HTMLElement;
  private ids: string;

  constructor(ctx: Ctx, view: SeanceView) {
    super(ctx);
    const titleId = uniq('sc-tlobby');
    const seats = seatsOf(view);
    this.ids = seats.map((s) => s.id).join(',');
    this.table = new SeanceTable(lobbySeats(seats), { names: true, cls: 'is-grand' });
    this.table.glass(view.sign, 'sign');
    this.wait = h('p', { class: 'sc-tl-wait' });
    this.read = h('p', { class: 'sc-tl-config' });
    this.el = h(
      'div',
      { class: 'sc-scene sc-table-lobby', 'aria-labelledby': titleId },
      h('div', { class: 'sc-tl-stage' }, this.table.el),
      h(
        'div',
        { class: 'sc-tl-side' },
        this.heading('h2', 'Join the séance', 'kicker sc-tl-k', titleId),
        signEl(view.sign, signSpoken(view.sign), 'sc-sign sc-sign-grand'),
        h('p', { class: 'sc-tl-how' }, 'On a phone, open Cthulhoo, choose the Séance, then Join a séance, and give this sign.'),
        h('p', { class: 'sc-tl-url' }, linkText(view.sign)),
        this.wait,
        this.read,
      ),
    );
    this.update(view);
  }

  update(view: SeanceView) {
    const seats = seatsOf(view);
    const ids = seats.map((s) => s.id).join(',');
    const fresh = seats.filter((s) => !this.ids.split(',').includes(s.id));
    this.ids = ids;
    this.table.set(lobbySeats(seats));
    if (fresh.length && seats.length > fresh.length) this.env.announce(`${fresh.map((s) => s.name).join(' and ')} ${fresh.length === 1 ? 'sits' : 'sit'} down.`);
    const medium = seats.find((s) => s.medium);
    this.wait.textContent = !seats.length ? 'Nobody has sat down yet. The first to join lights the candles.' : medium ? `${medium.name} is the medium, and will light the first candle.` : 'The medium will light the first candle.';
    this.read.textContent = configLine(view.config);
  }
}
