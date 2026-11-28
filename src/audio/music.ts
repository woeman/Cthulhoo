// Music: recorded ambient beds laid under the synthesised sound (engine.ts).
// Eight tracks, two for each of four places: the surface, the mid-depths, the
// abyss, and the séance. A dive plays the bed of the depth it is at and changes
// bed as it sinks; the séance plays its own. Within a place the two tracks take
// turns, each coming in under the other's tail, and a bed begins somewhere in
// its track's first half, so no two sittings sound alike and nothing ever
// hard-loops.
//
// The files are not part of the game's script: they stream from music/ beside
// the page when first needed. Two players are enough (one fading out, one
// fading in). Their sound goes through the engine's graph, so the sound switch,
// the volume, the ducks under an event and the hush at the floor all apply to
// the music as they do to the bed.

export type MusicPlace = 'surface' | 'middepths' | 'abyss' | 'seance';
export type MusicScene = 'dive' | 'seance' | 'quiet';

export interface MusicTrack {
  place: MusicPlace;
  file: string;
  /** Integrated loudness of the file as measured (LUFS), so every bed sits at the same level. */
  lufs: number;
}

export const MUSIC_TRACKS: readonly MusicTrack[] = [
  { place: 'surface', file: 'surface-a.mp3', lufs: -17.2 },
  { place: 'surface', file: 'surface-b.mp3', lufs: -17.6 },
  { place: 'middepths', file: 'middepths-a.mp3', lufs: -18.2 },
  { place: 'middepths', file: 'middepths-b.mp3', lufs: -17.6 },
  { place: 'abyss', file: 'abyss-a.mp3', lufs: -16.7 },
  { place: 'abyss', file: 'abyss-b.mp3', lufs: -16.0 },
  { place: 'seance', file: 'seance-a.mp3', lufs: -17.3 },
  { place: 'seance', file: 'seance-b.mp3', lufs: -16.9 },
];

/**
 * How loud the music plays, in LUFS. The synthesised bed sits near -20; the
 * music lies a little under it, a layer and not the lead.
 */
export const MUSIC_LUFS = -22;
/** Seconds a track's tail overlaps the next one's start. Most of the tracks fade out over about this long. */
export const MUSIC_OVERLAP = 7;
/** Seconds to change from one place's bed to another's. */
export const MUSIC_CHANGE = 5;
/** Seconds the camera must stay in a zone before its bed begins: a camera passing through starts nothing. */
export const MUSIC_SETTLE = 1.5;
/** Times a track may fail to arrive before the music gives up until it is switched on again. */
export const MUSIC_TRIES = 3;

/** The gain that brings a track to the level the music plays at. */
export const trackGain = (t: Pick<MusicTrack, 'lufs'>, target = MUSIC_LUFS): number => Math.pow(10, (target - t.lufs) / 20);

/**
 * Depths where a dive's bed changes, and how far back the camera must come
 * before it changes back. The surface beds cover the Shallows and most of the
 * Gloaming; the abyss beds begin well inside the Stygian Dark, so that a good
 * dive hears all three.
 */
const MID_FROM = 600;
const ABYSS_FROM = 3000;
const SLACK = 150;

/**
 * The place whose bed a depth calls for. `was` keeps a dive that hovers at a
 * boundary from flickering between two beds.
 */
export function placeForDepth(metres: number, was?: MusicPlace | null): MusicPlace {
  const m = Number.isFinite(metres) ? metres : 0;
  const edge = (at: number, deeper: MusicPlace) => (was === deeper ? at - SLACK : at);
  if (m >= edge(ABYSS_FROM, 'abyss')) return 'abyss';
  if (m >= edge(MID_FROM, 'middepths')) return 'middepths';
  return 'surface';
}

/** The next track for a place: the other one from last time, or either at random to begin with. */
export function nextTrack(place: MusicPlace, last: MusicTrack | null | undefined, rand: () => number = Math.random): MusicTrack {
  const own = MUSIC_TRACKS.filter((t) => t.place === place);
  const fresh = own.filter((t) => t !== last);
  const pool = fresh.length ? fresh : own;
  return pool[Math.floor(rand() * pool.length) % pool.length];
}

/** Where the engine lets music into its mix. Null until sound has started. */
export type MusicBus = () => { ctx: AudioContext; input: AudioNode } | null;

interface Player {
  el: HTMLAudioElement;
  gain: GainNode;
  track: MusicTrack | null;
  /** Whether it is the one being heard (or about to be), not the one fading out. */
  lead: boolean;
  /** Seconds to fade in over once its sound arrives; 0 when it has. */
  rise: number;
  /** The timer that stops it after its fade out. */
  stop: number;
}

// An empty WAV: playing it inside a tap is what lets a player start later without one.
const SILENCE = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';

const quiet = (p: Promise<void> | undefined) => void p?.catch(() => undefined);

export class Music {
  private players: Player[] = [];
  private scene: MusicScene = 'dive';
  private depth = 0;
  private place: MusicPlace | null = null;
  private lastOf = new Map<MusicPlace, MusicTrack>();
  private on = true;
  private enabled = true;
  private unlocked = false;
  private fails = 0;
  private pending: MusicPlace | null | undefined;
  private settling = 0;

  constructor(
    private bus: MusicBus,
    /** The address music/ sits beside (the page's own). */
    private base: string,
    private rand: () => number = Math.random,
  ) {}

  /**
   * Call from a tap, click or key (every one, it is cheap): browsers only let
   * sound begin inside a gesture, so the two players are made and woken here.
   * Later calls restart a player the browser stopped behind our back.
   */
  unlock(): void {
    if (!this.enabled || !this.on) return;
    if (this.unlocked) {
      for (const p of this.players) if (p.track && p.el.paused && !p.el.ended) quiet(p.el.play());
      return;
    }
    const bus = this.bus();
    if (!bus || typeof Audio === 'undefined') return;
    try {
      const made: Player[] = [];
      for (let i = 0; i < 2; i++) {
        const el = new Audio();
        el.preload = 'none';
        el.loop = false;
        const gain = bus.ctx.createGain();
        gain.gain.value = 0;
        bus.ctx.createMediaElementSource(el).connect(gain).connect(bus.input);
        const player: Player = { el, gain, track: null, lead: false, rise: 0, stop: 0 };
        el.addEventListener('playing', () => this.heard(player));
        el.addEventListener('timeupdate', () => this.near(player));
        el.addEventListener('ended', () => this.ended(player, false));
        el.addEventListener('error', () => this.ended(player, true));
        el.src = SILENCE;
        quiet(el.play());
        made.push(player);
      }
      this.players = made;
      this.unlocked = true;
    } catch {
      return;
    }
    this.aim();
  }

  /** What is on screen: a dive (bed by depth), the séance (its own beds), or somewhere music keeps out of. */
  setScene(scene: MusicScene): void {
    if (scene === this.scene) return;
    this.scene = scene;
    this.settled();
    this.aim();
  }

  /** The camera's depth in metres; call as often as the engine's setDepth. */
  setDepth(metres: number): void {
    this.depth = metres;
    if (!this.unlocked || this.scene !== 'dive') return;
    const want = this.want();
    if (want === this.place) return this.settled();
    if (this.settling && want === this.pending) return;
    this.settled();
    this.pending = want;
    this.settling = setTimeout(() => {
      this.settling = 0;
      this.aim();
    }, MUSIC_SETTLE * 1000) as unknown as number;
  }

  /** Sound on and the tab in sight: otherwise the players stop where they are, and pick up there afterwards. */
  setOn(on: boolean): void {
    if (on === this.on) return;
    this.on = on;
    if (!on) {
      for (const p of this.players) p.el.pause();
      return;
    }
    for (const p of this.players) if (p.track && !p.el.ended) quiet(p.el.play());
    this.aim();
  }

  /** The player's own music switch. */
  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return;
    this.enabled = enabled;
    if (enabled) this.fails = 0;
    this.aim();
  }

  /** The track being heard, for tests and the curious. */
  get playing(): string | null {
    return this.players.find((p) => p.lead)?.track?.file ?? null;
  }

  // ------------------------------------------------------------------ inside

  private want(): MusicPlace | null {
    if (!this.enabled || this.scene === 'quiet' || this.fails >= MUSIC_TRIES) return null;
    return this.scene === 'seance' ? 'seance' : placeForDepth(this.depth, this.place);
  }

  private settled(): void {
    clearTimeout(this.settling);
    this.settling = 0;
    this.pending = undefined;
  }

  /** Bring what is playing in line with what is wanted. */
  private aim(): void {
    if (!this.unlocked || !this.on) return;
    const want = this.want();
    if (want === this.place) return;
    this.place = want;
    if (!want) {
      for (const p of this.players) if (p.track) this.fade(p, MUSIC_CHANGE);
      return;
    }
    // A bed begins somewhere in its track's first half, so no two visits sound alike.
    this.start(nextTrack(want, this.lastOf.get(want), this.rand), MUSIC_CHANGE, true);
  }

  /** Start a track on the player that is free (or the one fading out), fading the other out. */
  private start(track: MusicTrack, seconds: number, midway: boolean): void {
    const bus = this.bus();
    const lead = this.players.find((p) => p.lead);
    const free = this.players.find((p) => !p.track) ?? this.players.find((p) => p !== lead);
    if (!bus || !free) return;
    if (lead && lead !== free) this.fade(lead, seconds);
    clearTimeout(free.stop);
    free.lead = true;
    free.track = track;
    free.rise = seconds;
    this.lastOf.set(track.place, track);
    // Silent until its sound arrives (see heard), so a slow line fades in late and never pops in.
    const g = free.gain.gain;
    g.cancelScheduledValues(bus.ctx.currentTime);
    g.setValueAtTime(0, bus.ctx.currentTime);
    const el = free.el;
    el.src = new URL(`music/${track.file}`, this.base).href;
    if (midway) {
      const seek = () => {
        if (free.track === track && Number.isFinite(el.duration) && el.duration > 60) el.currentTime = this.rand() * el.duration * 0.5;
      };
      el.addEventListener('loadedmetadata', seek, { once: true });
    }
    quiet(el.play());
  }

  /** A player's sound has arrived: fade it in. */
  private heard(p: Player): void {
    if (!p.track) return;
    this.fails = 0;
    const bus = this.bus();
    if (!p.lead || !p.rise || !bus) return;
    const g = p.gain.gain;
    const now = bus.ctx.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0, now);
    g.linearRampToValueAtTime(trackGain(p.track), now + p.rise);
    p.rise = 0;
  }

  /** Fade a player out, then stop its stream. */
  private fade(p: Player, seconds: number): void {
    p.lead = false;
    p.rise = 0;
    const bus = this.bus();
    if (bus) {
      const g = p.gain.gain;
      const now = bus.ctx.currentTime;
      g.cancelScheduledValues(now);
      g.setValueAtTime(g.value, now);
      g.linearRampToValueAtTime(0, now + seconds);
    }
    clearTimeout(p.stop);
    p.stop = setTimeout(() => {
      p.el.pause();
      p.track = null;
    }, seconds * 1000 + 300) as unknown as number;
  }

  /** A track nears its end: the place's other track comes in under its tail. */
  private near(p: Player): void {
    if (!p.lead || !p.track || !this.place || !this.on) return;
    const left = p.el.duration - p.el.currentTime;
    if (Number.isFinite(left) && left <= MUSIC_OVERLAP) this.start(nextTrack(this.place, p.track, this.rand), MUSIC_OVERLAP, false);
  }

  /** A track ran out, or could not be fetched, while still the one heard. */
  private ended(p: Player, failed: boolean): void {
    if (!p.lead || !p.track) return;
    const track = p.track;
    p.lead = false;
    p.track = null;
    p.rise = 0;
    const place = this.place;
    if (!failed) {
      // Its end came before the next was brought in (a throttled tab): move on rather than fall silent.
      if (place) this.start(nextTrack(place, track, this.rand), 1.5, false);
      return;
    }
    // The file is not to be had (offline, or a single-file copy of the game). Try again in a while, then let it be.
    this.place = null;
    this.fails++;
    if (this.fails < MUSIC_TRIES) setTimeout(() => this.aim(), 15_000 * this.fails);
  }
}
