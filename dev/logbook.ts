// The Logbook bench: a made-up career for each case, for tuning the page by eye.
//
// dev/logbook.html?case=new|first|fortnight|drifted|veteran
//   &copy=rich|placeholder  the career copy: the bench's own milestones and titles (the
//                           veteran's default, so a deep career has milestones to pass),
//                           or the game's placeholder (every other case's default)
//   &zone=midnight          the zone on <html>, as if the app's water stood at that depth
//   &reduced                motion reduced
//   &payout                 pay the cable out, as on the first visit of the day
//                           (otherwise it is shown drawn, for screenshots)
//   &hud=hidden             keep the app's hidden HUD row above the stage, as the app does now
//   &seed=abc               the player's seed for the title and synopsis
import '../art/tokens/tokens.css';
import '../art/css/fonts.css';
import '../art/css/components.css';
import '../src/styles/app.css';
import { computeCareer } from '../src/game/career';
import { computeSigils } from '../src/game/sigils';
import { personaFor } from '../src/game/persona';
import { computeStats } from '../src/game/stats';
import { PLACEHOLDER_THEME, buildCareer } from '../src/game/theme';
import { baseDepth } from '../src/game/scoring';
import { dateForDay, dateKeyForDay, hashString, mulberry32 } from '../src/game/daily';
import type { AnswerRecord, DayRecord, ThemeCopy, Tier } from '../src/game/types';
import { installArt } from '../src/ui/art';
import { h } from '../src/ui/dom';
import { logbookScreen } from '../src/screens/logbook';

interface Plan {
  today: number;
  played: number[];
  /** Skill per topic, 0 to 1; `default` for the rest. */
  skill: Record<string, number>;
  /** Share of dives taken late at night. */
  night: number;
  seed: string;
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const without = (days: number[], gone: number[]) => days.filter((d) => !gone.includes(d));

const PLANS: Record<string, Plan> = {
  new: { today: 9, played: [], skill: { default: 0.4 }, night: 0.2, seed: 'k3v9q2bench' },
  first: { today: 9, played: [9], skill: { default: 0.45, geography: 0.7 }, night: 0, seed: 'k3v9q2bench' },
  // Fourteen days: a week, a ward spent on day 14, three more, a drift on day 18, two more.
  fortnight: {
    today: 20,
    played: without(range(7, 20), [14, 18]),
    skill: { default: 0.32, geography: 0.78, history: 0.62, science: 0.45, sport: 0.12 },
    night: 0.15,
    seed: 'k3v9q2bench',
  },
  // Ten days played, then four away: one warded, three adrift. Today not yet played.
  drifted: {
    today: 44,
    played: range(30, 39),
    skill: { default: 0.35, nature: 0.74, science: 0.6, culture: 0.48, food: 0.18 },
    night: 0.1,
    seed: 'p8x1m4bench',
  },
  // Three hundred days: the odd missed day (most of them warded) and a five-day break.
  veteran: {
    today: 320,
    played: without(range(21, 320), [47, 88, 89, 130, 175, 176, 177, 178, 179, 221, 262, 263, 301]),
    skill: { default: 0.42, geography: 0.9, myth: 0.82, language: 0.7, history: 0.6, nature: 0.55, science: 0.46, food: 0.3, sport: 0.18 },
    night: 0.75,
    seed: 'w2n7c5bench',
  },
};

// Career copy richer than the placeholder's two milestones, so a deep career has a way
// to mark. Not the game's copy: data/theme.json owns that.
const BENCH_CAREER = {
  title: '{epithet} {role} of {place}',
  surfacePlace: 'the Shallows',
  milestones: [
    { depth: 1000, name: 'Below the Gloaming', place: 'the Gloaming', line: 'The last of the light is above you now.' },
    { depth: 3000, name: 'The First Trench', place: 'the First Trench', line: 'The floor falls away.' },
    { depth: 7000, name: 'The Roofs of the Drowned City', place: 'the Drowned City', line: 'You have touched the floor. It was not the floor.' },
    { depth: 15000, name: 'The Drowned Belfry', place: 'the Drowned Belfry', line: 'A bell rings once, under you.' },
    { depth: 30000, name: 'The Streets Below the Roofs', place: 'the Lower Streets', line: 'The streets go down, not along.' },
    { depth: 60000, name: 'The Library of Wet Stone', place: 'the Library of Wet Stone', line: 'Every book is open at your page.' },
    { depth: 120000, name: 'The Stair Without a Landing', place: 'the Endless Stair', line: 'You stop counting the steps.' },
    { depth: 250000, name: 'The Gate of the Drowned Script', place: 'the Script Gate', line: 'You can read the gate now.' },
    { depth: 500000, name: "The Sleeper's Antechamber", place: 'the Antechamber', line: 'Wipe your feet.' },
    { depth: 1000000, name: 'Where the Sleeper Dreams', place: 'the Dreaming Halls', line: 'It is dreaming of you.' },
    { depth: 2000000, name: 'The Bottom of the Dream', place: 'the Bottom of the Dream', line: 'There is no bottom.' },
  ],
  epithets: [
    { from: 0, words: ['Damp', 'Salt-Stung'] },
    { from: 1000, words: ['Lamplit'] },
    { from: 7000, words: ['Drowned'] },
    { from: 60000, words: ['Hollow-Eyed'] },
    { from: 250000, words: ['Abyssal'] },
    { from: 1000000, words: ['Unfathomed'] },
  ],
  roles: {
    none: ['Diver'],
    geography: ['Cartographer'],
    science: ['Alchemist'],
    nature: ['Naturalist'],
    culture: ['Archivist'],
    history: ['Chronicler'],
    myth: ['Augur'],
    food: ['Sea-Cook'],
    language: ['Lexicographer'],
    sport: ['Harpooner'],
    misc: ['Beachcomber'],
  },
  synopsis: {
    strong: {
      geography: ['It knows the shape of coasts that are no longer there.'],
      science: ['It weighs the stars by the way they fall.'],
      nature: ['It can name what lives where the light ends.'],
      culture: ['It has read the books the library would not lend.'],
      history: ['It remembers kings the sea has kept.'],
      myth: ['It knows the old names, and does not say them twice.'],
      food: ['It knows what the drowned would eat, if they ate.'],
      language: ['It reads the words the water writes.'],
      sport: ['It keeps the scores of games no one plays now.'],
      misc: ['It gathers what the tide leaves behind.'],
    },
    weak: {
      sport: ['Games mean little to it.'],
      food: ['It forgets to eat.'],
      science: ['Numbers slip through its fingers.'],
      history: ['It does not look back.'],
    },
  },
};

const q = new URLSearchParams(location.search);
const kase = PLANS[q.get('case') ?? ''] ? (q.get('case') as string) : 'fortnight';
const plan = PLANS[kase];
const copy = q.get('copy') ?? (kase === 'veteran' ? 'rich' : 'placeholder');
const theme: ThemeCopy = copy === 'rich' ? { ...PLACEHOLDER_THEME, career: buildCareer(BENCH_CAREER, PLACEHOLDER_THEME.career) } : PLACEHOLDER_THEME;
const TOPICS = Object.keys(theme.categories);

/** A tier for one answer: rarer as the diver's skill in the topic grows. */
function tierFor(rnd: () => number, skill: number): Tier {
  if (rnd() < 0.05) return 0; // out of air
  const mean = 0.8 + skill * 4.4;
  const t = Math.round(mean + (rnd() + rnd() + rnd() - 1.5) * 1.5);
  return Math.max(1, Math.min(6, t)) as Tier;
}

function makeDays(p: Plan): Record<number, DayRecord> {
  const days: Record<number, DayRecord> = {};
  for (const day of p.played) {
    const rnd = mulberry32(hashString(`${p.seed}:${day}`));
    // Seven topics a day, at most two of any one, as the daily plan has them.
    const picks: string[] = [];
    while (picks.length < 7) {
      const t = TOPICS[Math.floor(rnd() * TOPICS.length)];
      if (picks.filter((x) => x === t).length < 2) picks.push(t);
    }
    const answers: AnswerRecord[] = picks.map((topic, i) => {
      const skill = p.skill[topic] ?? p.skill.default ?? 0.4;
      const tier = tierFor(rnd, skill);
      return {
        promptId: `bench-${day}-${i}`,
        input: tier ? 'answer' : null,
        answer: tier ? 'answer' : null,
        tier,
        depth: tier ? baseDepth(theme, tier) : 0,
        rejects: [],
        timeMs: tier ? Math.round(3500 + (1 - skill) * 9000 + rnd() * 5000) : 25000,
        category: topic,
      };
    });
    const late = rnd() < p.night;
    const hour = late ? 23 + Math.floor(rnd() * 3) : 9 + Math.floor(rnd() * 11);
    days[day] = {
      day,
      date: dateKeyForDay(day),
      omen: 'still',
      promptIds: answers.map((a) => a.promptId),
      answers,
      sanity: 40 + Math.round(rnd() * 50),
      finished: true,
      playedAt: dateForDay(day).getTime() + hour * 3_600_000 + Math.floor(rnd() * 3_600_000),
    };
  }
  return days;
}

const days = makeDays(plan);
const career = computeCareer(days, plan.today, theme.career.milestones);
const sigils = computeSigils(days, () => undefined, theme);
const persona = personaFor(career, sigils, days, theme, q.get('seed') || plan.seed, plan.today);
const stats = computeStats(days, plan.today);
const reduced = q.has('reduced') || matchMedia('(prefers-reduced-motion: reduce)').matches;

if (q.get('zone')) document.documentElement.dataset.zone = q.get('zone') as string;
if (reduced) document.documentElement.classList.add('reduced-motion');
// The cable pays out once a day; the bench shows it drawn unless asked.
try {
  if (q.has('payout')) localStorage.removeItem('cthulhoo.v1.logbook.cable');
  else localStorage.setItem('cthulhoo.v1.logbook.cable', String(plan.today));
} catch {
  /* storage blocked */
}

installArt();
const stage = h('main', { class: 'stage' });
const hud = q.get('hud') === 'hidden' ? h('header', { class: 'hud', hidden: true }, h('span', { class: 'icon-btn' }), h('span'), h('span'), h('span', { class: 'icon-btn' })) : null;
const shell = h('div', { class: 'app', style: hud ? '' : 'grid-template-rows: 0 1fr' }, ...(hud ? [hud] : []), stage);
document.getElementById('app')?.append(shell);

const screen = logbookScreen(
  { theme, career, persona, sigils, stats, today: plan.today, reduced },
  { onBack: () => console.info('[bench] back'), onSettings: () => console.info('[bench] settings') },
);
if (!reduced) screen.classList.add('screen-in');
stage.append(screen);
screen.scrollTop = 0;

// For the console: what the bench built.
Object.assign(window, { bench: { kase, career, persona, sigils, stats } });
console.info(`[bench] ${kase}: ${Math.round(career.depth)} m, ${career.daysPlayed} dives, streak ${career.streak}, wards ${career.wards}, title "${persona.title}"`);
requestAnimationFrame(() => requestAnimationFrame(() => (document.body.dataset.ready = 'yes')));
