// The host's side of the Convocation: the big screen at the front of the room.
// It shows the class how to join, asks each question in letters the back row
// can read, and surfaces the answers and the standings. It never answers.

import { ownTopics } from '../../game/ownsets';
import { DAILY_GROUP, choiceNames, ownOfTopic, type Topic } from '../../game/topics';
import { filedUnder } from '../../game/packs';
import { CLASS_LANTERNS, CLASS_MAX_SEATS, CLASS_MODES, CLASS_QUESTIONS, CLASS_SECONDS, CLASS_TABLES, LAST_MAX_ALONE, type ClassConfig, type ClassMode, type ClassSeatPublic, type ClassView } from '../../party/class-types';
import { signSpoken } from '../../party/codes';
import { fmtMetres, h } from '../../ui/dom';
import { qrSvg } from '../../ui/qr';
import { topicPicker, type TopicPicker } from '../../ui/topics';
import { questionBlock } from '../seance/candle';
import { listNames, shareLink } from '../seance/model';
import { CandleRow, shareButton, signEl, unsaidList } from '../seance/parts';
import { Scene, uniq, type Ctx } from '../seance/scene';
import { answerList, boutLine, classStandings, lanternsEl, MODE_COPY, pickRow, plural, questionOf, tableBoard, tableName, tableRows, tableStyle, type Choice, type PickRow } from './parts';

/** The game's own address with the class's sign on it: what the QR code holds. */
export const classLink = (sign: string): string => shareLink(location.href, sign, 'class');

const linkText = (sign: string) => classLink(sign).replace(/^https?:\/\//, '');

const secondsChoices = (mode: ClassMode) => CLASS_SECONDS[mode].map((s) => ({ value: s, v: String(s), u: 'seconds' }));

// ------------------------------------------------------------------ the lobby

/** The choices a host makes about how the class is held. */
export type HostChoices = Pick<ClassConfig, 'mode' | 'seconds' | 'tables' | 'questions' | 'lanterns'>;

export interface HostLobbyActions {
  /** How the class is held; `topics` are the names of the ticked topics, for the class to read. */
  config(c: HostChoices, topics: string[]): void;
  begin(): void;
  remove(id: string): void;
}

export class HostLobbyScene extends Scene {
  readonly key = 'cv-host-lobby';
  private view: ClassView;
  private roll: HTMLElement;
  private rollCount: HTMLElement;
  private rollEmpty: HTMLElement;
  private begin: HTMLButtonElement;
  private hint: HTMLElement;
  private mode: PickRow<ClassMode>;
  private seconds: PickRow<number>;
  private tables: PickRow<number>;
  private questions: PickRow<number>;
  private lanterns: PickRow<number>;
  private how: HTMLElement;
  private picker?: TopicPicker;
  private names: string[] = [];
  /** The host's own sets, as topics, and how many questions the ticked ones held when last looked at. */
  private own: Topic[] = [];
  private ownWas = 0;
  /** The number of questions last chosen from the usual few, to come back to when own sets are unticked. */
  private usual: number;
  private paint = 0;
  /** The diver the host has pressed once to remove: a second press does it. */
  private armed: string | null = null;
  private disarm = 0;
  private known = new Set<string>();

  constructor(
    ctx: Ctx,
    view: ClassView,
    private actions: HostLobbyActions,
  ) {
    super(ctx);
    this.view = view;
    this.usual = (CLASS_QUESTIONS as readonly number[]).includes(view.config.questions) ? view.config.questions : CLASS_QUESTIONS[1];
    const titleId = uniq('cv-host');
    const link = classLink(view.sign);
    let qr: HTMLElement | null = null;
    try {
      qr = h('div', { class: 'cv-qr', html: qrSvg(link, { label: `A code to join the class: ${linkText(view.sign)}` }) });
    } catch {
      /* an address too long for a code: the sign and the link still serve */
    }
    const join = h(
      'div',
      { class: 'cv-join' },
      h(
        'div',
        { class: 'cv-join-words' },
        this.heading('h2', view.n ? 'The class is seated' : 'Join the class', 'kicker cv-join-k', titleId),
        signEl(view.sign, signSpoken(view.sign), 'sc-sign sc-sign-grand cv-join-sign'),
        h('p', { class: 'cv-join-how' }, qr ? 'Point a phone’s camera at the square. Or open the game, choose the Convocation, and give this sign.' : 'Open the game on a phone, choose the Convocation, and give this sign.'),
        h('p', { class: 'cv-join-url' }, linkText(view.sign)),
        h('div', { class: 'sc-row cv-join-acts' }, shareButton('Share the link', () => ({ title: 'The Convocation', text: `Join our class in Cthulhoo. The sign is ${view.sign}.`, url: link }), () => this.click(), (m) => this.env.announce(m))),
      ),
      qr,
    );

    this.rollCount = h('span', { class: 'sc-count' });
    this.roll = h('ul', { class: 'cv-divers' });
    this.rollEmpty = h('p', { class: 'cv-roll-empty' }, 'Nobody has sat down yet.');
    const rollPlate = h('section', { class: 'plate cv-roll', 'aria-label': 'The class' }, h('h3', { class: 'sc-h' }, 'The class ', this.rollCount), this.rollEmpty, this.roll);

    const c = view.config;
    const send = (patch: Partial<HostChoices>) => {
      this.click();
      const cur = this.view.config;
      const mode = patch.mode ?? cur.mode;
      // A blitz burns longer than a classic question, and a turn far shorter: changing the mode takes its usual time.
      const seconds = patch.seconds ?? (CLASS_SECONDS[mode].includes(cur.seconds) ? cur.seconds : CLASS_SECONDS[mode][0]);
      const lanterns = patch.lanterns ?? cur.lanterns;
      const next: HostChoices = { mode, seconds, tables: patch.tables ?? cur.tables, questions: patch.questions ?? cur.questions, ...(lanterns ? { lanterns } : {}) };
      this.view = { ...this.view, config: { ...cur, ...next } };
      this.syncConfig();
      this.actions.config(next, this.names);
    };
    this.mode = pickRow<ClassMode>('How each question is played', CLASS_MODES.map((m) => ({ value: m, v: MODE_COPY[m].name, u: MODE_COPY[m].line })), c.mode, (mode) => send({ mode }), 'is-words');
    this.how = h('p', { class: 'cv-how' });
    this.seconds = pickRow<number>('Each question burns for', secondsChoices(c.mode), c.seconds, (seconds) => send({ seconds }));
    this.lanterns = pickRow<number>('Lanterns each', CLASS_LANTERNS.map((n) => ({ value: n, v: String(n), u: n === 1 ? 'lantern' : 'lanterns' })), c.lanterns ?? CLASS_LANTERNS[0], (lanterns) => send({ lanterns }));
    this.tables = pickRow<number>('Tables', CLASS_TABLES.map((t) => (t ? { value: t, v: String(t), u: 'tables' } : { value: 0, v: 'None', u: 'everyone alone' })), c.tables, (tables) => send({ tables }), 'is-tables');
    this.questions = pickRow<number>('Questions', this.questionChoices(), c.questions, (questions) => {
      if (!this.ownCount()) this.usual = questions;
      send({ questions });
    });
    const setup = h('section', { class: 'plate sc-config cv-setup', 'aria-label': 'How the class is held' }, h('h3', { class: 'sc-h' }, 'How the class is held'), this.mode.el, this.how, this.seconds.el, this.lanterns.el, this.questions.el, this.tables.el);

    const parts: HTMLElement[] = [join, rollPlate, setup];
    const topics = this.env.topics;
    if (topics) {
      this.names = c.topics ?? [];
      // The host's own sets stand between the daily deep and the class packs.
      this.own = ownTopics();
      const withOwn = (all: Topic[]) => [...all.filter((t) => t.group === DAILY_GROUP), ...this.own, ...all.filter((t) => t.group !== DAILY_GROUP)];
      const retell = (all: Topic[]) => {
        const names = choiceNames(this.picker?.choice() ?? [], all);
        const cur = this.view.config;
        const questions = this.fitQuestions();
        if (names.join('|') === this.names.join('|') && questions === cur.questions) return;
        this.names = names;
        if (questions !== cur.questions) this.view = { ...this.view, config: { ...cur, questions } };
        this.syncConfig();
        this.actions.config({ mode: cur.mode, seconds: cur.seconds, tables: cur.tables, questions, ...(cur.lanterns ? { lanterns: cur.lanterns } : {}) }, names);
      };
      let known = withOwn(topics.daily());
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
      // The class packs arrive a moment later; only then is this device's last choice told to the class.
      let live = true;
      this.stops.push(() => (live = false));
      void topics.all().then((all) => {
        if (!live) return;
        known = withOwn(all);
        this.picker?.setTopics(known);
        retell(known);
      });
      this.ownWas = this.ownCount();
      parts.push(
        h(
          'section',
          { class: 'plate sc-config sc-topics cv-topics', 'aria-label': 'What the class is asked about' },
          h('h3', { class: 'sc-h' }, 'The questions'),
          this.picker.el,
          this.own.length ? null : h('p', { class: 'cv-own-hint' }, 'Questions of your own? Write a set under “Your question sets” on the Convocation’s first page, and it is offered here to tick.'),
        ),
      );
    }

    this.begin = h('button', { class: 'btn primary sc-begin cv-begin', type: 'button' }, this.beginLabel()) as HTMLButtonElement;
    this.begin.addEventListener('click', () => {
      if (this.begin.disabled) return;
      this.click();
      this.begin.disabled = true;
      this.begin.setAttribute('aria-busy', 'true');
      this.begin.textContent = 'Lighting the candle…';
      this.actions.begin();
    });
    this.hint = h('p', { class: 'sc-hint' });
    parts.push(h('div', { class: 'sc-actions' }, this.begin, this.hint));
    this.el = h('div', { class: 'sc-scene cv-host-lobby', 'aria-labelledby': titleId }, ...parts);
    this.stops.push(() => {
      cancelAnimationFrame(this.paint);
      clearTimeout(this.disarm);
    });
    for (const s of view.roll ?? []) this.known.add(s.id);
    this.syncConfig();
    this.render();
  }

  private beginLabel(): string {
    return this.view.n ? 'Ask the next question' : 'Ask the first question';
  }

  /** The topics ticked on the host's device: empty for the whole daily deep. */
  choice(): string[] {
    return this.picker?.choice() ?? [];
  }

  /** How many questions the ticked sets hold, when the host's own sets are all that is ticked; else 0. */
  private ownCount(): number {
    const choice = this.choice();
    if (!choice.length || !choice.every((id) => ownOfTopic(id))) return 0;
    return this.own.filter((t) => choice.includes(t.id)).reduce((n, t) => n + t.count, 0);
  }

  /** The numbers of questions on offer: the usual few, or with only own sets ticked, no more than they hold and all of them at a press. */
  private questionChoices(): Array<Choice<number>> {
    const usual: Array<Choice<number>> = CLASS_QUESTIONS.map((q) => ({ value: q, v: String(q), u: 'questions' }));
    const n = this.ownCount();
    if (!n) return usual;
    if (n > 30) return [...usual, { value: 20, v: '20', u: 'questions' }, { value: 30, v: '30', u: 'questions' }];
    return [...usual.filter((o) => o.value < n), { value: n, v: `All ${n}`, u: n === 1 ? 'question' : 'questions' }];
  }

  /**
   * The number of questions for what is ticked now. Ticking a short set of the
   * host's own asks all of it; unticking it comes back to the usual number; a
   * number no longer on offer gives way to the largest that is.
   */
  private fitQuestions(): number {
    const cur = this.view.config.questions;
    const offered = this.questionChoices().map((o) => o.value);
    const n = this.ownCount();
    const was = this.ownWas;
    this.ownWas = n;
    if (n !== was) {
      if (!n) return this.usual;
      if (n <= 12) return n;
    }
    return offered.includes(cur) ? cur : offered[offered.length - 1];
  }

  private syncConfig() {
    const c = this.view.config;
    const bout = c.mode === 'last';
    this.mode.set(c.mode);
    this.seconds.setLabel(bout ? 'Each turn burns for' : 'Each question burns for');
    this.seconds.setOptions(secondsChoices(c.mode), c.seconds);
    this.lanterns.el.hidden = !bout;
    this.lanterns.set(c.lanterns ?? CLASS_LANTERNS[0]);
    this.tables.set(c.tables);
    this.questions.setOptions(this.questionChoices(), c.questions);
    this.how.textContent = bout
      ? `${MODE_COPY.last.how} ${c.tables ? 'The tables take the turns, and anyone at a table may answer for it.' : `With no tables every diver takes turns alone: that suits ${LAST_MAX_ALONE} divers or fewer.`}`
      : `${MODE_COPY[c.mode].how}${c.tables ? ' Each table also wins its deepest different answers.' : ''}`;
  }

  update(view: ClassView) {
    const was = this.view.config;
    this.view = view;
    const c = view.config;
    if (c.mode !== was.mode || c.seconds !== was.seconds || c.tables !== was.tables || c.questions !== was.questions || c.lanterns !== was.lanterns) this.syncConfig();
    const fresh = (view.roll ?? []).filter((s) => !this.known.has(s.id));
    for (const s of fresh) this.known.add(s.id);
    if (fresh.length && fresh.length <= 3) this.env.announce(`${listNames(fresh.map((s) => s.name))} ${fresh.length === 1 ? 'sits' : 'sit'} down.`);
    // A whole class sits down within a minute: draw the roll once a frame, not once a diver.
    cancelAnimationFrame(this.paint);
    this.paint = requestAnimationFrame(() => this.render());
  }

  private chip(s: ClassSeatPublic): HTMLElement {
    const armed = this.armed === s.id;
    const x = h('button', { class: 'cv-diver-x', type: 'button', 'aria-label': armed ? `Remove ${s.name} from the class: press again to confirm` : `Remove ${s.name} from the class` }, armed ? 'Remove?' : '×');
    x.addEventListener('click', () => {
      this.click();
      if (this.armed === s.id) {
        this.armed = null;
        this.actions.remove(s.id);
        return;
      }
      this.armed = s.id;
      clearTimeout(this.disarm);
      this.disarm = this.later(() => {
        this.armed = null;
        this.render();
      }, 4000);
      this.render();
      this.roll.querySelector<HTMLElement>(`[data-id="${s.id}"] .cv-diver-x`)?.focus({ preventScroll: true });
    });
    return h('li', { class: `cv-diver${s.online ? '' : ' is-away'}${armed ? ' is-armed' : ''}`, 'data-id': s.id, style: s.table ? tableStyle(s.table) : '' }, h('span', { class: 'cv-diver-n' }, s.name), s.online ? null : h('span', { class: 'visually-hidden' }, ' (stepped away)'), x);
  }

  private render() {
    const view = this.view;
    const roll = view.roll ?? [];
    const here = roll.filter((s) => s.online).length;
    this.rollCount.textContent = roll.length ? (here === roll.length ? `${roll.length} of ${CLASS_MAX_SEATS}` : `${here} here · ${roll.length} seated`) : '';
    this.rollEmpty.hidden = roll.length > 0;
    this.roll.textContent = '';
    const n = view.config.tables;
    if (n) {
      for (let t = 1; t <= n; t++) {
        const at = roll.filter((s) => s.table === t);
        this.roll.append(h('li', { class: 'cv-divers-table', style: tableStyle(t) }, h('span', { class: 'cv-divers-table-k' }, tableName(t), h('span', { class: 'sc-count' }, ` ${at.length}`)), h('ul', { class: 'cv-divers' }, ...at.map((s) => this.chip(s)))));
      }
    } else for (const s of roll) this.roll.append(this.chip(s));
    this.roll.classList.toggle('is-tabled', !!n);
    if (!this.begin.disabled) this.begin.textContent = this.beginLabel();
    if (this.begin.disabled) return;
    const bout = view.config.mode === 'last';
    this.hint.textContent =
      bout && !here
        ? 'Last diver standing needs somebody here to take a turn.'
        : bout && !n && here > LAST_MAX_ALONE
          ? `${plural(here, 'diver')} are here. Last diver standing takes turns: with more than ${LAST_MAX_ALONE}, choose tables first.`
          : !roll.length
            ? 'Wait for the class to sit down, or begin to see how it goes.'
            : `${plural(here, 'diver')} ${here === 1 ? 'is' : 'are'} here. Ask when the class is ready.`;
  }

  /** The question could not be asked: say why, and offer the button again. */
  fail(message: string) {
    this.begin.disabled = false;
    this.begin.removeAttribute('aria-busy');
    this.begin.textContent = this.beginLabel();
    this.hint.textContent = message;
    this.env.shout(message);
  }
}

// ------------------------------------------------------------------ a question burning

export interface HostAskActions {
  reveal(): void;
}

export class HostAskScene extends Scene {
  readonly key: string;
  private clock: CandleRow;
  private meterN: HTMLElement;
  private meterBar: HTMLElement;
  private revealBtn: HTMLButtonElement;
  private blitz: boolean;

  constructor(ctx: Ctx, key: string, view: ClassView, actions: HostAskActions) {
    super(ctx);
    this.key = key;
    this.blitz = view.config.mode === 'blitz';
    const prompt = view.prompt!;
    const qid = uniq('cv-hq');
    const rid = uniq('cv-hrules');
    const { q, rules, flavor } = questionBlock(prompt, qid, rid, 'question cv-hq-text');
    const filed = filedUnder(this.env.theme, prompt);
    this.clock = new CandleRow({
      now: () => this.ctx.now(),
      litAt: view.litAt,
      deadline: view.deadline,
      reduced: ctx.reduced,
      count: Math.max(view.n, view.config.questions),
      index: view.n - 1,
      grand: true,
      onSecond: (secs) => {
        if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
      },
      onOut: () => {
        this.revealBtn.disabled = true;
        this.revealBtn.textContent = 'The answers are surfacing…';
      },
    });
    this.meterN = h('p', { class: 'cv-meter-n', role: 'status' });
    this.meterBar = h('span', {});
    this.revealBtn = h('button', { class: 'btn ghost cv-reveal-now', type: 'button' }, 'Reveal now') as HTMLButtonElement;
    this.revealBtn.addEventListener('click', () => {
      if (this.revealBtn.disabled) return;
      this.click();
      this.revealBtn.disabled = true;
      actions.reveal();
      // If the line was down, offer it again.
      this.later(() => !this.clock.isOut && (this.revealBtn.disabled = false), 2500);
    });
    const madCat = filed ? h('p', { class: 'category' }, filed) : null;
    this.el = h(
      'div',
      { class: `sc-scene cv-host-ask${this.blitz ? ' is-blitz' : ''}`, 'aria-labelledby': qid },
      h('div', { class: 'plate question-plate cv-hq' }, h('p', { class: 'kicker' }, `${questionOf(view)}${this.blitz ? ' · Blitz: every answer you can' : ''}`), madCat, q, rules, flavor),
      h('div', { class: 'cv-hq-foot' }, this.clock.el, h('div', { class: 'cv-meter' }, this.meterN, h('span', { class: 'cv-meter-bar', 'aria-hidden': 'true' }, this.meterBar)), this.revealBtn),
    );
    this.focus = q;
    this.stops.push(() => this.clock.stop());
    this.clock.start();
    this.later(() => this.mad(madCat), 50);
    this.update(view);
  }

  update(view: ClassView) {
    const of = Math.max(view.here, view.answered);
    this.meterN.textContent = this.blitz ? `${plural(view.said, 'answer')} from ${plural(view.answered, 'diver')}` : `${view.answered} of ${of} have answered`;
    this.meterBar.style.width = `${of ? Math.round((view.answered / of) * 100) : 0}%`;
  }
}

// ------------------------------------------------------------------ the answers surface

export interface HostRevealActions {
  next(): void;
  end(): void;
}

export class HostRevealScene extends Scene {
  readonly key: string;
  private next: HTMLButtonElement;
  private hint: HTMLElement;
  private nextLabel: string;

  constructor(ctx: Ctx, key: string, view: ClassView, actions: HostRevealActions) {
    super(ctx);
    this.key = key;
    const theme = this.env.theme;
    const r = view.result;
    const titleId = uniq('cv-hr');
    const last = view.n >= view.config.questions;
    const tables = !!view.config.tables;
    this.nextLabel = last ? 'Ask one more' : 'Next question';
    this.next = h('button', { class: `btn ${last ? 'ghost' : 'primary'} cv-next`, type: 'button' }, this.nextLabel) as HTMLButtonElement;
    const end = h('button', { class: `btn ${last ? 'primary' : 'ghost'} cv-end-btn`, type: 'button' }, 'End the class') as HTMLButtonElement;
    this.hint = h('p', { class: 'sc-hint' });
    this.next.addEventListener('click', () => {
      if (this.next.disabled) return;
      this.click();
      this.next.disabled = true;
      this.next.setAttribute('aria-busy', 'true');
      this.next.textContent = 'Lighting the candle…';
      this.hint.textContent = '';
      actions.next();
    });
    end.addEventListener('click', () => {
      this.click();
      actions.end();
    });
    // A bout of last diver standing: who stood last, and the lanterns each side kept.
    const bout = r?.last;
    const won = bout ? boutLine(bout, tables) : '';
    const sum = !r
      ? ''
      : bout
        ? [`${plural(r.given, 'answer')} named of the ${r.known.toLocaleString('en-GB')} the deep knew`, plural(bout.turns, 'turn')].join(' · ')
        : [`${plural(r.spoke, 'diver')} answered`, `${plural(r.given, 'different answer')} of the ${r.known.toLocaleString('en-GB')} the deep knew`, r.silent ? `${r.silent} said nothing` : null].filter(Boolean).join(' · ');
    const answers = r?.answers ?? [];
    const said = h(
      'section',
      { class: 'cv-hr-said', 'aria-label': bout ? 'What was named' : 'What the class said' },
      h('h3', { class: 'sc-h' }, bout ? 'What was named' : 'What the class said', h('span', { class: 'sc-count' }, 'rarest first')),
      answers.length ? answerList(theme, answers, { max: tables ? 10 : 12, given: r?.given, bout: !!bout }) : h('p', { class: 'cv-roll-empty' }, bout ? 'Nothing was named.' : 'Nobody sealed an answer.'),
      r?.unsaid.length ? h('div', { class: 'sc-unsaid cv-hr-unsaid' }, h('h3', { class: 'sc-h sc-unsaid-k' }, 'What the deep knew'), unsaidList(theme, r.unsaid)) : null,
    );
    const lit = (pick: (s: NonNullable<typeof bout>['sides'][number]) => boolean) => {
      const at = bout?.sides.find(pick);
      return bout && at ? lanternsEl(at.lanterns, bout.lanterns, 'cv-board-lanterns') : null;
    };
    const side = h(
      'div',
      { class: 'cv-hr-side' },
      tables ? h('section', { class: 'plate cv-board', 'aria-label': 'The tables' }, h('h3', { class: 'sc-h' }, 'The tables'), tableBoard(tableRows(view, r?.tables), { gains: true, ...(bout ? { marks: (t: number) => lit((s) => s.table === t) } : {}) })) : null,
      h(
        'section',
        { class: 'plate cv-board', 'aria-label': 'The deepest divers' },
        h('h3', { class: 'sc-h' }, 'The deepest'),
        classStandings(view.standings ?? [], { gains: true, tables, max: tables ? 6 : 10, ...(bout && !tables ? { marks: (id: string) => lit((s) => s.id === id) } : {}) }),
      ),
    );
    this.el = h(
      'div',
      { class: `sc-scene cv-host-reveal${bout ? ' is-bout' : ''}`, 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'sc-reveal-head cv-hr-head' },
        h('p', { class: 'kicker' }, `${questionOf(view)} · ${bout ? 'the bout is over' : 'the answers surface'}`),
        this.heading('h2', r?.prompt.text ?? '', 'sc-reveal-q cv-hr-q', titleId),
        bout ? h('p', { class: 'cv-hr-won' }, `${won}.`, bout.winner >= 0 ? h('span', { class: 'cv-hr-bonus' }, ` +${fmtMetres(bout.bonus)} m`) : null) : null,
        h('p', { class: 'cv-hr-sum' }, sum),
      ),
      h('div', { class: 'cv-hr-grid' }, said, side),
      h('div', { class: 'sc-actions cv-hr-acts' }, h('div', { class: 'sc-row' }, this.next, end), this.hint),
    );
    this.env.announce(bout ? `The bout is over. ${won}. ${sum}.` : `The answers surface. ${sum}.`);
    this.ctx.sink(view.standings?.[0]?.total ?? 0);
  }

  /** The next question could not be asked: say why, and offer the button again. */
  fail(message: string) {
    this.next.disabled = false;
    this.next.removeAttribute('aria-busy');
    this.next.textContent = this.nextLabel;
    this.hint.textContent = message;
    this.env.shout(message);
  }
}

// ------------------------------------------------------------------ the end

export interface HostEndActions {
  again(): void;
  close(): void;
  /** Opens what the class came to, diver by diver: absent when this device kept no record (an older relay). */
  results?(): void;
}

export class HostEndScene extends Scene {
  readonly key = 'cv-host-end';

  constructor(ctx: Ctx, view: ClassView, actions: HostEndActions) {
    super(ctx);
    const titleId = uniq('cv-he');
    const standings = view.standings ?? [];
    const first = standings.filter((s) => s.rank === 1 && s.total > 0);
    const tables = !!view.config.tables;
    const trows = tables ? tableRows(view) : [];
    const topTables = trows.filter((t) => t.rank === 1 && t.total > 0);
    const again = h('button', { class: 'btn primary', type: 'button' }, 'Hold another round') as HTMLButtonElement;
    const close = h('button', { class: 'btn ghost', type: 'button' }, 'Close the class') as HTMLButtonElement;
    again.addEventListener('click', () => {
      this.click();
      again.disabled = true;
      actions.again();
    });
    close.addEventListener('click', () => {
      this.click();
      actions.close();
    });
    const results = actions.results ? (h('button', { class: 'btn ghost cv-results-btn', type: 'button' }, 'See the class results') as HTMLButtonElement) : null;
    results?.addEventListener('click', () => {
      this.click();
      actions.results?.();
    });
    const herald = first.length ? listNames(first.slice(0, 3).map((s) => s.name)) + (first.length > 3 ? ` and ${first.length - 3} more` : '') : 'Nobody sank at all';
    this.el = h(
      'div',
      { class: 'sc-scene cv-host-end', 'aria-labelledby': titleId },
      h(
        'header',
        { class: 'sc-reveal-head cv-he-head' },
        h('p', { class: 'kicker' }, first.length > 1 ? 'The Heralds of the Deep' : 'The Herald of the Deep'),
        this.heading('h2', herald, 'cv-he-name', titleId),
        first.length ? h('p', { class: 'cv-end-depth' }, fmtMetres(first[0].total), h('span', { class: 'u' }, ' m')) : null,
        topTables.length ? h('p', { class: 'cv-he-table', style: tableStyle(topTables[0].table) }, `${listNames(topTables.map((t) => tableName(t.table)))} ${topTables.length === 1 ? 'is the deepest table' : 'are the deepest tables'}, at ${fmtMetres(topTables[0].total)} m.`) : null,
      ),
      h(
        'div',
        { class: `cv-he-grid${tables ? ' has-tables' : ''}` },
        tables ? h('section', { class: 'plate cv-board', 'aria-label': 'The tables' }, h('h3', { class: 'sc-h' }, 'The tables'), tableBoard(trows)) : null,
        h('section', { class: 'plate cv-board', 'aria-label': 'The class' }, h('h3', { class: 'sc-h' }, 'The class', h('span', { class: 'sc-count' }, plural(standings.length, 'diver'))), classStandings(standings, { tables, max: 20 }), standings.length > 20 ? h('p', { class: 'cv-answer-more' }, `and ${plural(standings.length - 20, 'more diver')}`) : null),
      ),
      h(
        'div',
        { class: 'sc-actions' },
        h('div', { class: 'sc-row' }, again, results, close),
        h('p', { class: 'sc-hint' }, results ? 'Another round keeps the class seated and starts everyone from the surface. The results show every diver’s answers, to print or take as a spreadsheet: they are kept on this device.' : 'Another round keeps the class seated and starts everyone from the surface.'),
      ),
    );
    this.env.announce(first.length ? `The class has surfaced. ${herald} ${first.length === 1 ? 'is the Herald' : 'are the Heralds'} of the Deep, at ${fmtMetres(first[0].total)} metres.` : 'The class has surfaced.');
    this.ctx.sink(first[0]?.total ?? 0);
  }
}
