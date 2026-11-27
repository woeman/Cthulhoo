// The Whispering Deep on its own, for tuning by eye and for screenshots.
//
//   dev/riddle.html?state=fresh|hints2|solved|sunk|codex|live
//
// Other parameters, all optional:
//   riddle=fog     play this riddle (default: today's); riddle=max is a made-up riddle at
//                  the bank validator's limits (6 lines of 60 characters, a 120-word page)
//   depth=640      the water to read it in (default 640 m, the Gloaming; 0 is paper)
//   guess=cloud    type this and press Speak once the riddle has risen
//   settle=1600    how long after that guess to call the page ready (for catching a bubble mid-burst)
//   rise=3200      how long after the fonts to call the page ready (for catching the verse mid-rise)
//   reduced=1      reduced motion
//   abyss=0        no engraved sea behind it (plain water)
//   hud=show|none  the app's HUD shown, or left out (default: hidden but taking its room, as on the title)
//   scale=2        pin the sea's render scale, as the game's ?scale does
// Every state but "live" keeps its saves in memory only; "live" saves for real, so a
// reload carries on where the riddle was.
import '../art/tokens/tokens.css';
import '../art/css/fonts.css';
import '../art/css/components.css';
import '../src/styles/app.css';
import { applyDepth } from '../art/js/depth.js';
import { dateKeyForDay, dayNumberFor, localDateKey } from '../src/game/daily';
import { cleanRiddle, codexFolio, loadRiddleDeck, matchRiddle, newAttempt, riddleForDay, stepRiddle, type Riddle, type RiddleAttempt, type RiddleAction } from '../src/game/riddles';
import { loadRiddles, setEphemeral } from '../src/game/storage';
import { Abyss } from '../src/render/abyss';
import { codexBody, riddleScreen } from '../src/screens/riddle';
import { icon, installArt } from '../src/ui/art';
import { h } from '../src/ui/dom';

const q = new URLSearchParams(location.search);
const state = q.get('state') || 'fresh';
const num = (k: string, d: number) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : d);
const depth = num('depth', 640);
const reduced = q.get('reduced') === '1' || matchMedia('(prefers-reduced-motion: reduce)').matches;
const log = (...args: unknown[]) => console.info('[riddle bench]', ...args);

if (state !== 'live') setEphemeral(true);
document.documentElement.classList.toggle('reduced-motion', reduced);
applyDepth(document.documentElement, depth);
installArt();

// The sea behind, as in the game, unless asked not to.
if (q.get('abyss') !== '0') {
  const abyss = new Abyss(document.body, { reducedMotion: reduced, pinScale: num('scale', 0) });
  if (!abyss.ok) document.documentElement.classList.add('no-webgl');
  abyss.jumpTo(depth + 40);
  abyss.start();
} else document.documentElement.classList.add('no-webgl');

// A made-up riddle at the validator's limits, for layout only: six lines of up to sixty
// characters, long whispers, four traps and a 120-word page.
const MAX: unknown = {
  id: 'max',
  verse: [
    'I was laid down in the dark before the first keel was cut,',
    'and I have kept every name the harbour ever tried to forget.',
    'The lamps go out along the quay as I come walking in,',
    'and the gulls fall quiet, and the bell on the buoy forgets.',
    'Sailors count my knots in fathoms and their wives in years.',
    'Name me and I let you rise. Mistake me and I will not.',
  ],
  answers: [{ answer: 'Memory', aliases: ['Remembrance'] }, { answer: 'Tide' }],
  hints: [
    'I am older than the town, and the town is older than its church, and the church remembers the flood.',
    'Every wreck in the harbour is written in me, though no one has ever held a pen to write it down.',
    'Old sailors say I come in twice a day and take a little more of the shore with me each time.',
  ],
  traps: [
    { answer: 'Fog', reason: 'Fog walks in at dusk too, but it forgets everything by noon.' },
    { answer: 'Night', reason: 'The night comes every day. I only seem to.' },
    { answer: 'Sea', reason: 'Close. The sea is what I move.' },
    { answer: 'Wave', reason: 'A wave is only my messenger, sent ahead.' },
  ],
  page: {
    title: 'Of the Long Memory of the Harbour and Its Tides',
    text:
      'The harbour keeps its records in the water, and the water keeps them well. Each tide carries in a little of the last: salt, silt and the small bones of fish, laid down along the mud in thin grey layers that can be counted like the rings of a tree. ' +
      'A core of that mud no longer than an arm can hold centuries of floods, storms and dry summers, each year a band no thicker than a page. The old harbourmasters never needed the cores. They knew which tides had come in wrong, and which had taken someone back with them. They wrote those down as well, in a book kept in the harbour office, until the office went under.',
  },
};

const deck = loadRiddleDeck();
const today = dayNumberFor(new Date());
const pickRiddle = (day: number): Riddle => {
  const want = q.get('riddle');
  if (want === 'max') return cleanRiddle(MAX)!;
  return (want && deck.byId.get(want)) || riddleForDay(deck, day, dateKeyForDay(day)) || deck.riddles[0];
};

/** Guesses the deep refuses outright (not near misses), to spend breaths with. */
const WRONG = ['Teapot', 'Violin', 'Saddle', 'Umbrella', 'Carrot', 'Bicycle', 'Thimble', 'Kettle', 'Parsnip', 'Trumpet', 'Ladder', 'Pillow'];
const wrongFor = (r: Riddle) => WRONG.filter((w) => matchRiddle(r, w).kind === 'reject');

function play(r: Riddle, day: number, moves: RiddleAction[]): RiddleAttempt {
  let a = newAttempt(r, day, dateKeyForDay(day), Date.now() - 600_000);
  for (const m of moves) a = stepRiddle(r, a, m).attempt;
  return a;
}

function attemptFor(r: Riddle, day: number): RiddleAttempt | null {
  const wrong = wrongFor(r).map((text): RiddleAction => ({ type: 'guess', text }));
  const near: RiddleAction[] = r.traps.length ? [{ type: 'guess', text: r.traps[0].answer }] : [];
  const answer: RiddleAction = { type: 'guess', text: r.answers[0].answer };
  switch (state) {
    case 'hints2':
      return play(r, day, [{ type: 'hint' }, wrong[0], ...near, { type: 'hint' }, wrong[1]]);
    case 'solved':
      return play(r, day, [wrong[0], { type: 'hint' }, answer]);
    case 'codex':
      return codexSaves()[day] ?? null;
    case 'sunk':
      return play(r, day, [{ type: 'hint' }, ...near, ...wrong.slice(0, 5)]);
    case 'live':
      return loadRiddles()[day] ?? null;
    default:
      return null;
  }
}

// ------------------------------------------------------------ the shell, as the app builds it
const root = document.getElementById('app')!;
const hudMode = q.get('hud') || 'hidden';
const hud =
  hudMode === 'none'
    ? null
    : h(
        'header',
        { class: 'hud', hidden: hudMode !== 'show' },
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Logbook and settings', html: icon('info') }),
        h('div', { class: 'hud-title' }, 'The Whispering Deep'),
        h('div', { class: 'hud-depth' }, h('span', { class: 'num' }, String(depth)), h('span', { class: 'unit' }, ' m'), h('span', { class: 'zone' }, '')),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Sound', html: icon('sound-on') }),
      );
const stage = h('main', { class: 'stage' });
const app = h('div', { class: 'app' }, hud, stage);
const live = h('div', { class: 'visually-hidden', role: 'status', 'aria-live': 'polite' });
const alert = h('div', { class: 'visually-hidden', 'aria-live': 'assertive', 'aria-atomic': 'true' });
root.append(app, live, alert);

// The app fits itself to the visual viewport (the iPhone keyboard), and packs tighter when it is short.
const vv = window.visualViewport;
const fit = () => {
  const r = document.documentElement;
  const visible = vv && Math.abs(vv.scale - 1) < 0.01 ? vv.height : window.innerHeight;
  r.style.setProperty('--vvh', `${Math.round(visible)}px`);
  r.style.setProperty('--vv-top', `${Math.round(vv && Math.abs(vv.scale - 1) < 0.01 ? vv.offsetTop : 0)}px`);
  r.classList.toggle('short', visible < 560);
};
vv?.addEventListener('resize', fit);
vv?.addEventListener('scroll', fit);
window.addEventListener('resize', fit);
fit();

const say = (region: HTMLElement, msg: string) => {
  region.textContent = '';
  window.setTimeout(() => (region.textContent = msg), 60);
};

function mount(day: number) {
  const riddle = pickRiddle(day);
  const date = day === today ? localDateKey(new Date()) : dateKeyForDay(day);
  const attempt = attemptFor(riddle, day);
  const screen = riddleScreen(
    // The Codex state shows its own saves, so the page's folio is worked out from them.
    { riddle, day, date, attempt, reducedMotion: reduced, folio: state === 'codex' ? codexFolio(riddle, codexSaves()) : undefined },
    {
      onBack: () => log('back to the surface'),
      onFinished: (result) => log('finished', result),
      onCodex: () => openCodex(),
      announce: (msg, urgent) => {
        log(urgent ? 'shout:' : 'say:', msg);
        say(urgent ? alert : live, msg);
      },
      click: () => log('sound: click'),
      key: () => {},
      refuse: () => log('sound: refuse'),
      accept: () => log('sound: accept'),
      whisper: () => log('sound: whisper'),
      breath: () => log('sound: breath'),
      sink: () => log('sound: sink'),
    },
  );
  if (!reduced) screen.classList.add('screen-in');
  stage.append(screen);
  return screen;
}

// ------------------------------------------------------------ the Codex, as a Logbook sheet
function codexSaves(): Record<number, RiddleAttempt> {
  const saves: Record<number, RiddleAttempt> = {};
  const plan: Array<[number, RiddleAction[] | 'sink']> = [
    [1, [{ type: 'hint' }]],
    [2, []],
    [3, 'sink'],
    [4, [{ type: 'hint' }, { type: 'hint' }]],
  ];
  for (const [day, moves] of plan) {
    const r = riddleForDay(deck, day, dateKeyForDay(day))!;
    saves[day] = moves === 'sink' ? play(r, day, wrongFor(r).slice(0, 5).map((text) => ({ type: 'guess', text }))) : play(r, day, [...moves, { type: 'guess', text: r.answers[0].answer }]);
  }
  return saves;
}

function openCodex() {
  const close = h('button', { class: 'icon-btn close', type: 'button', 'aria-label': 'Close', html: icon('close') });
  const panel = h('div', { class: 'sheet-panel', tabindex: '-1' }, h('div', { class: 'sheet-head' }, h('h2', { id: 'codex-title' }, 'The Drowned Codex'), close), h('div', { class: 'sheet-body' }, ...codexBody(deck, state === 'live' ? loadRiddles() : codexSaves())));
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'codex-title' }, panel);
  const shut = () => {
    sheet.remove();
    app.inert = false;
  };
  close.addEventListener('click', shut);
  sheet.addEventListener('click', (e) => e.target === sheet && shut());
  document.body.append(sheet);
  app.inert = true;
  panel.focus({ preventScroll: true });
}

const screen = mount(state === 'codex' ? 4 : today);
if (state === 'codex') openCodex();
log(`deck: ${deck.riddles.length} riddles from ${deck.source}; state ${state}`);

// Tell the screenshot script when everything has risen.
const guess = q.get('guess');
void document.fonts.ready.then(() => {
  const settle = num('rise', reduced ? 150 : 3200);
  window.setTimeout(() => {
    if (guess) {
      const input = screen.querySelector<HTMLInputElement>('.riddle-answer');
      const form = screen.querySelector<HTMLFormElement>('.riddle-form');
      if (input && form) {
        input.value = guess;
        form.requestSubmit();
      }
    }
    window.setTimeout(() => (document.body.dataset.ready = 'yes'), guess ? num('settle', reduced ? 100 : 1600) : 0);
  }, settle);
});
