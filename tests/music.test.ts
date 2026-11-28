import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MUSIC_CHANGE, MUSIC_LUFS, MUSIC_OVERLAP, MUSIC_SETTLE, MUSIC_TRACKS, MUSIC_TRIES, Music, nextTrack, placeForDepth, trackGain } from '../src/audio/music';

// The files as they sit in the game's public folder (named, never loaded).
const FILES = Object.keys(import.meta.glob('/public/music/*.mp3')).map((f) => f.split('/').pop());

describe('the music beds', () => {
  it('has two tracks for each place, and every file is in the game', () => {
    for (const place of ['surface', 'middepths', 'abyss', 'seance'] as const) {
      expect(MUSIC_TRACKS.filter((t) => t.place === place)).toHaveLength(2);
    }
    expect([...FILES].sort()).toEqual(MUSIC_TRACKS.map((t) => t.file).sort());
  });

  it('brings every track to the same loudness, under its own', () => {
    for (const t of MUSIC_TRACKS) {
      const g = trackGain(t);
      expect(g).toBeGreaterThan(0.3);
      expect(g).toBeLessThan(1);
      expect(t.lufs + 20 * Math.log10(g)).toBeCloseTo(MUSIC_LUFS, 6);
    }
  });

  it('chooses the bed by depth', () => {
    expect(placeForDepth(-32)).toBe('surface');
    expect(placeForDepth(0)).toBe('surface');
    expect(placeForDepth(599)).toBe('surface');
    expect(placeForDepth(600)).toBe('middepths');
    expect(placeForDepth(2999)).toBe('middepths');
    expect(placeForDepth(3000)).toBe('abyss');
    expect(placeForDepth(7000)).toBe('abyss');
    expect(placeForDepth(NaN)).toBe('surface');
  });

  it('does not flicker between two beds at a boundary', () => {
    expect(placeForDepth(580, 'middepths')).toBe('middepths');
    expect(placeForDepth(449, 'middepths')).toBe('surface');
    expect(placeForDepth(2900, 'abyss')).toBe('abyss');
    expect(placeForDepth(2849, 'abyss')).toBe('middepths');
    expect(placeForDepth(500, 'abyss')).toBe('surface');
    expect(placeForDepth(600, 'surface')).toBe('middepths');
  });

  it('takes the two tracks of a place in turn', () => {
    const [a, b] = MUSIC_TRACKS.filter((t) => t.place === 'abyss');
    expect(nextTrack('abyss', a)).toBe(b);
    expect(nextTrack('abyss', b)).toBe(a);
    expect(nextTrack('abyss', null, () => 0)).toBe(a);
    expect(nextTrack('abyss', null, () => 0.99)).toBe(b);
    // A track of another place says nothing about this one.
    expect(nextTrack('abyss', MUSIC_TRACKS[0], () => 0.99)).toBe(b);
  });
});

// ---------------------------------------------------------------- the player

type Listener = () => void;

class FakeAudio {
  static made: FakeAudio[] = [];
  src = '';
  preload = '';
  loop = false;
  paused = true;
  ended = false;
  currentTime = 0;
  duration = NaN;
  error: unknown = null;
  plays = 0;
  private on = new Map<string, { fn: Listener; once: boolean }[]>();
  constructor() {
    FakeAudio.made.push(this);
  }
  addEventListener(type: string, fn: Listener, opts?: { once?: boolean }) {
    const list = this.on.get(type) ?? [];
    list.push({ fn, once: !!opts?.once });
    this.on.set(type, list);
  }
  emit(type: string) {
    const list = this.on.get(type) ?? [];
    this.on.set(
      type,
      list.filter((l) => !l.once),
    );
    for (const l of list) l.fn();
  }
  play() {
    this.plays++;
    this.paused = false;
    this.ended = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  /** The file's name, as the game asked for it. */
  get file() {
    return this.src.split('/').pop() ?? '';
  }
  /** The stream arrives: its length is known, and it is heard. */
  arrive(duration = 120) {
    this.duration = duration;
    this.emit('loadedmetadata');
    this.emit('playing');
  }
}

class FakeParam {
  value = 0;
  target: number | null = null;
  over = 0;
  cancelScheduledValues() {}
  setValueAtTime(v: number) {
    this.value = v;
    this.target = null;
  }
  linearRampToValueAtTime(v: number, at: number) {
    this.target = v;
    this.over = at;
  }
}

function rig(rand: () => number = () => 0) {
  FakeAudio.made = [];
  const params: FakeParam[] = [];
  const node = { connect: (n: unknown) => n };
  const ctx = {
    currentTime: 0,
    createGain: () => {
      const gain = new FakeParam();
      params.push(gain);
      return { gain, connect: (n: unknown) => n };
    },
    createMediaElementSource: () => node,
  };
  let live = true;
  const music = new Music(() => (live ? { ctx: ctx as unknown as AudioContext, input: node as unknown as AudioNode } : null), 'https://example.test/game/', rand);
  return {
    music,
    params,
    els: () => FakeAudio.made,
    /** The player that holds a file, if one does. */
    el: (file: string) => FakeAudio.made.find((e) => e.file === file),
    silent: () => (live = false),
  };
}

describe('the music player', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Audio', FakeAudio);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('stays silent until sound has started and someone has tapped', () => {
    const r = rig();
    r.silent();
    r.music.unlock();
    expect(r.els()).toHaveLength(0);
    expect(r.music.playing).toBeNull();
  });

  it('begins the surface bed on the first tap, from beside the page, part way in', () => {
    const r = rig(() => 0.5);
    r.music.setDepth(-32);
    r.music.unlock();
    expect(r.els()).toHaveLength(2);
    expect(r.music.playing).toBe('surface-b.mp3');
    const el = r.el('surface-b.mp3')!;
    expect(el.src).toBe('https://example.test/game/music/surface-b.mp3');
    expect(el.paused).toBe(false);
    // Silent until the stream arrives, then faded in to the track's own level.
    expect(r.params[0].target).toBeNull();
    el.arrive(120);
    expect(el.currentTime).toBeCloseTo(30, 6);
    expect(r.params[0].target).toBeCloseTo(trackGain(MUSIC_TRACKS[1]), 6);
    expect(r.params[0].over).toBe(MUSIC_CHANGE);
    // A second tap makes nothing new.
    r.music.unlock();
    expect(r.els()).toHaveLength(2);
  });

  it('brings the other track in under the tail of the first, and so on in turn', () => {
    const r = rig();
    r.music.unlock();
    const a = r.el('surface-a.mp3')!;
    a.arrive(120);
    a.currentTime = 100;
    a.emit('timeupdate');
    expect(r.music.playing).toBe('surface-a.mp3');
    a.currentTime = 120 - MUSIC_OVERLAP + 0.1;
    a.emit('timeupdate');
    expect(r.music.playing).toBe('surface-b.mp3');
    const b = r.el('surface-b.mp3')!;
    b.arrive(120);
    // From the top this time, over the length of the overlap; the first fades out and is then stopped.
    expect(b.currentTime).toBe(0);
    expect(r.params[1].over).toBe(MUSIC_OVERLAP);
    expect(r.params[0].target).toBe(0);
    expect(a.paused).toBe(false);
    vi.advanceTimersByTime(MUSIC_OVERLAP * 1000 + 400);
    expect(a.paused).toBe(true);
    b.currentTime = 119;
    b.emit('timeupdate');
    expect(r.music.playing).toBe('surface-a.mp3');
  });

  it('changes bed when the dive settles in a new zone, not while passing through', () => {
    const r = rig();
    r.music.unlock();
    r.el('surface-a.mp3')!.arrive();
    r.music.setDepth(900);
    expect(r.music.playing).toBe('surface-a.mp3');
    vi.advanceTimersByTime(MUSIC_SETTLE * 1000 - 100);
    // Still sinking: through the mid-depths and on into the abyss.
    r.music.setDepth(3400);
    vi.advanceTimersByTime(MUSIC_SETTLE * 1000 - 100);
    expect(r.music.playing).toBe('surface-a.mp3');
    vi.advanceTimersByTime(200);
    expect(r.music.playing).toBe('abyss-a.mp3');
    expect(r.els().some((e) => e.file.startsWith('middepths'))).toBe(false);
    // A dip across a boundary and straight back changes nothing.
    r.music.setDepth(500);
    r.music.setDepth(3400);
    vi.advanceTimersByTime(5000);
    expect(r.music.playing).toBe('abyss-a.mp3');
  });

  it('plays the séance its own beds, and gives the dive its bed back afterwards', () => {
    const r = rig();
    r.music.unlock();
    r.music.setScene('seance');
    expect(r.music.playing).toBe('seance-a.mp3');
    r.music.setDepth(5000);
    vi.advanceTimersByTime(5000);
    expect(r.music.playing).toBe('seance-a.mp3');
    r.music.setScene('dive');
    expect(r.music.playing).toBe('abyss-a.mp3');
    // Back at the séance later, the other of its two is heard.
    r.music.setScene('seance');
    expect(r.music.playing).toBe('seance-b.mp3');
  });

  it('stops with the sound switch and picks up where it left off', () => {
    const r = rig();
    r.music.unlock();
    const a = r.el('surface-a.mp3')!;
    a.arrive();
    r.music.setOn(false);
    expect(a.paused).toBe(true);
    vi.advanceTimersByTime(60_000);
    r.music.setOn(true);
    expect(a.paused).toBe(false);
    expect(r.music.playing).toBe('surface-a.mp3');
    expect(r.els().filter((e) => e.file.endsWith('.mp3'))).toHaveLength(1);
  });

  it('never starts while sound is off, and starts on the tap that turns it on', () => {
    const r = rig();
    r.music.setOn(false);
    r.music.unlock();
    expect(r.els()).toHaveLength(0);
    r.music.setOn(true);
    r.music.unlock();
    expect(r.music.playing).toBe('surface-a.mp3');
  });

  it('fades out when the music switch is turned off, and returns when it is turned on', () => {
    const r = rig();
    r.music.unlock();
    const a = r.el('surface-a.mp3')!;
    a.arrive();
    r.music.setEnabled(false);
    expect(r.music.playing).toBeNull();
    expect(r.params[0].target).toBe(0);
    vi.advanceTimersByTime(MUSIC_CHANGE * 1000 + 400);
    expect(a.paused).toBe(true);
    r.music.setEnabled(true);
    expect(r.music.playing).toBe('surface-b.mp3');
  });

  it('tries a missing track a few times, then lets the game go on without music', () => {
    const r = rig();
    r.music.unlock();
    for (let i = 1; i <= MUSIC_TRIES; i++) {
      const el = r.els().find((e) => e.file.startsWith('surface') && !e.error)!;
      expect(el, `try ${i}`).toBeTruthy();
      el.error = { code: 4 };
      el.emit('error');
      expect(r.music.playing).toBeNull();
      el.error = null;
      el.src = '';
      vi.advanceTimersByTime(60_000);
    }
    expect(r.music.playing).toBeNull();
    // Switching the music off and on again is a fresh start.
    r.music.setEnabled(false);
    r.music.setEnabled(true);
    expect(r.music.playing).not.toBeNull();
  });

  it('moves on if a track runs out before the next was brought in', () => {
    const r = rig();
    r.music.unlock();
    const a = r.el('surface-a.mp3')!;
    a.arrive();
    a.ended = true;
    a.paused = true;
    a.emit('ended');
    expect(r.music.playing).toBe('surface-b.mp3');
  });
});
