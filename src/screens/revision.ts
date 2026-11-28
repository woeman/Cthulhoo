// Revision dives: one class pack, studied alone before an exam. A question at
// a time, the diver names every answer they can; each sinks them its depth, and
// the page sinks with them towards the floor at 7,000 m. Then the deep shows
// what they missed, the commonest first. How deep they have been on each
// question is kept on the device (src/game/revision.ts holds the rules), so the
// next sitting begins with what they know least.
//
//   const r = revisionScreen(env, { pack: 'finance', onExit });
//   stage.append(r.el);   // a <section class="screen seance-screen revision-screen">
//   …
//   r.destroy();

import '../styles/seance.css';
import '../styles/classroom.css';
import '../styles/revision.css';
import { matchAnswer } from '../game/matcher';
import { REVISION_CANDLES, agoWords, closeSitting, depthNamed, floorOf, missedByTier, packProgress, revisionOrder, type RevisionBook, type RevisionRecord, type SittingResult } from '../game/revision';
import { FLOOR_DEPTH, baseDepth } from '../game/scoring';
import { slipRemark } from '../game/slips';
import { forgetRevision, loadNumber, loadRevision, saveNumber, saveRevision } from '../game/storage';
import { pickLine, zoneFor } from '../game/theme';
import { packOfTopic, type Topic } from '../game/topics';
import type { PromptDef, ThemeCopy } from '../game/types';
import { icon } from '../ui/art';
import { disputeBlock } from '../ui/disputes';
import { fmtMetres, h } from '../ui/dom';
import { installSeanceArt } from './seance/art';
import { questionBlock, riseMs } from './seance/candle';
import { CandleRow, addTry, answerForm, keepFocus, tierName, type FormParts } from './seance/parts';
import { Scene, uniq, type Ctx } from './seance/scene';
import type { SeanceEnv } from './seance/types';

export interface RevisionOpts {
  /** A class pack from the address (?revise=finance): the screen opens on it. */
  pack?: string;
  /** Whether a question is held back today: it is in today's dive, which is still to be made. */
  heldBack?(promptId: string): boolean;
  /** Something of the app's for the end of the bar (its sound switch). */
  barEnd?: HTMLElement;
  onExit(): void;
}

export function revisionScreen(env: SeanceEnv, opts: RevisionOpts): { el: HTMLElement; destroy(): void } {
  installSeanceArt();
  const screen = new RevisionScreen(env, opts);
  return { el: screen.el, destroy: () => screen.destroy() };
}

/** A class pack, as a topic, with its own id. */
type Pack = Topic & { pack: string };

/** Missed answers of one tier shown at first, and after "show more". */
const MISSED_FIRST = 10;
const MISSED_MORE = 150;
/** Answers that slipped away shown before "and more". */
const SLIPPED_SHOWN = 16;
const CANDLE_KEY = 'reviseCandle';

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;
const pct = (share: number) => `${Math.round(Math.max(0, Math.min(1, share)) * 100)}%`;
const metres = (m: number) => `${fmtMetres(m)} m`;

function dateWords(key: string | undefined): string {
  if (!key || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return '';
  const d = new Date(`${key}T12:00:00`);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** A depth line: how far down, against the floor. `was` marks the deepest before today. */
function gauge(depth: number, floor: number, opts: { was?: number; cls?: string } = {}): HTMLElement {
  const share = floor > 0 ? Math.max(0, Math.min(1, depth / floor)) : 0;
  const el = h('span', { class: `rv-gauge${opts.cls ? ` ${opts.cls}` : ''}${share >= 1 ? ' is-floor' : ''}`, 'aria-hidden': 'true' }, h('span', { class: 'rv-gauge-fill', style: `width:${(share * 100).toFixed(1)}%` }));
  if (opts.was && floor > 0 && opts.was < floor) el.append(h('span', { class: 'rv-gauge-was', style: `left:${((opts.was / floor) * 100).toFixed(1)}%` }));
  return el;
}

/** Answers as chips, each in its tier's colour. */
function chips(theme: ThemeCopy, answers: Array<{ answer: string; tier: number }>, cls = ''): HTMLElement {
  const list = h('ul', { class: `cv-named rv-chips${cls ? ` ${cls}` : ''}` });
  for (const a of answers) list.append(h('li', { class: 'cv-named-a', 'data-tier': String(a.tier), style: `--tier-color: var(--color-tier-${a.tier})`, title: tierName(theme, a.tier) }, a.answer));
  return list;
}

/** How a pack stands, in a line. */
function progressLine(p: ReturnType<typeof packProgress>, today: number): string {
  if (!p.revised) return 'Not begun';
  const parts = [`${pct(p.share)} of the way down`];
  if (p.fathomed) parts.push(`${p.fathomed} of ${p.questions} at the floor`);
  parts.push(`last sat ${agoWords(p.last, today)}`);
  return parts.join(' · ');
}

// ------------------------------------------------------------------ waiting

class WaitScene extends Scene {
  readonly key = 'rv-wait';

  constructor(ctx: Ctx, line: string, retry?: { label: string; go(): void }) {
    super(ctx);
    const btn = retry
      ? h(
          'button',
          {
            class: 'btn',
            type: 'button',
            onclick: () => {
              this.click();
              retry.go();
            },
          },
          retry.label,
        )
      : null;
    this.el = h('div', { class: 'sc-scene rv-wait' }, h('div', { class: 'plate rv-plate' }, this.heading('h2', line, 'rv-wait-line'), btn ?? h('p', { class: 'rv-dim' }, 'One moment.')));
  }
}

// ------------------------------------------------------------------ the shelf of packs

class ShelfScene extends Scene {
  readonly key = 'rv-shelf';

  constructor(ctx: Ctx, packs: Pack[], book: RevisionBook, pick: (p: Pack) => void) {
    super(ctx);
    const today = this.env.today;
    const groups = [...new Set(packs.map((p) => p.group))];
    const packButton = (p: Pack) => {
      const prog = packProgress(p.pack, p.count, book);
      const btn = h(
        'button',
        { class: `rv-pack${prog.revised ? ' is-begun' : ''}`, type: 'button' },
        h('span', { class: 'rv-pack-name' }, p.name),
        p.title ? h('span', { class: 'rv-pack-title' }, p.title) : null,
        gauge(prog.share, 1),
        h('span', { class: 'rv-pack-meta' }, `${plural(p.count, 'question')} · ${progressLine(prog, today)}`),
      );
      btn.addEventListener('click', () => {
        this.click();
        pick(p);
      });
      return btn;
    };
    this.el = h(
      'div',
      { class: 'sc-scene rv-shelf' },
      h(
        'header',
        { class: 'plate rv-plate rv-head' },
        h('p', { class: 'kicker' }, 'Charted Waters'),
        this.heading('h2', 'Revision dives', 'rv-title'),
        h('p', { class: 'rv-lede' }, `Pick a class pack. One question at a time, name every answer you can: each sinks you its depth, and the floor lies at ${metres(FLOOR_DEPTH)}. Then see what you missed. How deep you have been is kept on this device.`),
      ),
      ...groups.map((g) =>
        h(
          'section',
          { class: 'plate rv-plate rv-group', 'aria-label': g },
          h('h3', { class: 'rv-k' }, g),
          h('ul', { class: 'rv-packs' }, ...packs.filter((p) => p.group === g).map((p) => h('li', {}, packButton(p)))),
        ),
      ),
    );
  }
}

// ------------------------------------------------------------------ one pack

interface PackActions {
  begin(): void;
  one(p: PromptDef): void;
  candle(secs: number): void;
  forget(): void;
}

class PackScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, pack: Pack, prompts: PromptDef[], book: RevisionBook, held: Set<string>, candle: number, actions: PackActions) {
    super(ctx);
    this.key = `rv-pack:${pack.pack}`;
    const today = this.env.today;
    const prog = packProgress(pack.pack, prompts.length, book);
    const depthOf = (tier: number) => baseDepth(this.env.theme, tier);
    const open = prompts.filter((p) => !held.has(p.id));
    const asOf = dateWords(pack.asOf);

    const begin = h('button', { class: 'btn primary rv-begin', type: 'button', disabled: !open.length }, prog.revised ? 'Dive again · what you know least first' : 'Begin the dive') as HTMLButtonElement;
    begin.addEventListener('click', () => {
      this.click();
      actions.begin();
    });

    const name = uniq('rv-candle');
    const candles = h('div', { class: 'sc-choice-opts' });
    for (const secs of REVISION_CANDLES) {
      const input = h('input', { type: 'radio', name, value: secs, class: 'visually-hidden' }) as HTMLInputElement;
      input.checked = secs === candle;
      input.addEventListener('change', () => {
        if (!input.checked) return;
        this.env.sound?.key?.();
        actions.candle(secs);
      });
      candles.append(h('label', { class: 'sc-choice' }, input, h('span', { class: 'v' }, secs ? String(secs / 60) : 'No'), h('span', { class: 'u' }, secs ? (secs === 60 ? 'minute' : 'minutes') : 'candle')));
    }

    const rows = prompts.map((p) => {
      const r = book[p.id];
      const floor = floorOf(p, depthOf);
      const depth = Math.min(r?.depth ?? 0, floor);
      const isHeld = held.has(p.id);
      const state = isHeld ? 'Held back today: it is in today’s dive' : !r ? 'Not yet sat' : depth >= floor ? `At the floor · ${metres(floor)}` : `${metres(depth)} of ${fmtMetres(floor)}`;
      const btn = h(
        'button',
        { class: `rv-q${r ? ' is-sat' : ''}${r && depth >= floor ? ' is-floor' : ''}`, type: 'button', disabled: isHeld },
        h('span', { class: 'rv-q-text' }, p.text),
        gauge(depth, floor),
        h('span', { class: 'rv-q-meta' }, p.section ? `${p.section} · ${state}` : state),
      );
      btn.addEventListener('click', () => {
        this.click();
        actions.one(p);
      });
      return h('li', {}, btn);
    });

    let armed = 0;
    const forget = h('button', { class: 'btn ghost rv-forget', type: 'button' }, 'Forget how deep I have been in this pack') as HTMLButtonElement;
    forget.addEventListener('click', () => {
      this.click();
      if (!armed) {
        forget.textContent = 'Press again to forget it all';
        armed = this.later(() => {
          armed = 0;
          forget.textContent = 'Forget how deep I have been in this pack';
        }, 4000);
        return;
      }
      clearTimeout(armed);
      actions.forget();
    });

    this.el = h(
      'div',
      { class: 'sc-scene rv-pack-scene' },
      h(
        'header',
        { class: 'plate rv-plate rv-head' },
        h('p', { class: 'kicker' }, `A revision dive · ${pack.group}`),
        this.heading('h2', pack.title ?? pack.name, 'rv-title'),
        pack.blurb ? h('p', { class: 'rv-lede' }, pack.blurb) : null,
        h('p', { class: 'rv-dim' }, [pack.title ? pack.name : '', plural(prompts.length, 'question'), asOf ? `lists as they stood on ${asOf}` : ''].filter(Boolean).join(' · ')),
        h('div', { class: 'rv-progress' }, gauge(prog.share, 1, { cls: 'is-wide' }), h('p', { class: 'rv-progress-line' }, progressLine(prog, today))),
        h('fieldset', { class: 'sc-choices rv-candles' }, h('legend', { class: 'sc-choices-k' }, 'A candle on each question'), candles),
        h('div', { class: 'rv-actions' }, begin),
        open.length ? null : h('p', { class: 'rv-dim' }, 'Every question of this pack is in today’s dive. Make the dive first, then come back.'),
      ),
      h('section', { class: 'plate rv-plate', 'aria-label': 'The questions' }, h('h3', { class: 'rv-k' }, 'Or sit one question'), h('ol', { class: 'rv-qs' }, ...rows), prog.revised ? forget : null),
    );
  }
}

// ------------------------------------------------------------------ a question

interface AskInfo {
  /** The line over the question ("Finance · Markets · 3 of 16"). */
  kicker: string;
  /** Seconds of candle; 0 for none. */
  candle: number;
  before?: RevisionRecord;
}

interface AskActions {
  /** The sitting is over: what was named, by its own spelling, and what the deep refused. */
  done(named: string[], rejects: string[]): void;
}

class AskScene extends Scene {
  readonly key: string;
  private parts: FormParts;
  private clock: CandleRow | null = null;
  private named: string[] = [];
  private rejects: string[] = [];
  private locked = false;
  private floor: number;
  private depth = 0;
  private zone = '';
  private depthN: HTMLElement;
  private zoneEl: HTMLElement;
  private countEl: HTMLElement;
  private gaugeSlot: HTMLElement;
  private chipsEl: HTMLElement;
  private doneBtn: HTMLButtonElement;
  private depthOf = (tier: number) => baseDepth(this.env.theme, tier);

  constructor(
    ctx: Ctx,
    private prompt: PromptDef,
    private info: AskInfo,
    private actions: AskActions,
  ) {
    super(ctx);
    this.key = `rv-ask:${prompt.id}`;
    this.floor = floorOf(prompt, this.depthOf);
    const qid = uniq('rv-q');
    const rid = uniq('rv-rules');
    const { q, rules, flavor } = questionBlock(prompt, qid, rid);
    this.parts = answerForm(prompt.rules ? `${qid} ${rid}` : qid, () => this.env.sound?.key?.());
    this.parts.input.placeholder = 'Name one…';
    this.parts.button.textContent = 'Name it';
    this.depthN = h('span', { class: 'rv-depth-n' }, '0');
    this.zoneEl = h('p', { class: 'rv-zone' });
    this.countEl = h('p', { class: 'rv-count' });
    this.gaugeSlot = h('div', { class: 'rv-gauge-slot' });
    this.chipsEl = h('div', { class: 'rv-named', role: 'group', 'aria-label': 'What you have named' });
    this.doneBtn = h('button', { class: 'btn rv-done', type: 'button', onmousedown: keepFocus }) as HTMLButtonElement;
    this.doneBtn.addEventListener('click', () => {
      this.click();
      this.finish();
    });
    const rise = riseMs(prompt.text, ctx.reduced);
    if (info.candle > 0) {
      const litAt = ctx.now() + rise;
      this.clock = new CandleRow({
        now: () => ctx.now(),
        litAt,
        deadline: litAt + info.candle * 1000,
        reduced: ctx.reduced,
        count: 1,
        index: 0,
        onSecond: (secs) => {
          if (secs <= 5 && secs > 0) this.env.sound?.tick?.(secs <= 3);
          if (secs === 10) this.env.announce('Ten seconds.');
        },
        onOut: () => this.burntOut(),
      });
      this.stops.push(() => this.clock?.stop());
    }
    const tally = h(
      'div',
      { class: 'rv-tally' },
      h('div', { class: 'rv-tally-depth' }, h('p', { class: 'rv-depth' }, this.depthN, h('span', { class: 'u' }, ' m')), this.zoneEl),
      this.clock ? this.clock.el : null,
    );
    const plate = h(
      'div',
      { class: 'plate question-plate sc-qplate rv-ask-plate' },
      h('p', { class: 'kicker' }, info.kicker),
      q,
      rules,
      flavor,
      tally,
      this.gaugeSlot,
      this.countEl,
      this.parts.form,
      this.parts.feedback,
      this.chipsEl,
      this.parts.tries,
      h('div', { class: 'rv-actions' }, this.doneBtn),
    );
    this.el = h('div', { class: 'sc-scene sc-candle-scene rv-ask', 'aria-labelledby': qid }, plate);
    this.parts.form.addEventListener('submit', (e) => {
      e.preventDefault();
      this.submit();
    });
    this.parts.input.addEventListener('focus', () => this.later(() => this.parts.form.scrollIntoView({ block: 'center', behavior: ctx.reduced ? 'auto' : 'smooth' }), 320));
    this.focus = this.parts.input;
    this.focusDelay = Math.min(rise, 900);
    this.clock?.start();
    this.paint(false);
  }

  /** The tally: how deep, in which waters, how many named. */
  private paint(live: boolean) {
    const theme = this.env.theme;
    this.depth = depthNamed(this.prompt, this.named, this.depthOf);
    const atFloor = this.floor > 0 && this.depth >= this.floor;
    this.depthN.textContent = fmtMetres(this.depth);
    const zone = zoneFor(theme, this.depth);
    this.zoneEl.textContent = atFloor ? `The floor of this question${this.floor >= FLOOR_DEPTH ? `: ${zone.name}` : ''}` : zone.name;
    this.gaugeSlot.replaceChildren(gauge(this.depth, this.floor, { was: this.info.before?.depth, cls: 'is-wide' }));
    const left = this.prompt.answers.length - this.named.length;
    const best = this.info.before?.depth;
    this.countEl.textContent = [
      this.named.length ? `${this.named.length} named` : 'Nothing named yet',
      left > 0 ? `${left.toLocaleString('en-GB')} still down there` : 'every answer named',
      atFloor ? '' : `the floor at ${metres(this.floor)}`,
      best ? `your deepest here ${metres(Math.min(best, this.floor))}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    this.doneBtn.textContent = this.named.length ? 'Surface · see what I missed' : 'Show me the answers';
    const list = this.named
      .slice()
      .reverse()
      .map((answer) => ({ answer, tier: this.prompt.answers.find((a) => a.answer === answer)?.tier ?? 1 }));
    const el = chips(theme, list);
    if (live && el.firstElementChild) el.firstElementChild.classList.add('is-fresh');
    this.chipsEl.replaceChildren(el);
    this.ctx.sink(this.depth);
    if (live && zone.key !== this.zone && this.zone) this.env.sound?.zone?.();
    this.zone = zone.key;
  }

  private submit() {
    if (this.locked) return;
    const input = this.parts.input;
    const text = input.value.trim();
    if (!text) {
      input.focus();
      return;
    }
    const res = matchAnswer(this.prompt, text);
    if (res.kind === 'empty') return;
    const theme = this.env.theme;
    const fb = this.parts.feedback;
    fb.textContent = '';
    if (res.kind === 'accept') {
      const a = res.answer;
      if (this.named.includes(a.answer)) {
        const words = `You have named ${a.answer} already.`;
        fb.append(h('span', { class: 'sc-note' }, words));
        this.env.announce(words);
      } else {
        const was = this.depth;
        const wasFloor = this.floor > 0 && was >= this.floor;
        this.named.push(a.answer);
        this.paint(true);
        const gain = this.depth - was;
        const name = tierName(theme, a.tier);
        const remark = res.fuzzy ? slipRemark(theme.slips.lines, a.answer, this.prompt.id, text) : null;
        const touched = !wasFloor && this.floor > 0 && this.depth >= this.floor;
        fb.append(h('span', { class: 'rv-took', style: `--tier-color: var(--color-tier-${a.tier})` }, `${name}: “${a.answer}”.`), gain > 0 ? h('span', { class: 'rv-gain' }, ` +${metres(gain)}.`) : '');
        if (remark) fb.append(' ', h('span', { class: 'rv-slip' }, remark.before, h('span', { class: 'spelt' }, remark.answer), remark.after));
        if (touched) fb.append(' ', h('span', { class: 'rv-touched' }, 'You have touched the floor of this question.'));
        this.env.announce([`${name}. ${a.answer}.`, remark?.text ?? '', `${fmtMetres(this.depth)} metres.`, touched ? 'You have touched the floor of this question.' : ''].filter(Boolean).join(' '));
        this.env.sound?.accept?.(a.tier);
        this.env.buzz?.(touched ? [30, 50, 90] : 20);
      }
    } else {
      const lines = theme.refused.lines;
      const line = res.kind === 'trap' ? res.trap.reason : pickLine(res.kind === 'decoy' ? lines.decoy : res.kind === 'ambiguous' ? lines.ambiguous : lines.unknown, this.prompt.id, text);
      fb.append(h('span', { class: 'said' }, `${theme.refused.name}: “${text}”.`), ' ', line);
      this.env.shout(`${theme.refused.name}: ${text}. ${line}`);
      if (addTry(this.parts.tries, text)) this.rejects.push(text);
      this.env.sound?.refuse?.();
      this.env.buzz?.(45);
      const form = this.parts.form;
      form.classList.remove('shake');
      void form.offsetWidth;
      if (!this.ctx.reduced) form.classList.add('shake');
    }
    input.value = '';
    input.focus();
  }

  /** The candle went out by itself: a breath, then what was missed. */
  private burntOut() {
    if (this.locked) return;
    this.lock();
    const words = 'The candle is out.';
    this.parts.feedback.textContent = '';
    this.parts.feedback.append(h('span', { class: 'sc-note' }, words));
    this.env.announce(words);
    this.later(() => this.finish(), this.ctx.reduced ? 300 : 1100);
  }

  private lock() {
    this.locked = true;
    this.parts.input.disabled = true;
    this.parts.button.disabled = true;
    this.doneBtn.disabled = true;
  }

  private finish() {
    if (this.gone) return;
    this.lock();
    this.clock?.snuff();
    this.actions.done(this.named.slice(), this.rejects.slice());
  }

  /** What has been named so far, for a sitting left by the way back. */
  get sofar(): { named: string[]; rejects: string[] } {
    return { named: this.named.slice(), rejects: this.rejects.slice() };
  }
}

// ------------------------------------------------------------------ what was missed

interface MissedActions {
  next(): void;
  again(): void;
}

class MissedScene extends Scene {
  readonly key: string;

  constructor(ctx: Ctx, prompt: PromptDef, res: SittingResult, named: string[], rejects: string[], info: { kicker: string; nextLabel: string }, actions: MissedActions) {
    super(ctx);
    this.key = `rv-missed:${prompt.id}`;
    const theme = this.env.theme;
    const zone = zoneFor(theme, res.depth);
    const tiers = new Map(prompt.answers.map((a) => [a.answer, a.tier]));
    const tierOf = (answer: string) => tiers.get(answer) ?? 1;
    const fresh = new Set(res.fresh);

    const standing = res.fathomed
      ? 'You touched the floor of this question.'
      : res.first
        ? 'Your first sitting on this question.'
        : res.deeper
          ? `Deeper than ever: you had reached ${metres(res.depthBefore)}.`
          : `Your deepest here is still ${metres(res.depthBefore)}.`;

    const next = h('button', { class: 'btn primary', type: 'button' }, info.nextLabel) as HTMLButtonElement;
    next.addEventListener('click', () => {
      this.click();
      actions.next();
    });
    const again = h('button', { class: 'btn ghost', type: 'button' }, 'Sit it again') as HTMLButtonElement;
    again.addEventListener('click', () => {
      this.click();
      actions.again();
    });

    // What you named, the rarest first; an answer new to you is marked.
    const yours = named.map((answer) => ({ answer, tier: tierOf(answer) })).sort((a, b) => b.tier - a.tier);
    const yoursEl = chips(theme, yours);
    [...yoursEl.children].forEach((li, i) => fresh.has(yours[i].answer) && !res.first && li.classList.add('is-new'));

    const slipped = res.slipped.map((answer) => ({ answer, tier: tierOf(answer) }));
    const slippedMore = slipped.length - SLIPPED_SHOWN;

    const missed = missedByTier(prompt, named, MISSED_MORE);
    const tierBlocks = missed.map((t) => {
      const name = tierName(theme, t.tier);
      const head = h('p', { class: 'rv-tier-k', style: `--tier-color: var(--color-tier-${t.tier})` }, h('span', { class: 'rv-tier-name' }, name), ' ', h('span', { class: 'rv-tier-n' }, t.missed ? `${t.missed.toLocaleString('en-GB')} of ${t.of.toLocaleString('en-GB')} missed` : `all ${t.of.toLocaleString('en-GB')} named`));
      if (!t.missed) return h('div', { class: 'rv-tier is-clear' }, head);
      const list = chips(theme, t.answers.slice(0, MISSED_FIRST), 'is-missed');
      const block = h('div', { class: 'rv-tier' }, head, list);
      const beyond = t.missed - t.answers.length;
      const tail = (shown: number) => (t.missed > shown ? h('p', { class: 'rv-dim rv-tier-more' }, `and ${plural(t.missed - shown, 'more')}`) : null);
      if (t.answers.length > MISSED_FIRST) {
        const more = h('button', { class: 'btn ghost rv-more', type: 'button' }, `Show ${beyond > 0 ? `${(t.answers.length - MISSED_FIRST).toLocaleString('en-GB')} more` : `all ${t.missed.toLocaleString('en-GB')}`}`) as HTMLButtonElement;
        more.addEventListener('click', () => {
          this.click();
          const all = chips(theme, t.answers, 'is-missed');
          list.replaceWith(all);
          more.replaceWith(tail(t.answers.length) ?? '');
          (all.children[MISSED_FIRST] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest', behavior: ctx.reduced ? 'auto' : 'smooth' });
        });
        block.append(more);
      } else {
        const rest = tail(t.answers.length);
        if (rest) block.append(rest);
      }
      return block;
    });
    const missedAll = res.total - res.named;

    this.el = h(
      'div',
      { class: 'sc-scene rv-missed' },
      h(
        'div',
        { class: 'plate rv-plate rv-result' },
        h('p', { class: 'kicker' }, info.kicker),
        this.heading('h2', prompt.text, 'rv-result-q'),
        h('p', { class: 'rv-depth is-result' }, h('span', { class: 'rv-depth-n' }, fmtMetres(res.depth)), h('span', { class: 'u' }, ' m')),
        h('p', { class: 'rv-zone' }, res.fathomed ? 'The floor of this question' : zone.name),
        gauge(res.depth, res.floor, { was: res.first ? undefined : res.depthBefore, cls: 'is-wide' }),
        h('p', { class: 'rv-count' }, `${res.named.toLocaleString('en-GB')} named of ${res.total.toLocaleString('en-GB')} · ${standing}`),
        h('div', { class: 'rv-actions' }, next, again),
      ),
      named.length ? h('section', { class: 'plate rv-plate', 'aria-label': 'What you named' }, h('h3', { class: 'rv-k' }, 'You named'), yoursEl, fresh.size && !res.first ? h('p', { class: 'rv-dim' }, `${plural(fresh.size, 'answer')} new to you, ringed.`) : null) : null,
      slipped.length
        ? h(
            'section',
            { class: 'plate rv-plate rv-slipped', 'aria-label': 'Named before, not today' },
            h('h3', { class: 'rv-k' }, 'Named before, not today'),
            chips(theme, slipped.slice(0, SLIPPED_SHOWN), 'is-missed'),
            slippedMore > 0 ? h('p', { class: 'rv-dim' }, `and ${plural(slippedMore, 'more')}`) : null,
          )
        : null,
      missedAll > 0
        ? h('section', { class: 'plate rv-plate', 'aria-label': 'What you missed' }, h('h3', { class: 'rv-k' }, 'What you missed'), h('p', { class: 'rv-dim' }, 'The commonest first: what everybody says is what an exam asks first.'), ...tierBlocks)
        : h('section', { class: 'plate rv-plate' }, h('h3', { class: 'rv-k' }, 'Nothing missed'), h('p', { class: 'rv-dim' }, 'You named every answer the deep knows.')),
      (() => {
        const block = disputeBlock(prompt, rejects, this.env.today);
        return block ? h('section', { class: 'plate rv-plate rv-refused' }, block) : null;
      })(),
    );
    this.focus = next;
    this.focusDelay = ctx.reduced ? 0 : 500;
    this.env.announce(`${fmtMetres(res.depth)} metres. ${res.named} named of ${res.total}. ${standing}`);
  }
}

// ------------------------------------------------------------------ the end of a dive

class EndScene extends Scene {
  readonly key = 'rv-end';

  constructor(ctx: Ctx, pack: Pack, results: SittingResult[], before: number, after: ReturnType<typeof packProgress>, back: () => void) {
    super(ctx);
    const named = results.reduce((n, r) => n + r.named, 0);
    const floors = results.filter((r) => r.fathomed).length;
    const deeper = results.filter((r) => r.deeper || (r.first && r.depth > 0)).length;
    const btn = h('button', { class: 'btn primary', type: 'button' }, 'Back to the pack') as HTMLButtonElement;
    btn.addEventListener('click', () => {
      this.click();
      back();
    });
    const stat = (n: string, label: string) => h('li', {}, h('span', { class: 'rv-stat-n' }, n), h('span', { class: 'rv-stat-k' }, label));
    const moved = after.share > before + 0.004;
    this.el = h(
      'div',
      { class: 'sc-scene rv-end' },
      h(
        'div',
        { class: 'plate rv-plate rv-head' },
        h('p', { class: 'kicker' }, `${pack.name} · the dive is done`),
        this.heading('h2', 'You have been through the pack.', 'rv-title'),
        h('ul', { class: 'rv-stats' }, stat(String(results.length), results.length === 1 ? 'question sat' : 'questions sat'), stat(named.toLocaleString('en-GB'), named === 1 ? 'answer named' : 'answers named'), stat(String(deeper), 'deeper than before'), stat(String(floors), floors === 1 ? 'floor touched' : 'floors touched')),
        h('div', { class: 'rv-progress' }, gauge(after.share, 1, { was: moved ? before : undefined, cls: 'is-wide' }), h('p', { class: 'rv-progress-line' }, `The pack: ${pct(after.share)} of the way down${moved ? `, from ${pct(before)}` : ''}.`)),
        h('div', { class: 'rv-actions' }, btn),
      ),
    );
    this.focus = btn;
    this.env.announce(`The dive is done. ${named} answers named over ${results.length} questions. The pack is ${pct(after.share)} of the way down.`);
  }
}

// ------------------------------------------------------------------ the screen

interface Run {
  order: PromptDef[];
  at: number;
  results: SittingResult[];
  /** How far down the pack was before this dive. */
  shareBefore: number;
}

class RevisionScreen {
  readonly el: HTMLElement;
  private stage: HTMLElement;
  private backLabel: HTMLElement;
  private barNote: HTMLElement;
  private scene: Scene | null = null;
  private ctx: Ctx;
  private reduced: boolean;
  private dead = false;
  private depthNow = 0;
  private packs: Pack[] | null = null;
  private pack: Pack | null = null;
  private prompts: PromptDef[] = [];
  private run: Run | null = null;
  /** Bumps whenever the screen moves on, so a fetch that comes back late changes nothing. */
  private token = 0;
  private depthOf = (tier: number) => baseDepth(this.env.theme, tier);

  constructor(
    private env: SeanceEnv,
    private opts: RevisionOpts,
  ) {
    let mq = false;
    try {
      mq = matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      /* no media queries here */
    }
    this.reduced = env.reduced || mq;
    this.backLabel = h('span', {}, 'Close');
    const back = h('button', { class: 'btn ghost sc-back', type: 'button', html: icon('back') }, this.backLabel) as HTMLButtonElement;
    back.addEventListener('click', () => {
      this.env.sound?.click?.();
      this.back();
    });
    this.barNote = h('span', { class: 'sc-bar-sign rv-bar-pack' });
    this.stage = h('div', { class: 'sc-stage' });
    this.el = h(
      'section',
      { class: `screen seance-screen revision-screen${this.reduced ? ' is-reduced' : ''}`, 'aria-label': 'Revision dives' },
      h('div', { class: `sc-bar${opts.barEnd ? ' has-end' : ''}` }, back, h('p', { class: 'sc-bar-title' }, h('span', { class: 't' }, 'Revision dive'), this.barNote), opts.barEnd ?? null),
      this.stage,
    );
    this.ctx = {
      env,
      reduced: this.reduced,
      screen: this.el,
      depth: () => this.depthNow,
      now: () => Date.now(),
      sink: (m) => this.sink(m),
    };
    void this.openShelf(opts.pack);
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.token++;
    // A sitting left by closing the screen is kept, as one left by the way back is.
    this.keepUnfinished();
    this.scene?.destroy();
    this.scene = null;
    this.sink(0);
  }

  private sink(m: number) {
    const d = Math.max(0, Math.round(m));
    if (d === this.depthNow) return;
    this.depthNow = d;
    this.env.onDepth?.(d);
  }

  /** One scene gives way to the next: the old drifts off as the new one surfaces. */
  private show(next: Scene) {
    const old = this.scene;
    this.scene = next;
    if (old) {
      old.destroy();
      const el = old.el;
      if (this.reduced) el.remove();
      else {
        el.inert = true;
        el.classList.add('sc-leaving');
        window.setTimeout(() => el.remove(), 420);
      }
    }
    if (!this.reduced) next.el.classList.add('sc-arriving');
    this.stage.append(next.el);
    this.el.scrollTop = 0;
    const target = next.focus;
    if (target) window.setTimeout(() => !this.dead && this.scene === next && target.isConnected && target.focus({ preventScroll: true }), next.focusDelay || (this.reduced ? 0 : 120));
  }

  private bar(label: string, note = '') {
    this.backLabel.textContent = label;
    this.barNote.textContent = note;
  }

  private back() {
    if (this.scene instanceof AskScene || this.scene instanceof MissedScene || this.scene instanceof EndScene) {
      this.keepUnfinished();
      return void this.showPack();
    }
    if (this.scene instanceof PackScene || (this.pack && this.scene instanceof WaitScene)) return void this.openShelf();
    this.opts.onExit();
  }

  /** A sitting left halfway still counts for what was named in it. */
  private keepUnfinished() {
    if (!(this.scene instanceof AskScene) || !this.pack) return;
    const prompt = this.run?.order[this.run.at];
    const { named } = this.scene.sofar;
    if (!prompt || !named.length) return;
    this.keep(prompt, named);
  }

  private keep(prompt: PromptDef, named: string[]): SittingResult {
    const res = closeSitting(prompt, this.pack!.pack, named, loadRevision()[prompt.id], this.env.today, this.depthOf);
    saveRevision(prompt.id, res.record);
    return res;
  }

  // ------------------------------------------------------------ the shelf

  private async openShelf(straightTo?: string) {
    const token = ++this.token;
    this.pack = null;
    this.run = null;
    this.sink(0);
    this.bar('Close');
    if (!this.packs) {
      this.show(new WaitScene(this.ctx, 'Fetching the class packs…'));
      let topics: Topic[] = [];
      try {
        topics = (await this.env.topics?.all()) ?? [];
      } catch {
        /* the line is down: said below */
      }
      if (token !== this.token) return;
      const packs = topics.flatMap((t) => {
        const pack = packOfTopic(t.id);
        return pack ? [{ ...t, pack }] : [];
      });
      if (!packs.length) {
        this.show(new WaitScene(this.ctx, 'The class packs could not be fetched. Check the connection.', { label: 'Try again', go: () => void this.openShelf(straightTo) }));
        return;
      }
      this.packs = packs;
    }
    const wanted = straightTo ? this.packs.find((p) => p.pack === straightTo) : undefined;
    if (wanted) return void this.openPack(wanted);
    this.show(new ShelfScene(this.ctx, this.packs, loadRevision(), (p) => void this.openPack(p)));
  }

  // ------------------------------------------------------------ a pack

  private async openPack(pack: Pack) {
    const token = ++this.token;
    this.pack = pack;
    this.run = null;
    this.sink(0);
    this.bar('Packs', pack.name);
    this.show(new WaitScene(this.ctx, `Fetching ${pack.name}…`));
    let prompts: PromptDef[] = [];
    try {
      prompts = ((await this.env.topics?.pool([pack.id])) ?? []).filter((p) => p.answers.length > 0);
    } catch {
      /* said below */
    }
    if (token !== this.token) return;
    if (!prompts.length) {
      this.show(new WaitScene(this.ctx, `${pack.name} could not be fetched. Check the connection.`, { label: 'Try again', go: () => void this.openPack(pack) }));
      return;
    }
    this.prompts = prompts;
    this.showPack();
  }

  private held(): Set<string> {
    const held = this.opts.heldBack;
    return new Set(held ? this.prompts.filter((p) => held(p.id)).map((p) => p.id) : []);
  }

  private candle(): number {
    const kept = loadNumber(CANDLE_KEY);
    return (REVISION_CANDLES as readonly number[]).includes(kept ?? -1) ? (kept as number) : REVISION_CANDLES[0];
  }

  private showPack() {
    const pack = this.pack;
    if (!pack) return void this.openShelf();
    this.token++;
    this.run = null;
    this.sink(0);
    this.bar('Packs', pack.name);
    const book = loadRevision();
    const held = this.held();
    const open = this.prompts.filter((p) => !held.has(p.id));
    const shareBefore = packProgress(pack.pack, this.prompts.length, book).share;
    this.show(
      new PackScene(this.ctx, pack, this.prompts, book, held, this.candle(), {
        begin: () => this.begin(revisionOrder(open, loadRevision()), shareBefore),
        one: (p) => this.begin([p], shareBefore),
        candle: (secs) => saveNumber(CANDLE_KEY, secs),
        forget: () => {
          forgetRevision(pack.pack);
          this.env.announce(`Forgotten: ${pack.name}.`);
          this.showPack();
        },
      }),
    );
  }

  // ------------------------------------------------------------ a dive

  private begin(order: PromptDef[], shareBefore: number) {
    if (!order.length) return;
    this.run = { order, at: 0, results: [], shareBefore };
    this.ask();
  }

  private kicker(prompt: PromptDef): string {
    const run = this.run!;
    return [this.pack?.name ?? '', prompt.section ?? '', run.order.length > 1 ? `${run.at + 1} of ${run.order.length}` : ''].filter(Boolean).join(' · ');
  }

  private ask() {
    const run = this.run;
    const prompt = run?.order[run.at];
    if (!run || !prompt || !this.pack) return void this.showPack();
    this.token++;
    this.sink(0);
    this.bar('The pack', this.pack.name);
    this.show(
      new AskScene(this.ctx, prompt, { kicker: this.kicker(prompt), candle: this.candle(), before: loadRevision()[prompt.id] }, { done: (named, rejects) => this.missed(prompt, named, rejects) }),
    );
  }

  private missed(prompt: PromptDef, named: string[], rejects: string[]) {
    const run = this.run;
    if (!run || !this.pack) return;
    const res = this.keep(prompt, named);
    run.results.push(res);
    const last = run.at >= run.order.length - 1;
    this.show(
      new MissedScene(this.ctx, prompt, res, named, rejects, { kicker: `${this.kicker(prompt)} · what you missed`, nextLabel: !last ? 'The next question' : run.order.length > 1 ? 'End the dive' : 'Back to the pack' }, {
        next: () => {
          if (!last) {
            run.at++;
            return this.ask();
          }
          if (run.order.length > 1) return this.end();
          this.showPack();
        },
        again: () => {
          // The sitting just kept stands; this one is another.
          run.results.pop();
          this.ask();
        },
      }),
    );
  }

  private end() {
    const run = this.run;
    const pack = this.pack;
    if (!run || !pack) return void this.showPack();
    this.sink(0);
    this.bar('The pack', pack.name);
    const after = packProgress(pack.pack, this.prompts.length, loadRevision());
    this.show(new EndScene(this.ctx, pack, run.results, run.shareBefore, after, () => this.showPack()));
    this.run = null;
  }
}
