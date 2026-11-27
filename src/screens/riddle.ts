// The Whispering Deep on screen: the day's riddle as a page of the Drowned Codex
// (the art kit's tome page, .cth-tome), its five breaths and three whispers on a
// plate below it, the two ways it ends, and the Codex itself for the Logbook.
//
// The screen saves every move itself (saveRiddle, unless actions.onSave is given),
// so a reload mid-riddle comes back with its guesses and whispers. Pass the saved
// attempt back in as data.attempt.

import { hashString } from '../game/daily';
import {
  BREATHS,
  breathsLeft,
  codexFolio,
  codexPages,
  hintCost,
  hintsHeard,
  matchRiddle,
  newAttempt,
  resumeAttempt,
  riddleMetres,
  riddleResult,
  stepRiddle,
  worthNow,
  type CodexPage,
  type Riddle,
  type RiddleAttempt,
  type RiddleDeck,
  type RiddleEvent,
  type RiddleResult,
  type RiddleStep,
} from '../game/riddles';
import { loadRiddles, saveRiddle } from '../game/storage';
import { calm, icon, madden, sealSvg } from '../ui/art';
import { fmtMetres, h } from '../ui/dom';
import '../styles/riddle.css';

export interface RiddleScreenData {
  riddle: Riddle;
  /** Today's day number (the riddle's "No.") and its local date, YYYY-MM-DD. */
  day: number;
  date: string;
  /** The saved attempt for this day, if any (loadRiddles()[day]). Anything else is ignored and a fresh attempt begins. */
  attempt?: RiddleAttempt | null;
  /** The app's reduced-motion setting: no rising lines, bursting bubbles or madness. */
  reducedMotion?: boolean;
  /** The riddle's folio in the player's Codex (the next free one while it is unsolved). Worked out from the saved riddles when left out. */
  folio?: number;
}

export interface RiddleActions {
  /** Leave the riddle (the back button, and "Return to the surface" once it has ended). */
  onBack(): void;
  /** Called once, when the riddle ends on this screen (solved, out of breath or given up), after the attempt is saved. */
  onFinished(result: RiddleResult): void;
  /** Open the Drowned Codex. When given, the end of the riddle offers it. */
  onCodex?(): void;
  /** Save the attempt yourself. By default the screen calls saveRiddle(). */
  onSave?(attempt: RiddleAttempt): void;
  /** Speak through the app's live regions (urgent for refusals). By default the screen has its own. */
  announce?(text: string, urgent?: boolean): void;
  /** Sound hooks, all optional. */
  click?(): void;
  key?(): void;
  refuse?(): void;
  accept?(): void;
  /** A whisper is heard. */
  whisper?(): void;
  /** A breath is lost: a bubble bursts. */
  breath?(): void;
  /** The riddle sinks. */
  sink?(): void;
}

type Madness = ReturnType<typeof madden>;

const REFUSED = 'Refused';
const WRONG_LINES = ['The deep does not answer to that.', 'That is not its name.', 'The water closes over it.', 'Not that. Listen again.'];
/** The whispers' labels, and how far the deep has got into each (only while motion is allowed). */
const WHISPER_LABELS = ['A whisper', 'Closer', 'At your ear'];
const WHISPER_MADNESS = [0.2, 0.5, 0.8];
const ORDINALS = ['first', 'second', 'third'];
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const WHISPERS_HEARD = ['No whisper', 'One whisper', 'Two whispers', 'Three whispers'];
/** Time before the first line of the verse inks in, between the lines, and how long each takes. */
const LINE_LEAD_MS = 260;
const LINE_GAP_MS = 340;
const LINE_RISE_MS = 1100;
/** On mousedown: tapping Speak keeps the keyboard up instead of stealing focus. */
const keepFocus = (e: Event) => e.preventDefault();

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const numberWord = (n: number) => NUMBER_WORDS[n] ?? String(n);
const pick = (list: string[], seed: string) => list[hashString(seed) % list.length];
const minus = (m: number) => `−${fmtMetres(m)} m`;

/** A breath: clear in the middle and bright at the rim, as air is under water. The id names its own gradient. */
const bubbleSvg = (id: string) =>
  '<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">' +
  `<defs><radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5" fx="0.42" fy="0.38">` +
  '<stop offset="0" stop-color="currentColor" stop-opacity="0"/>' +
  '<stop offset="0.6" stop-color="currentColor" stop-opacity="0.04"/>' +
  '<stop offset="0.86" stop-color="currentColor" stop-opacity="0.16"/>' +
  '<stop offset="1" stop-color="currentColor" stop-opacity="0.46"/>' +
  '</radialGradient></defs>' +
  '<g class="b-spray"><path d="M16 1.5v3.2M16 27.3v3.2M1.5 16h3.2M27.3 16h3.2M5.8 5.8l2.3 2.3M23.9 23.9l2.3 2.3M5.8 26.2l2.3-2.3M23.9 8.1l2.3-2.3"/></g>' +
  `<circle class="b-ring" cx="16" cy="16" r="10.5" fill="url(#${id})"/>` +
  '<path class="b-shine" d="M9.6 15.4a6.6 6.6 0 0 1 5.2-6"/>' +
  '<path class="b-under" d="M22.3 18.6a6.6 6.6 0 0 1-3.4 3.9"/>' +
  '<circle class="b-glint" cx="18.6" cy="9.8" r="0.95"/>' +
  '</svg>';

/** "27 November", or "27 November 2026" with the year. */
export function dateLabel(key: string, year = false): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.toLocaleDateString('en-GB', year ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long' });
}

/** Lower-case Roman numerals, as an old book numbers its leaves. */
export function roman(n: number): string {
  const marks: Array<[number, string]> = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let left = Math.max(1, Math.floor(n));
  let out = '';
  for (const [v, s] of marks) while (left >= v) (out += s), (left -= v);
  return out;
}

/** The answer as a later hand wrote it into the margin: "Tide. One whisper, 700 m." */
export function marginNote(answer: string, hints: number, metres: number): string {
  return `${answer}. ${WHISPERS_HEARD[hints] ?? `${capital(numberWord(hints))} whispers`}, ${fmtMetres(metres)} m.`;
}

/** “Fog”, or “Mist” — every answer, joined gently. */
function answerList(r: Riddle): string {
  const names = r.answers.map((a) => `“${a.answer}”`);
  if (names.length < 2) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

function heardNote(hints: number): string {
  if (hints <= 0) return 'No whisper needed.';
  return hints === 1 ? 'After one whisper.' : `After ${numberWord(hints)} whispers.`;
}

const breathsLabel = (left: number) => (left > 0 ? `${capital(numberWord(left))} of ${numberWord(BREATHS)} breaths left` : 'No breaths left');

let seq = 0;

// ---------------------------------------------------------------- the tome page
// The page is the art kit's .cth-tome (art/css/components.css): always paper, with
// its foxing, drop cap, rule and catchword. riddle.css only lays out round it.

/** Where the foxing sits on a page, so that no two pages match. */
function foxFor(seed: string): string {
  const n = hashString(`fox|${seed}`);
  return `--tome-fox: ${n % 101}% ${Math.floor(n / 101) % 101}%`;
}

/**
 * The first word of a page's title ("Of"), set as the catchword at the foot of
 * the page before it, as old printers did. Left out when it would give the answer away.
 */
export function catchwordFor(title: string, riddle?: Riddle): string | undefined {
  const word = (title.trim().split(/\s+/)[0] ?? '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!word) return undefined;
  if (riddle) {
    const w = word.toLowerCase();
    const named = riddle.answers.some((a) => [a.answer, ...a.aliases].some((f) => f.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(w)));
    if (named || matchRiddle(riddle, word).kind === 'accept') return undefined;
  }
  return word;
}

const tomeHead = (folio?: number) => h('header', { class: 'cth-tome__head' }, h('span', {}, 'The Drowned Codex'), folio ? h('span', {}, `Folio ${roman(folio)}`) : null);

const tomeFoot = (left: Node | string, catchword?: string, hidden = false) =>
  h(
    'footer',
    { class: 'cth-tome__foot', 'aria-hidden': hidden ? 'true' : undefined },
    typeof left === 'string' ? h('span', {}, left) : left,
    catchword ? h('span', { class: 'cth-tome__catchword', 'aria-hidden': 'true' }, catchword) : null,
  );

/** The running foot of a solved page: where it was found. */
const foundAt = (day: number, date: string) => {
  const when = dateLabel(date, true);
  return `No. ${day}${when ? ` · ${when}` : ''}`;
};

export interface TomeOpts {
  /** Its place in the Codex, in the head as a folio number. */
  folio?: number;
  /** The running foot, such as where the page was found ("The Whispering Deep" by default). */
  foot?: string;
  /** The first word of the next page, set at the foot. */
  catchword?: string;
  /** The answer, written into the margin (marginNote). */
  margin?: string;
  /** The heading level of the page's title (h3 by default). */
  level?: 'h2' | 'h3' | 'h4';
  /** Seeds where the foxing sits (the riddle's id, say). */
  fox?: string;
}

/** A solved page of the Drowned Codex: its title, its text, and the answer in the margin. */
export function tomePage(page: CodexPage, opts: TomeOpts = {}): HTMLElement {
  const id = `tome-title-${++seq}`;
  const paras = page.text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  return h(
    'article',
    { class: 'cth-tome', 'data-state': 'solved', 'aria-labelledby': id, style: foxFor(opts.fox ?? page.title) },
    tomeHead(opts.folio),
    h(opts.level ?? 'h3', { class: 'cth-tome__title', id, tabindex: '-1' }, page.title),
    h('div', { class: 'cth-tome__text' }, ...paras.map((p) => h('p', {}, p))),
    h('hr', { class: 'cth-tome__rule' }),
    tomeFoot(opts.foot ?? 'The Whispering Deep', opts.catchword),
    opts.margin ? h('p', { class: 'cth-tome__margin' }, opts.margin) : null,
  );
}

// ---------------------------------------------------------------- the Codex

/**
 * The Drowned Codex for the Logbook: how many pages are found and how many still
 * lost, then every page found as a tome page, newest first. The newest lies open;
 * the rest are a stack of folios to open. Returns the body of a sheet.
 */
export function codexBody(deck: RiddleDeck, saves: Record<number, RiddleAttempt>): HTMLElement[] {
  const { pages, found, lost } = codexPages(deck, saves);
  const tally = h(
    'p',
    { class: 'codex-tally' },
    h('span', {}, h('b', {}, String(found)), found === 1 ? ' page found' : ' pages found'),
    h('span', { class: 'codex-tally__sep', 'aria-hidden': 'true' }, '·'),
    h('span', {}, h('b', {}, String(lost)), ' still lost to the deep'),
  );
  const out: HTMLElement[] = [h('p', { class: 'flavor codex-intro' }, 'A book drowned with its city, and the deep gives it back a page at a time. Each riddle you answer surfaces one.'), tally];
  if (!pages.length) {
    out.push(h('p', { class: 'codex-empty' }, 'No page has surfaced yet. Answer the Whispering Deep and the first will rise.'));
    return out;
  }
  const byFolio = new Map(pages.map((e) => [e.folio, e]));
  const list = h('ol', { class: 'codex-pages', reversed: true, 'aria-label': 'Pages found, newest first' });
  pages.forEach((e, i) => {
    const next = byFolio.get(e.folio + 1);
    const page = tomePage(e.page, {
      folio: e.folio,
      foot: foundAt(e.day, e.date),
      catchword: next ? catchwordFor(next.page.title) : undefined,
      margin: e.answer ? marginNote(e.answer, e.hints, e.metres) : undefined,
      fox: e.riddleId,
    });
    const tab = h('summary', { class: 'codex-leaf__tab' }, h('span', { class: 'codex-leaf__folio' }, `Folio ${roman(e.folio)}`), h('span', { class: 'codex-leaf__title' }, e.page.title));
    list.append(h('li', {}, h('details', { class: 'codex-leaf', open: i === 0 }, tab, page)));
  });
  out.push(list);
  return out;
}

// ---------------------------------------------------------------- the riddle screen

/** Run once the element is in the page (the app adds a screen just after building it, and calms all madness first). */
function onceConnected(el: HTMLElement, fn: () => void, frames = 60): void {
  if (el.isConnected) fn();
  else if (frames > 0) requestAnimationFrame(() => onceConnected(el, fn, frames - 1));
}

export function riddleScreen(data: RiddleScreenData, actions: RiddleActions): HTMLElement {
  const { riddle } = data;
  const reduced = data.reducedMotion === true;
  const n = ++seq;
  const ids = { title: `riddle-title-${n}`, verse: `riddle-verse-${n}`, end: `riddle-end-${n}` };
  let attempt: RiddleAttempt = resumeAttempt(riddle, data.attempt, data.day) ?? newAttempt(riddle, data.day, data.date);
  const save = (a: RiddleAttempt) => (actions.onSave ? actions.onSave(a) : saveRiddle(a));
  const folio = data.folio ?? codexFolio(riddle, loadRiddles());
  const mads: Madness[] = [];
  let ended = attempt.status !== 'playing';

  // Live regions, unless the app lends its own.
  const polite = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
  const urgent = h('div', { class: 'visually-hidden', 'aria-live': 'assertive', 'aria-atomic': 'true' });
  const speak = (msg: string, now = false) => {
    if (actions.announce) {
      actions.announce(msg, now);
      return;
    }
    const region = now ? urgent : polite;
    region.textContent = ''; // emptied first, so the same words said twice are still read out
    window.setTimeout(() => (region.textContent = msg), 60);
  };

  // ------------------------------------------------------------ the top
  const back = h('button', {
    class: 'icon-btn riddle-back',
    type: 'button',
    'aria-label': 'Back to the surface',
    title: 'Back to the surface',
    html: icon('back'),
    onclick: () => {
      actions.click?.();
      actions.onBack();
    },
  });
  const top = h(
    'div',
    { class: 'riddle-top' },
    back,
    h('p', { class: 'riddle-title', id: ids.title }, h('span', { class: 'riddle-title__icon', 'aria-hidden': 'true', html: icon('riddle') }), 'The Whispering Deep', h('span', { class: 'visually-hidden' }, `, riddle No. ${data.day}`)),
    h('p', { class: 'riddle-no', 'aria-hidden': 'true' }, `No. ${data.day}`),
  );

  // ------------------------------------------------------------ the riddle's page
  // The verse is one paragraph with a break between the lines, so the drop cap sinks
  // into three of them; each line inks itself in, in turn.
  const lead = reduced ? 0 : LINE_LEAD_MS;
  const revealMs = reduced ? 0 : lead + (riddle.verse.length - 1) * LINE_GAP_MS + LINE_RISE_MS;
  const verse = h(
    'div',
    { class: 'cth-tome__verse riddle-verse', id: ids.verse, tabindex: '-1', style: `--rise-lead:${lead}ms` },
    h('p', {}, ...riddle.verse.flatMap((line, i) => [i ? h('br') : null, h('span', { class: 'riddle-line', style: `--i:${i}` }, line)])),
  );
  // The running foot counts the breaths left, and once the riddle sinks, says the page is sealed.
  const footNote = () => (attempt.status === 'sunk' ? 'Sealed' : `${capital(numberWord(breathsLeft(attempt)))} ${breathsLeft(attempt) === 1 ? 'breath' : 'breaths'} left`);
  const foot = h('span', {}, footNote());
  const riddleTome = h(
    'article',
    { class: 'cth-tome riddle-tome', 'aria-label': `Riddle No. ${data.day}`, style: foxFor(riddle.id) },
    tomeHead(folio),
    verse,
    h('hr', { class: 'cth-tome__rule' }),
    tomeFoot(foot, catchwordFor(riddle.page.title, riddle), true),
  );
  const solvedTome = () =>
    tomePage(attempt.page ?? riddle.page, {
      folio,
      foot: foundAt(attempt.day, attempt.date || data.date),
      margin: marginNote(attempt.answer ?? riddle.answers[0].answer, hintsHeard(attempt), riddleMetres(attempt)),
      fox: riddle.id,
      level: 'h2',
    });
  /** A page the deep keeps: the riddle stays on it, sealed. */
  const sealTome = (animate: boolean) => {
    tome.dataset.state = 'sunk';
    foot.textContent = footNote();
    if (tome.querySelector('.riddle-seal')) return;
    tome.append(h('div', { class: `riddle-seal${animate ? ' arriving' : ''}`, 'aria-hidden': 'true', html: sealSvg('refused', 'riddle-seal__mark') }));
  };
  let tome: HTMLElement = attempt.status === 'solved' ? solvedTome() : riddleTome;
  if (attempt.status === 'sunk') sealTome(false);

  // ------------------------------------------------------------ breaths and worth
  const bubbles = Array.from({ length: BREATHS }, (_, i) => h('span', { class: 'riddle-bubble', 'data-state': i < breathsLeft(attempt) ? 'held' : 'spent', style: `--i:${i}`, html: bubbleSvg(`riddle-air-${n}-${i}`) }));
  const breathsEl = h('div', { class: 'riddle-breaths', role: 'img', 'aria-label': breathsLabel(breathsLeft(attempt)) }, ...bubbles);
  const worthV = h('span', { class: 'riddle-worth__v' }, `${fmtMetres(worthNow(attempt))} m`);
  const status = h(
    'div',
    { class: 'riddle-status' },
    h('div', { class: 'riddle-status__breaths' }, h('span', { class: 'riddle-label', 'aria-hidden': 'true' }, 'Breaths'), breathsEl),
    h('p', { class: 'riddle-worth' }, h('span', { class: 'riddle-label' }, 'Worth'), ' ', worthV),
  );

  // ------------------------------------------------------------ the answer
  const input = h('input', {
    class: 'answer riddle-answer',
    type: 'text',
    name: 'answer',
    autocomplete: 'off',
    autocapitalize: 'words',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'send',
    maxlength: 60,
    placeholder: 'Name it…',
    'aria-label': 'Your answer',
    'aria-describedby': ids.verse,
  }) as HTMLInputElement;
  const form = h('form', { class: 'answer-form riddle-form', autocomplete: 'off' }, input, h('button', { class: 'btn primary', type: 'submit', onmousedown: keepFocus }, 'Speak'));
  const feedback = h('p', { class: 'feedback riddle-feedback' });
  const tries = h('ul', { class: 'tries riddle-tries', 'aria-label': 'Refused answers' });
  const addTry = (text: string, near: boolean) =>
    tries.append(h('li', near ? { class: 'near', title: 'A near miss: no breath lost' } : {}, text, near ? h('span', { class: 'visually-hidden' }, ', a near miss') : null));
  for (const t of attempt.tries) addTry(t.text, t.near === true);

  // ------------------------------------------------------------ whispers
  const whispers = h('ol', { class: 'riddle-whispers', 'aria-label': 'Whispers heard' });
  const whisperItem = (i: number, fresh: boolean) =>
    h(
      'li',
      { class: `riddle-whisper${fresh ? ' fresh' : ''}`, 'data-n': String(i + 1) },
      h('p', { class: 'riddle-whisper__label' }, h('span', {}, WHISPER_LABELS[i] ?? 'A whisper')),
      h('p', { class: 'riddle-whisper__text' }, riddle.hints[i] ?? ''),
    );
  const madWhisper = (li: HTMLElement, i: number) => {
    const label = li.querySelector<HTMLElement>('.riddle-whisper__label span');
    if (label) mads.push(madden(label, 0, reduced, WHISPER_MADNESS[i] ?? 0.5));
  };
  for (let i = 0; i < hintsHeard(attempt); i++) whispers.append(whisperItem(i, false));

  const listen = h('button', { class: 'btn ghost riddle-listen', type: 'button' }) as HTMLButtonElement;
  const renderListen = () => {
    const cost = hintCost(attempt);
    if (cost > 0) {
      listen.innerHTML = `${icon('hint')}<span class="riddle-listen__label">Listen closer</span><span class="riddle-listen__cost">${minus(cost)}</span>`;
      listen.setAttribute('aria-label', `Listen closer. A whisper costs ${fmtMetres(cost)} metres.`);
      listen.removeAttribute('aria-disabled');
      listen.classList.remove('spent');
    } else {
      listen.innerHTML = '<span class="riddle-listen__label">Nothing more is whispered</span>';
      listen.removeAttribute('aria-label');
      listen.setAttribute('aria-disabled', 'true');
      listen.classList.add('spent');
    }
  };
  renderListen();
  const renderWorth = () => {
    worthV.textContent = `${fmtMetres(worthNow(attempt))} m`;
    if (!reduced) {
      worthV.classList.remove('changed');
      void worthV.offsetWidth;
      worthV.classList.add('changed');
    }
  };

  // ------------------------------------------------------------ giving up
  const giveUp = h('button', { class: 'btn ghost riddle-give-up', type: 'button' }, 'Let it sink') as HTMLButtonElement;
  const sinkBtn = h('button', { class: 'btn riddle-sink', type: 'button' }, 'Let it sink') as HTMLButtonElement;
  const keepBtn = h('button', { class: 'btn ghost', type: 'button' }, 'Keep listening') as HTMLButtonElement;
  const confirm = h('div', { class: 'riddle-confirm', hidden: true }, h('p', {}, 'Give it up? The riddle sinks, and its page stays locked.'), h('div', { class: 'riddle-confirm__row' }, keepBtn, sinkBtn));

  const play = h(
    'div',
    { class: 'riddle-play', style: `--play-delay:${revealMs ? Math.max(0, revealMs - 500) : 0}ms` },
    status,
    form,
    feedback,
    tries,
    whispers,
    h('div', { class: 'riddle-listen-row' }, listen),
    h('div', { class: 'riddle-quit' }, giveUp, confirm),
  );
  const plate = h('div', { class: 'plate riddle-plate' }, play);
  const after = h('div', { class: 'riddle-after' });
  const screen = h('section', { class: 'screen riddle-screen', 'aria-labelledby': ids.title, 'data-status': attempt.status }, top, tome, plate, after, polite, urgent);

  // ------------------------------------------------------------ the end
  let endTitle: HTMLElement | null = null;
  const endBlock = (): HTMLElement => {
    const solved = attempt.status === 'solved';
    endTitle = h('h2', { class: 'riddle-end__title', id: ids.end, tabindex: '-1' }, solved ? 'Answered' : 'The riddle sinks');
    if (solved) {
      const others = riddle.answers.filter((a) => a.answer !== attempt.answer);
      return h(
        'div',
        { class: 'riddle-end', 'data-end': 'solved' },
        h('div', { class: 'riddle-medal', 'aria-hidden': 'true', html: icon('riddle', 'riddle-medal__icon') }),
        endTitle,
        h('p', { class: 'riddle-end__answer' }, `“${attempt.answer ?? riddle.answers[0].answer}”`),
        h('p', { class: 'riddle-end__gain' }, `+${fmtMetres(riddleMetres(attempt))} m`),
        h('p', { class: 'riddle-end__note' }, heardNote(hintsHeard(attempt))),
        others.length ? h('p', { class: 'riddle-end__also' }, `It answers to ${others.map((a) => `“${a.answer}”`).join(' and ')} as well.`) : null,
        h('p', { class: 'riddle-end__line' }, 'Its page of the Drowned Codex is yours.'),
      );
    }
    return h(
      'div',
      { class: 'riddle-end', 'data-end': 'sunk' },
      endTitle,
      h('p', { class: 'riddle-end__note' }, attempt.gaveUp ? 'You let it go.' : 'Out of breath.'),
      h('p', { class: 'riddle-end__answer riddle-end__answer--gentle' }, `It was ${answerList(riddle)}.`),
      h('p', { class: 'riddle-end__gain' }, '0 m'),
      h('p', { class: 'riddle-end__line' }, 'Its page stays locked. The deep keeps it a while longer.'),
    );
  };
  const actionsBlock = (): HTMLElement =>
    h(
      'div',
      { class: 'riddle-actions' },
      h('p', { class: 'riddle-next' }, 'A new riddle rises at midnight.'),
      h(
        'button',
        {
          class: 'btn primary',
          type: 'button',
          onclick: () => {
            actions.click?.();
            actions.onBack();
          },
        },
        'Return to the surface',
      ),
      actions.onCodex
        ? h('button', {
            class: 'btn ghost',
            type: 'button',
            onclick: () => {
              actions.click?.();
              actions.onCodex?.();
            },
            html: `${icon('riddle')}<span>Open the Drowned Codex</span>`,
          })
        : null,
    );
  const showEnd = (animate: boolean) => {
    for (const m of mads.splice(0)) calm(m);
    screen.dataset.status = attempt.status;
    screen.classList.remove('riddle-screen--tight');
    const solved = attempt.status === 'solved';
    const motion = animate && !reduced;
    const end = endBlock();
    if (motion) {
      end.classList.add('arriving');
      after.classList.add('arriving');
    }
    play.replaceWith(end);
    after.replaceChildren(actionsBlock());
    if (solved) {
      // the page turns: the riddle goes, and what it hid is written in its place
      const page = solvedTome();
      if (motion) page.classList.add('riddle-turn');
      tome.replaceWith(page);
      tome = page;
    } else sealTome(motion);
    if (!animate) return;
    window.setTimeout(
      () => {
        if (!screen.isConnected) return;
        if (solved) {
          tome.querySelector<HTMLElement>('.cth-tome__title')?.focus({ preventScroll: true });
          screen.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
        } else if (endTitle) {
          endTitle.focus({ preventScroll: true });
          endTitle.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        }
      },
      reduced ? 0 : 450,
    );
  };
  if (ended) {
    play.replaceWith(endBlock());
    after.replaceChildren(actionsBlock());
  }
  const finish = () => {
    if (ended) return;
    ended = true;
    const result = riddleResult(attempt);
    if (result) actions.onFinished(result);
  };

  // ------------------------------------------------------------ moves
  const apply = (step: RiddleStep): RiddleEvent | null => {
    if (step.event.kind === 'none') return null;
    attempt = step.attempt;
    save(attempt);
    return step.event;
  };

  const burst = (index: number) => {
    const b = bubbles[index];
    breathsEl.setAttribute('aria-label', breathsLabel(breathsLeft(attempt)));
    foot.textContent = footNote();
    if (!b) return;
    if (reduced) {
      b.dataset.state = 'spent';
      return;
    }
    b.dataset.state = 'burst';
    window.setTimeout(() => (b.dataset.state = 'spent'), 720);
  };

  const shake = () => {
    if (reduced) return;
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
  };

  const sinkNow = (gaveUp: boolean) => {
    actions.sink?.();
    const answers = answerList(riddle).replace(/[“”]/g, '');
    speak(`${gaveUp ? 'You let it go' : 'Out of breath'}. The riddle sinks. It was ${answers}. Its page stays locked.`);
    // The last bubble bursts before the riddle goes under.
    window.setTimeout(() => showEnd(true), reduced || gaveUp ? 0 : 650);
    finish();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (attempt.status !== 'playing') return;
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const ev = apply(stepRiddle(riddle, attempt, { type: 'guess', text }));
    if (!ev) return;
    if (ev.kind === 'solved') {
      input.blur();
      actions.accept?.();
      showEnd(true);
      speak(`Answered: ${ev.answer}. ${fmtMetres(ev.metres)} metres. Its page of the Drowned Codex is yours: ${(attempt.page ?? riddle.page).title}.`);
      finish();
      return;
    }
    if (ev.kind !== 'refused') return;
    const line = ev.again ? 'You said that already.' : ev.reason ?? pick(WRONG_LINES, `${riddle.id}|${ev.input.toLowerCase()}`);
    const cost = !ev.breathLost ? 'No breath lost.' : ev.sunk ? 'That was your last breath.' : `A breath escapes. ${capital(numberWord(ev.breathsLeft))} left.`;
    feedback.replaceChildren(h('span', { class: 'said' }, `${REFUSED}: “${ev.input}”.`), ' ', line, ' ', h('span', { class: 'riddle-feedback__cost' }, cost));
    speak(`${REFUSED}: ${ev.input}. ${line} ${cost}`, true);
    if (!ev.again) addTry(ev.input, !ev.breathLost);
    if (ev.breathLost) {
      burst(ev.breathsLeft);
      actions.breath?.();
    }
    actions.refuse?.();
    shake();
    input.value = '';
    if (ev.sunk) {
      input.blur();
      sinkNow(false);
      return;
    }
    input.focus();
    requestAnimationFrame(keepInView);
  });
  input.addEventListener('input', () => actions.key?.());

  listen.addEventListener('click', () => {
    if (listen.getAttribute('aria-disabled') === 'true') return;
    const ev = apply(stepRiddle(riddle, attempt, { type: 'hint' }));
    if (!ev || ev.kind !== 'hint') return;
    actions.whisper?.();
    const li = whisperItem(ev.index, !reduced);
    whispers.append(li);
    madWhisper(li, ev.index);
    renderWorth();
    renderListen();
    speak(`The ${ORDINALS[ev.index] ?? 'last'} whisper: ${ev.text} A solve is now worth ${fmtMetres(ev.worth)} metres.`);
    li.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  });

  giveUp.addEventListener('click', () => {
    actions.click?.();
    giveUp.hidden = true;
    confirm.hidden = false;
    keepBtn.focus();
  });
  keepBtn.addEventListener('click', () => {
    actions.click?.();
    confirm.hidden = true;
    giveUp.hidden = false;
    giveUp.focus();
  });
  sinkBtn.addEventListener('click', () => {
    if (!apply(stepRiddle(riddle, attempt, { type: 'give-up' }))) return;
    sinkNow(true);
  });

  // ------------------------------------------------------------ the phone keyboard
  // Keep the answer line (and a refusal, while the verse can stay) in sight above
  // the keyboard, as the daily question does.
  const keepInView = () => {
    if (!screen.isConnected || document.activeElement !== input) return;
    const view = screen.getBoundingClientRect();
    const below = (el: Element) => el.getBoundingClientRect().bottom + 8 - view.bottom;
    const verseTop = verse.getBoundingClientRect().top - 8;
    const room = Math.max(0, verseTop - view.top); // how far down before the verse starts to leave the top
    const down = Math.max(below(form), feedback.textContent ? Math.min(below(feedback), room) : 0);
    if (down > 0) screen.scrollTop += down;
    else if (verseTop < view.top) screen.scrollTop -= Math.min(view.top - verseTop, Math.max(0, -below(form)));
  };

  // ------------------------------------------------------------ a long verse on a small screen
  // When the verse would push the answer line off the screen, the screen packs tighter
  // (closer rules, a tighter page), so the riddle and its answer stay together. It is
  // judged on the loose layout every time, so it cannot flicker between the two.
  const layoutTop = (el: HTMLElement) => {
    let y = 0;
    for (let e: HTMLElement | null = el; e && e !== screen; e = e.offsetParent as HTMLElement | null) y += e.offsetTop;
    return y;
  };
  const fitVerse = () => {
    if (!screen.isConnected) return;
    screen.classList.remove('riddle-screen--tight');
    if (attempt.status !== 'playing' || !form.isConnected) return;
    if (layoutTop(form) + form.offsetHeight + 12 > screen.clientHeight) screen.classList.add('riddle-screen--tight');
  };

  const onViewport = () => {
    if (!screen.isConnected) {
      window.visualViewport?.removeEventListener('resize', onViewport);
      window.removeEventListener('resize', onViewport);
      return;
    }
    requestAnimationFrame(() => {
      fitVerse();
      keepInView();
    });
  };
  input.addEventListener('focus', () => window.setTimeout(keepInView, 320));

  onceConnected(screen, () => {
    fitVerse();
    void document.fonts?.ready.then(fitVerse);
    window.visualViewport?.addEventListener('resize', onViewport);
    window.addEventListener('resize', onViewport);
    // The whispers already heard go strange again (the app calms every madness as a screen arrives).
    if (!ended) whispers.querySelectorAll<HTMLElement>('.riddle-whisper').forEach((li, i) => madWhisper(li, i));
    // Once the verse has risen: the field on a computer; on a phone, the verse, so the
    // keyboard does not cover it uninvited (and a screen reader starts at the riddle).
    window.setTimeout(
      () => {
        if (!screen.isConnected) return;
        if (attempt.status === 'solved') tome.querySelector<HTMLElement>('.cth-tome__title')?.focus({ preventScroll: true });
        else if (attempt.status === 'sunk') endTitle?.focus({ preventScroll: true });
        else if (matchMedia('(pointer: fine)').matches) input.focus({ preventScroll: true });
        else verse.focus({ preventScroll: true });
      },
      reduced ? 0 : Math.min(revealMs, 1400),
    );
  });

  return screen;
}
