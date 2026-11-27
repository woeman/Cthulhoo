import { loadBank, type Bank } from './game/bank';
import { dayNumberFor, localDateKey, msUntilNextDay, practicePrompts, promptsForDay, repairDive } from './game/daily';
import { matchAnswer } from './game/matcher';
import { omenById, omenForDay } from './game/omens';
import { SANITY, clampSanity, depthFor, isBellQuestion, sanityAfterAnswer, timeLimitMs, totalDepth } from './game/scoring';
import { shareDive, shareText } from './game/share';
import { computeStats } from './game/stats';
import { careerDay, computeCareer, type Career } from './game/career';
import { resultsNews, titleNews, type News } from './game/news';
import { personaFor } from './game/persona';
import { computeSigils } from './game/sigils';
import { loadDays, loadDisputes, loadFlag, loadNumber, loadSettings, loadSightings, playerId, saveDay, saveFlag, saveNumber, saveSettings, saveSighting } from './game/storage';
import { cultRankFor, landmarkFor, pickLine, tierDef, zoneFor } from './game/theme';
import type { AnswerDef, AnswerRecord, DayRecord, PromptDef, Settings, ThemeCopy, Tier } from './game/types';
import { Sound } from './audio/engine';
import { Abyss } from './render/abyss';
import { fmtMetres, focusables, h, risingWords, sleep } from './ui/dom';
import { ICONS } from './ui/icons';
import { MadText, calmAll, icon, madden, madnessForDepth, sealSvg, wordmarkMarkup } from './ui/art';
import { careerGainPlate, careerStrip, countUp, telegramEl } from './ui/career';
import { disputeBlock } from './ui/disputes';
import { bestiaryBody, sightingCard } from './ui/bestiary';
import { SIGHTING_TIER, sightingAlong, type Sighting } from './game/bestiary';
import { disputesText } from './game/disputes';
import { ARTIFACT } from './env';
import { applyDepth } from '../art/js/depth.js';

// The camera always sits a little below the score depth, so the first question
// is asked underwater rather than on the waterline.
const CAM_OFFSET = 40;
const TITLE_DEPTH = -32;
const cam = (score: number) => score + CAM_OFFSET;
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
/** How long a new zone's name is left to be read before the next words rise over it. */
const BANNER_READ_MS = 2300;
/** Camera depth where the floor's own Eye is a third open (the renderer opens it from 6,650 m). */
const EYE_NEAR = 6760;
/** Below this visible height (the phone keyboard is up, or the phone is on its side) the question packs tighter. */
const SHORT_VIEW = 560;
/** On mousedown: tapping a button beside the answer keeps the keyboard up instead of stealing focus. */
const keepFocus = (e: Event) => e.preventDefault();
const sentence = (s: string) => (s ? `${s[0].toUpperCase()}${s.slice(1)}${/[.?]$/.test(s) ? '' : '.'}` : '');
/** A tier's seal (the closed eye for no answer), coloured for its tier. */
const seal = (tier: number, cls = 'seal') => h('span', { class: cls, 'aria-hidden': 'true', style: `--tier-color: ${tier ? `var(--color-tier-${tier})` : 'var(--color-refused)'}`, html: sealSvg(tier || 'refused') });
/** The kit's large rarity medallion: a breathing disc with the seal in it. */
const medallion = (tier: number, size: number) =>
  h('figure', { class: 'cth-seal medallion', 'data-tier': tier ? String(tier) : 'refused', 'aria-hidden': 'true', style: `--size: ${size}px${tier ? '' : '; --tier-color: var(--color-refused)'}` }, h('div', { class: 'cth-seal__disc', html: sealSvg(tier || 'refused') }));

type Sheet = { el: HTMLElement; close: (quiet?: boolean, restoreFocus?: boolean) => void };
type SheetOpts = { onClose?: () => void; actions?: HTMLElement[]; focus?: HTMLElement | null };

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
  private sheets: Sheet[] = [];
  private sheetSeq = 0;
  private bannerEl: HTMLElement | null = null;
  private bannerAt = 0;
  private titleVisits = 0;
  private eyeIsOpen = false;
  /** The HUD's zone name, which the deep gets into as you sink. */
  private zoneText!: MadText;
  /** Set by the screen that cares when the visible area changes (keyboard up or down, rotation). */
  private onViewport: (() => void) | null = null;

  private hud!: { el: HTMLElement; title: HTMLElement; num: HTMLElement; zone: HTMLElement; sound: HTMLButtonElement };
  private appEl!: HTMLElement;
  private stage!: HTMLElement;
  private sounding!: { el: HTMLElement; bob: HTMLElement };
  private toastEl!: HTMLElement;
  private live!: HTMLElement;
  private alert!: HTMLElement;

  constructor(private root: HTMLElement) {
    const mq = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.settings.reducedMotion === 'on' || (this.settings.reducedMotion === 'auto' && mq.matches);
    document.documentElement.classList.toggle('reduced-motion', this.reduced);
    const pin = Number(new URLSearchParams(location.search).get('scale')) || 0; // ?scale=2 for crisp screenshots
    this.abyss = new Abyss(document.body, { reducedMotion: this.reduced, pinScale: pin });
    if (!this.abyss.ok) document.documentElement.classList.add('no-webgl');
    this.abyss.jumpTo(TITLE_DEPTH);
    this.abyss.onDepth = (d) => this.onCamera(d);
    // Follow the device setting while the player has not chosen one.
    mq.addEventListener('change', () => {
      if (this.settings.reducedMotion === 'auto') this.setReduced(mq.matches);
    });
    this.buildShell();
    this.sound.setMuted(this.settings.muted);
    this.sound.setVolume(this.settings.volume);
    this.bindGlobal();
    this.abyss.start();
    this.paintDepth(0, true);
  }

  // ================================================================= shell

  private buildShell() {
    const soundBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sound', 'data-sound-toggle': '', onclick: () => this.toggleSound() }) as HTMLButtonElement;
    const menu = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Logbook and settings', title: 'Logbook and settings', onclick: () => this.openLogbook(), html: icon('info') });
    const title = h('div', { class: 'hud-title' });
    const num = h('span', { class: 'num' }, '0');
    const zone = h('span', { class: 'zone' });
    const depth = h('div', { class: 'hud-depth' }, h('span', { class: 'visually-hidden' }, 'Depth '), num, h('span', { class: 'unit' }, ' m'), zone);
    const hud = h('header', { class: 'hud', hidden: true }, menu, title, depth, soundBtn);
    this.hud = { el: hud, title, num, zone, sound: soundBtn };
    this.zoneText = new MadText(zone, () => this.reduced);
    this.stage = h('main', { class: 'stage' });
    this.appEl = h('div', { class: 'app' }, hud, this.stage);
    // Live regions sit outside the app, so they still speak while a sheet makes the app inert.
    this.live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
    this.alert = h('div', { class: 'visually-hidden', 'aria-live': 'assertive', 'aria-atomic': 'true' });
    const bob = h('div', { class: 'bob' });
    const sounding = h('aside', { class: 'sounding', 'aria-hidden': 'true', hidden: true });
    for (let m = 500; m < 7000; m += 500) sounding.append(h('div', { class: 'tick', style: `top:${(m / 7000) * 100}%` }));
    for (const z of this.theme.zones) if (z.from > 0 && z.from <= 7000) sounding.append(h('div', { class: 'tick zone', style: `top:${(z.from / 7000) * 100}%` }));
    sounding.append(bob);
    this.sounding = { el: sounding, bob };
    this.toastEl = h('div', { class: 'toast', role: 'status', hidden: true });
    this.root.append(this.appEl, sounding, this.toastEl, this.live, this.alert);
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
    this.bindViewport();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /**
   * The visible area. Android (interactive-widget=resizes-content) shrinks the
   * layout for the keyboard by itself; iOS lays the keyboard over the page, so
   * the app is fitted to the visual viewport instead. Pinch zoom is left alone.
   */
  private bindViewport() {
    const root = document.documentElement;
    const vv = window.visualViewport;
    const update = () => {
      let visible = window.innerHeight;
      if (vv && Math.abs(vv.scale - 1) < 0.01) {
        visible = vv.height;
        root.style.setProperty('--kb', `${Math.round(Math.max(0, window.innerHeight - vv.height - vv.offsetTop))}px`);
        root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
        root.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
      } else {
        root.style.setProperty('--kb', '0px');
        root.style.setProperty('--vvh', `${window.innerHeight}px`);
        root.style.setProperty('--vv-top', '0px');
      }
      root.classList.toggle('short', visible < SHORT_VIEW);
      this.onViewport?.();
    };
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    update();
  }

  /** Sheets: Escape closes the top one, and Tab stays inside it. */
  private onKey(e: KeyboardEvent) {
    const top = this.sheets[this.sheets.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      top.close();
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusables(top.el);
    if (!items.length) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement as HTMLElement | null;
    const inside = !!active && items.includes(active);
    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  private setReduced(on: boolean) {
    this.reduced = on;
    document.documentElement.classList.toggle('reduced-motion', on);
    this.abyss.setReducedMotion(on);
  }

  private renderSoundIcon() {
    const on = !this.settings.muted;
    for (const b of document.querySelectorAll<HTMLButtonElement>('[data-sound-toggle]')) {
      if (b.classList.contains('icon-btn')) {
        b.innerHTML = icon(on ? 'sound-on' : 'sound-off');
        b.setAttribute('aria-pressed', String(on));
        b.title = on ? 'Sound on' : 'Sound off';
      } else {
        b.innerHTML = `${icon(on ? 'sound-on' : 'sound-off')}<span>${on ? 'Sound on · best with headphones' : 'Sound off'}</span>`;
      }
    }
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

  /** Polite: read when the reader has finished what it is saying. */
  private announce(msg: string) {
    this.say(this.live, msg);
  }

  /** Assertive: read straight away (refusals). */
  private shout(msg: string) {
    this.say(this.alert, msg);
  }

  private say(region: HTMLElement, msg: string) {
    // Emptied first, so the same words said twice are still read out.
    region.textContent = '';
    window.setTimeout(() => (region.textContent = msg), 60);
  }

  private stopLoops() {
    for (const stop of this.loops) stop();
    this.loops = [];
  }

  /**
   * One orchestrated change of screen: the old words drift away (up as you
   * sink, down as you rise) while the new ones surface, instead of a hard swap.
   */
  private show(screen: HTMLElement, dir: 'down' | 'up' = 'down') {
    this.token++;
    this.stopLoops();
    calmAll();
    this.onViewport = null;
    this.abyss.tension = 0;
    this.sound.setTension(0);
    this.dismissBanner();
    for (const old of [...this.stage.children] as HTMLElement[]) this.retire(old, dir);
    if (!this.reduced && !screen.classList.contains('stagger')) screen.classList.add('screen-in');
    this.stage.append(screen);
    screen.scrollTop = 0;
    return this.token;
  }

  private retire(old: HTMLElement, dir: 'down' | 'up') {
    if (this.reduced || !old.childElementCount || old.classList.contains('sink-away') || old.classList.contains('fade-away')) {
      old.remove();
      return;
    }
    old.inert = true;
    old.classList.remove('screen-in');
    old.classList.add('screen-out', dir === 'up' ? 'out-down' : 'out-up');
    const done = () => old.remove();
    old.addEventListener('animationend', (e) => e.target === old && done());
    window.setTimeout(done, 700);
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
    // The zone of the depth on show, so "4,000 m" never sits beside the zone above it.
    const z = zoneFor(this.theme, Math.round(score));
    if (force || z.key !== this.zoneKey) {
      this.zoneKey = z.key;
      this.zoneText.setText(z.name);
    }
    this.zoneText.setLevel(this.madLevel(score));
    applyDepth(document.documentElement, score);
    const zoneAttr = document.documentElement.dataset.zone ?? '';
    if (zoneAttr !== this.chromeZone) {
      this.chromeZone = zoneAttr;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[zoneAttr] ?? '#050b12');
    }
  }

  /** How far the deep has got into the lettering: by depth, and sooner when sanity fails. */
  private madLevel(depth: number): number {
    const sanity = this.rec && !this.hud.el.hidden ? this.rec.sanity : 100;
    return Math.max(madnessForDepth(depth), sanity < 35 ? 0.4 : sanity < 60 ? 0.2 : 0);
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

  // ================================================================ career

  /** The lifetime career, worked out afresh from the saved dives. */
  private careerNow(): { days: ReturnType<typeof loadDays>; marks: ThemeCopy['career']['milestones']; career: Career } {
    const days = loadDays();
    const marks = [...this.theme.career.milestones].sort((a, b) => a.depth - b.depth);
    return { days, marks, career: computeCareer(days, this.today, marks) };
  }

  /** Who the deep thinks you are: the Logbook's title, on the title screen too. */
  private personaTitle(career: Career, days: ReturnType<typeof loadDays>): string {
    const sigils = computeSigils(days, (id) => this.bank.byId.get(id), this.theme);
    return personaFor(career, sigils, days, this.theme, playerId(), this.today).title;
  }

  /** After a dispute: a word from the surface. */
  private disputed(input: string, kept: boolean) {
    this.sound.click();
    if (kept) this.toast('Disputed. The surveyors will look again.');
    else this.toast(`The deep knows “${input}” now.`);
  }

  /** A telegram lowered from the surface. It goes back up on a tap, or by itself. */
  private telegram(news: News, delay = 0) {
    for (const old of document.querySelectorAll('.telegram-toast')) old.remove();
    const time = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const el = telegramEl(news, ['Surface telegraph', time]);
    let gone = false;
    const lift = () => {
      if (gone) return;
      gone = true;
      el.classList.add('lifted');
      window.setTimeout(() => el.remove(), this.reduced ? 0 : 650);
    };
    el.addEventListener('click', lift);
    const show = window.setTimeout(() => {
      this.root.append(el);
      this.announce(news.plain);
    }, delay);
    const hide = window.setTimeout(lift, delay + 9000);
    this.loops.push(() => {
      clearTimeout(show);
      clearTimeout(hide);
      if (el.isConnected) lift();
    });
  }

  private dailyRecord(): DayRecord {
    const now = new Date();
    this.today = dayNumberFor(now);
    const existing = loadDays()[this.today];
    const ids = promptsForDay(this.bank.prompts, this.today, this.bank.days, localDateKey(now));
    // If the bank changed since the dive began, keep what was played and swap only
    // the questions that no longer exist (the one in progress restarts fresh).
    if (existing) return repairDive(existing, (id) => this.bank.byId.has(id), ids);
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
    const returning = this.titleVisits++ > 0;
    this.hud.el.hidden = true;
    this.sounding.el.hidden = true;
    this.setMadness(100);
    // The career, and any telegram about it (once a day). Back after days away, the
    // sea gives the diver back: the view rises to the surface as the number climbs.
    const { days, marks, career } = this.careerNow();
    const news = titleNews(career, this.theme.career, playerId(), this.today);
    const fresh = !!news && loadNumber('news') !== this.today;
    if (fresh) saveNumber('news', this.today);
    const drift = fresh && news?.kind === 'drift' ? career.away?.drift ?? 0 : 0;
    const riseFrom = drift > 0 && !this.reduced ? Math.min(900, 160 + drift * 0.35) : 0;
    if (riseFrom) {
      this.abyss.jumpTo(riseFrom);
      void this.abyss.descendTo(TITLE_DEPTH, 4600);
    } else if (Math.abs(this.abyss.depth - TITLE_DEPTH) > 1) void this.abyss.descendTo(TITLE_DEPTH, this.reduced ? 0 : 3800);
    this.closeEye();
    const strip = career.daysPlayed ? careerStrip(career, marks, news) : null;

    let primary: HTMLElement;
    const actions = h('div', { class: 'title-actions' });
    if (rec.finished) {
      const total = totalDepth(rec);
      primary = h('button', { class: 'btn primary', type: 'button', onclick: () => this.openResults(rec) }, 'Read your log');
      actions.append(
        h('p', { class: 'done-note' }, `You reached ${fmtMetres(total)} m today.`),
        primary,
        h('button', { class: 'btn', type: 'button', onclick: () => this.beginPractice() }, 'Practice dive'),
        this.countdownEl(rec.day),
      );
    } else {
      const label = progress ? `Continue the descent · ${progress + 1} of ${rec.promptIds.length}` : 'Begin the descent';
      primary = h('button', { class: 'btn primary', type: 'button', onclick: () => this.beginDaily() }, label);
      actions.append(primary);
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
        h('h1', { class: 'wordmark', id: 'wordmark' }, h('span', { class: 'visually-hidden' }, 'Cthulhoo'), h('span', { class: 'wordmark-art', 'aria-hidden': 'true', html: wordmarkMarkup() })),
        career.daysPlayed ? h('p', { class: 'persona-line' }, this.personaTitle(career, days)) : h('p', { class: 'tagline' }, 'How deep does your knowledge go?'),
      ),
      h(
        'div',
        { class: `title-plates${strip ? ' two' : ''}` },
        strip?.el ?? null,
        h(
          'div',
          { class: 'plate omen-plate' },
          h('p', { class: 'kicker' }, "Today's omen"),
          h('div', { class: 'glyph', 'aria-hidden': 'true' }, omen.glyph),
          h('h2', {}, omen.name),
          h('p', { class: 'effect' }, omen.effect),
          h('p', { class: 'flavor' }, omen.flavor),
        ),
      ),
      actions,
      // The HUD is hidden here, so the title carries its own sound switch.
      h('button', { class: 'btn ghost sound-toggle', type: 'button', 'data-sound-toggle': '', onclick: () => this.toggleSound() }),
    );
    this.show(screen, 'up');
    this.renderSoundIcon();
    if (strip && riseFrom) {
      strip.el.classList.add('rising');
      this.loops.push(countUp(strip.num, career.depth + drift, career.depth, 4200, false));
      const settle = window.setTimeout(() => strip.el.classList.remove('rising'), 4400);
      this.loops.push(() => clearTimeout(settle));
    }
    if (news && fresh) this.telegram(news, this.reduced ? 0 : 1400);
    if (returning) window.setTimeout(() => primary.isConnected && !this.sheets.length && primary.focus({ preventScroll: true }), this.reduced ? 0 : 500);
  }

  /** Time until the next descent. When the day it belongs to is over, the title comes back for the new one. */
  private countdownEl(day: number): HTMLElement {
    const span = h('span', { class: 'countdown' });
    const el = h('p', { class: 'next-dive' }, 'The tide turns in ', span);
    const tick = () => {
      const now = new Date();
      if (dayNumberFor(now) !== day) {
        this.showTitle();
        return;
      }
      const s = Math.floor(msUntilNextDay(now) / 1000);
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
    if (!this.rec.answers.length && !this.rec.active) {
      this.rec.playedAt ??= Date.now();
      saveDay(this.rec);
    }
    await this.plunge();
  }

  private async beginPractice() {
    void this.sound.start();
    this.sound.click();
    const today = this.dailyRecord();
    const ids = practicePrompts(this.bank.prompts, today.promptIds, Date.now() & 0xffff, this.today, this.bank.days);
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
    // Back from a reload mid-question: the clock is already running, so no long plunge.
    const dur = this.reduced || rec.active ? 0 : 2000 + Math.min(target, 7000) * 0.35;
    if (!rec.answers.length) this.banner('surface');
    await this.abyss.descendTo(cam(target), dur);
    await this.bannerRead();
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
    // The words start to rise once the last screen has drifted off, and the clock waits for them.
    const lead = this.reduced ? 0 : 180;
    const revealMs = this.reduced ? 150 : lead + 700 + Math.min(words, 14) * 70;
    let active = rec.active && rec.active.index === index ? rec.active : null;
    if (!active) {
      active = { index, startedAt: Date.now() + revealMs, rejects: [] };
      rec.active = active;
      saveDay(rec);
    }
    const act = active;
    const count = rec.promptIds.length;
    this.hud.title.textContent = `${rec.practice ? 'Practice' : `No. ${rec.day}`} · ${index + 1}/${count}`;
    const cat = this.theme.categories[prompt.category];
    const bell = isBellQuestion(rec, index);

    const fill = h('div', { class: 'air-fill' });
    const label = h('span', { class: 'air-label' }, String(Math.round(limit / 1000)));
    const air = h('div', { class: 'air', role: 'timer', 'aria-label': 'Air remaining' }, h('div', { class: 'air-track' }, fill), label);
    const feedback = h('p', { class: 'feedback' });
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
      'aria-describedby': prompt.rules ? 'question rules' : 'question',
    }) as HTMLInputElement;
    const form = h('form', { class: 'answer-form', autocomplete: 'off' }, input, h('button', { class: 'btn primary', type: 'submit', onmousedown: keepFocus }, 'Speak'));
    const questionEl = h('h2', { class: 'question', id: 'question', style: `--rise-lead:${lead}ms` }, risingWords(prompt.text));
    // One plate holds the question and the answer, so the engraving never runs through what you type.
    const plate = h(
      'div',
      { class: 'plate question-plate' },
      h('p', { class: 'kicker' }, `Question ${index + 1} of ${count}`),
      cat ? h('p', { class: 'category', 'data-mad': '' }, cat.title) : null,
      questionEl,
      prompt.rules ? h('p', { class: 'rules', id: 'rules' }, prompt.rules) : null,
      prompt.flavor ? h('p', { class: 'flavor' }, prompt.flavor) : null,
      bell ? h('p', { class: 'bell-mark' }, '♁ This question tolls · double depth') : null,
      air,
      form,
      feedback,
      tries,
    );
    if (omen.whisper && !rec.whisperUsed) {
      const btn = h('button', {
        class: 'btn ghost whisper-btn',
        type: 'button',
        onmousedown: keepFocus,
        onclick: () => {
          rec.whisperUsed = true;
          saveDay(rec);
          const w = this.whisperFor(prompt);
          btn.replaceWith(h('p', { class: 'whisper-text' }, h('span', { 'aria-hidden': 'true' }, w.shown), h('span', { class: 'visually-hidden' }, `A whisper: ${w.spoken}`)));
          this.announce(`A whisper: ${w.spoken}`);
          this.sound.whisper(0.55);
          input.focus();
        },
        html: `${icon('hint')}<span>Listen for a whisper</span>`,
      });
      plate.append(btn);
    }
    const screen = h('section', { class: 'screen prompt-screen', 'aria-labelledby': 'question' }, plate);
    const token = this.show(screen);
    if (bell) this.sound.zone();

    // Keep the gauge, the answer line and any refusal in sight above the keyboard.
    const keepInView = () => {
      if (token !== this.token || document.activeElement !== input) return;
      const view = screen.getBoundingClientRect();
      const below = (el: Element) => el.getBoundingClientRect().bottom + 8 - view.bottom;
      const airTop = air.getBoundingClientRect().top - 6;
      const room = Math.max(0, airTop - view.top); // how far down before the gauge leaves the top
      // The answer line always; a refusal too, as long as the gauge stays in sight.
      const down = Math.max(below(form), feedback.textContent ? Math.min(below(feedback), room) : 0);
      if (down > 0) screen.scrollTop += down;
      else if (airTop < view.top) screen.scrollTop -= Math.min(view.top - airTop, Math.max(0, -below(form)));
    };
    this.onViewport = () => requestAnimationFrame(keepInView);
    input.addEventListener('focus', () => window.setTimeout(keepInView, 320));

    let locked = false;
    let lastSecond = -1;
    const warned = new Set<number>();
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
        // Spoken twice at most, never every second.
        if ((secs === 10 || secs === 5) && remaining < limit && !warned.has(secs)) {
          warned.add(secs);
          this.announce(secs === 10 ? 'Ten seconds of air left.' : 'Five seconds of air.');
        }
      }
      const low = remaining < 6000;
      air.classList.toggle('low', low);
      const tension = low ? 1 - Math.max(0, remaining) / 6000 : 0;
      this.abyss.tension = tension;
      this.sound.setTension(tension);
      if (remaining <= 0) {
        locked = true;
        input.disabled = true;
        void this.timeout(prompt);
        return;
      }
      raf = requestAnimationFrame(tickTimer);
    };
    let raf = requestAnimationFrame(tickTimer);
    this.loops.push(() => cancelAnimationFrame(raf));

    // The deep gets into the short labels (never the question itself): by depth,
    // and sooner as sanity fails.
    const depthNow = totalDepth(rec);
    const catMad = plate.querySelector<HTMLElement>('[data-mad]');
    const madCat = catMad ? madden(catMad, depthNow, this.reduced, this.madLevel(depthNow)) : null;

    input.addEventListener('input', () => this.sound.key());
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (locked) return;
      const text = input.value.trim();
      if (!text) {
        input.focus();
        return;
      }
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
      feedback.append(h('span', { class: 'said' }, `${this.theme.refused.name}: “${text}”.`), ' ', line);
      this.shout(`${this.theme.refused.name}: ${text}. ${line}`);
      const repeat = act.rejects.some((r) => r.toLowerCase() === text.toLowerCase());
      if (!repeat) {
        act.rejects.push(text);
        tries.append(h('li', {}, text));
        rec.sanity = clampSanity(rec.sanity - SANITY.reject);
        this.setMadness(rec.sanity);
        saveDay(rec);
      }
      this.sound.refuse();
      // A refusal is an episode: the lettering lurches, if the deep is already in it.
      madCat?.pulse();
      this.zoneText.pulse();
      if (this.settings.haptics) Sound.buzz(45);
      form.classList.remove('shake');
      void form.offsetWidth;
      if (!this.reduced) form.classList.add('shake');
      input.value = '';
      input.focus();
      requestAnimationFrame(keepInView);
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
    const letters = name.replace(/[^a-z0-9]/gi, '').length;
    const parts = name.trim().split(/\s+/).length;
    return { shown: `“${shown}”`, spoken: `it begins with ${name[0].toUpperCase()}. ${parts > 1 ? `${parts} words, ` : ''}${letters} letters.` };
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
      category: prompt.category,
    };
    rec.answers.push(record);
    rec.active = null;
    rec.sanity = sanityAfterAnswer(rec.sanity, gain, answer.tier);
    if (rec.answers.length >= rec.promptIds.length) rec.finished = true;
    saveDay(rec);
    // A rare answer pays out enough cable for something to pass the porthole.
    let sighting: Sighting | null = null;
    if (!rec.practice && answer.tier >= SIGHTING_TIER) {
      const seen = loadSightings();
      const s = sightingAlong(this.theme, this.theme.bestiary, new Set(Object.keys(seen)), before, before + gain, `${playerId()}|${rec.day}|${prompt.id}`);
      if (s) {
        sighting = { id: s.creature.id, day: rec.day, depth: s.depth, at: Date.now(), promptId: prompt.id };
        saveSighting(sighting);
      }
    }
    this.abyss.tension = 0;
    this.sound.setTension(0);
    const screen = plate.closest('.screen');
    if (screen) screen.classList.add(this.reduced ? 'fade-away' : 'sink-away');
    await this.descend(before, before + gain, record);
    this.showReveal(record, prompt, answer, sighting);
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
      category: prompt.category,
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
    const dur = this.reduced ? 400 : 1500 + Math.min(gain, 1600) * 1.5;
    this.sound.accept(tier);
    this.sound.descend(dur, gain);
    // Buzz only for the rare finds, so a buzz means something.
    if (this.settings.haptics && tier >= 4) Sound.buzz(tier === 6 ? [30, 70, 120] : tier === 5 ? [20, 60, 80] : 20);
    this.abyss.pulse(0.12 + tier * 0.07);
    if (tier >= 4) this.abyss.summon(0.55 + (tier - 4) * 0.2);
    if (tier === 6) this.openEye();
    this.setMadness(this.rec!.sanity);

    const num = h('span', { class: 'n' }, fmtMetres(from));
    const readout = h('div', { class: 'descent-readout', 'aria-hidden': 'true' }, num, h('small', {}, gain ? `+${fmtMetres(gain)} m` : ''));
    document.body.append(readout);
    let zoneBefore = zoneFor(this.theme, from).key;
    const crossed = (score: number) => {
      const z = zoneFor(this.theme, score).key;
      if (z === zoneBefore) return;
      zoneBefore = z;
      this.banner(z, cam(to));
      this.sound.zone();
    };
    const prev = this.abyss.onDepth;
    this.abyss.onDepth = (d) => {
      // The first frame of a sink can sit a hair above where it began. Kept in
      // range, a dive that starts on a zone's edge never seems to rise into the last zone.
      const c = Math.min(cam(to), Math.max(cam(from), d));
      prev?.(c);
      const score = c - CAM_OFFSET;
      num.textContent = fmtMetres(score);
      crossed(score);
    };
    await this.abyss.descendTo(cam(to), dur);
    this.abyss.onDepth = prev;
    num.textContent = fmtMetres(to);
    this.paintDepth(to);
    // Landing exactly on a zone's edge still counts as arriving in it.
    crossed(to);
    await sleep(this.reduced ? 0 : 380);
    // A zone crossed late in the sink still gets its moment before the reveal rises.
    await this.bannerRead();
    if (this.reduced) readout.remove();
    else {
      readout.classList.add('leaving');
      window.setTimeout(() => readout.remove(), 500);
    }
  }

  /** A zone's name written across the water. `dest` is where the camera is headed. */
  private banner(zoneKey: string, dest = this.abyss.depth) {
    const z = this.theme.zones.find((x) => x.key === zoneKey);
    if (!z) return;
    this.dismissBanner(true);
    // Below the Eye when it is open, or will be by the end of this sink.
    const below = this.eyeIsOpen || Math.max(this.abyss.depth, dest) >= EYE_NEAR;
    const nameEl = h('span', { class: 'name' }, z.name);
    const b = h('div', { class: `zone-banner${below ? ' below-eye' : ''}`, 'aria-hidden': 'true' }, nameEl, h('span', { class: 'sub' }, z.subtitle));
    document.body.append(b);
    madden(nameEl, Math.max(z.from, dest - CAM_OFFSET), this.reduced);
    this.bannerEl = b;
    this.bannerAt = performance.now();
    if (zoneKey !== 'surface') this.announce(`${z.name}. ${sentence(z.subtitle)}`);
    window.setTimeout(
      () => {
        if (this.bannerEl === b) this.bannerEl = null;
        b.remove();
      },
      this.reduced ? BANNER_READ_MS + 400 : 4300,
    );
  }

  /** Wait until the current zone banner has been on screen long enough to read. */
  private async bannerRead() {
    if (!this.bannerEl) return;
    const wait = this.bannerAt + (this.reduced ? 1500 : BANNER_READ_MS) - performance.now();
    if (wait > 0) await sleep(wait);
  }

  /** Fade the zone banner out from wherever its own animation has got to. */
  private dismissBanner(now = false) {
    const b = this.bannerEl;
    if (!b) return;
    this.bannerEl = null;
    if (now || this.reduced) {
      b.remove();
      return;
    }
    const opacity = getComputedStyle(b).opacity;
    b.style.animation = 'none';
    b.style.opacity = opacity;
    void b.offsetWidth;
    b.classList.add('leaving');
    window.setTimeout(() => b.remove(), 700);
  }

  private showReveal(record: AnswerRecord, prompt: PromptDef, answer: AnswerDef | null, sighting: Sighting | null = null) {
    const rec = this.rec!;
    const n = rec.answers.length;
    const count = rec.promptIds.length;
    const last = n >= count;
    const total = totalDepth(rec);
    const tier = record.tier ? tierDef(this.theme, record.tier) : null;
    const kids: Array<HTMLElement | null> = [h('p', { class: 'kicker' }, `Question ${n} of ${count}`)];
    const said: string[] = [];
    if (tier && answer) {
      const bell = isBellQuestion(rec, n - 1);
      const line = answer.openSecret ? pickLine(this.theme.openSecret.lines, prompt.id, answer.answer) : pickLine(tier.lines, prompt.id, answer.answer);
      kids.push(
        medallion(tier.tier, 88),
        h('h2', { class: `tier-name${tier.tier === 6 ? ' iridescent' : ''}`, id: 'reveal-title', style: `--tier-color: var(--color-tier-${tier.tier})` }, tier.name),
        h('div', { class: 'answer-row' }, h('p', { class: 'echo' }, `“${answer.answer}”`), h('p', { class: 'gain' }, `+${fmtMetres(record.depth)} m`)),
        bell ? h('p', { class: 'bell-mark' }, '♁ The bell tolled: twice as deep') : null,
        answer.openSecret ? h('p', { class: 'secret' }, `${this.theme.openSecret.emoji} ${this.theme.openSecret.name}`) : null,
        h('p', { class: 'line' }, line),
        answer.lore ? h('p', { class: 'lore' }, answer.lore) : null,
      );
      said.push(`${tier.name}. ${answer.answer}.`, `${fmtMetres(record.depth)} metres deeper, ${fmtMetres(total)} in all.`);
      if (bell) said.push('The bell tolled: twice as deep.');
      if (answer.openSecret) said.push(`${this.theme.openSecret.name}.`);
      // Some lines open with the tier's own name; say it once.
      said.push(line.startsWith(`${tier.name}.`) ? line.slice(tier.name.length + 1).trim() : line, answer.lore ?? '');
      const creature = sighting && this.theme.bestiary.find((c) => c.id === sighting.id);
      if (sighting && creature) {
        const seen = Object.keys(loadSightings()).filter((id) => this.theme.bestiary.some((c) => c.id === id)).length;
        kids.push(sightingCard(creature, sighting, seen, this.theme.bestiary.length));
        said.push(`A sighting at ${fmtMetres(sighting.depth)} metres: ${creature.name}. ${creature.line}`);
      }
    } else {
      const line = pickLine(this.theme.refused.lines.timeout, prompt.id, rec.day);
      const rare = prompt.answers.filter((a) => a.tier >= 5).slice(0, 3);
      const might = rare.length ? `The deep would have taken ${rare.map((a) => `“${a.answer}”`).join(', ')}.` : '';
      kids.push(
        medallion(0, 88),
        h('h2', { class: 'tier-name', id: 'reveal-title', style: '--tier-color: var(--color-refused)' }, 'Out of air'),
        h('div', { class: 'answer-row' }, h('p', { class: 'gain' }, '+0 m')),
        h('p', { class: 'line' }, line),
        might ? h('p', { class: 'lore' }, might) : null,
      );
      said.push('Out of air. No depth gained.', line, might);
    }
    let leaving = false;
    const next = h(
      'button',
      {
        class: 'btn primary',
        type: 'button',
        onclick: () => {
          if (leaving) return;
          leaving = true;
          this.sound.click();
          this.closeEye();
          if (last) this.finishDive();
          else this.nextPrompt();
        },
      },
      last ? 'Read the log of your descent' : 'Descend further',
    );
    kids.push(h('div', { class: 'actions' }, next));
    kids.push(disputeBlock(prompt, record.rejects, rec.day, { onDispute: (input, kept) => this.disputed(input, kept) }));
    const eyeOpen = record.tier === 6 || (last && total >= 7000);
    if (eyeOpen) this.openEye();
    // Near the floor the sea opens the Eye itself, whatever the answer was.
    const beneath = eyeOpen || cam(total) >= EYE_NEAR;
    const screen = h('section', { class: `screen reveal-screen stagger${beneath ? ' beneath-eye' : ''}`, 'aria-labelledby': 'reveal-title' }, ...kids);
    this.show(screen);
    // The tier's name goes strange in the deep, except the pearl of the Unspeakable.
    const title = screen.querySelector<HTMLElement>('#reveal-title:not(.iridescent)');
    if (title) madden(title, total, this.reduced, this.madLevel(total));
    // Once the words have risen, the open Eye looks down at what was said.
    if (beneath) {
      const look = window.setTimeout(() => this.gazeAt(screen.querySelector('.echo') ?? screen.querySelector('#reveal-title')), this.reduced ? 0 : 900);
      this.loops.push(() => clearTimeout(look));
    }
    this.announce(said.filter(Boolean).join(' '));
    setTimeout(() => next.isConnected && !this.sheets.length && next.focus({ preventScroll: true }), this.reduced ? 0 : 700);
    // On a short screen the way on can rise below the fold: once it has risen, bring it just into view.
    setTimeout(() => !leaving && next.isConnected && next.scrollIntoView({ block: 'nearest', behavior: this.reduced ? 'auto' : 'smooth' }), this.reduced ? 0 : 1600);
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
    const place = landmark?.name ?? zone.name;
    const { days, marks, career } = this.careerNow();
    const rank = cultRankFor(this.theme, career.streak);
    const shareCareer = rec.practice || !career.daysPlayed ? null : { title: this.personaTitle(career, days), depth: career.depth, lantern: career.streak };
    // What today's dive did to the career: the metres it added, milestones carved, a ward.
    const day = rec.practice ? null : careerDay(career, rec.day);
    const gain = day?.dive ? careerGainPlate(career, day, marks, resultsNews(career, this.theme.career, playerId(), rec.day)) : null;
    const deepestTier = Math.max(0, ...rec.answers.map((a) => a.tier));

    const sightings = loadSightings();
    const log = h('ol', { class: 'plate dive-log', 'aria-label': 'Your answers' });
    rec.answers.forEach((a, i) => {
      const p = this.bank.byId.get(a.promptId);
      const tier = a.tier ? tierDef(this.theme, a.tier) : null;
      const more = h('div', { class: 'more' });
      if (p) {
        const def = p.answers.find((x) => x.answer === a.answer);
        if (def?.lore) more.append(h('p', {}, def.lore));
        const rarest = p.answers.filter((x) => x.tier === 6).slice(0, 6);
        const common = p.answers.filter((x) => x.tier === 1).slice(0, 5);
        if (rarest.length) more.append(h('p', {}, h('b', {}, 'Unspeakable answers: '), rarest.map((x) => x.answer).join(', ')));
        if (common.length) more.append(h('p', {}, h('b', {}, 'What everyone said: '), common.map((x) => x.answer).join(', ')));
      }
      for (const s of Object.values(sightings)) {
        const c = s.day === rec.day && s.promptId === a.promptId && !rec.practice ? this.theme.bestiary.find((x) => x.id === s.id) : null;
        if (c) more.append(h('p', {}, h('b', {}, 'Sighted: '), `${c.name}, at ${fmtMetres(s.depth)} m.`));
      }
      const refused = disputeBlock(p, a.rejects, rec.day, { note: false, onDispute: (input, kept) => this.disputed(input, kept) });
      if (refused) more.append(refused);
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
              seal(a.tier, 'g seal'),
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

    const shareBtn = h('button', { class: 'btn primary', type: 'button', html: `${icon('share')}<span>Share</span>` }) as HTMLButtonElement;
    const cardBtn = h('button', { class: 'btn', type: 'button', html: `${ICONS.image}<span>Save card</span>` }) as HTMLButtonElement;
    const doShare = async (btn: HTMLButtonElement, img: boolean) => {
      if (btn.classList.contains('busy')) return; // drawing the card takes a moment; one tap is enough
      this.sound.click();
      btn.classList.add('busy');
      btn.setAttribute('aria-busy', 'true');
      try {
        const out = await shareDive(this.theme, rec, img, shareCareer);
        if (out === 'copied') this.toast('Copied your descent. Paste it anywhere.');
        else if (out === 'failed') this.openShareText(shareText(this.theme, rec, shareCareer));
        else if (typeof out === 'object') this.openCard(out.card, rec);
      } finally {
        btn.classList.remove('busy');
        btn.removeAttribute('aria-busy');
      }
    };
    shareBtn.addEventListener('click', () => void doShare(shareBtn, false));
    cardBtn.addEventListener('click', () => void doShare(cardBtn, true));

    const totalEl = h('h2', { class: 'total', id: 'total', tabindex: '-1' }, fmtMetres(total), h('small', {}, 'm'));
    const screen = h(
      'section',
      { class: 'screen results-screen stagger', 'aria-labelledby': 'total' },
      h(
        'div',
        { class: 'result-head' },
        h('p', { class: 'kicker' }, rec.practice ? 'Practice dive · not recorded' : `Dive No. ${rec.day} · the log of your descent`),
        rec.answers.length ? medallion(deepestTier, 76) : null,
        totalEl,
        h('p', { class: 'landmark', 'data-mad': '' }, place),
        place !== zone.name ? h('p', { class: 'zone-name' }, zone.name) : null,
        h('p', { class: 'line' }, pickLine(landmark?.lines ?? [], rec.day, total)),
        h('p', { class: 'glyph-row', 'aria-hidden': 'true' }, ...rec.answers.map((a) => seal(a.tier))),
      ),
      h(
        'div',
        { class: 'plate stat-strip' },
        h('div', {}, h('span', { class: 'v' }, `${rec.sanity}%`), h('span', { class: 'k' }, 'sanity')),
        h('div', {}, h('span', { class: 'v' }, String(career.streak)), h('span', { class: 'k' }, career.streak === 1 ? 'day lantern' : 'days lantern')),
        h('div', {}, h('span', { class: 'v rank' }, rank.name), h('span', { class: 'k' }, 'rank')),
      ),
      gain?.el ?? null,
      h('div', { class: 'share-row' }, shareBtn, cardBtn),
      !rec.practice && rec.day === dayNumberFor(new Date()) ? this.countdownEl(rec.day) : null,
      log,
      h(
        'div',
        { class: 'title-actions' },
        h('button', { class: 'btn', type: 'button', onclick: () => this.beginPractice() }, rec.practice ? 'Another practice dive' : 'Practice dive'),
        h('button', { class: 'btn ghost', type: 'button', onclick: () => this.showTitle() }, 'Return to the surface'),
      ),
    );
    this.closeEye();
    this.show(screen);
    const landmarkEl = screen.querySelector<HTMLElement>('.landmark[data-mad]');
    if (landmarkEl) madden(landmarkEl, total, this.reduced);
    if (gain && day) {
      // The career counts up to its new depth once the log has surfaced.
      if (!this.reduced) gain.num.textContent = fmtMetres(day.before);
      const start = window.setTimeout(() => this.loops.push(countUp(gain.num, day.before, day.after, 1800, this.reduced)), this.reduced ? 0 : 900);
      this.loops.push(() => clearTimeout(start));
    }
    const carved = day ? day.milestones.map((i) => marks[i]?.name).filter(Boolean) : [];
    this.announce(
      `${rec.practice ? 'Practice dive over' : 'Dive complete'}. ${fmtMetres(total)} metres, ${place}.` +
        (day?.dive ? ` Career depth ${fmtMetres(day.after)} metres.` : '') +
        (carved.length ? ` Milestone carved: ${carved.join(', ')}.` : ''),
    );
    window.setTimeout(() => totalEl.isConnected && !this.sheets.length && totalEl.focus({ preventScroll: true }), this.reduced ? 0 : 450);
  }

  private openEye() {
    if (this.eyeIsOpen) return;
    this.eyeIsOpen = true;
    this.abyss.setEye(1);
    this.sound.eye();
    document.documentElement.classList.add('eye-open');
  }

  private closeEye() {
    this.abyss.lookAt(0, 0.4);
    if (!this.eyeIsOpen) return;
    this.eyeIsOpen = false;
    this.abyss.setEye(0);
    document.documentElement.classList.remove('eye-open');
  }

  /** Turn the Eye's gaze onto something on the page: the answer it has just heard. */
  private gazeAt(el: Element | null) {
    if (!el?.isConnected) return;
    const r = el.getBoundingClientRect();
    const h = Math.max(1, window.innerHeight);
    const x = (r.left + r.width / 2 - window.innerWidth / 2) / (h * 0.3);
    const y = (r.top + r.height / 2 - h * 0.36) / (h * 0.3);
    const k = Math.min(1, 1 / Math.max(1e-3, Math.hypot(x, y)));
    this.abyss.lookAt(x * k, y * k);
  }

  // =============================================================== sheets

  private openCard(blob: Blob, rec: DayRecord) {
    const url = URL.createObjectURL(blob);
    const total = totalDepth(rec);
    const place = landmarkFor(this.theme, total)?.name ?? zoneFor(this.theme, total).name;
    const body = [
      h('img', { class: 'card-preview', src: url, alt: `Sounding chart of the dive: ${fmtMetres(total)} metres, ${place}` }),
      h('p', { class: 'flavor' }, 'Press and hold the card to save or share it. On a computer, ', h('span', { class: 'nowrap' }, 'right-click'), ' it.'),
    ];
    const actions = ARTIFACT
      ? undefined
      : [h('a', { class: 'btn primary', href: url, download: `cthulhoo-${rec.practice ? 'practice' : rec.day}.png`, html: `${ICONS.image}<span>Download the card</span>` })];
    this.sheet('Your sounding chart', body, { actions, onClose: () => window.setTimeout(() => URL.revokeObjectURL(url), 400) });
  }

  private openShareText(text: string) {
    const area = h('textarea', { class: 'share-text', id: 'share-text', readonly: true, rows: 7, 'aria-label': 'Your descent, ready to copy' }) as HTMLTextAreaElement;
    area.value = text;
    this.sheet('Copy your descent', [h('p', {}, 'This browser would not copy it for you. The text is selected. Copy it and paste it anywhere.'), area], { focus: area });
    area.select();
  }

  /**
   * A modal sheet: the page behind goes inert, Tab stays inside, Escape or a tap
   * on the water closes it, and focus goes back to whatever opened it.
   */
  private sheet(title: string, body: Array<HTMLElement | null>, opts: SheetOpts = {}): Sheet {
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && active !== document.body ? active : null;
    const id = `sheet-title-${++this.sheetSeq}`;
    const closeBtn = h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', html: icon('close') });
    const panel = h(
      'div',
      { class: 'sheet-panel', tabindex: '-1' },
      h('div', { class: 'sheet-head' }, h('h2', { id }, title), closeBtn),
      h('div', { class: 'sheet-body' }, ...body),
      opts.actions?.length ? h('div', { class: 'sheet-actions' }, ...opts.actions) : null,
    );
    const el = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id }, panel);
    let closed = false;
    const close = (quiet = false, restoreFocus = true) => {
      if (closed) return;
      closed = true;
      this.sheets = this.sheets.filter((s) => s !== entry);
      this.syncInert();
      if (!quiet) this.sound.click();
      opts.onClose?.();
      if (this.reduced) el.remove();
      else {
        el.classList.add('closing');
        window.setTimeout(() => el.remove(), 260);
      }
      if (restoreFocus && opener?.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    };
    const entry: Sheet = { el, close };
    closeBtn.addEventListener('click', () => close());
    el.addEventListener('click', (e) => {
      if (e.target === el) close();
    });
    document.body.append(el);
    this.sheets.push(entry);
    this.syncInert();
    (opts.focus ?? panel).focus({ preventScroll: true });
    return entry;
  }

  private syncInert() {
    const top = this.sheets[this.sheets.length - 1]?.el ?? null;
    this.appEl.inert = !!top;
    for (const s of this.sheets) s.el.inert = s.el !== top;
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
      ladder.append(h('li', { style: `--tier-color: var(--color-tier-${t.tier})` }, seal(t.tier), h('span', { class: 'n' }, t.name), h('span', { class: 'd' }, `${fmtMetres(t.depth)} m`)));
    }
    const body = [
      h('ol', { class: 'howto-steps' }, ...steps.map((s) => h('li', {}, h('span', {}, s)))),
      h('h3', {}, 'How deep each answer sinks you'),
      ladder,
      h('h3', {}, 'Omens and sanity'),
      h('p', {}, 'Each day brings an omen that bends the rules a little. Every diver shares it.'),
      h('p', {}, 'Knowledge has a price. Each metre, each refusal and each unspeakable answer costs a little sanity, and the deep begins to look back. Sanity never changes your depth.'),
      h('h3', {}, 'Your career'),
      h('p', {}, 'Every daily dive adds to your career depth. Dive on days in a row and your lantern burns brighter: each full week adds ×0.1 to what a dive earns, up to ×2.'),
      h('p', {}, 'Every seventh day in a row earns a ward, and you can hold two. A ward keeps the lantern lit through a missed day.'),
      h('p', {}, 'Miss a day with no ward and the sea gives you back a little, about a third of a usual dive. Milestones, once passed, are carved for good: you never drift above them.'),
    ];
    let sheet: Sheet | null = null;
    // First time through, the way down stays in reach at the foot of the sheet.
    const begin = then
      ? h(
          'button',
          {
            class: 'btn primary',
            type: 'button',
            onclick: () => {
              sheet?.close(true, false);
              then();
            },
          },
          'Begin the descent',
        )
      : null;
    sheet = this.sheet('How to descend', body, { actions: begin ? [begin] : undefined, focus: begin });
  }

  /** Every creature by zone: the ones seen, and shapes in the dark for the rest. */
  private openSightings() {
    this.sound.click();
    this.sheet('Sightings', bestiaryBody(this.theme, this.theme.bestiary, loadSightings()));
  }

  /** The answers the player has said the deep was wrong to refuse, to copy for the surveyors. */
  private disputesSection(): HTMLElement[] {
    const list = loadDisputes();
    if (!list.length) return [];
    const copy = h('button', { class: 'btn', type: 'button' }, 'Copy the list') as HTMLButtonElement;
    copy.addEventListener('click', async () => {
      this.sound.click();
      const text = disputesText(list);
      try {
        await navigator.clipboard.writeText(text);
        this.toast('Copied. Send it to the surveyors.');
      } catch {
        this.openShareText(text);
      }
    });
    return [
      h('h3', {}, 'Answers you disputed'),
      h('p', { class: 'flavor' }, `${list.length === 1 ? 'One answer' : `${list.length} answers`} you said the deep was wrong to refuse. Until the surveyors have a line to the surface, copy the list and send it to them.`),
      copy,
    ];
  }

  private openLogbook() {
    this.sound.click();
    const stats = computeStats(loadDays(), this.today);
    const { career } = this.careerNow();
    const rank = cultRankFor(this.theme, career.streak);
    const most = Math.max(1, ...stats.tierCounts.slice(1));
    const bars = h('div', { class: 'tier-bars' });
    for (const t of this.theme.tiers) {
      const n = stats.tierCounts[t.tier] ?? 0;
      bars.append(
        h(
          'div',
          { class: 'bar', style: `--tier-color: var(--color-tier-${t.tier})` },
          h('span', { class: 'bar-name' }, seal(t.tier), t.name),
          h('span', { class: 'track', 'aria-hidden': 'true' }, h('span', { class: 'fill', style: `width:${(n / most) * 100}%` })),
          h('span', { class: 'log' }, String(n)),
        ),
      );
    }
    const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: this.settings.volume }) as HTMLInputElement;
    vol.addEventListener('input', () => {
      this.settings.volume = Number(vol.value);
      this.sound.setVolume(this.settings.volume);
      saveSettings(this.settings);
    });
    const motion = h('input', { type: 'checkbox' }) as HTMLInputElement;
    motion.checked = this.reduced;
    motion.addEventListener('change', () => {
      this.settings.reducedMotion = motion.checked ? 'on' : 'off';
      this.setReduced(motion.checked);
      saveSettings(this.settings);
    });
    const haptics = h('input', { type: 'checkbox' }) as HTMLInputElement;
    haptics.checked = this.settings.haptics;
    haptics.addEventListener('change', () => {
      this.settings.haptics = haptics.checked;
      saveSettings(this.settings);
    });
    const sound = h('input', { type: 'checkbox' }) as HTMLInputElement;
    sound.checked = !this.settings.muted;
    sound.addEventListener('change', () => this.toggleSound());
    // Only phones that can vibrate are offered vibration.
    const canBuzz = typeof navigator.vibrate === 'function';
    this.sheet('Logbook', [
      h(
        'div',
        { class: 'stats-grid' },
        h('div', {}, h('span', { class: 'v' }, String(stats.played)), h('span', { class: 'k' }, 'dives')),
        h('div', {}, h('span', { class: 'v' }, `${fmtMetres(stats.deepest)} m`), h('span', { class: 'k' }, 'deepest')),
        h('div', {}, h('span', { class: 'v' }, `${fmtMetres(stats.average)} m`), h('span', { class: 'k' }, 'average')),
        h('div', {}, h('span', { class: 'v' }, String(stats.unspeakables)), h('span', { class: 'k' }, 'unspeakables')),
        h('div', {}, h('span', { class: 'v' }, String(career.streak)), h('span', { class: 'k' }, 'lantern')),
        h('div', {}, h('span', { class: 'v' }, String(career.bestStreak)), h('span', { class: 'k' }, 'best lantern')),
      ),
      h('h3', {}, `Career depth: ${fmtMetres(career.depth)} m`),
      h('h3', {}, `Rank: ${rank.name}`),
      h('p', { class: 'flavor' }, 'Dive on consecutive days to rise through the cult.'),
      h('h3', {}, 'Answers by rarity'),
      bars,
      h('h3', {}, 'Sightings'),
      h('button', { class: 'btn', type: 'button', onclick: () => this.openSightings() }, `Open the bestiary · ${Object.keys(loadSightings()).length} of ${this.theme.bestiary.length}`),
      ...this.disputesSection(),
      h('h3', {}, 'Settings'),
      h('label', { class: 'setting' }, h('span', {}, 'Sound'), sound),
      h('label', { class: 'setting' }, h('span', {}, 'Volume'), vol),
      h('label', { class: 'setting' }, h('span', {}, 'Reduce motion'), motion),
      canBuzz ? h('label', { class: 'setting' }, h('span', {}, 'Vibration'), haptics) : null,
      h('p', { class: 'flavor' }, 'No sound on an iPhone? Check the silent switch. Everything you play is kept only in this browser.'),
    ]);
  }
}
