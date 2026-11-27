// Shared shapes for the question bank, the theme copy and saved progress.
// The bank format is the contract with the question-bank thread (data/*.json).

export type Tier = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Refused / drowned (no answer)

export interface AnswerDef {
  answer: string;
  aliases?: string[];
  tier: number;
  /** Short true fact shown on the reveal, mostly for tiers 5-6. */
  lore?: string;
  /** The answer people think is clever but everyone says. Still scores its tier. */
  openSecret?: boolean;
}

export interface TrapDef {
  answer: string;
  aliases?: string[];
  reason: string;
}

export interface PromptDef {
  id: string;
  text: string;
  category: string;
  flavor?: string;
  /** One line on what counts, e.g. "UN member states only". */
  rules?: string;
  answers: AnswerDef[];
  traps?: TrapDef[];
  decoys?: string[];
  /** Word play, where the spelling is the answer: only exact matches count, no typos or plurals. */
  exact?: boolean;
}

export interface BankDay {
  date: string; // YYYY-MM-DD
  prompts: string[];
}

export interface BankFile {
  prompts?: PromptDef[];
  days?: BankDay[];
}

export interface TierDef {
  tier: Exclude<Tier, 0>;
  key: string;
  name: string;
  depth: number;
  emoji: string;
  blurb: string;
  /** Reveal lines; one is picked deterministically per answer. */
  lines: string[];
  /** CSS colour used for this tier's glow. */
  color: string;
}

export type ZoneKey = 'surface' | 'twilight' | 'midnight' | 'abyss' | 'hadal' | 'floor';

export interface ZoneDef {
  key: ZoneKey;
  name: string;
  subtitle: string;
  from: number; // metres, inclusive
  to: number; // metres, exclusive
}

export interface Landmark {
  zone: string;
  from: number;
  to: number;
  name: string;
  lines: string[];
}

export interface CultRank {
  minStreak: number;
  name: string;
}

export interface ThemeCopy {
  maxDepth: number;
  promptsPerDay: number;
  secondsPerPrompt: number;
  tiers: TierDef[];
  openSecret: { name: string; emoji: string; blurb: string; lines: string[] };
  refused: {
    name: string;
    emoji: string;
    lines: { unknown: string[]; decoy: string[]; ambiguous: string[]; timeout: string[] };
  };
  zones: ZoneDef[];
  landmarks: Landmark[];
  categories: Record<string, { name: string; title: string }>;
  /** Placeholders: {day} {depth} {emoji} {landmark} {zone} {sanity} {omen} {url} */
  share: { template: string; missEmoji: string };
  howToPlay: string[];
  cultRanks: CultRank[];
}

/** One finished (or timed-out) prompt inside a dive. */
export interface AnswerRecord {
  promptId: string;
  /** What the player typed for the accepted answer. */
  input: string | null;
  /** Canonical accepted answer, or null if they ran out of air. */
  answer: string | null;
  tier: Tier;
  openSecret?: boolean;
  /** Metres gained from this prompt, after omens. */
  depth: number;
  rejects: string[];
  timeMs: number;
}

export interface ActivePrompt {
  index: number;
  /** Wall-clock ms when the timer started; time keeps running across reloads. */
  startedAt: number;
  rejects: string[];
  whisperUsed?: boolean;
}

export interface DayRecord {
  day: number;
  date: string; // YYYY-MM-DD local
  omen: string;
  promptIds: string[];
  answers: AnswerRecord[];
  sanity: number; // 0..100
  finished: boolean;
  active?: ActivePrompt | null;
  whisperUsed?: boolean;
  practice?: boolean;
}

export interface Settings {
  muted: boolean;
  volume: number; // 0..1
  reducedMotion: 'auto' | 'on' | 'off';
  haptics: boolean;
}
