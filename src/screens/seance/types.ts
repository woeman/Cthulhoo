// What the Séance's screens need from the app, and what a test bench may swap in.

import type { Topic } from '../../game/topics';
import type { BankDay, PromptDef, ThemeCopy } from '../../game/types';
import type { Hello, LinkHandlers, LinkStatus, SeancePeek } from '../../party/online';
import type { CultBoard } from '../../party/cult';
import type { ClientMsg, SeanceView } from '../../party/types';

/** The app's sound engine, as far as the Séance uses it. Every hook is optional. */
export interface SeanceSound {
  click?(): void;
  key?(): void;
  refuse?(): void;
  accept?(tier: number): void;
  tick?(urgent: boolean): void;
  whisper?(): void;
  zone?(): void;
}

export interface SeanceEnv {
  /** The question bank. */
  prompts: PromptDef[];
  byId: Map<string, PromptDef>;
  days: BankDay[];
  /** Today's daily prompt ids: a séance never asks them. */
  avoid: string[];
  theme: ThemeCopy;
  /** Today's day number. */
  today: number;
  /** The player's reduced-motion choice (the media query is honoured as well). */
  reduced: boolean;
  /** This device's mark (playerId() from storage). */
  playerId: string;
  sound?: SeanceSound;
  /** The app's polite live region. */
  announce(msg: string): void;
  /** The app's assertive live region (refusals). */
  shout(msg: string): void;
  /** Haptics; the app decides whether the player allows them. */
  buzz?(pattern: number | number[]): void;
  /** The deepest total as the séance goes on, so the app can sink its abyss; 0 on leaving. */
  onDepth?(metres: number): void;
  /** The topics a séance can be held on, when the app offers the choice. */
  topics?: SeanceTopics;
}

/** The topic tick-boxes' supply: the daily categories at once, the class packs once fetched. */
export interface SeanceTopics {
  daily(): Topic[];
  all(): Promise<Topic[]>;
  /** The questions a choice draws from. Rejects when a ticked class pack cannot be fetched. */
  pool(choice: string[]): Promise<PromptDef[]>;
  topicOf(p: Pick<PromptDef, 'id' | 'category'>): string;
  /** Fetches whichever class packs hold these question ids, for a séance picked up after a reload. */
  ensure(promptIds: string[]): Promise<void>;
  /** The choice last made on this device. */
  load(): string[];
  save(choice: string[]): void;
}

export interface SeanceOpts {
  /** A sign from the address (?seance=SIGN): the screen opens on Join with it filled. */
  sign?: string;
  /** Open as the table (a shared screen): with a sign, it sits straight down. */
  table?: boolean;
  /** Something of the app's for the end of the bar (its sound switch). */
  barEnd?: HTMLElement;
  onExit(): void;
}

/** The parts of a SeanceLink the screens use, so a bench can play the relay. */
export interface LinkLike {
  view: SeanceView | null;
  status: LinkStatus;
  now(): number;
  send(msg: ClientMsg): boolean;
  close(leave?: boolean): void;
}

export type LinkFactory = (sign: string, hello: Hello, on: LinkHandlers, rejoin: boolean) => LinkLike;

/** Stand-ins for the relay and the clock. The app never passes these; the bench does. */
export interface SeanceDeps {
  relay?: boolean;
  link?: LinkFactory;
  open?: () => Promise<string>;
  peek?: (sign: string) => Promise<SeancePeek | null>;
  /** The clock pass-and-play burns its candles by. */
  now?: () => number;
}

export interface CultDeps {
  relay?: boolean;
  found?: (id: string, name: string, day: number) => Promise<{ sign: string; board: CultBoard }>;
  join?: (sign: string, id: string, name: string, day: number) => Promise<CultBoard>;
  board?: (sign: string, id: string, day: number) => Promise<CultBoard>;
  leave?: (sign: string, id: string) => Promise<boolean>;
  dive?: (sign: string, id: string, day: number, depth: number) => Promise<CultBoard>;
}

/** One sitter as the screens draw them, from a relay view or a pass-and-play circle. */
export interface Seat {
  id: string;
  name: string;
  mark: number;
  online: boolean;
  you: boolean;
  medium: boolean;
}
