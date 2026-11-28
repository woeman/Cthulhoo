// What a class came to, for whoever held it: every diver's answers and depths,
// question by question, to read, to print, and to take away as a spreadsheet.
// And the list of the classes this device has kept. None of it leaves the
// device unless the host carries it off as a file.

import '../../styles/class-extras.css';
import { addOwnAnswer, loadOwnSets, ownSetOf, saveOwnSet } from '../../game/ownsets';
import { answersCsv, dropClassLog, givenBy, listClassLogs, logDivers, logFileName, marksCsv, questionCount, refusedOf, uncountedOf, type ClassLog, type ClassLogHead, type LogCell, type LogQuestion, type LogWords } from '../../party/class-log';
import { fmtMetres, h } from '../../ui/dom';
import { listNames } from '../seance/model';
import { sealEl, tierName } from '../seance/parts';
import { Scene, uniq, type Ctx } from '../seance/scene';
import { boutLine, classLine, MODE_COPY, plural, tableName, tableStyle } from './parts';

/** A moment as the host's own device writes dates: "Saturday 28 November 2026, 3:30 pm". */
export function whenOf(at: number, long = true): string {
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  try {
    const day = d.toLocaleDateString(undefined, long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short', year: 'numeric' });
    return `${day}, ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * Hands the browser a file to save. A spreadsheet's file begins with the mark
 * that tells Excel its letters are UTF-8, or an é in a name arrives as two
 * wrong letters.
 */
export function saveFile(name: string, text: string, type: 'text/csv' | 'text/plain'): boolean {
  try {
    const blob = new Blob([type === 'text/csv' ? String.fromCharCode(0xfeff) : '', text], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: name, hidden: true });
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
    return true;
  } catch {
    return false;
  }
}

/** Names in a line, cut where a class of hundreds would run on. */
function nameLine(names: string[], max: number): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} and ${(names.length - max).toLocaleString('en-GB')} more`;
}

/** A class in a line for its heading and the list: "23 divers · 5 questions". */
const sizeLine = (divers: number, questions: number): string => `${plural(divers, 'diver')} · ${plural(questions, 'question')}`;

export interface ResultsOpts {
  /** False when the device had no room to keep the class: it is here only until the page is closed. */
  kept: boolean;
  back(): void;
}

export class ResultsScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, log: ClassLog, opts: ResultsOpts) {
    super(ctx);
    this.key = `cv-results:${log.id}`;
    const theme = this.env.theme;
    const titleId = uniq('cr-title');
    const divers = logDivers(log);
    const tables = divers.some((d) => d.table > 0);
    const words: LogWords = { tier: (t) => tierName(theme, t), table: tableName, mode: (m) => MODE_COPY[m].name };

    const note = h('p', { class: 'cr-note no-print', role: 'status' });
    const tell = (m: string) => {
      note.textContent = m;
      this.env.announce(m);
    };
    const act = (label: string, cls: string, run: () => void): HTMLButtonElement => {
      const b = h('button', { class: `btn ${cls}`, type: 'button' }, label) as HTMLButtonElement;
      b.addEventListener('click', () => {
        this.click();
        run();
      });
      return b;
    };
    const save = (kind: string, text: string, what: string) => {
      const name = logFileName(log, kind);
      tell(saveFile(name, text, 'text/csv') ? `${what} saved as ${name}. Look in this device’s downloads.` : 'This browser would not save a file. Print the page instead.');
    };
    const marks = act('Download the marks (.csv)', 'primary', () => save('marks', marksCsv(log, words), 'The marks were'));
    const answers = act('Download every answer (.csv)', 'ghost', () => save('answers', answersCsv(log, words), 'Every answer was'));
    const print = act('Print, or save as a PDF', 'ghost', () => window.print());
    const back = act('Back', 'ghost', () => opts.back());
    note.textContent = opts.kept
      ? 'These results are kept on this device only, with the last classes held on it. The marks file has a row for each diver; the answers file a row for everything anyone typed.'
      : 'This device has no room left to keep this class. Download or print the results before closing the page.';
    if (!opts.kept) note.classList.add('is-warn');

    // ---- the class: one row a diver
    const head = h('tr', {}, h('th', { scope: 'col', class: 'cr-num' }, 'Place'), h('th', { scope: 'col' }, 'Name'), tables ? h('th', { scope: 'col' }, 'Table') : null, h('th', { scope: 'col', class: 'cr-num' }, 'Depth'));
    for (const q of log.questions) head.append(h('th', { scope: 'col', class: 'cr-qh', title: q.prompt.text }, h('abbr', { title: q.prompt.text }, `Q${q.n}`)));
    const body = h('tbody', {});
    const cellEl = (cell: LogCell | null): HTMLElement => {
      if (!cell) return h('td', { class: 'cr-c is-out' });
      if (!cell.answers.length) {
        // Someone who tried and was refused is not someone who gave nothing: their first try is shown, struck out.
        const tries = cell.tries.map((t) => t.trim()).filter(Boolean);
        if (tries.length)
          return h(
            'td',
            { class: 'cr-c is-refused', title: `Refused: ${tries.join(', ')}` },
            h('span', { class: 'visually-hidden' }, 'refused: '),
            h('s', { class: 'cr-x' }, tries[0]),
            tries.length > 1 ? h('span', { class: 'cr-g' }, ` and ${tries.length - 1} more`) : null,
          );
        return h('td', { class: `cr-c ${cell.here ? 'is-none' : 'is-away'}` }, cell.here ? h('span', { 'aria-label': 'no answer' }, '–') : 'away');
      }
      const td = h('td', { class: 'cr-c' });
      cell.answers.forEach((a, i) => td.append(i ? ', ' : '', h('span', { class: 'cr-a', 'data-tier': String(a.tier), style: `--tier-color: var(--color-tier-${a.tier})`, title: `${tierName(theme, a.tier)} · +${fmtMetres(a.depth)} m` }, a.answer)));
      // The space stands outside the metres, so they may fall to the next line and leave the answer beside its dot.
      td.append(' ', h('span', { class: 'cr-g' }, `+${fmtMetres(cell.gain)}`));
      return td;
    };
    for (const d of divers) {
      const tied = divers.some((x) => x !== d && x.rank === d.rank);
      body.append(
        h(
          'tr',
          { style: tables && d.table ? tableStyle(d.table) : '' },
          h('td', { class: 'cr-num' }, `${tied ? '=' : ''}${d.rank}`),
          h('th', { scope: 'row', class: 'cr-name' }, d.name),
          tables ? h('td', { class: 'cr-tbl' }, d.table ? h('span', { class: 'cv-dot', 'aria-hidden': 'true' }) : null, d.table ? tableName(d.table) : '') : null,
          h('td', { class: 'cr-num cr-depth' }, fmtMetres(d.total), h('span', { class: 'u' }, ' m')),
          ...d.cells.map(cellEl),
        ),
      );
    }
    const wide = log.questions.length > 8;
    const table = h('table', { class: `cr-table${wide ? ' is-wide' : ''}` }, h('caption', { class: 'visually-hidden' }, 'Every diver, deepest first, with what each gave to each question'), h('thead', {}, head), body);
    const tableTotals = log.tableTotals ?? [];
    const tablesLine =
      tables && tableTotals.length > 1
        ? h(
            'p',
            { class: 'cr-tables' },
            ...tableTotals
              .map((total, t) => ({ t, total }))
              .filter((x) => x.t > 0)
              .sort((a, b) => b.total - a.total)
              .map((x) => h('span', { class: 'cr-tables-t', style: tableStyle(x.t) }, h('span', { class: 'cv-dot', 'aria-hidden': 'true' }), `${tableName(x.t)} ${fmtMetres(x.total)} m`)),
          )
        : null;
    const classPlate = h(
      'section',
      { class: 'plate cr-class', 'aria-label': 'The class' },
      h('h3', { class: 'sc-h' }, 'The class', h('span', { class: 'sc-count' }, 'deepest first')),
      divers.length ? h('div', { class: 'cr-scroll', tabindex: '0', role: 'group', 'aria-label': 'The table of the class: it scrolls sideways' }, table) : h('p', { class: 'cv-roll-empty' }, 'Nobody was seated.'),
      tablesLine,
      wide ? h('p', { class: 'cr-print-note' }, 'On paper this table keeps to places and depths: each question’s answers are printed under it below.') : null,
    );

    // ---- question by question
    const details: HTMLDetailsElement[] = [];
    const sets = loadOwnSets();
    const qEls = log.questions.map((q) => this.question(q, sets, tables, details, tell));
    const toggle = h('button', { class: 'btn ghost cr-toggle no-print', type: 'button', 'aria-pressed': 'false' }, 'Show the refused answers') as HTMLButtonElement;
    toggle.hidden = !details.length;
    toggle.addEventListener('click', () => {
      this.click();
      const open = toggle.getAttribute('aria-pressed') !== 'true';
      toggle.setAttribute('aria-pressed', String(open));
      toggle.textContent = open ? 'Hide the refused answers' : 'Show the refused answers';
      for (const d of details) d.open = open;
    });

    this.el = h(
      'div',
      { class: 'sc-scene cr-results', 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'cr-head' },
        h('p', { class: 'kicker' }, log.ended ? 'The results of a class' : 'The results of a class, so far'),
        this.heading('h2', whenOf(log.at) || log.sign, 'cr-title', titleId),
        h('p', { class: 'cr-line' }, `${log.sign} · ${classLine(log.config)}`),
        h('p', { class: 'cr-line' }, sizeLine(divers.length, log.questions.length)),
      ),
      h('div', { class: 'sc-row cr-acts no-print' }, marks, answers, print, back),
      note,
      classPlate,
      h('section', { class: 'cr-questions', 'aria-label': 'Question by question' }, h('div', { class: 'cr-questions-head' }, h('h3', { class: 'sc-h cr-questions-k' }, 'Question by question', h('span', { class: 'sc-count' }, 'rarest answers first')), toggle), ...qEls),
    );
    // Paper wants ink on white and the whole page, not the screen's window on it: the page is told while results are on show.
    document.documentElement.classList.add('cr-printing');
    this.stops.push(() => document.documentElement.classList.remove('cr-printing'));
  }

  private question(q: LogQuestion, sets: ReturnType<typeof loadOwnSets>, tables: boolean, details: HTMLDetailsElement[], tell: (m: string) => void): HTMLElement {
    const theme = this.env.theme;
    const count = questionCount(q);
    const who = givenBy(q);
    const bout = q.last;
    const sum = bout
      ? [boutLine(bout, tables), plural(bout.turns, 'turn'), `${plural(count.given, 'answer')} named of the ${q.known.toLocaleString('en-GB')} the deep knew`]
      : [`${count.answered} of ${count.here} answered`, `${plural(count.given, 'different answer')} of the ${q.known.toLocaleString('en-GB')} the deep knew`];
    const list = h('ul', { class: 'cr-answers' });
    q.answers.forEach((a, k) => {
      list.append(
        h(
          'li',
          { class: `cr-answer${a.voices === 1 && !bout ? ' is-lone' : ''}`, 'data-tier': String(a.tier), style: `--tier-color: var(--color-tier-${a.tier})` },
          sealEl(a.tier, 'seal cr-answer-seal'),
          h('span', { class: 'cr-answer-a' }, a.answer),
          h('span', { class: 'cr-answer-t' }, tierName(theme, a.tier)),
          h('span', { class: 'cr-answer-d' }, `+${fmtMetres(a.depth)} m`),
          h('span', { class: 'cr-answer-who' }, bout || a.voices === 1 ? '' : `${a.voices} · `, nameLine(who[k] ?? [], 40)),
        ),
      );
    });
    const { refused: refusedOnly, silent, away } = uncountedOf(q);
    const line = (k: string, v: string) => h('p', { class: 'cr-q-line' }, h('span', { class: 'k' }, k), ' ', v);
    const refused = refusedOf(q);
    const set = ownSetOf(q.prompt.id, sets);
    let refusedEl: HTMLElement | null = null;
    if (refused.length) {
      const items = refused.map((r) => {
        const li = h('li', { class: 'cr-refusal' }, h('span', { class: 'cr-refusal-a' }, r.text), h('span', { class: 'cr-refusal-who' }, r.count > 1 ? `${r.count} · ` : '', nameLine(r.names, 12)));
        if (set) {
          // The teacher's own question: an answer the class was right about can be written into the set from here.
          const add = h('button', { class: 'cr-add no-print', type: 'button', 'aria-label': `Count ${r.text} as an answer next time` }, 'Count it next time') as HTMLButtonElement;
          add.addEventListener('click', () => {
            this.click();
            const now = loadOwnSets().find((s) => s.id === set.id);
            const text = now ? addOwnAnswer(now, q.prompt.id, r.text) : null;
            const done = !!now && text !== null && (text === now.text || saveOwnSet({ ...now, text, at: Date.now() }) === 'kept');
            add.disabled = true;
            add.textContent = done ? `Written into ${set.name}` : 'Not written';
            tell(done ? `“${r.text}” is now an answer to this question in your set ${set.name}, as its rarest. Open the set to move it, or to make it a spelling of another answer.` : `“${r.text}” could not be written into ${set.name}: the question has changed there, or the set names it as wrong. Open the set to write it in.`);
          });
          li.append(add);
        }
        return li;
      });
      const d = h('details', { class: 'cr-refused' }, h('summary', {}, h('span', {}, `Refused: ${plural(refused.length, 'different answer')}`)), h('ul', { class: 'cr-refusals' }, ...items)) as HTMLDetailsElement;
      details.push(d);
      refusedEl = d;
    }
    const cut = q.cut === 'typed' ? 'So many answers were given that the relay sent neither the refused ones nor what was typed.' : q.cut === 'tries' ? 'So many answers were given that the relay did not send the refused ones.' : '';
    const filed = [`Question ${q.n}`, MODE_COPY[q.mode].name, q.prompt.topic].filter(Boolean).join(' · ');
    return h(
      'article',
      { class: 'plate cr-q' },
      h('p', { class: 'kicker cr-q-k' }, filed),
      h('h4', { class: 'cr-q-text' }, q.prompt.text),
      q.prompt.rules ? h('p', { class: 'cr-q-rules' }, q.prompt.rules) : null,
      h('p', { class: 'cr-q-sum' }, sum.join(' · ')),
      q.answers.length ? list : h('p', { class: 'cv-roll-empty' }, bout ? 'Nothing was named.' : 'Nobody gave an answer the deep took.'),
      q.unsaid.length ? line('Nobody gave', `${q.unsaid.map((u) => u.answer).join(', ')}${q.known - q.answers.length > q.unsaid.length ? ` (the rarest of ${(q.known - q.answers.length).toLocaleString('en-GB')} left unsaid)` : ''}`) : null,
      refusedOnly.length && !bout ? line('Only refused answers', nameLine(refusedOnly, 60)) : null,
      silent.length && !bout ? line(q.cut ? 'No answer counted' : 'Gave nothing', nameLine(silent, 60)) : null,
      away.length ? line('Not here', nameLine(away, 60)) : null,
      refusedEl,
      cut ? h('p', { class: 'cr-q-line is-cut' }, cut) : null,
    );
  }
}

// ------------------------------------------------------------------ past classes

export interface PastActions {
  open(id: string): void;
  back(): void;
}

/** The classes this device has kept, newest first. */
export class PastClassesScene extends Scene {
  readonly key = 'cv-past';
  private list: HTMLElement;
  private empty: HTMLElement;
  private armed: string | null = null;
  private disarm = 0;

  constructor(
    ctx: Ctx,
    private actions: PastActions,
  ) {
    super(ctx);
    const titleId = uniq('cr-past');
    this.list = h('ul', { class: 'cr-past-list' });
    this.empty = h('p', { class: 'cv-roll-empty' }, 'No class is kept on this device yet. Hold one, and what it came to is kept here.');
    const back = h('button', { class: 'btn ghost', type: 'button' }, 'Back');
    back.addEventListener('click', () => {
      this.click();
      this.actions.back();
    });
    this.el = h(
      'div',
      { class: 'sc-scene cr-past', 'aria-labelledby': titleId },
      h('header', { class: 'cr-head' }, this.heading('h2', 'Past classes', 'sc-title', titleId), h('p', { class: 'sc-lede' }, 'What your classes came to, kept on this device: the last thirty, newest first.')),
      h('div', { class: 'plate cr-past-plate' }, this.empty, this.list),
      h('div', { class: 'sc-actions' }, back),
    );
    this.stops.push(() => clearTimeout(this.disarm));
    this.render();
  }

  private row(head: ClassLogHead): HTMLElement {
    const armed = this.armed === head.id;
    const modes = head.modes.map((m) => MODE_COPY[m].name);
    const open = h(
      'button',
      { class: 'cr-past-open', type: 'button' },
      h('span', { class: 't' }, whenOf(head.at, false) || head.sign),
      h('span', { class: 'd' }, [head.sign, sizeLine(head.divers, head.questions), modes.length ? listNames(modes) : null, head.topics.length ? head.topics.join(', ') : null, head.ended ? null : 'not ended'].filter(Boolean).join(' · ')),
    );
    open.addEventListener('click', () => {
      this.click();
      this.actions.open(head.id);
    });
    const drop = h('button', { class: `cr-past-drop${armed ? ' is-armed' : ''}`, type: 'button', 'aria-label': armed ? `Forget the class of ${whenOf(head.at, false)}: press again to confirm` : `Forget the class of ${whenOf(head.at, false)}` }, armed ? 'Forget it?' : 'Forget');
    drop.addEventListener('click', () => {
      this.click();
      clearTimeout(this.disarm);
      if (this.armed === head.id) {
        this.armed = null;
        dropClassLog(head.id);
        this.env.announce('The class is forgotten.');
        this.render();
        return;
      }
      this.armed = head.id;
      this.disarm = this.later(() => {
        this.armed = null;
        this.render();
      }, 4000);
      this.render();
      this.list.querySelector<HTMLElement>(`[data-id="${CSS.escape(head.id)}"] .cr-past-drop`)?.focus({ preventScroll: true });
    });
    return h('li', { class: 'cr-past-row', 'data-id': head.id }, open, drop);
  }

  private render() {
    const heads = listClassLogs();
    this.empty.hidden = heads.length > 0;
    this.list.replaceChildren(...heads.map((hd) => this.row(hd)));
  }
}
