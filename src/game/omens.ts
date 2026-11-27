import { mulberry32 } from './daily';

// A daily omen: one small, fair twist that everyone diving that day shares.

export interface OmenDef {
  id: string;
  name: string;
  /** Plain statement of what it does. */
  effect: string;
  /** An eerie line for flavour. */
  flavor: string;
  glyph: string;
  timeMs?: number;
  tierMultiplier?: Partial<Record<number, number>>;
  allMultiplier?: number;
  /** One question "tolls": its answer counts double. */
  bell?: boolean;
  /** Once per dive the player may listen for a whisper (a letter of a rare answer). */
  whisper?: boolean;
}

export const OMENS: OmenDef[] = [
  {
    id: 'still',
    name: 'Still Water',
    effect: 'No omen stirs today. The rules are as they always were.',
    flavor: 'The sea is quiet. Too quiet.',
    glyph: '〰',
  },
  {
    id: 'stars',
    name: 'The Stars Are Right',
    effect: 'Unspeakable answers sink you half as deep again.',
    flavor: 'Something vast turns over in its sleep.',
    glyph: '✶',
    tierMultiplier: { 6: 1.5 },
  },
  {
    id: 'slack',
    name: 'Slack Tide',
    effect: 'The current is lazy: 35 seconds for every question.',
    flavor: 'The water holds its breath, and so may you.',
    glyph: '◌',
    timeMs: 35_000,
  },
  {
    id: 'blood',
    name: 'Blood Tide',
    effect: 'Only 18 seconds per question, but every answer sinks a fifth deeper.',
    flavor: 'The water is warm, and it is not the sun.',
    glyph: '◉',
    timeMs: 18_000,
    allMultiplier: 1.2,
  },
  {
    id: 'bell',
    name: 'The Drowned Bell',
    effect: 'One question tolls. Its answer sinks you twice as deep.',
    flavor: 'A bell rings far below, where no bell should be.',
    glyph: '♁',
    bell: true,
  },
  {
    id: 'whisper',
    name: 'Whispering Deep',
    effect: 'Once this dive, you may listen for a whisper: the first letter of a rarer answer.',
    flavor: 'Someone is speaking your name, very slowly.',
    glyph: '❦',
    whisper: true,
  },
];

// "Still Water" appears twice so roughly two days in seven are plain.
const WHEEL = ['bell', 'still', 'stars', 'whisper', 'slack', 'still', 'blood'];

export function omenForDay(day: number): OmenDef {
  // Day 1 always opens with the bell; after that the wheel is shuffled per week.
  if (day <= 1) return OMENS.find((o) => o.id === 'bell')!;
  const week = Math.floor((day - 1) / 7);
  const order = WHEEL.slice();
  const rnd = mulberry32(0xd00d + week * 131);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const id = order[(day - 1) % 7];
  return OMENS.find((o) => o.id === id) ?? OMENS[0];
}

export function omenById(id: string): OmenDef {
  return OMENS.find((o) => o.id === id) ?? OMENS[0];
}

/** Which question tolls on a bell day (0-based). */
export function bellIndexFor(day: number, count: number): number {
  return Math.floor(mulberry32(day * 977 + 13)() * count);
}
