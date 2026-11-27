import { loadBank, type Bank } from './game/bank';
import { dayNumberFor, localDateKey, msUntilNextDay, practicePrompts, promptsForDay } from './game/daily';
import { matchAnswer } from './game/matcher';
import { omenById, omenForDay } from './game/omens';
import { SANITY, clampSanity, depthFor, isBellQuestion, sanityAfterAnswer, timeLimitMs, totalDepth } from './game/scoring';
import { shareDive, shareText } from './game/share';
import { computeStats } from './game/stats';
import { loadDays, loadFlag, loadSettings, saveDay, saveFlag, saveSettings } from './game/storage';
import { cultRankFor, landmarkFor, pickLine, tierDef, zoneFor } from './game/theme';
import type { AnswerDef, AnswerRecord, DayRecord, PromptDef, Settings, ThemeCopy, Tier } from './game/types';
import { Sound } from './audio/engine';
import { Abyss } from './render/abyss';
import { clear, fmtMetres, h, risingWords, sleep } from './ui/dom';
import { ICONS } from './ui/icons';
import { ARTIFACT } from './env';
import { applyDepth } from '../art/js/depth.js';

// The camera always sits a little below the score depth, so the first question
// is asked underwater rather than on the waterline.
const CAM_OFFSET = 40;
const TITLE_DEPTH = -32;
const cam = (score: number) => score + CAM_OFFSET;
const GLYPHS = ['ᚦ', 'ᛟ', 'ᚨ', 'ʘ', 'ϟ', 'Ψ', 'ᛉ', '⸸'];
// Browser chrome colour per zone (matches --color-ground in the art tokens).
const CHROME: Record<string, string> = {
  surface: '#e7ddc6',
  twilight: '#0f2530',
  midnight: '#061420',
  abyss: '#050b12',
  hadal: '#07040d',
  floor: '#07040d',
  city: '#07040d',
};

export class App {
  private bank: Bank = loadBank();
  private theme: ThemeCopy = this.bank.theme;
  private settings: Settings = loadSettings();
  private sound = new Sound();
  private abyss: Abyss;
  private reduced: boolean;
  private today = dayNumberFor(new Date());
  private rec: DayRecord | null = null;
  private token = 0; // bumps on every screen change so stale async flows stop
  private shown = TITLE_DEPTH; // last score depth pushed to the UI
  private zoneKey = '';
  private chromeZone = '';
  private loops: Array<() => void> = [];

  private hud!: { el: HTMLElement; title: HTMLElement; num: HTMLElement; zone: HTMLElement; sound: HTMLButtonElement };
  private stage!: HTMLElement;
  private sounding!: { el: HTMLElement; bob: HTMLElement };
  private toastEl!: HTMLElement;
  private live!: HTMLElement;

  constructor(private root: HTMLElement) {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.settings.reducedMotion === 'on' || (this.settings.reducedMotion === 'auto' && mq.matches);
    document.documentElement.classList.toggle('reduced-motion', this.reduced);
    this.abyss = new Abyss(document.body, { reducedMotion: this.reduced });
    if (!this.abyss.ok) document.documentElement.classList.add('no-webgl');
    this.abyss.jumpTo(TITLE_DEPTH);
    this.abyss.onDepth = (d) => this.onCamera(d);
    this.buildShell();
    this.sound.setMuted(this.settings.muted);
    this.sound.setVolume(this.settings.volume);
    this.bindGlobal();
    this.abyss.start();
    this.paintDepth(0, true);
  }

  // ================================================================= shell

  private buildShell() {
    const soundBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sound', onclick: () => this.toggleSound() }) as HTMLButtonElement;
    const menu = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Logbook and settings', onclick: () => this.openLogbook(), html: ICONS.book });
    const title = h('div', { class: 'hud-title' });
    const num = h('span', { class: 'num' }, '0');
    const zone = h('span', { class: 'zone' });
    const depth = h('div', { class: 'hud-depth', 'aria-label': 'Depth' }, num, h('span', { class: 'unit' }, ' m'), zone);
    const hud = h('header', { class: 'hud', hidden: true }, menu, title, depth, soundBtn);
    this.hud = { el: hud, title, num, zone, sound: soundBtn };
    this.stage = h('main', { class: 'stage' });
    this.live = h('div', { class: 'visually-hidden', 'aria-live': 'polite' });
    const app = h('div', { class: 'app' }, hud, this.stage, this.live);
    const bob = h('div', { class: 'bob' });
    const sounding = h('aside', { class: 'sounding', 'aria-hidden': 'true', hidden: true });
    for (let m = 500; m < 7000; m += 500) sounding.append(h('div', { class: 'tick', style: `top:${(m / 7000) * 100}%` }));
    for (const z of this.theme.zones) if (z.from > 0 && z.from <= 7000) sounding.append(h('div', { class: 'tick zone', style: `top:${(z.from / 7000) * 100}%` }));
    sounding.append(bob);
    this.sounding = { el: sounding, bob };
    this.toastEl = h('div', { class: 'toast', role: 'status', hidden: true });
    this.root.append(app, sounding, this.toastEl);
    this.renderSoundIcon();
  }

  private bindGlobal() {
    const unlock = () => {
      if (!this.settings.muted) void this.sound.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.sound.suspend() : this.sound.resume()));
    const vv = window.visualViewport;
    if (vv) {
      const onVV = () => {
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--kb', `${Math.round(kb)}px`);
      };
      vv.addEventListener('resize', onVV);
      vv.addEventListener('scroll', onVV);
    }
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelector<HTMLElement>('.sheet .close')?.click();
    });
  }

  private renderSoundIcon() {
    this.hud.sound.innerHTML = this.settings.muted ? ICONS.soundOff : ICONS.soundOn;
    this.hud.sound.setAttribute('aria-pressed', String(!this.settings.muted));
    this.hud.sound.setAttribute('aria-label', this.settings.muted ? 'Sound off' : 'Sound on');
  }

  private toggleSound() {
    this.settings.muted = !this.settings.muted;
    saveSettings(this.settings);
    if (!this.settings.muted) void this.sound.start();
    this.sound.setMuted(this.settings.muted);
    this.renderSoundIcon();
    this.sound.click();
  }

  private toast(msg: string, ms = 2600) {
    this.toastEl.textContent = msg;
    this.toastEl.hidden = false;
    const t = this.toastEl;
    clearTimeout(Number(t.dataset.timer));
    t.dataset.timer = String(window.setTimeout(() => (t.hidden = true), ms));
  }

  private announce(msg: string) {
    this.live.textContent = msg;
  }

  private stopLoops() {
    for (const stop of this.loops) stop();
    this.loops = [];
  }

  private show(screen: HTMLElement) {
    this.token++;
    this.stopLoops();
    this.abyss.tension = 0;
    this.sound.setTension(0);
    clear(this.stage);
    this.stage.append(screen);
    screen.scrollTop = 0;
    return this.token;
  }

  // ======================================================= depth plumbing

  private onCamera(camDepth: number) {
    const score = Math.max(0, camDepth - CAM_OFFSET);
    this.sound.setDepth(camDepth);
    if (Math.round(score) !== Math.round(this.shown)) this.paintDepth(score);
  }

  private paintDepth(score: number, force = false) {
    this.shown = score;
    this.hud.num.textContent = fmtMetres(score);
    const top = (Math.min(score, 7000) / 7000) * 100;
    this.sounding.bob.style.top = `${top}%`;
    const z = zoneFor(this.theme, score);
    if (force || z.key !== this.zoneKey) {
      this.zoneKey = z.key;
      this.hud.zone.textContent = z.name;
    }
    applyDepth(document.documentElement, score);
    const zoneAttr = document.documentElement.dataset.zone ?? '';
    if (zoneAttr !== this.chromeZone) {
      this.chromeZone = zoneAttr;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[zoneAttr] ?? '#050b12');
    }
  }

  private setMadness(sanity: number) {
    const m = Math.pow(Math.max(0, Math.min(1, (100 - sanity) / 75)), 1.3);
    this.abyss.madness = m * 0.9;
    this.sound.setMadness(m);
    const html = document.documentElement;
    html.classList.toggle('mad-1', sanity < 60);
    html.classList.toggle('mad-2', sanity < 35);
  }

  // ================================================================ title

  start() {
    this.showTitle();
  }

  private dailyRecord(): DayRecord {
    const now = new Date();
    this.today = dayNumberFor(now);
    const existing = loadDays()[this.today];
    const ids = promptsForDay(this.bank.prompts, this.today, this.bank.days, localDateKey(now));
    if (existing) {
      // If the bank changed since the dive began, keep what was played and refill the rest.
      const known = existing.promptIds.filter((id) => this.bank.byId.has(id));
      if (known.length < existing.promptIds.length) {
        const played = new Set(existing.answers.map((a) => a.promptId));
        existing.promptIds = [...existing.promptIds.filter((id) => played.has(id)), ...ids.filter((id) => !played.has(id))].slice(0, 7);
      }
      return existing;
    }
    return {
      day: this.today,
      date: localDateKey(now),
      omen: omenForDay(this.today).id,
      promptIds: ids,
      answers: [],
      sanity: SANITY.start,
      finished: false,
      active: null,
    };
  }

  private showTitle() {
    const rec = this.dailyRecord();
    const omen = omenById(rec.omen);
    const dateText = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    const progress = rec.answers.length;
    this.hud.el.hidden = true;
    this.sounding.el.hidden = true;
    document.documentElement.classList.remove('mad-1', 'mad-2');
    this.abyss.madness = 0;
    if (Math.abs(this.abyss.depth - TITLE_DEPTH) > 1) void this.abyss.descendTo(TITLE_DEPTH, this.reduced ? 0 : 3800);
    this.abyss.setEye(0);

    const actions = h('div', { class: 'title-actions' });
    if (rec.finished) {
      const total = totalDepth(rec);
      actions.append(
        h('p', { class: 'done-note' }, `You reached ${fmtMetres(total)} m today.`),
        h('button', { class: 'btn primary', type: 'button', onclick: () => this.openResults(rec) }, 'Read your log'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.beginPractice() }, 'Practice dive'),
        this.countdownEl(),
      );
    } else {
      const label = progress ? `Continue the descent · ${progress + 1} of ${rec.promptIds.length}` : 'Begin the descent';
      actions.append(h('button', { class: 'btn primary', type: 'button', onclick: () => this.beginDaily() }, label));
    }
    actions.append(
      h(
        'div',
        { class: 'row' },
        h('button', { class: 'btn ghost', type: 'button', onclick: () => this.openHowTo() }, 'How to play'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => this.openLogbook() }, 'Logbook'),
      ),
    );

    const screen = h(
      'section',
      { class: 'screen title-screen stagger', 'aria-labelledby': 'wordmark' },
      h(
        'div',
        { class: 'crest' },
        h('p', { class: 'kicker' }, `Dive No. ${rec.day} · ${dateText}`),
        h('h1', { class: 'wordmark', id: 'wordmark', 'aria-label': 'Cthulhoo' }, 'Cthulh', h('span', { class: 'tail', 'aria-hidden': 'true' }, 'oo')),
        h('p', { class: 'tagline' }, 'How deep does your knowledge go?'),
      ),
      h(
        'div',
        { class: 'plate omen-plate' },
        h('p', { class: 'kicker' }, "Today's omen"),
        h('div', { class: 'glyph', 'aria-hidden': 'true' }, omen.glyph),
        h('h2', {}, omen.name),
        h('p', { class: 'effect' }, omen.effect),
        h('p', { class: 'flavor' }, omen.flavor),
      ),
      actions,
      h('p', { class: 'meta kicker' }, 'Sound on · best with headphones'),
    );
    this.show(screen);
  }

  private countdownEl(): HTMLElement {
    const span = h('span', { class: 'countdown' });
    const el = h('p', { class: 'next-dive' }, 'The tide turns in ', span);
    const tick = () => {
      const ms = msUntilNextDay(new Date());
      if (ms < 900) {
        this.showTitle();
        return;
      }
      const s = Math.floor(ms / 1000);
      span.textContent = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    };
    tick();
    const id = window.setInterval(tick, 1000);
    this.loops.push(() => clearInterval(id));
    return el;
  }

  // ================================================================ dives

  private async beginDaily() {
    void this.sound.start().then(() => this.sound.setMuted(this.settings.muted));
    this.sound.click();
    if (!loadFlag('seenHowTo')) {
      saveFlag('seenHowTo');
      this.openHowTo(() => this.beginDaily());
      return;
    }
    this.rec = this.dailyRecord();
    if (!this.rec.answers.length && !this.rec.active) saveDay(this.rec);
    await this.plunge();
  }

  private async beginPractice() {
    void this.sound.start();
    this.sound.click();
    const today = this.dailyRecord();
    const ids = practicePrompts(this.bank.prompts, today.promptIds, Date.now() & 0xffff);
    this.rec = {
      day: this.today,
      date: localDateKey(new Date()),
      omen: 'still',
      promptIds: ids,
      answers: [],
      sanity: SANITY.start,
      finished: false,
      active: null,
      practice: true,
    };
    await this.plunge();
  }

  /** From the moonlit surface down to wherever this dive has got to. */
  private async plunge() {
    const rec = this.rec!;
    const token = this.show(h('section', { class: 'screen' }));
    this.hud.el.hidden = false;
    this.sounding.el.hidden = false;
    this.hud.title.textContent = rec.practice ? 'Practice' : `No. ${rec.day}`;
    const target = totalDepth(rec);
    this.setMadness(rec.sanity);
    this.sound.bubbles(16, 0.08);
    this.abyss.pulse(0.25);
    const dur = this.reduced ? 0 : 2000 + Math.min(target, 7000) * 0.35;
    if (!rec.answers.length) this.banner('surface');
    await this.abyss.descendTo(cam(target), dur);
    if (token !== this.token) return;
    this.nextPrompt();
  }

  private nextPrompt() {
    const rec = this.rec!;
    if (rec.answers.length >= rec.promptIds.length) {
      this.finishDive();
      return;
    }
    this.showPrompt();
  }

  private showPrompt() {
    const rec = this.rec!;
    const index = rec.answers.length;
    const prompt = this.bank.byId.get(rec.promptIds[index]);
    if (!prompt) {
      // Unknown prompt id (bank changed): skip it without penalty.
      rec.promptIds.splice(index, 1);
      this.nextPrompt();
      return;
    }
    const omen = omenById(rec.omen);
    const limit = timeLimitMs(omen);
    const words = prompt.text.split(/\s+/).length;
    const revealMs = this.reduced ? 150 : 700 + Math.min(words, 14) * 70;
    let active = rec.active && rec.active.index === index ? rec.active : null;
    if (!active) {
      active = { index, startedAt: Date.now() + revealMs, rejects: [] };
      rec.active = active;
      saveDay(rec);
    }
    const act = active;
    this.hud.title.textContent = `${rec.practice ? 'Practice' : `No. ${rec.day}`} · ${index + 1}/${rec.promptIds.length}`;
    const cat = this.theme.categories[prompt.category];
    const bell = isBellQuestion(rec, index);

    const fill = h('div', { class: 'air-fill' });
    const label = h('span', { class: 'air-label' }, String(Math.round(limit / 1000)));
    const air = h('div', { class: 'air', role: 'timer', 'aria-label': 'Air remaining' }, h('div', { class: 'air-track' }, fill), label);
    const feedback = h('p', { class: 'feedback', 'aria-live': 'assertive' });
    const tries = h('ul', { class: 'tries', 'aria-label': 'Refused answers' });
    for (const t of act.rejects) tries.append(h('li', {}, t));
    const input = h('input', {
      class: 'answer',
      type: 'text',
      name: 'answer',
      autocomplete: 'off',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'send',
      maxlength: 60,
      placeholder: 'Speak a name…',
      'aria-label': 'Your answer',
    }) as HTMLInputElement;
    const form = h('form', { class: 'answer-form', autocomplete: 'off' }, input, h('button', { class: 'btn primary', type: 'submit' }, 'Speak'));
    const questionEl = h('h2', { class: 'question', id: 'question' }, risingWords(prompt.text));
    const plate = h(
      'div',
      { class: 'plate question-plate' },
      h('p', { class: 'kicker' }, `Question ${index + 1} of ${rec.promptIds.length}${cat ? ` · ${cat.title}` : ''}`),
      questionEl,
      prompt.rules ? h('p', { class: 'rules' }, prompt.rules) : null,
      prompt.flavor ? h('p', { class: 'flavor' }, prompt.flavor) : null,
      bell ? h('div', { class: 'bell-mark' }, '♁ This question tolls · double depth') : null,
      air,
    );
    const extras = h('div', {});
    if (omen.whisper && !rec.whisperUsed) {
      const btn = h(
        'button',
        {
          class: 'btn ghost whisper-btn',
          type: 'button',
          onclick: () => {
            rec.whisperUsed = true;
            saveDay(rec);
            const w = this.whisperFor(prompt);
            btn.replaceWith(h('p', { class: 'whisper-text', 'aria-label': `A whisper: ${w.spoken}` }, w.shown));
            this.sound.whisper(0.55);
            input.focus();
          },
          html: `${ICONS.ear}<span>Listen for a whisper</span>`,
        },
      );
      extras.append(btn);
    }
    const screen = h('section', { class: 'screen prompt-screen', 'aria-labelledby': 'question' }, plate, form, feedback, tries, extras);
    const token = this.show(screen);
    if (bell) this.sound.zone();

    let locked = false;
    let lastSecond = -1;
    const tickTimer = () => {
      if (token !== this.token || locked) return;
      const now = Date.now();
      const remaining = Math.min(limit, limit - (now - act.startedAt));
      const frac = Math.max(0, remaining / limit);
      fill.style.transform = `scaleX(${frac})`;
      const secs = Math.max(0, Math.ceil(remaining / 1000));
      if (secs !== lastSecond) {
        lastSecond = secs;
        label.textContent = String(secs);
        if (secs <= 5 && secs > 0 && remaining < limit) this.sound.tick(secs <= 3);
      }
      const low = remaining < 6000;
      air.classList.toggle('low', low);
      const tension = low ? 1 - Math.max(0, remaining) / 6000 : 0;
      this.abyss.tension = tension;
      this.sound.setTension(tension);
      if (remaining <= 0) {
        locked = true;
        void this.timeout(prompt);
        return;
      }
      raf = requestAnimationFrame(tickTimer);
    };
    let raf = requestAnimationFrame(tickTimer);
    this.loops.push(() => cancelAnimationFrame(raf));

    // madness: letters of the question sometimes become something else
    if (rec.sanity < 35 && !this.reduced) {
      const id = window.setInterval(() => {
        const ws = questionEl.querySelectorAll<HTMLElement>('.w');
        const w = ws[Math.floor(Math.random() * ws.length)];
        if (!w || w.dataset.orig) return;
        const orig = w.textContent ?? '';
        const i = Math.floor(Math.random() * orig.length);
        w.dataset.orig = orig;
        w.textContent = '';
        w.append(orig.slice(0, i), h('span', { class: 'glitch' }, GLYPHS[Math.floor(Math.random() * GLYPHS.length)]), orig.slice(i + 1));
        setTimeout(() => {
          w.textContent = orig;
          delete w.dataset.orig;
        }, 160);
      }, 2600);
      this.loops.push(() => clearInterval(id));
    }

    input.addEventListener('input', () => this.sound.key());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (locked) return;
      const text = input.value.trim();
      if (!text) return;
      if (Date.now() < act.startedAt) act.startedAt = Date.now(); // answered during the reveal: start the clock
      const res = matchAnswer(prompt, text);
      if (res.kind === 'empty') return;
      if (res.kind === 'accept') {
        locked = true;
        input.blur();
        input.disabled = true;
        void this.accept(prompt, res.answer, text, plate);
        return;
      }
      let line = '';
      if (res.kind === 'trap') line = res.trap.reason;
      else if (res.kind === 'decoy') line = pickLine(this.theme.refused.lines.decoy, prompt.id, text);
      else if (res.kind === 'ambiguous') line = pickLine(this.theme.refused.lines.ambiguous, prompt.id, text);
      else line = pickLine(this.theme.refused.lines.unknown, prompt.id, text);
      feedback.textContent = '';
      feedback.append(h('span', {}, `${this.theme.refused.name}: “${text}”. `), line);
      const repeat = act.rejects.some((r) => r.toLowerCase() === text.toLowerCase());
      if (!repeat) {
        act.rejects.push(text);
        tries.append(h('li', {}, text));
        rec.sanity = clampSanity(rec.sanity - SANITY.reject);
        this.setMadness(rec.sanity);
        saveDay(rec);
      }
      this.sound.refuse();
      if (this.settings.haptics) Sound.buzz(45);
      form.classList.remove('shake');
      void form.offsetWidth;
      if (!this.reduced) form.classList.add('shake');
      input.value = '';
      input.focus();
    });
    // Focus once the question has risen (keeps the keyboard from covering the reveal).
    setTimeout(() => {
      if (token === this.token && !locked) input.focus({ preventScroll: true });
    }, this.reduced ? 0 : Math.min(revealMs, 900));
  }

  private whisperFor(prompt: PromptDef): { shown: string; spoken: string } {
    const rare = prompt.answers.filter((a) => a.tier >= 5);
    const pool = rare.length ? rare : prompt.answers.filter((a) => a.tier >= 3);
    const pick = pool[Math.abs([...prompt.id].reduce((s, c) => s * 31 + c.charCodeAt(0), 7)) % Math.max(1, pool.length)] ?? prompt.answers[0];
    const name = pick.answer;
    const shown = name
      .split('')
      .map((ch, i) => (i === 0 ? ch.toUpperCase() : /[a-z0-9]/i.test(ch) ? '·' : ch))
      .join('');
    return { shown: `“${shown}”`, spoken: `it begins with ${name[0]}, ${name.length} letters` };
  }

  private async accept(prompt: PromptDef, answer: AnswerDef, input: string, plate: HTMLElement) {
    const rec = this.rec!;
    const index = rec.answers.length;
    const omen = omenById(rec.omen);
    const gain = depthFor(this.theme, answer.tier, omen, index, rec.day, rec.promptIds.length);
    const before = totalDepth(rec);
    const record: AnswerRecord = {
      promptId: prompt.id,
      input,
      answer: answer.answer,
      tier: answer.tier as Tier,
      openSecret: !!answer.openSecret,
      depth: gain,
      rejects: rec.active?.rejects ?? [],
      timeMs: Math.max(0, Date.now() - (rec.active?.startedAt ?? Date.now())),
    };
    rec.answers.push(record);
    rec.active = null;
    rec.sanity = sanityAfterAnswer(rec.sanity, gain, answer.tier);
    if (rec.answers.length >= rec.promptIds.length) rec.finished = true;
    saveDay(rec);
    this.abyss.tension = 0;
    this.sound.setTension(0);
    const screen = plate.closest('.screen');
    if (screen) screen.classList.add(this.reduced ? 'fade-away' : 'sink-away');
    await this.descend(before, before + gain, record);
    this.showReveal(record, prompt, answer);
  }

  private async timeout(prompt: PromptDef) {
    const rec = this.rec!;
    const record: AnswerRecord = {
      promptId: prompt.id,
      input: null,
      answer: null,
      tier: 0,
      depth: 0,
      rejects: rec.active?.rejects ?? [],
      timeMs: timeLimitMs(omenById(rec.omen)),
    };
    rec.answers.push(record);
    rec.active = null;
    rec.sanity = clampSanity(rec.sanity - SANITY.timeout);
    if (rec.answers.length >= rec.promptIds.length) rec.finished = true;
    saveDay(rec);
    this.setMadness(rec.sanity);
    this.sound.timeout();
    if (this.settings.haptics) Sound.buzz([60, 40, 60]);
    this.abyss.pulse(0.08);
    await sleep(this.reduced ? 0 : 500);
    this.showReveal(record, prompt, null);
  }

  /** The sink after an accepted answer: counter, particles, banners, the eye. */
  private async descend(from: number, to: number, record: AnswerRecord) {
    const gain = to - from;
    const tier = record.tier;
    const token = this.token;
    const dur = this.reduced ? 400 : 1500 + Math.min(gain, 1600) * 1.5;
    this.sound.accept(tier);
    this.sound.descend(dur, gain);
    if (this.settings.haptics) Sound.buzz(tier >= 5 ? [20, 60, 90] : 25);
    this.abyss.pulse(0.12 + tier * 0.07);
    if (tier >= 4) this.abyss.summon(0.55 + (tier - 4) * 0.2);
    if (tier === 6) {
      this.abyss.setEye(1);
      this.sound.eye();
      setTimeout(() => this.abyss.setEye(0), dur + 2600);
    }
    this.setMadness(this.rec!.sanity);

    const num = h('span', {}, fmtMetres(from));
    const readout = h('div', { class: 'descent-readout', 'aria-hidden': 'true' }, num, h('small', {}, gain ? `+${fmtMetres(gain)} m` : ''));
    document.body.append(readout);
    let zoneBefore = zoneFor(this.theme, from).key;
    const prev = this.abyss.onDepth;
    this.abyss.onDepth = (d) => {
      prev?.(d);
      const score = Math.max(0, d - CAM_OFFSET);
      num.textContent = fmtMetres(Math.min(to, Math.max(from, score)));
      const z = zoneFor(this.theme, score).key;
      if (z !== zoneBefore) {
        zoneBefore = z;
        this.banner(z);
        this.sound.zone();
      }
    };
    await this.abyss.descendTo(cam(to), dur);
    this.abyss.onDepth = prev;
    num.textContent = fmtMetres(to);
    this.paintDepth(to);
    this.announce(`Sank ${fmtMetres(gain)} metres, now at ${fmtMetres(to)} metres.`);
    await sleep(this.reduced ? 0 : 350);
    readout.remove();
    void token;
  }

  private banner(zoneKey: string) {
    const z = this.theme.zones.find((x) => x.key === zoneKey);
    if (!z) return;
    const b = h('div', { class: 'zone-banner', 'aria-hidden': 'true' }, h('span', { class: 'name' }, z.name), h('span', { class: 'sub' }, z.subtitle));
    document.body.append(b);
    setTimeout(() => b.remove(), 4300);
  }

  private showReveal(record: AnswerRecord, prompt: PromptDef, answer: AnswerDef | null) {
    const rec = this.rec!;
    const last = rec.answers.length >= rec.promptIds.length;
    const tier = record.tier ? tierDef(this.theme, record.tier) : null;
    const kids: Array<HTMLElement | null> = [];
    kids.push(h('p', { class: 'kicker' }, `Question ${rec.answers.length} of ${rec.promptIds.length}`));
    if (tier && answer) {
      kids.push(
        h(
          'p',
          { class: `tier-name${tier.tier === 6 ? ' iridescent' : ''}`, style: `--tier-color: var(--color-tier-${tier.tier})` },
          tier.name,
        ),
      );
      const echo = h('p', { class: 'echo' }, `“${answer.answer}”`);
      kids.push(echo);
      kids.push(h('p', { class: 'gain' }, `+${fmtMetres(record.depth)} m`));
      if (answer.openSecret) {
        kids.push(h('p', { class: 'secret' }, `${this.theme.openSecret.emoji} ${this.theme.openSecret.name}`));
        kids.push(h('p', { class: 'line' }, pickLine(this.theme.openSecret.lines, prompt.id, answer.answer)));
      } else {
        kids.push(h('p', { class: 'line' }, pickLine(tier.lines, prompt.id, answer.answer)));
      }
      if (answer.lore) kids.push(h('p', { class: 'lore' }, answer.lore));
    } else {
      kids.push(h('p', { class: 'tier-name', style: '--tier-color: var(--color-refused)' }, 'Out of air'));
      kids.push(h('p', { class: 'line' }, pickLine(this.theme.refused.lines.timeout, prompt.id, rec.day)));
      const rare = prompt.answers.filter((a) => a.tier >= 5).slice(0, 3);
      if (rare.length) kids.push(h('p', { class: 'lore' }, `The deep would have taken ${rare.map((a) => `“${a.answer}”`).join(', ')}.`));
      kids.push(h('p', { class: 'gain' }, '+0 m'));
    }
    const next = h(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
          this.sound.click();
          if (last) this.finishDive();
          else this.nextPrompt();
        },
      },
      last ? 'Read the log of your descent' : 'Descend further',
    );
    kids.push(h('div', { class: 'actions' }, next));
    const eyeOpen = record.tier === 6 || (last && totalDepth(rec) >= 7000);
    const screen = h('section', { class: `screen reveal-screen stagger${eyeOpen ? ' beneath-eye' : ''}`, 'aria-live': 'polite' }, ...kids);
    this.show(screen);
    setTimeout(() => next.focus({ preventScroll: true }), this.reduced ? 0 : 600);
  }

  // ============================================================== results

  private finishDive() {
    const rec = this.rec!;
    rec.finished = true;
    rec.active = null;
    saveDay(rec);
    this.openResults(rec);
  }

  private openResults(rec: DayRecord) {
    this.rec = rec;
    const total = totalDepth(rec);
    this.hud.el.hidden = false;
    this.sounding.el.hidden = false;
    this.hud.title.textContent = rec.practice ? 'Practice' : `No. ${rec.day} · log`;
    if (Math.abs(this.abyss.depth - cam(total)) > 1) void this.abyss.descendTo(cam(total), this.reduced ? 0 : 3200);
    this.setMadness(rec.sanity);
    const zone = zoneFor(this.theme, total);
    const landmark = landmarkFor(this.theme, total);
    const stats = computeStats(loadDays(), this.today);
    const rank = cultRankFor(this.theme, stats.streak);

    const log = h('ol', { class: 'dive-log' });
    rec.answers.forEach((a, i) => {
      const p = this.bank.byId.get(a.promptId);
      const tier = a.tier ? tierDef(this.theme, a.tier) : null;
      const emoji = a.tier === 0 ? this.theme.share.missEmoji : a.openSecret ? this.theme.openSecret.emoji : tier?.emoji ?? '';
      const more = h('div', { class: 'more' });
      if (p) {
        const def = p.answers.find((x) => x.answer === a.answer);
        if (def?.lore) more.append(h('p', {}, def.lore));
        const rarest = p.answers.filter((x) => x.tier === 6).slice(0, 6);
        const common = p.answers.filter((x) => x.tier === 1).slice(0, 5);
        if (rarest.length) more.append(h('p', {}, h('b', {}, 'Unspeakable answers: '), rarest.map((x) => x.answer).join(', ')));
        if (common.length) more.append(h('p', {}, h('b', {}, 'What everyone said: '), common.map((x) => x.answer).join(', ')));
      }
      if (a.rejects.length) more.append(h('p', {}, h('b', {}, 'Refused: '), a.rejects.join(', ')));
      log.append(
        h(
          'li',
          {},
          h(
            'details',
            {},
            h(
              'summary',
              {},
              h('span', { 'aria-hidden': 'true' }, emoji),
              h(
                'span',
                {},
                h('span', { class: 'q' }, `${i + 1}. ${p?.text ?? ''}`),
                h('span', { class: `a${a.answer ? '' : ' miss'}` }, a.answer ?? 'Out of air'),
                h('span', { class: 't', style: tier ? `color: var(--color-tier-${tier.tier})` : '' }, a.openSecret ? this.theme.openSecret.name : tier?.name ?? this.theme.refused.name),
              ),
              h('span', { class: 'm' }, `${fmtMetres(a.depth)} m`),
            ),
            more,
          ),
        ),
      );
    });

    const shareBtn = h('button', { class: 'btn primary', type: 'button', html: `${ICONS.share}<span>Share</span>` });
    const cardBtn = h('button', { class: 'btn', type: 'button', html: `${ICONS.image}<span>Save card</span>` });
    const doShare = async (img: boolean) => {
      this.sound.click();
      const out = await shareDive(this.theme, rec, img);
      if (out === 'copied') this.toast('Copied your descent. Paste it anywhere.');
      else if (out === 'failed') this.openShareText(shareText(this.theme, rec));
      else if (typeof out === 'object') this.openCard(out.card, rec);
    };
    shareBtn.addEventListener('click', () => void doShare(false));
    cardBtn.addEventListener('click', () => void doShare(true));

    const screen = h(
      'section',
      { class: 'screen results-screen stagger', 'aria-labelledby': 'total' },
      h(
        'div',
        { class: 'result-head' },
        h('p', { class: 'kicker' }, rec.practice ? 'Practice dive · not recorded' : `Dive No. ${rec.day} · the log of your descent`),
        h('h2', { class: 'total', id: 'total' }, fmtMetres(total), h('small', {}, 'm')),
        h('p', { class: 'landmark' }, landmark?.name ?? zone.name),
        h('p', { class: 'zone-name' }, zone.name),
        h('p', { class: 'line' }, pickLine(landmark?.lines ?? [], rec.day, total)),
        h('p', { class: 'glyph-row', 'aria-hidden': 'true' }, ...rec.answers.map((a) => h('span', {}, a.tier === 0 ? this.theme.share.missEmoji : a.openSecret ? this.theme.openSecret.emoji : tierDef(this.theme, a.tier)?.emoji ?? ''))),
      ),
      h(
        'div',
        { class: 'plate stat-strip' },
        h('div', {}, h('span', { class: 'v' }, `${rec.sanity}%`), h('span', { class: 'k' }, 'sanity')),
        h('div', {}, h('span', { class: 'v' }, String(stats.streak)), h('span', { class: 'k' }, 'day streak')),
        h('div', {}, h('span', { class: 'v', style: 'font-size: var(--step-0)' }, rank.name), h('span', { class: 'k' }, 'rank')),
      ),
      log,
      h('div', { class: 'share-row' }, shareBtn, cardBtn),
      rec.practice ? null : this.countdownEl(),
      h(
        'div',
        { class: 'title-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.beginPractice() }, rec.practice ? 'Another practice dive' : 'Practice dive'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => this.showTitle() }, 'Return to the surface'),
      ),
    );
    this.show(screen);
    if (total >= 7000) {
      this.abyss.setEye(1);
      this.sound.eye();
    }
  }

  // =============================================================== sheets

  private openCard(blob: Blob, rec: DayRecord) {
    const url = URL.createObjectURL(blob);
    const total = totalDepth(rec);
    const place = landmarkFor(this.theme, total)?.name ?? zoneFor(this.theme, total).name;
    const body: HTMLElement[] = [
      h('img', { class: 'card-preview', src: url, alt: `Sounding chart of the dive: ${fmtMetres(total)} metres, ${place}` }),
      h('p', { class: 'flavor' }, 'Press and hold the card (or right-click it) to save or share it.'),
    ];
    if (!ARTIFACT) {
      body.push(
        h(
          'div',
          { class: 'title-actions' },
          h('a', { class: 'btn primary', href: url, download: `cthulhoo-${rec.practice ? 'practice' : rec.day}.png`, html: `${ICONS.image}<span>Download the card</span>` }),
        ),
      );
    }
    this.sheet('Your sounding chart', body, () => URL.revokeObjectURL(url));
  }

  private openShareText(text: string) {
    const area = h('textarea', { class: 'share-text', id: 'share-text', readonly: true, rows: 7, 'aria-label': 'Your descent, ready to copy' }) as HTMLTextAreaElement;
    area.value = text;
    this.sheet('Copy your descent', [h('p', {}, 'This browser would not copy it for you. The text is selected: copy it and paste it anywhere.'), area]);
    setTimeout(() => {
      area.focus();
      area.select();
    }, 60);
  }

  private sheet(title: string, body: HTMLElement[], onClose?: () => void): HTMLElement {
    const close = () => {
      el.remove();
      this.sound.click();
      onClose?.();
    };
    const el = h(
      'div',
      { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h(
        'div',
        { class: 'sheet-panel' },
        h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', onclick: close, html: ICONS.close }),
        h('h2', {}, title),
        ...body,
      ),
    );
    el.addEventListener('click', (e) => {
      if (e.target === el) close();
    });
    document.body.append(el);
    (el.querySelector('.sheet-panel button:not(.close)') as HTMLElement | null)?.focus({ preventScroll: true });
    return el;
  }

  private openHowTo(then?: () => void) {
    this.sound.click();
    const steps = this.theme.howToPlay.length
      ? this.theme.howToPlay
      : [
          'Seven questions rise from the deep each day. Each has many true answers.',
          'Common answers keep you in the shallows. The rarer your true answer, the deeper you sink.',
          'You have 25 seconds per question. A wrong answer costs nothing but time.',
        ];
    const ladder = h('ul', { class: 'tier-ladder' });
    for (const t of this.theme.tiers) {
      ladder.append(h('li', { style: `--tier-color: var(--color-tier-${t.tier})` }, h('span', { 'aria-hidden': 'true' }, t.emoji), h('span', { class: 'n' }, t.name), h('span', { class: 'd' }, `${fmtMetres(t.depth)} m`)));
    }
    let sheetEl: HTMLElement | null = null;
    const body = [
      h('ol', { class: 'howto-steps' }, ...steps.map((s) => h('li', {}, h('span', {}, s)))),
      h('h3', {}, 'How deep each answer sinks you'),
      ladder,
      h('h3', {}, 'Omens and sanity'),
      h('p', {}, 'Each day brings an omen that bends the rules a little, the same for every diver. Knowledge has a price: every metre, every refusal and every unspeakable answer costs a little sanity, and the deep begins to look back.'),
    ];
    if (then) {
      body.push(
        h('div', { class: 'title-actions' }, h('button', { class: 'btn primary', type: 'button', onclick: () => { sheetEl?.remove(); then(); } }, 'Begin the descent')),
      );
    }
    sheetEl = this.sheet('How to descend', body);
  }

  private openLogbook() {
    this.sound.click();
    const stats = computeStats(loadDays(), this.today);
    const rank = cultRankFor(this.theme, stats.streak);
    const most = Math.max(1, ...stats.tierCounts.slice(1));
    const bars = h('div', { class: 'tier-bars' });
    for (const t of this.theme.tiers) {
      const n = stats.tierCounts[t.tier] ?? 0;
      bars.append(
        h(
          'div',
          { class: 'bar', style: `--tier-color: var(--color-tier-${t.tier})` },
          h('span', {}, `${t.emoji} ${t.name}`),
          h('span', { class: 'track' }, h('span', { class: 'fill', style: `width:${(n / most) * 100}%` })),
          h('span', { class: 'log' }, String(n)),
        ),
      );
    }
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: this.settings.volume, 'aria-label': 'Volume' }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value);
      this.sound.setVolume(this.settings.volume);
      saveSettings(this.settings);
    });
    const motion = h('input', { type: 'checkbox', 'aria-label': 'Reduce motion' }) as HTMLInputElement;
    motion.checked = this.reduced;
    motion.addEventListener('change', () => {
      this.settings.reducedMotion = motion.checked ? 'on' : 'off';
      this.reduced = motion.checked;
      document.documentElement.classList.toggle('reduced-motion', this.reduced);
      this.abyss.setReducedMotion(this.reduced);
      saveSettings(this.settings);
    });
    const haptics = h('input', { type: 'checkbox', 'aria-label': 'Vibration' }) as HTMLInputElement;
    haptics.checked = this.settings.haptics;
    haptics.addEventListener('change', () => {
      this.settings.haptics = haptics.checked;
      saveSettings(this.settings);
    });
    const sound = h('input', { type: 'checkbox', 'aria-label': 'Sound' }) as HTMLInputElement;
    sound.checked = !this.settings.muted;
    sound.addEventListener('change', () => this.toggleSound());
    this.sheet('Logbook', [
      h(
        'div',
        { class: 'stats-grid' },
        h('div', {}, h('span', { class: 'v' }, String(stats.played)), h('span', { class: 'k' }, 'dives')),
        h('div', {}, h('span', { class: 'v' }, `${fmtMetres(stats.deepest)} m`), h('span', { class: 'k' }, 'deepest')),
        h('div', {}, h('span', { class: 'v' }, `${fmtMetres(stats.average)} m`), h('span', { class: 'k' }, 'average')),
        h('div', {}, h('span', { class: 'v' }, String(stats.unspeakables)), h('span', { class: 'k' }, 'unspeakables')),
        h('div', {}, h('span', { class: 'v' }, String(stats.streak)), h('span', { class: 'k' }, 'streak')),
        h('div', {}, h('span', { class: 'v' }, String(stats.bestStreak)), h('span', { class: 'k' }, 'best streak')),
      ),
      h('h3', {}, `Rank: ${rank.name}`),
      h('p', { class: 'flavor' }, 'Dive on consecutive days to rise through the cult.'),
      h('h3', {}, 'Answers by rarity'),
      bars,
      h('h3', {}, 'Settings'),
      h('label', { class: 'setting' }, h('span', {}, 'Sound'), sound),
      h('label', { class: 'setting' }, h('span', {}, 'Volume'), vol),
      h('label', { class: 'setting' }, h('span', {}, 'Reduce motion'), motion),
      h('label', { class: 'setting' }, h('span', {}, 'Vibration (Android)'), haptics),
      h('p', { class: 'flavor' }, 'No sound on iPhone? Check the silent switch. Everything you play is saved only in this browser.'),
    ]);
  }
}
