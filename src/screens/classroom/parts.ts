// Pieces the Convocation's screens share: the choices a host makes, the answers
// as they surface for a whole class, and the standings of divers and of tables.

import { topicsPhrase } from '../../game/topics';
import type { ThemeCopy } from '../../game/types';
import { CLASS_LANTERNS, type ClassAnswerRow, type ClassConfig, type ClassLastBeat, type ClassLastResult, type ClassLastSide, type ClassLastView, type ClassMode, type ClassStanding, type ClassTableGain, type ClassView } from '../../party/class-types';
import { fmtMetres, h } from '../../ui/dom';
import { tintOf } from '../seance/model';
import { sealEl, tierName } from '../seance/parts';

export const MODE_COPY: Record<ClassMode, { name: string; line: string; how: string }> = {
  classic: { name: 'Classic', line: 'one answer each', how: 'One answer each. Rarer answers sink deeper, and one nobody else gives sinks half as deep again.' },
  blitz: { name: 'Blitz', line: 'every answer you can', how: 'Give every answer you can before the candle is out. Each one sinks you, the rare ones deepest.' },
  last: { name: 'Last diver standing', line: 'take turns until one is left', how: 'Take turns naming an answer nobody has named yet. One already named, or a turn that runs out, puts out a lantern. The last with a lantern lit wins.' },
};

/** Tables are named for things of the deep, so a class can cheer for one. */
export const TABLE_NAMES = ['Kraken', 'Dagon', 'Hydra', 'Siren', 'Selkie', 'Wraith', 'Raven', 'Urchin'] as const;
export const tableName = (t: number): string => TABLE_NAMES[t - 1] ?? `Table ${t}`;
/** A table's own colour, one of the six tier colours. */
export const tableStyle = (t: number): string => `--sitter: var(--color-tier-${tintOf(Math.max(0, t - 1))})`;

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** A place as a class of hundreds needs it: 1st, 2nd, 23rd, 112th. */
export function nth(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n.toLocaleString('en-GB')}${suffix}`;
}

/** How the class is held, in a line: "Classic · 30 seconds a question · 4 tables · Finance". */
export function classLine(config: ClassConfig): string {
  const bout = config.mode === 'last';
  const parts = [MODE_COPY[config.mode].name, `${config.seconds} seconds a ${bout ? 'turn' : 'question'}`];
  if (bout) parts.push(plural(config.lanterns ?? CLASS_LANTERNS[0], 'lantern'));
  if (config.tables) parts.push(`${config.tables} tables`);
  if (config.topics?.length) parts.push(topicsPhrase(config.topics));
  return parts.join(' · ');
}

/** "Question 3 of 5", never "6 of 5" when the host asks one more. */
export const questionOf = (view: Pick<ClassView, 'n' | 'config'>): string => `Question ${view.n} of ${Math.max(view.n, view.config.questions)}`;

export interface Choice<T> {
  value: T;
  /** The large figure or word. */
  v: string;
  /** The small word after it. */
  u?: string;
}

export interface PickRow<T> {
  el: HTMLElement;
  set(value: T): void;
  /** Other options altogether (the seconds a blitz may burn are not a classic's). */
  setOptions(options: Array<Choice<T>>, current: T): void;
  /** Other words over the row (a bout burns by the turn, not by the question). */
  setLabel(label: string): void;
}

/** A row of choices that reads as one control, as the séance's candles and seconds do. */
export function pickRow<T>(label: string, options: Array<Choice<T>>, current: T, onPick: (value: T) => void, cls = ''): PickRow<T> {
  const name = `cv-${Math.random().toString(36).slice(2, 8)}`;
  const opts = h('div', { class: 'sc-choice-opts' });
  let inputs: Array<{ input: HTMLInputElement; value: T }> = [];
  const build = (list: Array<Choice<T>>, cur: T) => {
    inputs = [];
    opts.textContent = '';
    opts.style.setProperty('--cols', String(Math.min(list.length, 4)));
    for (const o of list) {
      const input = h('input', { type: 'radio', name, class: 'visually-hidden' }) as HTMLInputElement;
      input.checked = o.value === cur;
      input.addEventListener('change', () => input.checked && onPick(o.value));
      inputs.push({ input, value: o.value });
      opts.append(h('label', { class: 'sc-choice' }, input, h('span', { class: 'v' }, o.v), o.u ? h('span', { class: 'u' }, o.u) : null));
    }
  };
  build(options, current);
  const legend = h('legend', { class: 'sc-choices-k' }, label);
  return {
    el: h('fieldset', { class: `sc-choices cv-choices ${cls}`.trim() }, legend, opts),
    set(value) {
      for (const i of inputs) i.input.checked = i.value === value;
    },
    setOptions(list, cur) {
      build(list, cur);
    },
    setLabel(text) {
      legend.textContent = text;
    },
  };
}

/** Who gave an answer, as a class reads it: a lone voice by name, a chorus by its number. */
export function voicesNote(row: Pick<ClassAnswerRow, 'voices' | 'names'>): string {
  if (row.voices === 1) return row.names[0] ? `a lone voice · ${row.names[0]}` : 'a lone voice';
  const named = row.names.slice(0, 2).join(', ');
  const rest = row.voices - Math.min(2, row.names.length);
  return named ? `${row.voices} voices · ${named}${rest > 0 ? ` and ${rest} more` : ''}` : `${row.voices} voices`;
}

/** The answers the class gave, rarest first: seal, answer, how rare, who, how deep. */
export function answerList(theme: ThemeCopy, rows: ClassAnswerRow[], opts: { max?: number; given?: number; names?: boolean; bout?: boolean } = {}): HTMLElement {
  const max = opts.max ?? rows.length;
  const shown = rows.slice(0, max);
  const list = h('ul', { class: 'cv-answers' });
  for (const r of shown) {
    list.append(
      h(
        'li',
        { class: `cv-answer${r.voices === 1 && !opts.bout ? ' is-lone' : ''}`, 'data-tier': String(r.tier), style: `--tier-color: var(--color-tier-${r.tier})` },
        sealEl(r.tier, 'seal cv-answer-seal'),
        h('span', { class: 'cv-answer-a' }, r.answer),
        h('span', { class: 'cv-answer-t' }, tierName(theme, r.tier)),
        // In a bout every answer is named once: who named it is all there is to say.
        h('span', { class: 'cv-answer-who' }, opts.bout ? (r.names[0] ?? '') : opts.names === false ? (r.voices === 1 ? 'a lone voice' : `${r.voices} voices`) : voicesNote(r)),
        h('span', { class: 'cv-answer-d' }, `+${fmtMetres(r.depth)}`, h('span', { class: 'u' }, ' m')),
      ),
    );
  }
  const more = (opts.given ?? rows.length) - shown.length;
  if (more > 0) list.append(h('li', { class: 'cv-answer-more' }, `and ${plural(more, 'more answer')}, more common than these`));
  return list;
}

/** The deepest divers. `you` marks this device's own row; with tables, each row wears its table's colour. */
export function classStandings(rows: ClassStanding[], opts: { you?: string; gains?: boolean; tables?: boolean; max?: number; marks?: (id: string) => HTMLElement | null } = {}): HTMLElement {
  const shown = rows.slice(0, opts.max ?? rows.length);
  const deepest = Math.max(1, ...rows.map((r) => r.total));
  const list = h('ol', { class: 'sc-standings cv-standings' });
  for (let i = 0; i < shown.length; i++) {
    const r = shown[i];
    const tied = shown.some((x, j) => j !== i && x.rank === r.rank);
    const you = r.id === opts.you;
    const share = Math.max(0, Math.min(1, r.total / deepest));
    list.append(
      h(
        'li',
        { class: `sc-stand${you ? ' is-you' : ''}${r.rank === 1 && r.total > 0 ? ' is-first' : ''}`, style: opts.tables && r.table ? tableStyle(r.table) : '--sitter: var(--color-glow)' },
        h('span', { class: 'sc-stand-rank', 'aria-hidden': 'true' }, `${tied ? '=' : ''}${r.rank}`),
        opts.tables && r.table ? h('span', { class: 'cv-dot', title: tableName(r.table), 'aria-hidden': 'true' }) : null,
        h('span', { class: 'sc-stand-name' }, r.name, you ? h('span', { class: 'sc-you' }, ' · you') : null, opts.tables && r.table ? h('span', { class: 'visually-hidden' }, `, table ${tableName(r.table)}`) : null, opts.marks?.(r.id) ?? null),
        opts.gains && r.gain ? h('span', { class: 'sc-stand-gain' }, `+${fmtMetres(r.gain)}`) : null,
        h('span', { class: 'sc-stand-total' }, fmtMetres(r.total), h('span', { class: 'u' }, ' m')),
        h('span', { class: 'sc-stand-line', 'aria-hidden': 'true' }, h('span', { style: `width:${(share * 100).toFixed(1)}%` })),
        h('span', { class: 'visually-hidden' }, `, ${tied ? 'tied ' : ''}${r.rank === 1 ? 'deepest' : `place ${r.rank}`}${opts.gains && r.gain ? `, ${fmtMetres(r.gain)} metres this question` : ''}.`),
      ),
    );
  }
  return list;
}

export interface TableRow {
  table: number;
  total: number;
  gain: number;
  seats: number;
  rank: number;
}

/** The tables as they stand, deepest first; equal depths share a place. */
export function tableRows(view: Pick<ClassView, 'tableTotals' | 'tableSeats'>, gains?: ClassTableGain[]): TableRow[] {
  const totals = view.tableTotals ?? [];
  const rows: TableRow[] = [];
  for (let t = 1; t < Math.max(totals.length, view.tableSeats?.length ?? 0); t++) {
    rows.push({ table: t, total: totals[t] ?? 0, gain: gains?.find((g) => g.table === t)?.gain ?? 0, seats: view.tableSeats?.[t] ?? 0, rank: 0 });
  }
  rows.sort((a, b) => b.total - a.total || a.table - b.table);
  rows.forEach((r, i) => (r.rank = i > 0 && rows[i - 1].total === r.total ? rows[i - 1].rank : i + 1));
  return rows;
}

/** The tables' board: each with its name, its divers, what it won this question and how deep it is. */
export function tableBoard(rows: TableRow[], opts: { you?: number; gains?: boolean; marks?: (table: number) => HTMLElement | null } = {}): HTMLElement {
  const deepest = Math.max(1, ...rows.map((r) => r.total));
  const list = h('ol', { class: 'cv-tables' });
  for (const r of rows) {
    const share = Math.max(0, Math.min(1, r.total / deepest));
    list.append(
      h(
        'li',
        { class: `cv-table${r.table === opts.you ? ' is-you' : ''}${r.rank === 1 && r.total > 0 ? ' is-first' : ''}`, style: tableStyle(r.table) },
        h('span', { class: 'cv-table-rank', 'aria-hidden': 'true' }, String(r.rank)),
        h('span', { class: 'cv-table-name' }, tableName(r.table), r.table === opts.you ? h('span', { class: 'sc-you' }, ' · yours') : null),
        h('span', { class: 'cv-table-seats' }, opts.marks?.(r.table) ?? plural(r.seats, 'diver')),
        opts.gains && r.gain ? h('span', { class: 'cv-table-gain' }, `+${fmtMetres(r.gain)}`) : h('span', { class: 'cv-table-gain' }),
        h('span', { class: 'cv-table-total' }, fmtMetres(r.total), h('span', { class: 'u' }, ' m')),
        h('span', { class: 'cv-table-line', 'aria-hidden': 'true' }, h('span', { style: `width:${(share * 100).toFixed(1)}%` })),
        h('span', { class: 'visually-hidden' }, `, ${r.rank === 1 ? 'deepest' : `${nth(r.rank)} place`}.`),
      ),
    );
  }
  return list;
}

/** A place said as a person says it: "4th of 23". */
export const placeOf = (rank: number, of: number): string => `${nth(rank)} of ${of.toLocaleString('en-GB')}`;

// ------------------------------------------------------- last diver standing

/** A side of a bout by name: its table's, or the diver's own. */
export const sideName = (side: Pick<ClassLastSide, 'table' | 'name'>): string => (side.table ? tableName(side.table) : (side.name ?? 'A diver'));

/** A side's colour: its table's, or one of the six by its place in the turn order. */
export const sideStyle = (side: Pick<ClassLastSide, 'table'>, place: number): string => (side.table ? tableStyle(side.table) : `--sitter: var(--color-tier-${tintOf(place)})`);

/** The side this device plays for, as a place in the bout's sides; -1 when it only watches. */
export function mySide(view: Pick<ClassView, 'you' | 'config'>, sides: ClassLastSide[]): number {
  const you = view.you;
  if (!you) return -1;
  return sides.findIndex((s) => (view.config.tables ? s.table === you.table : s.id === you.id));
}

const LANTERN =
  '<svg viewBox="0 0 16 22" aria-hidden="true" focusable="false"><path class="l-ring" d="M5.6 4.4a2.4 2.4 0 0 1 4.8 0"/><path class="l-cap" d="M4.2 6.6h7.6l-1-2.2H5.2z"/><rect class="l-glass" x="3.6" y="6.6" width="8.8" height="11" rx="2.4"/><path class="l-flame" d="M8 9.3c1.5 1.6 2.2 2.8 2.2 3.9a2.2 2.2 0 0 1-4.4 0c0-1.1.7-2.3 2.2-3.9z"/><path class="l-base" d="M3.4 19.6h9.2"/></svg>';

/** A side's lanterns, lit and dark, said once for a screen reader. */
export function lanternsEl(lit: number, of: number, cls = ''): HTMLElement {
  const el = h('span', { class: `cv-lanterns ${cls}`.trim(), role: 'img', 'aria-label': lit > 0 ? `${lit} of ${plural(of, 'lantern')} lit` : 'Every lantern out' });
  for (let i = 0; i < of; i++) el.append(h('span', { class: `cv-lantern${i < lit ? ' is-lit' : ''}`, html: LANTERN }));
  return el;
}

/** What the last turn came to, in a line for the room. */
export function beatLine(theme: ThemeCopy, beat: ClassLastBeat, last: Pick<ClassLastView, 'sides'>, tables: boolean): string {
  const side = last.sides[beat.side];
  const who = side ? sideName(side) : 'A side';
  const out = side && side.lanterns <= 0 ? ` ${who} is out.` : '';
  switch (beat.kind) {
    case 'said':
      return `${beat.name} named ${beat.answer}${tables ? ` for ${who}` : ''}. ${tierName(theme, beat.tier)}, +${fmtMetres(beat.depth)} m.`;
    case 'repeat':
      return `${beat.answer} had been named already. A lantern goes dark for ${who}.${out}`;
    case 'dark':
      return `${who} ran out of time. A lantern goes dark.${out}`;
    case 'away':
      return `${who} ${tables ? 'has nobody here' : 'is not here'}. A lantern goes dark.${out}`;
  }
}

/** How a bout ended, in a line: who stood last, or why nobody did. */
export function boutLine(last: Pick<ClassLastResult, 'ended' | 'sides' | 'winner'> & { turns?: number }, tables: boolean): string {
  const w = last.winner >= 0 ? last.sides[last.winner] : undefined;
  if (w) return `${sideName(w)} is the last ${tables ? 'table' : 'diver'} standing`;
  const lit = last.sides.filter((s) => s.lanterns > 0).length;
  const still = lit ? `, with ${plural(lit, tables ? 'table' : 'diver')} still standing` : '';
  switch (last.ended) {
    case 'none':
      return 'Every lantern is out';
    case 'dry':
      return 'Every answer the deep knew has been named';
    case 'cap':
      return `The bout was called after ${last.turns ?? 'too many'} turns${still}`;
    default:
      return `The bout was called${still}`;
  }
}

/** The sides of a bout as a strip: each with its name, its lanterns and what it has named. `turn` lights the side whose turn it is. */
export function sidesStrip(last: Pick<ClassLastView, 'sides' | 'lanterns'>, opts: { turn?: number; you?: number; compact?: boolean } = {}): HTMLElement {
  const list = h('ol', { class: `cv-sides${opts.compact ? ' is-compact' : ''}`, 'aria-label': 'The sides' });
  last.sides.forEach((side, k) => {
    const out = side.lanterns <= 0;
    list.append(
      h(
        'li',
        { class: `cv-side${k === opts.turn ? ' is-turn' : ''}${out ? ' is-out' : ''}${k === opts.you ? ' is-you' : ''}`, style: sideStyle(side, k), ...(k === opts.turn ? { 'aria-current': 'true' } : {}) },
        h('span', { class: 'cv-side-name' }, sideName(side), k === opts.you ? h('span', { class: 'sc-you' }, side.table ? ' · yours' : ' · you') : null),
        lanternsEl(side.lanterns, last.lanterns, 'cv-side-lanterns'),
        opts.compact ? null : h('span', { class: 'cv-side-said' }, out ? 'out' : plural(side.said, 'answer')),
        opts.compact ? null : h('span', { class: 'cv-side-gain' }, fmtMetres(side.gain), h('span', { class: 'u' }, ' m')),
      ),
    );
  });
  return list;
}

/** The answers named so far, newest first, each in its tier's colour. */
export function namedChips(theme: ThemeCopy, said: ClassLastView['said'], fresh = 0): HTMLElement {
  const list = h('ul', { class: 'cv-named' });
  said.forEach((a, i) => {
    list.append(h('li', { class: `cv-named-a${i < fresh ? ' is-fresh' : ''}`, 'data-tier': String(a.tier), style: `--tier-color: var(--color-tier-${a.tier})`, title: tierName(theme, a.tier) }, a.answer));
  });
  return list;
}
