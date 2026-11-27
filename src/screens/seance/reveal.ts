// The candle is out: the table's glass lights, and the answers surface one by
// one, shallowest first and the deepest last, each sitter's hand lighting as
// their voice comes up; then what the deep knew and how deep each sitter is.
// And at the end, the Herald of the Deep, with their name in the glass.

import { landmarkFor, zoneFor } from '../../game/theme';
import { fmtMetres, h } from '../../ui/dom';
import type { CandleResult, Voice } from '../../party/types';
import { deepest, gainsOf, listNames, revealOrder, standings, totalsBefore, voiceNoteSpoken, type SeatState } from './model';
import { markEl, SeanceTable, sitterStyle, standingsList, tableSeats, tierName, unsaidList, voiceCard, WaterColumn } from './parts';
import { Scene, uniq, type Ctx } from './scene';
import type { Seat } from './types';

/** Who is looking: the medium (who moves the séance on), a sitter, the one device passed round, or the table. */
export type Role = 'medium' | 'sitter' | 'lantern' | 'table';

export interface RevealData {
  result: CandleResult;
  index: number;
  count: number;
  /** Everyone the circle knows, so a voice whose sitter has left still has a name. */
  seats: Seat[];
  /** After this candle. */
  totals: Record<string, number>;
  role: Role;
  sign?: string;
}

export interface RevealActions {
  next?(): void;
}

const seatMap = (seats: Seat[]) => new Map(seats.map((s) => [s.id, s]));

/**
 * The table at a reveal: the circle waits out of the light, and each hand lights
 * as its voice surfaces (a voice that said nothing stays dim).
 */
class RevealTable {
  table: SeanceTable;
  private up = new Set<string>();

  constructor(
    private seats: Seat[],
    private voices: Voice[],
    cls: string,
    names = false,
  ) {
    this.table = new SeanceTable(this.chairs(), { cls, names });
  }

  private chairs() {
    const said = new Map(this.voices.map((v) => [v.sitter, v.input !== null]));
    return tableSeats(this.seats, (s): SeatState => (this.up.has(s.id) ? (said.get(s.id) ? 'lit' : 'dim') : said.has(s.id) ? 'waiting' : 'away'));
  }

  /** The glass lights: the answers are coming up. */
  open() {
    this.table.light(true);
  }

  surface(id: string) {
    this.up.add(id);
    this.table.set(this.chairs(), false);
  }

  all() {
    for (const v of this.voices) this.up.add(v.sitter);
    this.table.set(this.chairs(), false);
  }
}

/** What a screen reader hears as the answers surface. */
export function revealSpoken(theme: Ctx['env']['theme'], voices: Voice[], seats: Map<string, Seat>): string {
  const lines = voices.map((v) => {
    const name = seats.get(v.sitter)?.name ?? 'Someone';
    if (v.input === null) return `${name}: the candle went out.`;
    return `${name}: ${v.input}, ${tierName(theme, v.tier)}, ${voiceNoteSpoken(v)}, ${fmtMetres(v.depth)} metres.`;
  });
  return `The answers surface. ${lines.join(' ')}`;
}

/**
 * The surfacing itself: each voice in turn, a held breath before the deepest,
 * then the rest of the scene. Everything at once with motion reduced.
 */
function surface(later: (fn: () => void, ms: number) => number, count: number, reduced: boolean, each: (i: number) => void, done: () => void) {
  if (reduced || count === 0) {
    for (let i = 0; i < count; i++) each(i);
    done();
    return;
  }
  const gap = Math.max(650, Math.min(1100, 7000 / count));
  let t = 650;
  for (let i = 0; i < count; i++) {
    if (i === count - 1 && count > 1) t += 700;
    const at = t;
    later(() => each(i), at);
    t += gap;
  }
  later(done, t + 200);
}

export class RevealScene extends Scene {
  readonly key: string;
  private cards: HTMLElement[] = [];
  private order: Voice[];
  private after: HTMLElement[];
  private actionsBox: HTMLElement;
  private role: Role;
  private done = false;
  private table: RevealTable;

  constructor(
    ctx: Ctx,
    key: string,
    private data: RevealData,
    private actions: RevealActions,
  ) {
    super(ctx);
    this.key = key;
    this.role = data.role;
    const seats = seatMap(data.seats);
    this.order = revealOrder(data.result.voices);
    const titleId = uniq('sc-reveal');
    const list = h('ol', { class: 'sc-voices', 'aria-label': 'The answers, shallowest first' });
    for (const v of this.order) {
      const card = voiceCard(this.env.theme, v, seats.get(v.sitter));
      card.classList.add('is-sunk');
      this.cards.push(card);
      list.append(card);
    }
    const unsaid = data.result.unsaid.length
      ? h('section', { class: 'sc-unsaid' }, h('h3', { class: 'sc-h sc-unsaid-k' }, 'What the deep knew'), h('p', { class: 'sc-unsaid-sub' }, 'The rarest answers nobody gave.'), unsaidList(this.env.theme, data.result.unsaid))
      : null;
    const rows = standings(
      data.seats.map((s) => s.id).filter((id) => id in data.totals),
      data.totals,
      gainsOf(data.result),
    );
    const board = h('section', { class: 'plate sc-board' }, h('h3', { class: 'sc-h' }, data.index + 1 >= data.count ? 'The circle, all candles out' : 'The circle so far'), standingsList(rows, seats, { gains: true }));
    this.actionsBox = h('div', { class: 'sc-actions' });
    this.after = [unsaid, board, this.actionsBox].filter((x): x is HTMLElement => !!x);
    for (const el of this.after) el.classList.add('is-sunk');
    this.table = new RevealTable(data.seats, data.result.voices, 'sc-reveal-table');
    this.el = h(
      'div',
      { class: 'sc-scene sc-reveal', 'aria-labelledby': titleId },
      h('header', { class: 'sc-reveal-head' }, this.table.table.el, h('p', { class: 'kicker' }, `Candle ${data.index + 1} of ${data.count} · the answers surface`), this.heading('h2', data.result.prompt.text, 'sc-reveal-q', titleId)),
      list,
      ...this.after,
    );
    if (ctx.reduced) {
      this.table.open();
      this.table.all();
    } else this.later(() => this.table.open(), 120);
    this.paintActions();
    if (unsaid) this.later(() => this.mad(unsaid.querySelector('.sc-unsaid-k')), 50);
    this.env.announce(revealSpoken(this.env.theme, this.order, seats));
    surface(
      (fn, ms) => this.later(fn, ms),
      this.cards.length,
      ctx.reduced,
      (i) => this.rise(i),
      () => this.finish(),
    );
  }

  private rise(i: number) {
    const card = this.cards[i];
    const v = this.order[i];
    card.classList.remove('is-sunk');
    card.classList.add('is-up');
    if (!this.ctx.reduced) this.table.surface(v.sitter);
    const mine = this.data.seats.find((s) => s.id === v.sitter)?.you;
    // Online, each phone sounds only its own answer; the table and a passed lantern sound them all.
    if (v.input !== null && (this.role === 'lantern' || mine)) this.env.sound?.accept?.(v.tier);
    if (!this.ctx.reduced && i > 0) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.table.all();
    this.after.forEach((el, i) => this.later(() => el.classList.remove('is-sunk'), this.ctx.reduced ? 0 : i * 220));
    if (this.data.result.unsaid.length && !this.ctx.reduced) this.env.sound?.whisper?.();
    this.ctx.sink(deepest(this.data.totals));
    const btn = this.actionsBox.querySelector<HTMLButtonElement>('button');
    if (btn) this.later(() => btn.focus({ preventScroll: true }), this.ctx.reduced ? 0 : 700);
  }

  private paintActions() {
    const last = this.data.index + 1 >= this.data.count;
    this.actionsBox.textContent = '';
    if (this.role === 'medium' || this.role === 'lantern') {
      const b = h('button', { class: 'btn primary', type: 'button' }, last ? 'Read the last rites' : 'Light the next candle') as HTMLButtonElement;
      b.addEventListener('click', () => {
        if (b.disabled) return;
        this.click();
        b.disabled = true;
        this.actions.next?.();
      });
      this.actionsBox.append(b);
    } else if (this.role === 'sitter') {
      this.actionsBox.append(h('p', { class: 'sc-wait-line' }, last ? 'The medium will read the last rites.' : 'The medium will light the next candle.'));
    }
  }

  /** The medium left and the candles passed to someone else (perhaps to you). */
  setRole(role: Role) {
    if (role === this.role) return;
    this.role = role;
    this.paintActions();
  }

  /** The relay would not move on: offer the button again. */
  fail() {
    const b = this.actionsBox.querySelector<HTMLButtonElement>('button');
    if (b) b.disabled = false;
  }
}

export class TableRevealScene extends Scene {
  readonly key: string;
  private column: WaterColumn;
  private cards: HTMLElement[] = [];
  private order: Voice[];
  private before: Record<string, number>;
  private unsaid: HTMLElement | null;
  private foot: HTMLElement;
  private table: RevealTable;

  constructor(
    ctx: Ctx,
    key: string,
    private data: RevealData,
  ) {
    super(ctx);
    this.key = key;
    const seats = seatMap(data.seats);
    this.order = revealOrder(data.result.voices);
    this.before = totalsBefore(data.totals, data.result);
    const circle = data.seats.filter((s) => s.id in data.totals || data.result.voices.some((v) => v.sitter === s.id));
    this.column = new WaterColumn(circle, this.before, ctx.depth());
    this.stops.push(() => this.column.destroy());
    const titleId = uniq('sc-treveal');
    this.table = new RevealTable(circle, data.result.voices, 'sc-tr-table');
    if (ctx.reduced) {
      this.table.open();
      this.table.all();
    } else this.later(() => this.table.open(), 120);
    const list = h('ol', { class: 'sc-voices is-grand', style: `--n:${this.order.length}`, 'aria-label': 'The answers, shallowest first' });
    for (const v of this.order) {
      const card = voiceCard(this.env.theme, v, seats.get(v.sitter), 'sc-voice is-grand');
      card.classList.add('is-sunk');
      this.cards.push(card);
      list.append(card);
    }
    this.unsaid = data.result.unsaid.length
      ? h('section', { class: 'sc-unsaid is-grand is-sunk' }, h('h3', { class: 'sc-h sc-unsaid-k' }, 'What the deep knew'), unsaidList(this.env.theme, data.result.unsaid))
      : null;
    const last = data.index + 1 >= data.count;
    this.foot = h('p', { class: 'sc-tr-foot is-sunk' }, last ? 'The medium will read the last rites.' : 'The medium will light the next candle.', data.sign ? h('span', { class: 'sc-tr-sign' }, ' · Join with ', h('b', {}, data.sign)) : null);
    this.el = h(
      'div',
      { class: 'sc-scene sc-table-reveal', 'aria-labelledby': titleId },
      h('header', { class: 'sc-tr-head' }, this.table.table.el, h('div', { class: 'sc-tr-title' }, h('p', { class: 'kicker' }, `Candle ${data.index + 1} of ${data.count} · the answers surface`), this.heading('h2', data.result.prompt.text, 'sc-tr-q', titleId))),
      // What the deep knew lies on the sea floor, under the divers.
      h('div', { class: 'sc-tr-body' }, h('div', { class: 'sc-tr-left' }, list), h('div', { class: 'sc-tr-right' }, this.column.el, this.unsaid)),
      this.foot,
    );
    if (this.unsaid) this.later(() => this.mad(this.unsaid?.querySelector('.sc-unsaid-k') ?? null), 50);
    this.env.announce(revealSpoken(this.env.theme, this.order, seats));
    surface(
      (fn, ms) => this.later(fn, ms),
      this.cards.length,
      ctx.reduced,
      (i) => this.rise(i),
      () => this.finish(),
    );
  }

  private rise(i: number) {
    const v = this.order[i];
    const card = this.cards[i];
    card.classList.remove('is-sunk');
    card.classList.add('is-up');
    if (v.input !== null) this.env.sound?.accept?.(v.tier);
    this.before[v.sitter] = (this.before[v.sitter] ?? 0) + v.depth;
    if (this.ctx.reduced) return;
    this.table.surface(v.sitter);
    this.column.sinkOne(v.sitter, this.before[v.sitter]);
  }

  private finish() {
    this.table.all();
    this.column.set(this.data.totals, deepest(this.data.totals), this.ctx.reduced);
    for (const el of [this.unsaid, this.foot]) if (el) this.later(() => el.classList.remove('is-sunk'), this.ctx.reduced ? 0 : 300);
    if (this.unsaid && !this.ctx.reduced) this.env.sound?.whisper?.();
    this.ctx.sink(deepest(this.data.totals));
  }
}

// ------------------------------------------------------------------ the last rites

export interface EndData {
  heralds: string[];
  seats: Seat[];
  totals: Record<string, number>;
  role: Role;
  sign?: string;
}

export interface EndActions {
  again?(): void;
  leave(): void;
}

function heraldWords(theme: Ctx['env']['theme'], data: EndData) {
  const seats = seatMap(data.seats);
  const names = data.heralds.map((id) => seats.get(id)?.name ?? 'Someone');
  const depth = data.heralds.length ? (data.totals[data.heralds[0]] ?? 0) : 0;
  const place = depth > 0 ? (landmarkFor(theme, depth)?.name ?? zoneFor(theme, depth).name) : '';
  const line = !names.length
    ? 'Nobody sank. The deep keeps its herald for another night.'
    : names.length === 1
      ? `The deep heard ${names[0]} above all the others.`
      : `A tie. The deep keeps ${names.length === 2 ? 'them both' : 'them all'}.`;
  return { names, depth, place, line };
}

/** The words in the glass for the Herald: one name, two joined, or for a wider tie, how many. */
function glassWords(names: string[]): string | null {
  if (!names.length) return null;
  if (names.length === 1) return names[0];
  const two = names.join(' & ');
  return names.length === 2 && two.length <= 15 ? two : `${names.length} heralds`;
}

function heraldBlock(ctx: Ctx, data: EndData, titleId: string, grand: boolean): { el: HTMLElement; spoken: string; title: HTMLElement; table: SeanceTable } {
  const { names, depth, place, line } = heraldWords(ctx.env.theme, data);
  const seats = seatMap(data.seats);
  const heralds = new Set(data.heralds);
  const circle = data.seats.filter((s) => s.id in data.totals);
  const table = new SeanceTable(
    tableSeats(circle, (s) => (heralds.has(s.id) ? 'lit' : 'dim')),
    { cls: grand ? 'is-grand sc-herald-table' : 'sc-herald-table', names: grand },
  );
  table.glass(glassWords(names), 'herald');
  table.light(true);
  const title = h('h2', { class: 'sc-herald-k', id: titleId, tabindex: '-1' }, 'The Herald of the Deep');
  const who = names.length
    ? h(
        'p',
        { class: `sc-herald-name${names.length > 1 ? ' is-tie' : ''}` },
        ...data.heralds.flatMap((id, i) => {
          const s = seats.get(id);
          const bits: Array<HTMLElement | string> = [];
          if (i > 0) bits.push(h('span', { class: 'sc-herald-and' }, i === data.heralds.length - 1 ? ' and ' : ', '));
          bits.push(h('span', { class: 'sc-herald-one', style: sitterStyle(s?.mark ?? 0) }, markEl(s?.mark ?? 0), h('span', {}, s?.name ?? 'Someone')));
          return bits;
        }),
      )
    : h('p', { class: 'sc-herald-name is-nobody' }, 'Nobody');
  const el = h(
    'div',
    { class: `sc-herald${grand ? ' is-grand' : ''}` },
    h('p', { class: 'kicker' }, 'The last rites'),
    table.el,
    title,
    who,
    depth > 0 ? h('p', { class: 'sc-herald-depth' }, h('span', { class: 'n' }, fmtMetres(depth)), h('span', { class: 'u' }, ' m'), place ? h('span', { class: 'p' }, ` · ${place}`) : null) : null,
    h('p', { class: 'sc-herald-line' }, line),
  );
  const spoken = names.length ? `The last rites. The Herald of the Deep: ${listNames(names)}, at ${fmtMetres(depth)} metres. ${line}` : `The last rites. ${line}`;
  return { el, spoken, title, table };
}

export class EndScene extends Scene {
  readonly key: string;
  private actionsBox: HTMLElement;
  private role: Role;

  constructor(
    ctx: Ctx,
    key: string,
    data: EndData,
    private actions: EndActions,
  ) {
    super(ctx);
    this.key = key;
    this.role = data.role;
    const titleId = uniq('sc-end');
    const herald = heraldBlock(ctx, data, titleId, false);
    this.focus = herald.title;
    const seats = seatMap(data.seats);
    const rows = standings(
      data.seats.map((s) => s.id).filter((id) => id in data.totals),
      data.totals,
    );
    this.actionsBox = h('div', { class: 'sc-actions sc-end-actions' });
    this.el = h(
      'div',
      { class: 'sc-scene sc-end', 'aria-labelledby': titleId },
      herald.el,
      h('section', { class: 'plate sc-board' }, h('h3', { class: 'sc-h' }, 'How deep each went'), standingsList(rows, seats)),
      this.actionsBox,
    );
    this.paintActions();
    this.later(() => this.mad(herald.title), 60);
    this.env.announce(herald.spoken);
    if (!ctx.reduced) this.later(() => this.env.sound?.zone?.(), 400);
    this.ctx.sink(deepest(data.totals));
  }

  private paintActions() {
    this.actionsBox.textContent = '';
    if (this.role === 'medium' || this.role === 'lantern') {
      const again = h('button', { class: 'btn primary', type: 'button' }, 'Sit again') as HTMLButtonElement;
      again.addEventListener('click', () => {
        if (again.disabled) return;
        this.click();
        again.disabled = true;
        this.actions.again?.();
      });
      this.actionsBox.append(again);
    } else if (this.role === 'sitter') {
      this.actionsBox.append(h('p', { class: 'sc-wait-line' }, 'The medium may sit again with the same circle.'));
    }
    const leave = h('button', { class: 'btn ghost', type: 'button' }, 'Leave the circle');
    leave.addEventListener('click', () => {
      this.click();
      this.actions.leave();
    });
    this.actionsBox.append(leave);
  }

  setRole(role: Role) {
    if (role === this.role) return;
    this.role = role;
    this.paintActions();
  }

  fail() {
    const b = this.actionsBox.querySelector<HTMLButtonElement>('button.primary');
    if (b) b.disabled = false;
  }
}

export class TableEndScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, key: string, data: EndData) {
    super(ctx);
    this.key = key;
    const titleId = uniq('sc-tend');
    const herald = heraldBlock(ctx, data, titleId, true);
    this.focus = herald.title;
    const circle = data.seats.filter((s) => s.id in data.totals);
    const column = new WaterColumn(circle, data.totals, deepest(data.totals));
    this.stops.push(() => column.destroy());
    this.el = h(
      'div',
      { class: 'sc-scene sc-table-end', 'aria-labelledby': titleId },
      h('div', { class: 'sc-te-left' }, herald.el, h('p', { class: 'sc-te-foot' }, data.sign ? `The medium may sit again. The sign is still ${data.sign}.` : 'The medium may sit again.')),
      h('div', { class: 'sc-te-right' }, column.el),
    );
    this.later(() => this.mad(herald.title), 60);
    this.env.announce(herald.spoken);
    if (!ctx.reduced) this.later(() => this.env.sound?.zone?.(), 400);
    this.ctx.sink(deepest(data.totals));
  }
}
