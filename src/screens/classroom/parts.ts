// Pieces the Convocation's screens share: the choices a host makes, the answers
// as they surface for a whole class, and the standings of divers and of tables.

import { topicsPhrase } from '../../game/topics';
import type { ThemeCopy } from '../../game/types';
import type { ClassAnswerRow, ClassConfig, ClassMode, ClassStanding, ClassTableGain, ClassView } from '../../party/class-types';
import { fmtMetres, h } from '../../ui/dom';
import { tintOf } from '../seance/model';
import { sealEl, tierName } from '../seance/parts';

export const MODE_COPY: Record<ClassMode, { name: string; line: string; how: string }> = {
  classic: { name: 'Classic', line: 'one answer each', how: 'One answer each. Rarer answers sink deeper, and one nobody else gives sinks half as deep again.' },
  blitz: { name: 'Blitz', line: 'every answer you can', how: 'Give every answer you can before the candle is out. Each one sinks you, the rare ones deepest.' },
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
  const parts = [MODE_COPY[config.mode].name, `${config.seconds} seconds a question`];
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
  return {
    el: h('fieldset', { class: `sc-choices cv-choices ${cls}`.trim() }, h('legend', { class: 'sc-choices-k' }, label), opts),
    set(value) {
      for (const i of inputs) i.input.checked = i.value === value;
    },
    setOptions(list, cur) {
      build(list, cur);
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
export function answerList(theme: ThemeCopy, rows: ClassAnswerRow[], opts: { max?: number; given?: number; names?: boolean } = {}): HTMLElement {
  const max = opts.max ?? rows.length;
  const shown = rows.slice(0, max);
  const list = h('ul', { class: 'cv-answers' });
  for (const r of shown) {
    list.append(
      h(
        'li',
        { class: `cv-answer${r.voices === 1 ? ' is-lone' : ''}`, 'data-tier': String(r.tier), style: `--tier-color: var(--color-tier-${r.tier})` },
        sealEl(r.tier, 'seal cv-answer-seal'),
        h('span', { class: 'cv-answer-a' }, r.answer),
        h('span', { class: 'cv-answer-t' }, tierName(theme, r.tier)),
        h('span', { class: 'cv-answer-who' }, opts.names === false ? (r.voices === 1 ? 'a lone voice' : `${r.voices} voices`) : voicesNote(r)),
        h('span', { class: 'cv-answer-d' }, `+${fmtMetres(r.depth)}`, h('span', { class: 'u' }, ' m')),
      ),
    );
  }
  const more = (opts.given ?? rows.length) - shown.length;
  if (more > 0) list.append(h('li', { class: 'cv-answer-more' }, `and ${plural(more, 'more answer')}, more common than these`));
  return list;
}

/** The deepest divers. `you` marks this device's own row; with tables, each row wears its table's colour. */
export function classStandings(rows: ClassStanding[], opts: { you?: string; gains?: boolean; tables?: boolean; max?: number } = {}): HTMLElement {
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
        h('span', { class: 'sc-stand-name' }, r.name, you ? h('span', { class: 'sc-you' }, ' · you') : null, opts.tables && r.table ? h('span', { class: 'visually-hidden' }, `, table ${tableName(r.table)}`) : null),
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
export function tableBoard(rows: TableRow[], opts: { you?: number; gains?: boolean } = {}): HTMLElement {
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
        h('span', { class: 'cv-table-seats' }, plural(r.seats, 'diver')),
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
