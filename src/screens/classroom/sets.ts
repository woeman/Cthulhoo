// A teacher's own question sets: the list of those kept on this device, and the
// page a set is written on. A set is plain text (see game/ownsets.ts); as it is
// typed, the page shows the questions the deep reads in it, how deep each answer
// sinks, and anything it could not read.

import '../../styles/class-extras.css';
import { OWN_EXAMPLE, OWN_NAME_MAX, OWN_SETS_MAX, OWN_TEXT_MAX, cleanSetName, dropOwnSet, loadOwnSets, newOwnSet, parseOwnSet, readSetFile, saveOwnSet, setFileName, setFileText, type OwnParsed, type OwnSet } from '../../game/ownsets';
import type { PromptDef } from '../../game/types';
import { hear } from '../../party/room';
import { fmtMetres, h } from '../../ui/dom';
import { tierDepths } from '../seance/model';
import { tierName } from '../seance/parts';
import { Scene, uniq, type Ctx } from '../seance/scene';
import { plural } from './parts';
import { saveFile, whenOf } from './results';

/** The largest file taken as a set: far past the longest set, short of a mistake (a video, a whole textbook). */
const FILE_MAX = 400_000;

const countLine = (p: OwnParsed): string => {
  const answers = p.questions.reduce((n, q) => n + q.prompt.answers.length, 0);
  return p.questions.length ? `${plural(p.questions.length, 'question')} · ${plural(answers, 'answer')}` : 'No questions yet';
};

// ------------------------------------------------------------------ the list

export interface SetsActions {
  open(id: string): void;
  back(): void;
}

export class SetsScene extends Scene {
  readonly key = 'cv-sets';
  private msg: HTMLElement;

  constructor(
    ctx: Ctx,
    private actions: SetsActions,
    message = '',
  ) {
    super(ctx);
    const titleId = uniq('cs-sets');
    const sets = loadOwnSets().sort((a, b) => b.at - a.at);
    this.msg = h('p', { class: 'sc-msg', role: 'alert', hidden: !message }, message);
    const list = h('ul', { class: 'cs-list' });
    for (const s of sets) {
      const parsed = parseOwnSet(s.text, s);
      const open = h('button', { class: 'cs-open', type: 'button' }, h('span', { class: 't' }, s.name), h('span', { class: 'd' }, [countLine(parsed), s.at ? `changed ${whenOf(s.at, false)}` : null].filter(Boolean).join(' · ')));
      open.addEventListener('click', () => {
        this.click();
        this.actions.open(s.id);
      });
      list.append(h('li', {}, open));
    }
    const fresh = h('button', { class: 'btn primary', type: 'button' }, 'Write a new set');
    fresh.addEventListener('click', () => {
      this.click();
      this.begin('New set', '');
    });
    const file = h('input', { type: 'file', accept: '.txt,.text,.md,text/plain', class: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' }) as HTMLInputElement;
    const load = h('button', { class: 'btn ghost', type: 'button' }, 'Load a set from a file');
    load.addEventListener('click', () => {
      this.click();
      file.click();
    });
    file.addEventListener('change', () => void this.take(file));
    const back = h('button', { class: 'btn ghost', type: 'button' }, 'Back');
    back.addEventListener('click', () => {
      this.click();
      this.actions.back();
    });
    this.el = h(
      'div',
      { class: 'sc-scene cs-sets', 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'cr-head' },
        this.heading('h2', 'Your question sets', 'sc-title', titleId),
        h('p', { class: 'sc-lede' }, 'Write your own questions, then tick the set when you hold a class. Sets are kept on this device: download one to keep it safe, or to hand it to a colleague.'),
      ),
      h('div', { class: 'plate cs-list-plate' }, sets.length ? list : h('p', { class: 'cv-roll-empty' }, 'No set is written yet.'), this.msg),
      h('div', { class: 'sc-actions' }, h('div', { class: 'sc-row' }, fresh, load, back), file),
    );
  }

  private say(message: string) {
    this.msg.textContent = message;
    this.msg.hidden = !message;
    if (message) this.env.shout(message);
  }

  private begin(name: string, text: string) {
    const sets = loadOwnSets();
    if (sets.length >= OWN_SETS_MAX) return this.say(`This device keeps ${OWN_SETS_MAX} sets at most. Delete one you no longer need, then try again.`);
    const set = newOwnSet(name, text, Date.now(), sets);
    if (saveOwnSet(set) !== 'kept') return this.say('This device would not keep the set: its storage is full or closed to the game.');
    this.actions.open(set.id);
  }

  private async take(input: HTMLInputElement) {
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > FILE_MAX) return this.say('That file is too large to be a set. A set is a plain text file of questions and answers.');
    let text = '';
    try {
      text = await f.text();
    } catch {
      return this.say('That file could not be read.');
    }
    if (this.gone) return;
    const read = readSetFile(text, f.name);
    if (!parseOwnSet(read.text, { id: 'x', name: read.name }).questions.length) return this.say('No questions could be read in that file. A set is plain text: a question on a line, its answers on the lines under it, and an empty line before the next question.');
    this.begin(read.name, read.text);
  }
}

// ------------------------------------------------------------------ writing a set

export interface SetEditActions {
  done(): void;
}

const HOW = [
  'Leave an empty line between questions.',
  'The first line is the question. Each line under it is one answer.',
  'Other spellings of an answer follow it on the same line after a | stroke, as in: ASX | Australian Securities Exchange. Capitals, accents, plurals and small slips of the finger are forgiven without your listing them. The deep reads Latin letters and numbers: an answer in other letters needs one spelling in those.',
  'Write the answers commonest first. The further down its question an answer stands, the deeper it sinks. To say how deep yourself, end the line with a number in square brackets, from [1] (commonplace) to [6] (unspeakable). After a question, it sets every answer of that question.',
  'A line beginning Note: is shown under the question, to say what counts.',
  'A line beginning Not: names a wrong answer you expect, with other spellings after | strokes and, after two hyphens (--), why it is wrong. Whoever gives it is told why, and may try again.',
  'A numbered or bulleted list pastes in as it is: the numbers and bullets are dropped.',
];

export class SetEditScene extends Scene {
  readonly key: string;
  private set: OwnSet;
  private nameInput: HTMLInputElement;
  private area: HTMLTextAreaElement;
  private status: HTMLElement;
  private kept: HTMLElement;
  private problems: HTMLElement;
  private preview: HTMLElement;
  private example: HTMLButtonElement;
  private pending = 0;
  private dirty = false;
  private dropped = false;

  constructor(
    ctx: Ctx,
    set: OwnSet,
    private actions: SetEditActions,
  ) {
    super(ctx);
    this.set = set;
    this.key = `cv-set:${set.id}`;
    const titleId = uniq('cs-edit');
    const nameId = uniq('cs-name');
    const areaId = uniq('cs-text');
    const howId = uniq('cs-how');
    this.nameInput = h('input', { class: 'sc-input cs-name', id: nameId, type: 'text', maxlength: OWN_NAME_MAX, autocomplete: 'off', autocapitalize: 'words', spellcheck: 'false', enterkeyhint: 'next', placeholder: 'Week 3: Markets' }) as HTMLInputElement;
    this.nameInput.value = set.name;
    this.area = h('textarea', {
      class: 'cs-text',
      id: areaId,
      rows: 16,
      maxlength: OWN_TEXT_MAX,
      spellcheck: 'true',
      autocapitalize: 'sentences',
      autocomplete: 'off',
      'aria-describedby': howId,
      placeholder: 'Name a stock exchange.\nNew York Stock Exchange | NYSE\nNasdaq\nASX | Australian Securities Exchange\n\nThe next question, after an empty line…',
    }) as HTMLTextAreaElement;
    this.area.value = set.text;
    this.status = h('p', { class: 'cs-status', role: 'status' });
    this.kept = h('p', { class: 'cs-kept', 'aria-live': 'polite' });
    this.problems = h('ul', { class: 'cs-problems' });
    this.preview = h('ol', { class: 'cs-preview' });
    this.example = h('button', { class: 'btn ghost cs-example', type: 'button' }, 'Start from an example') as HTMLButtonElement;
    this.example.addEventListener('click', () => {
      this.click();
      if (this.area.value.trim()) return;
      this.area.value = OWN_EXAMPLE;
      this.changed();
      this.area.focus();
    });
    this.nameInput.addEventListener('input', () => this.changed());
    this.nameInput.addEventListener('change', () => {
      this.flush();
      // The name it was kept under (another set may bear the one typed).
      this.nameInput.value = this.set.name;
    });
    this.area.addEventListener('input', () => this.changed());

    const done = h('button', { class: 'btn primary', type: 'button' }, 'Done');
    done.addEventListener('click', () => {
      this.click();
      this.actions.done();
    });
    const download = h('button', { class: 'btn ghost', type: 'button' }, 'Download (.txt)');
    download.addEventListener('click', () => {
      this.click();
      this.flush();
      const name = setFileName(this.set);
      const ok = saveFile(name, setFileText(this.set), 'text/plain');
      this.note(ok ? `Saved as ${name}. Look in this device’s downloads.` : 'This browser would not save a file.');
    });
    let armed = 0;
    const drop = h('button', { class: 'btn ghost cs-drop', type: 'button' }, 'Delete this set') as HTMLButtonElement;
    drop.addEventListener('click', () => {
      this.click();
      clearTimeout(armed);
      if (drop.classList.contains('is-armed')) {
        this.dropped = true;
        dropOwnSet(this.set.id);
        this.env.announce(`The set ${this.set.name} is deleted.`);
        this.actions.done();
        return;
      }
      drop.classList.add('is-armed');
      drop.textContent = 'Delete it for good?';
      armed = this.later(() => {
        drop.classList.remove('is-armed');
        drop.textContent = 'Delete this set';
      }, 4000);
    });

    const tiers = tierDepths(this.env.theme);
    const legend = h('ul', { class: 'cs-legend', 'aria-label': 'How deep each tier sinks' });
    for (let t = 1; t <= 6; t++) legend.append(h('li', { style: `--tier-color: var(--color-tier-${t})` }, h('span', { class: 'cs-legend-n' }, `[${t}]`), ` ${tierName(this.env.theme, t)} `, h('span', { class: 'u' }, `${fmtMetres(tiers[t] ?? 0)} m`)));

    this.el = h(
      'div',
      { class: 'sc-scene cs-edit', 'aria-labelledby': titleId },
      h('header', { class: 'cr-head' }, this.heading('h2', 'A set of your own', 'sc-title', titleId)),
      h(
        'div',
        { class: 'cs-grid' },
        h(
          'div',
          { class: 'plate cs-write' },
          h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: nameId }, 'The set’s name, as the class will see it'), this.nameInput),
          h('div', { class: 'sc-field' }, h('label', { class: 'sc-field-k', for: areaId }, 'Questions and answers'), this.area),
          h('div', { class: 'cs-write-foot' }, this.kept, this.example),
          h('details', { class: 'sc-how cs-how', id: howId }, h('summary', {}, h('span', {}, 'How to write a set')), h('ol', { class: 'howto-steps' }, ...HOW.map((s) => h('li', {}, h('span', {}, s)))), legend),
        ),
        h('section', { class: 'plate cs-read', 'aria-label': 'What the deep reads in your set' }, h('h3', { class: 'sc-h' }, 'What the deep reads', this.status), this.problems, this.preview),
      ),
      h('div', { class: 'sc-actions' }, h('div', { class: 'sc-row' }, done, download, drop)),
    );
    this.focus = set.text.trim() ? this.focus : this.area;
    this.stops.push(() => {
      clearTimeout(this.pending);
      clearTimeout(armed);
      this.settle();
    });
    this.read();
  }

  private note(message: string) {
    this.kept.textContent = message;
    this.kept.classList.remove('is-warn');
  }

  private changed() {
    this.dirty = true;
    clearTimeout(this.pending);
    this.pending = window.setTimeout(() => this.flush(), 450);
  }

  /** What is typed is kept, and read again. */
  private flush() {
    clearTimeout(this.pending);
    if (this.dropped) return;
    if (this.dirty) {
      this.dirty = false;
      const next: OwnSet = { ...this.set, name: cleanSetName(this.nameInput.value) || this.set.name, text: this.area.value.slice(0, OWN_TEXT_MAX), at: Date.now() };
      const how = saveOwnSet(next);
      if (how === 'kept') {
        // Kept under a name no other set bears.
        this.set = loadOwnSets().find((s) => s.id === next.id) ?? next;
        this.note('Kept on this device.');
      } else {
        this.set = next;
        this.kept.textContent = 'This device would not keep the set: its storage is full or closed to the game. Download it before leaving this page.';
        this.kept.classList.add('is-warn');
      }
    }
    this.read();
  }

  /**
   * On leaving: the last keystrokes are kept; a set left empty is not. The
   * screen calls it before it draws the list of sets, which reads what is kept.
   */
  settle() {
    if (this.dropped) return;
    clearTimeout(this.pending);
    if (this.dirty) {
      this.dirty = false;
      saveOwnSet({ ...this.set, name: cleanSetName(this.nameInput.value) || this.set.name, text: this.area.value.slice(0, OWN_TEXT_MAX), at: Date.now() });
    }
    if (!this.area.value.trim()) {
      this.dropped = true;
      dropOwnSet(this.set.id);
    }
  }

  private read() {
    const text = this.area.value;
    const parsed = parseOwnSet(text, this.set);
    this.example.hidden = !!text.trim();
    this.status.textContent = countLine(parsed);
    this.problems.replaceChildren(...parsed.problems.map((p) => h('li', {}, h('span', { class: 'k' }, `Line ${p.line}`), ' ', p.text)));
    this.problems.hidden = !parsed.problems.length;
    this.preview.replaceChildren(...parsed.questions.map((q) => this.question(q.prompt, q.mute ?? [])));
    if (!parsed.questions.length) this.preview.append(h('li', { class: 'cs-preview-empty' }, text.trim() ? 'No question can be read yet: a question needs at least one answer on the line under it.' : 'Your questions appear here as you type them, with how deep each answer sinks.'));
  }

  private question(p: PromptDef, mute: string[]): HTMLElement {
    const theme = this.env.theme;
    const depths = tierDepths(theme);
    const chips = h('ul', { class: 'cs-chips' });
    for (const a of p.answers) {
      const dumb = mute.includes(a.answer);
      chips.append(
        h(
          'li',
          { class: `cs-chip${dumb ? ' is-mute' : ''}`, 'data-tier': String(a.tier), style: `--tier-color: var(--color-tier-${a.tier})`, title: dumb ? 'Nobody can type this answer yet: it needs a spelling in Latin letters or numbers' : `${tierName(theme, a.tier)} · ${fmtMetres(depths[a.tier] ?? 0)} m` },
          dumb ? h('span', { class: 'visually-hidden' }, 'cannot be typed: ') : null,
          h('span', { class: 'a' }, a.answer),
          a.aliases?.length ? h('span', { class: 'alt' }, ` · ${a.aliases.join(' · ')}`) : null,
          h('span', { class: 'm' }, ` ${fmtMetres(depths[a.tier] ?? 0)} m`),
        ),
      );
    }
    const wrong = [...(p.traps ?? []).map((t) => `${[t.answer, ...(t.aliases ?? [])].join(', ')} (${t.reason})`), ...(p.decoys ?? [])];
    const out = h('p', { class: 'cs-try-out', role: 'status' });
    const tryId = uniq('cs-try');
    const input = h('input', { class: 'cs-try-in', id: tryId, type: 'text', maxlength: 80, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: 'Try an answer as a diver would type it' }) as HTMLInputElement;
    input.addEventListener('input', () => {
      const text = input.value.trim();
      const r = text ? hear(p, text) : null;
      out.className = `cs-try-out${r ? (r.kind === 'sealed' ? ' is-taken' : ' is-refused') : ''}`;
      out.textContent = !r
        ? ''
        : r.kind === 'sealed'
          ? `Taken as ${r.answer}: ${tierName(theme, r.tier)}, ${fmtMetres(depths[r.tier] ?? 0)} m.`
          : r.kind === 'refused'
            ? r.verdict === 'trap'
              ? `Refused: ${r.reason ?? 'you named it as wrong.'}`
              : r.verdict === 'decoy'
                ? 'Refused: you named it as wrong.'
                : r.verdict === 'ambiguous'
                  ? `Refused for now: ${r.reason ?? 'it reads as more than one answer.'}`
                  : 'Refused: no answer here reads like it.'
            : '';
    });
    return h(
      'li',
      { class: 'cs-q' },
      h('p', { class: 'cs-q-text' }, p.text),
      p.rules ? h('p', { class: 'cs-q-rules' }, p.rules) : null,
      chips,
      wrong.length ? h('p', { class: 'cs-q-not' }, h('span', { class: 'k' }, 'Named as wrong: '), wrong.join('; ')) : null,
      h('div', { class: 'cs-try' }, h('label', { class: 'visually-hidden', for: tryId }, `Try an answer to: ${p.text}`), input, out),
    );
  }
}
