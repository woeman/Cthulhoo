/**
 * madness.js — wrongness that grows with depth.
 *
 *   import { createMadness, madnessForDepth } from '../art/js/madness.js';
 *   const mad = createMadness(document.querySelector('.cth-question__text'));
 *   mad.set(madnessForDepth(5200));   // 0 (sane) .. 1 (the Drowned City)
 *   mad.pulse();                       // one sharp episode, e.g. on a Refused answer
 *   mad.destroy();                     // restores the original markup
 *
 * Options: { level: 0..1, sprite: URL of script-sprite.svg }. The sprite defaults to
 * ../glyphs/script-sprite.svg next to this file; pass it explicitly if a bundler moves things.
 * It is fetched once and inlined into the page (hidden), so it may live on another origin
 * as long as that origin allows the fetch.
 *
 * What happens as the level rises:
 *   > 0.15  a letter, now and then, is briefly the wrong letter (a look-alike from another alphabet)
 *   > 0.35  colours split at the edges of the text (chromatic fringe)
 *   > 0.5   letters twitch, combining marks crawl onto them
 *   > 0.7   a letter becomes a glyph of the Drowned Script for a moment
 *   > 0.85  a whole word is replaced by something the deep is whispering
 *
 * Accessibility: the original text stays in the DOM in a visually hidden span for
 * screen readers; only an aria-hidden copy is disturbed. With prefers-reduced-motion
 * the text never changes; only a faint, static fringe is shown.
 * Keep it to short text (questions, headings, labels), never to inputs or long copy.
 */

const LOOKALIKES = {
  a: 'ɑаα', b: 'ƀɓ', c: 'ϲꞓ', d: 'ɗძ', e: 'ҽėɇ', f: 'ƒ', g: 'ɠ', h: 'ɦħ', i: 'ıɩї', k: 'ƙ', l: 'łɭ', m: 'ɱ',
  n: 'ŋռ', o: 'øɵơ', p: 'ƥ', r: 'ɼŕ', s: 'ʂș', t: 'ŧƭ', u: 'ʊս', v: 'ʋ', w: 'ɯω', y: 'ɣỿ', z: 'ʐ',
  A: 'Λ', B: 'Ƀ', C: 'Ͼ', D: 'Ɖ', E: 'ɆΞ', G: 'Ǥ', H: 'Ħ', I: 'Ɨ', K: 'Ҡ', L: 'Ⱡ', M: 'Ɱ', N: 'Ŋ',
  O: 'ØΘ', R: 'Я', S: 'Ƨ', T: 'Ŧ', U: 'Ʉ', Y: 'Ɏ',
};
const MARKS = ['̰', '̴', '̷', '̣', '͒', '͓', '͙', '̟', '͇'];
const WHISPERS = ['below', 'dreaming', 'deeper', 'it sees', 'we wait', 'not yet', 'remember', 'drowned', 'home', 'come down'];
const GLYPHS = ['eye', 'coil', 'gate', 'sleeper', 'tide', 'fang', 'anchor', 'talon', 'sounding', 'maw', 'root', 'veil', 'spire', 'knot', 'hand', 'void'];
const DEFAULT_SPRITE = new URL('../glyphs/script-sprite.svg', import.meta.url).href;

const STYLE_ID = 'cth-madness-style';
const CSS = `
.cth-mad { --mad: 0; position: relative; }
.cth-mad[data-fringe] { text-shadow: calc(var(--mad) * 1.6px) 0 var(--color-accent-soft, rgb(255 80 80 / .35)),
                                     calc(var(--mad) * -1.6px) 0 var(--color-glow-soft, rgb(80 220 255 / .35)); }
.cth-mad-w { white-space: nowrap; }
.cth-mad-ch { display: inline-block; white-space: pre; transition: transform 90ms linear, filter 120ms linear; }
.cth-mad-ch[data-twitch] { transform: translate(var(--tx, 0), var(--ty, 0)) rotate(var(--tr, 0)); filter: blur(.3px); }
.cth-mad-ch[data-wrong] { color: var(--color-glow, currentColor); }
.cth-mad-glyph { width: .62em; height: 1em; vertical-align: -.12em; overflow: visible; color: var(--color-glow, currentColor); }
.cth-mad-sr { position: absolute !important; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden;
              clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

function ensureStyle() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* The Drowned Script sprite is fetched once and inlined, so <use href="#g-..."> works even
   when the page and its assets live on different origins. Until it arrives (or if it never
   does), the glyph effect falls back to a look-alike letter, so no letter is ever left blank. */
const SPRITE_ID = 'cth-mad-sprite';
const spriteLoads = new Map();
let spriteInlined = false;
function ensureSprite(url) {
  if (typeof document === 'undefined') return;
  if (spriteInlined || document.getElementById(SPRITE_ID)) { spriteInlined = true; return; }
  if (spriteLoads.has(url) || typeof fetch !== 'function') return;
  spriteLoads.set(url, fetch(url)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(r.status))))
    .then((svgText) => {
      if (document.getElementById(SPRITE_ID)) return;
      const holder = document.createElement('div');
      holder.id = SPRITE_ID;
      holder.hidden = true;
      holder.setAttribute('aria-hidden', 'true');
      holder.innerHTML = svgText;
      document.body.appendChild(holder);
      spriteInlined = true;
    })
    .catch(() => {}));
}

const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** How mad the page should be at a depth in metres. 0 until the Stygian Dark deepens, 1 at the floor. */
export function madnessForDepth(m) {
  if (m < 2500) return 0;
  if (m < 6000) return ((m - 2500) / 3500) * 0.55;
  return 0.55 + Math.min(1, (m - 6000) / 1000) * 0.45;
}

export function createMadness(el, opts = {}) {
  ensureStyle();
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const original = el.innerHTML;
  const text = el.textContent;
  let level = clamp01(opts.level ?? 0);
  ensureSprite(opts.sprite || DEFAULT_SPRITE);
  let timer = 0;
  let alive = true;

  // Build: hidden original for assistive tech + an aria-hidden copy split into letters.
  el.textContent = '';
  const sr = document.createElement('span');
  sr.className = 'cth-mad-sr';
  sr.textContent = text;
  const vis = document.createElement('span');
  vis.className = 'cth-mad';
  vis.setAttribute('aria-hidden', 'true');
  const chars = [];
  const words = [];
  let word = [];
  let wordEl = null;   // letters are inline-blocks, so each word is kept whole with nowrap
  for (const ch of text) {
    if (/\s/.test(ch)) {
      if (word.length) { words.push(word); word = []; }
      wordEl = null;
      vis.appendChild(document.createTextNode(ch));
      continue;
    }
    if (!wordEl) {
      wordEl = document.createElement('span');
      wordEl.className = 'cth-mad-w';
      vis.appendChild(wordEl);
    }
    const span = document.createElement('span');
    span.className = 'cth-mad-ch';
    span.textContent = ch;
    span.dataset.ch = ch;
    wordEl.appendChild(span);
    chars.push(span);
    word.push(span);
  }
  if (word.length) words.push(word);
  el.append(sr, vis);

  const restore = (span) => {
    span.textContent = span.dataset.ch;
    delete span.dataset.wrong;
    delete span.dataset.twitch;
  };

  function wrongLetter(span, ms) {
    const ch = span.dataset.ch;
    const alts = LOOKALIKES[ch];
    if (!alts) return;
    span.textContent = pick([...alts]);
    span.dataset.wrong = '';
    setTimeout(() => alive && restore(span), ms);
  }

  function crawl(span, ms) {
    span.textContent = span.dataset.ch + pick(MARKS) + (Math.random() < 0.4 ? pick(MARKS) : '');
    setTimeout(() => alive && restore(span), ms);
  }

  function twitch(span, ms) {
    span.style.setProperty('--tx', `${(Math.random() - 0.5) * 3 * level}px`);
    span.style.setProperty('--ty', `${(Math.random() - 0.5) * 3 * level}px`);
    span.style.setProperty('--tr', `${(Math.random() - 0.5) * 8 * level}deg`);
    span.dataset.twitch = '';
    setTimeout(() => alive && delete span.dataset.twitch, ms);
  }

  function glyph(span, ms) {
    if (!spriteInlined) return wrongLetter(span, ms);
    span.innerHTML = `<svg class="cth-mad-glyph" viewBox="0 0 20 32" aria-hidden="true"><use href="#g-${pick(GLYPHS)}"/></svg>`;
    span.dataset.wrong = '';
    setTimeout(() => alive && restore(span), ms);
  }

  function whisper(ms) {
    const w = pick(words);
    if (!w) return;
    const say = pick(WHISPERS);
    w.forEach((span, i) => {
      span.textContent = say[i] ?? '';
      span.dataset.wrong = '';
    });
    // Any letters of the whisper that do not fit ride on the last span.
    if (say.length > w.length) w[w.length - 1].textContent += say.slice(w.length);
    setTimeout(() => alive && w.forEach(restore), ms);
  }

  function episode(intensity = level) {
    if (!chars.length) return;
    const n = 1 + Math.floor(intensity * 3 * Math.random());
    for (let i = 0; i < n; i++) {
      const span = pick(chars);
      const r = Math.random();
      const ms = 120 + Math.random() * 420;
      if (intensity > 0.85 && r < 0.12) whisper(700 + Math.random() * 500);
      else if (intensity > 0.7 && r < 0.3) glyph(span, ms + 200);
      else if (intensity > 0.5 && r < 0.55) crawl(span, ms);
      else if (intensity > 0.5 && r < 0.8) twitch(span, 90 + Math.random() * 120);
      else wrongLetter(span, ms);
    }
  }

  function schedule() {
    clearTimeout(timer);
    if (!alive || reduce || level < 0.15) return;
    // Mean gap shrinks from ~6 s at the threshold to ~0.5 s at full madness.
    const gap = 500 + (1 - level) * 5600 * (0.5 + Math.random());
    timer = setTimeout(() => {
      if (typeof document !== 'undefined' && document.hidden) return schedule();
      episode();
      schedule();
    }, gap);
  }

  function apply() {
    vis.style.setProperty('--mad', reduce ? Math.min(level, 0.4) : level);
    vis.toggleAttribute('data-fringe', level > 0.35);
    schedule();
  }
  apply();

  return {
    set(v) { level = clamp01(v); apply(); },
    get level() { return level; },
    pulse(strength = 0.9) { if (!reduce) { episode(Math.max(level, strength)); episode(Math.max(level, strength)); } },
    destroy() { alive = false; clearTimeout(timer); el.innerHTML = original; },
  };
}
