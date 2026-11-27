// The Cult: a standing circle of friends found by a sign like BRINE-42, and the
// board of how deep each of them dived this week. The app puts cultBody() in a
// sheet titled "The Cult", and calls postDiveToCult() when a daily dive ends.

import '../styles/seance.css';
import '../styles/cult.css';
import { parseSign, signSpoken } from '../party/codes';
import { CULT_MAX, type CultBoard, type CultRow } from '../party/cult';
import { cultBoard, cultDive, cultFound, cultJoin, cultLeave, hasRelay, RelayError } from '../party/online';
import { cleanName } from '../party/room';
import { NAME_MAX } from '../party/types';
import { icon } from '../ui/art';
import { fmtMetres, h } from '../ui/dom';
import { glyphSvg } from './seance/art';
import { capitalise, listNames, relayId, shareLink, shortMetres, weekCells, weekSpan, WEEKDAYS, type DayCell } from './seance/model';
import { dropStore, loadName, readJson, saveName, shareButton, signEl, sitterStyle, writeStore } from './seance/parts';
import type { CultDeps, SeanceEnv } from './seance/types';

export const CULT_KEY = 'cthulhoo.v1.cult';

/** What the cult screens need from the app: a SeanceEnv will do. */
export type CultEnv = Pick<SeanceEnv, 'playerId' | 'today' | 'announce'> & Partial<Pick<SeanceEnv, 'shout' | 'sound'>>;

export interface CultOpts {
  /** Called when this device founds, joins or leaves a cult (or finds it gone). */
  onChange?(): void;
  /** A sign from the address (?cult=SIGN): the join field is filled with it. */
  sign?: string;
  /** Today's dive, if there was one: founding or joining sets it on the board straight away. */
  todayDepth?: number;
}

/** The cult this device belongs to, kept in this browser. */
export interface CultStore {
  sign: string;
  name: string;
  /** A dive that could not reach the surface, sent again when the board is next read. */
  pending?: { day: number; depth: number };
}

export function loadCult(): CultStore | null {
  const c = readJson<CultStore>(CULT_KEY);
  return c && typeof c.sign === 'string' && parseSign(c.sign, 'cult') ? { sign: c.sign, name: typeof c.name === 'string' ? c.name : '', pending: c.pending } : null;
}

const saveCult = (c: CultStore) => writeStore(CULT_KEY, JSON.stringify(c));
const forgetCult = () => dropStore(CULT_KEY);

const NOT_A_SIGN = 'That is not a cult’s sign. It looks like BRINE-42: a word and a two-figure number.';

/** A dive the relay will still take: it keeps only today's (a day either side, for time zones). */
const fresh = (p: CultStore['pending'], today: number) => !!p && Number.isInteger(p.day) && Math.abs(p.day - today) <= 1 && p.depth > 0;

const gone = (e: unknown) => e instanceof RelayError && (e.status === 404 || e.status === 403);

interface Calls {
  found: NonNullable<CultDeps['found']>;
  join: NonNullable<CultDeps['join']>;
  board: NonNullable<CultDeps['board']>;
  leave: NonNullable<CultDeps['leave']>;
  dive: NonNullable<CultDeps['dive']>;
}

const callsFor = (deps: CultDeps): Calls => ({
  found: deps.found ?? cultFound,
  join: deps.join ?? cultJoin,
  board: deps.board ?? cultBoard,
  leave: deps.leave ?? cultLeave,
  dive: deps.dive ?? cultDive,
});

/**
 * Set a finished daily dive on the cult's board. Does nothing without a relay or
 * a cult, and never throws: a dive that cannot reach the surface is kept and sent
 * the next time the board is read.
 */
export async function postDiveToCult(env: Pick<SeanceEnv, 'playerId'>, day: number, depth: number, deps: CultDeps = {}): Promise<void> {
  try {
    if (!(deps.relay ?? hasRelay())) return;
    const c = loadCult();
    if (!c || !(depth > 0)) return;
    try {
      await callsFor(deps).dive(c.sign, relayId(env.playerId), day, Math.round(depth));
      if (c.pending) saveCult({ sign: c.sign, name: c.name });
    } catch (e) {
      if (gone(e)) forgetCult();
      else if (!(e instanceof RelayError && e.status === 400)) saveCult({ ...c, pending: { day, depth: Math.round(depth) } });
    }
  } catch {
    /* the board will simply not have it */
  }
}

/** The body of the cult sheet: the way in, or this week's board. */
export function cultBody(env: CultEnv, opts: CultOpts = {}, deps: CultDeps = {}): HTMLElement {
  return new CultPanel(env, opts, deps).el;
}

let seq = 0;

class CultPanel {
  readonly el: HTMLElement;
  private calls: Calls;
  private id: string;
  private busy = false;

  constructor(
    private env: CultEnv,
    private opts: CultOpts,
    deps: CultDeps,
  ) {
    this.calls = callsFor(deps);
    this.id = relayId(env.playerId);
    this.el = h('div', { class: 'cult-body' });
    if (!(deps.relay ?? hasRelay())) {
      this.el.append(h('p', { class: 'cult-norelay' }, 'A cult keeps its board on the surface relay, which is not set up yet. Until it is, the Séance can still be held by passing one phone round the room.'));
      return;
    }
    const c = loadCult();
    if (c) void this.read(c);
    else this.out();
  }

  private click() {
    this.env.sound?.click?.();
  }

  private changed() {
    try {
      this.opts.onChange?.();
    } catch {
      /* the app's own business */
    }
  }

  private put(...nodes: Array<Node | null>) {
    this.el.replaceChildren(...nodes.filter((n): n is Node => !!n));
  }

  // ------------------------------------------------------------ the way in

  private out(message?: string) {
    const nameId = `cult-name-${++seq}`;
    const signId = `cult-sign-${seq}`;
    const msg = h('p', { class: 'sc-msg cult-msg', role: 'alert', hidden: !message }, message ?? '');
    const name = h('input', {
      class: 'sc-input',
      id: nameId,
      type: 'text',
      maxlength: NAME_MAX,
      autocomplete: 'nickname',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      placeholder: 'What friends call you',
      value: loadName(),
    }) as HTMLInputElement;
    const sign = h('input', {
      class: 'sc-input cult-sign-input',
      id: signId,
      type: 'text',
      maxlength: 16,
      autocomplete: 'off',
      autocapitalize: 'characters',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'go',
      inputmode: 'text',
      placeholder: 'BRINE-42',
      value: this.opts.sign ?? '',
    }) as HTMLInputElement;
    const found = h('button', { class: 'btn primary cult-found', type: 'button' }, 'Found a cult') as HTMLButtonElement;
    const join = h('button', { class: 'btn cult-join-btn', type: 'submit' }, 'Join') as HTMLButtonElement;
    const say = (text: string, field?: HTMLInputElement) => {
      msg.textContent = text;
      msg.hidden = false;
      name.removeAttribute('aria-invalid');
      sign.removeAttribute('aria-invalid');
      if (field) {
        field.setAttribute('aria-invalid', 'true');
        field.focus();
      }
      this.env.shout?.(text);
    };
    const quiet = () => {
      msg.hidden = true;
      name.removeAttribute('aria-invalid');
      sign.removeAttribute('aria-invalid');
    };
    name.addEventListener('input', quiet);
    sign.addEventListener('input', quiet);
    const wait = (on: boolean, btn: HTMLButtonElement, label: string) => {
      this.busy = on;
      found.disabled = on;
      join.disabled = on;
      btn.textContent = on ? label : btn === found ? 'Found a cult' : 'Join';
      this.el.setAttribute('aria-busy', String(on));
    };
    const named = (): string | null => {
      const n = cleanName(name.value);
      if (!n) {
        say('Give the cult a name to call you by.', name);
        return null;
      }
      return n;
    };
    found.addEventListener('click', async () => {
      if (this.busy) return;
      this.click();
      const n = named();
      if (!n) return;
      wait(true, found, 'Founding…');
      try {
        const r = await this.calls.found(this.id, n, this.env.today);
        saveName(n);
        saveCult({ sign: r.sign, name: n });
        this.changed();
        const board = (await this.dived(r.sign)) ?? r.board;
        this.board(board, `You founded ${r.sign}. Share the sign with the friends you want in it.`);
      } catch (e) {
        wait(false, found, '');
        say(e instanceof RelayError ? e.message : 'The surface relay did not answer. Try again.');
      }
    });
    const form = h(
      'form',
      { class: 'cult-join', novalidate: true },
      h('label', { class: 'sc-field-k', for: signId }, 'Join with a sign'),
      h('div', { class: 'cult-join-row' }, sign, join),
    );
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (this.busy) return;
      this.click();
      const n = named();
      if (!n) return;
      const s = parseSign(sign.value, 'cult');
      if (!s) return say(NOT_A_SIGN, sign);
      sign.value = s;
      wait(true, join, 'Joining…');
      try {
        const board = await this.calls.join(s, this.id, n, this.env.today);
        saveName(n);
        saveCult({ sign: s, name: n });
        this.changed();
        this.board((await this.dived(s)) ?? board, `You joined ${s}.`);
      } catch (err) {
        wait(false, join, '');
        say(err instanceof RelayError ? err.message : 'The surface relay did not answer. Try again.', err instanceof RelayError && err.status === 404 ? sign : undefined);
      }
    });
    this.put(
      h(
        'div',
        { class: 'cult-out' },
        h('div', { class: 'cult-emblem', 'aria-hidden': 'true', html: emblem() }),
        h('p', { class: 'cult-lede' }, `A cult is a standing circle of friends, up to ${CULT_MAX} of them. Each daily dive you make is set on the week’s board beside theirs, and whoever sinks deepest by Sunday is the cult’s Herald.`),
        h('div', { class: 'sc-field cult-field' }, h('label', { class: 'sc-field-k', for: nameId }, 'Your name in the cult'), name),
        msg,
        found,
        h('p', { class: 'cult-or', 'aria-hidden': 'true' }, h('span', {}, 'or')),
        form,
      ),
    );
    if (this.opts.sign && !parseSign(this.opts.sign, 'cult')) say(NOT_A_SIGN);
    else if (this.opts.sign) (name.value ? join : name).focus({ preventScroll: true });
  }

  /** Today's dive, set on a board just founded or joined. */
  private async dived(sign: string): Promise<CultBoard | null> {
    const d = this.opts.todayDepth ?? 0;
    if (!(d > 0)) return null;
    try {
      return await this.calls.dive(sign, this.id, this.env.today, Math.round(d));
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ the board

  private head(sign: string): HTMLElement {
    const share = shareButton(
      'Share the sign',
      () => ({ title: 'The Cult', text: `Join my cult in Cthulhoo. The sign is ${sign}.`, url: shareLink(location.href, sign, 'cult') }),
      () => this.click(),
      this.env.announce,
    );
    return h('header', { class: 'cult-head' }, h('p', { class: 'kicker' }, 'Your cult'), signEl(sign, signSpoken(sign), 'sc-sign cult-sign'), share);
  }

  private async read(c: CultStore) {
    const status = h('p', { class: 'cult-loading', role: 'status' }, h('span', { class: 'cult-plumb', 'aria-hidden': 'true' }), 'Reading the board…');
    this.put(this.head(c.sign), status);
    this.el.setAttribute('aria-busy', 'true');
    try {
      let board: CultBoard | null = null;
      let kept = false;
      if (c.pending && fresh(c.pending, this.env.today)) {
        try {
          board = await this.calls.dive(c.sign, this.id, c.pending.day, c.pending.depth);
        } catch (e) {
          if (gone(e)) throw e;
          kept = !(e instanceof RelayError && e.status === 400);
        }
      }
      board ??= await this.calls.board(c.sign, this.id, this.env.today);
      if (c.pending && !kept) saveCult({ sign: c.sign, name: c.name });
      if (!board.member) {
        forgetCult();
        this.changed();
        this.out(`You are no longer of ${c.sign}. Found a cult, or join one with its sign.`);
        return;
      }
      this.board(board);
    } catch (e) {
      if (gone(e)) {
        forgetCult();
        this.changed();
        this.out(`The cult ${c.sign} is no more. Found another, or join one with its sign.`);
        return;
      }
      const again = h('button', { class: 'btn', type: 'button' }, 'Try again');
      again.addEventListener('click', () => {
        this.click();
        void this.read(c);
      });
      this.put(
        this.head(c.sign),
        h('div', { class: 'cult-fail', role: 'alert' }, h('p', {}, e instanceof RelayError && e.status ? e.message : 'The board could not be read from the surface. Check your connection.'), again),
        this.leaveRow(c.sign),
      );
    } finally {
      this.el.removeAttribute('aria-busy');
    }
  }

  private board(b: CultBoard, say?: string) {
    const titleId = `cult-week-${++seq}`;
    const most = Math.max(1000, ...b.rows.flatMap((r) => r.days.map((d) => d ?? 0)));
    const ranks = rankRows(b.rows);
    const todayIdx = b.today - b.week;
    const daysHead = h(
      'div',
      { class: 'cult-days-head', 'aria-hidden': 'true' },
      ...WEEKDAYS.map((d, i) => h('span', { class: i === todayIdx ? 'is-today' : '' }, d.slice(0, 1))),
    );
    const list = h('ol', { class: 'cult-board', 'aria-labelledby': titleId });
    b.rows.forEach((r, i) => list.append(this.row(b, r, ranks[i], most)));
    const heralds = b.lastWeek;
    const stats = h(
      'div',
      { class: 'cult-stats' },
      h(
        'div',
        { class: 'cult-stat' },
        h('span', { class: 'v' }, `${fmtMetres(b.total)} m`),
        h('span', { class: 'k' }, b.rows.length === 1 ? 'the cult this week' : `the cult this week, between ${b.rows.length}`),
      ),
      h(
        'div',
        { class: 'cult-stat is-herald' },
        heralds ? h('span', { class: 'v n' }, listNames(heralds.names)) : h('span', { class: 'v is-none' }, 'Nobody'),
        h('span', { class: 'k' }, heralds ? `last week’s ${heralds.names.length > 1 ? 'Heralds' : 'Herald'} · ${fmtMetres(heralds.depth)} m` : 'dived last week'),
      ),
    );
    const heading = h('h3', { class: 'cult-week-title', id: titleId, tabindex: '-1' }, 'This week', h('span', { class: 'cult-span' }, weekSpan(b.week)));
    this.put(
      this.head(b.sign),
      h('section', { class: 'cult-week', 'aria-labelledby': titleId }, heading, daysHead, list),
      stats,
      this.leaveRow(b.sign),
    );
    if (say) {
      this.env.announce(say);
      heading.focus({ preventScroll: true });
    }
  }

  private row(b: CultBoard, r: CultRow, rank: { n: number; tied: boolean }, most: number): HTMLElement {
    const you = r.id === this.id;
    const cells = weekCells(b, r.days);
    const days = h('ol', { class: 'cult-days', 'aria-hidden': 'true' }, ...cells.map((c) => dayCell(c, most)));
    const spoken = `${r.name}${you ? ' (you)' : ''}, ${rank.tied ? 'joint ' : ''}${ordinalWord(rank.n)}, ${fmtMetres(r.total)} metres this week. ${daysSpoken(cells)}`;
    return h(
      'li',
      { class: `cult-row${you ? ' is-you' : ''}${r.total ? '' : ' is-dry'}`, style: sitterStyle(r.mark) },
      h('span', { class: 'cult-rank', 'aria-hidden': 'true' }, `${rank.tied ? '=' : ''}${rank.n}`),
      h('span', { class: 'sc-mark cult-mark', 'aria-hidden': 'true', html: glyphSvg(r.mark) }),
      h('span', { class: 'cult-name', 'aria-hidden': 'true' }, h('span', { class: 'n' }, r.name), you ? h('span', { class: 'cult-you' }, 'you') : null),
      h('span', { class: 'cult-metres', 'aria-hidden': 'true' }, `${fmtMetres(r.total)} m`),
      days,
      h('span', { class: 'visually-hidden' }, spoken),
    );
  }

  private leaveRow(sign: string): HTMLElement {
    const box = h('div', { class: 'cult-leave' });
    const ask = h('button', { class: 'btn ghost', type: 'button' }, 'Leave the cult') as HTMLButtonElement;
    ask.addEventListener('click', () => {
      this.click();
      const yes = h('button', { class: 'btn primary', type: 'button' }, 'Leave') as HTMLButtonElement;
      const no = h('button', { class: 'btn ghost', type: 'button' }, 'Stay');
      const note = h('p', { class: 'cult-leave-note', role: 'alert' }, `Leave ${sign}? Your dives leave the board with you. You can join again with the sign.`);
      no.addEventListener('click', () => {
        this.click();
        box.replaceChildren(ask);
        ask.focus();
      });
      yes.addEventListener('click', async () => {
        if (this.busy) return;
        this.click();
        this.busy = true;
        yes.disabled = true;
        yes.textContent = 'Leaving…';
        try {
          await this.calls.leave(sign, this.id);
        } catch (e) {
          if (!gone(e)) {
            this.busy = false;
            yes.disabled = false;
            yes.textContent = 'Leave';
            note.textContent = 'The surface relay did not answer, so you are still of the cult. Try again.';
            return;
          }
        }
        this.busy = false;
        forgetCult();
        this.changed();
        this.env.announce(`You left ${sign}.`);
        this.out();
        (this.el.querySelector<HTMLElement>('.cult-found') ?? this.el).focus({ preventScroll: true });
      });
      box.replaceChildren(note, h('div', { class: 'sc-row' }, yes, no));
      no.focus();
    });
    box.append(ask);
    return box;
  }
}

/** Ranks down a board sorted deepest first; equal totals share a rank. */
function rankRows(rows: CultRow[]): Array<{ n: number; tied: boolean }> {
  return rows.map((r) => {
    const n = 1 + rows.filter((o) => o.total > r.total).length;
    return { n, tied: rows.some((o) => o !== r && o.total === r.total) };
  });
}

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
const ordinalWord = (n: number) => ORDINAL_WORDS[n - 1] ?? `number ${n}`;

function dayCell(c: DayCell, most: number): HTMLElement {
  const dived = c.depth != null && c.depth > 0;
  const fill = dived ? Math.max(0.08, Math.min(1, c.depth! / most)) : 0;
  return h(
    'li',
    { class: `cult-day is-${c.state}${dived ? ' has-dive' : ''}`, style: `--fill: ${fill.toFixed(3)}` },
    h('span', { class: 'cult-day-col' }, h('span', { class: 'cult-day-line' })),
    h('span', { class: 'cult-day-v' }, dived ? shortMetres(c.depth!) : c.state === 'future' ? '' : '·'),
  );
}

function daysSpoken(cells: DayCell[]): string {
  const said: string[] = [];
  const toCome: string[] = [];
  for (const c of cells) {
    const day = WEEKDAYS[c.index];
    if (c.state === 'future') toCome.push(day);
    else if (c.depth) said.push(`${day}${c.state === 'today' ? ', today,' : ''} ${fmtMetres(c.depth)} metres`);
    else said.push(c.state === 'today' ? `${day}, today, no dive yet` : `${day} no dive`);
  }
  const rest = toCome.length ? ` ${capitalise(listNames(toCome))} still to come.` : '';
  return `${said.join('; ')}.${rest}`;
}

/** The cult's emblem for the way in: its icon in an engraved roundel, ringed by twelve marks. */
function emblem(): string {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i / 12) * Math.PI * 2;
    const x1 = 50 + Math.cos(a) * 41;
    const y1 = 50 + Math.sin(a) * 41;
    const x2 = 50 + Math.cos(a) * 45;
    const y2 = 50 + Math.sin(a) * 45;
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}"/>`;
  }).join('');
  return `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false"><g class="ce-rule" fill="none"><circle cx="50" cy="50" r="47"/><circle cx="50" cy="50" r="39" class="ce-fine"/><circle cx="50" cy="50" r="33" stroke-dasharray="1.5 3" class="ce-fine"/></g><g class="ce-ticks">${ticks}</g><g class="ce-icon" transform="translate(29 28) scale(1.75)">${icon('cult', 'ce-svg').replace('viewBox="0 0 24 24" ', 'width="24" height="24" viewBox="0 0 24 24" ')}</g></svg>`;
}
