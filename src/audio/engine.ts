// Generative sound for the descent. Everything is synthesised in the browser
// with Web Audio: there are no audio files.
//
// Direction: docs/art/07 (motion and sound). Dread is a held note: a slow,
// quiet bed on D that changes with depth, very few events on top, nothing
// that jumps. The harmony darkens interval by interval as you sink, the bed
// grows muffled, and below 4,000 m it drifts flat of the interface sounds,
// which stay in tune: the world and the instruments stop agreeing.
//
//   Surface   wind in the rigging, surf, water slapping the hull, gulls far off, a bell buoy on A
//   Shallows  the same surf muffled overhead, bubbles                              D A
//   Gloaming  a low hum, an unanswered sonar ping, the hull creaking                D F A
//   Stygian   a low choir singing "oo", the clicks of small things that hunt        D Ab F
//   Abyss     the choir far off in semitone clusters, stone settling, bowed metal   D Eb A Bb
//   Dreaming  something breathing on the 7 s cycle, a heart that is not yours       D F Ab C
//   Floor     two seconds of nothing, then the heart; the Eye opens it all          D F# A Bb
//
// Each zone is a layer that crossfades over 200 m around its boundaries and
// exists only while it can be heard. Events are short voices that disconnect
// themselves when their last source has ended. Timing runs on the audio clock
// through a short look-ahead pump, so nothing piles up while the context is
// suspended, and an OfflineAudioContext can render the whole thing for
// measurement (tests/audio-levels.cjs).
//
// Routing
//   bed layers and bed events -> bed low-pass (by depth) -> fade -> tension -> ducks -> madness throb -> bus
//   game and interface sounds -> ui (no depth filter, always in tune) ------------------------------> bus
//   reverb sends -> short reverb / long reverb, crossfaded by depth ------------------------------> bus
//   bus -> high-pass 24 Hz -> compressor (peaks only) -> soft ceiling at -1.3 dBFS -> volume -> out

type Tier = number;

/** Options for start(). The game passes none; offline renders and tests pass a context. */
export interface SoundOptions {
  /** Render into this context instead of opening a realtime one (an OfflineAudioContext for measurement). */
  context?: BaseAudioContext;
  /** Seed for every random choice, so a render can be repeated exactly. */
  seed?: number;
  /** false leaves the ambient bed out, to measure event sounds on their own. */
  ambience?: boolean;
}

// ------------------------------------------------------------------ shapes and tuning

const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Smoothstep from a to b; b < a gives a falling edge. */
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** Rises over a..b, holds, falls over c..d. */
const band = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
/** Interpolates frequencies (or any ratio) on a log scale. */
const glideHz = (a: number, b: number, t: number) => a * Math.pow(b / a, clamp01(t));
const dB = (db: number) => Math.pow(10, db / 20);

/** -80 dB: where exponential fades end before a source stops. */
const SILENT = 1e-4;
/** The idle breath of the whole game, in seconds. */
const CYCLE = 7;
/** How far ahead the pump schedules, in seconds. */
const LOOK = 0.3;
/** Ambient and minor voices are skipped above this many live voices. */
const VOICE_CAP = 48;
/** No new event at all above this many (the game never gets near it). */
const HARD_CAP = 96;
/**
 * iOS (Safari 17+): 'ambient' respects the ringer switch and mixes with the
 * player's own music, as the art direction asks ("respect the silent switch")
 * and as the settings screen tells players. 'playback' would play through the
 * switch like a video and pause their music.
 */
const IOS_SESSION: 'ambient' | 'playback' = 'ambient';

type Curve = ReadonlyArray<readonly [number, number]>;

/** Piecewise interpolation along [depth, value] points; on a log scale for frequencies. */
function along(c: Curve, d: number, log = false): number {
  if (d <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    const [d1, v1] = c[i];
    if (d <= d1) {
      const [d0, v0] = c[i - 1];
      const t = (d - d0) / (d1 - d0);
      return log ? v0 * Math.pow(v1 / v0, t) : v0 + (v1 - v0) * t;
    }
  }
  return c[c.length - 1][1];
}

// Depth controls from the sound brief, interpolated between the points.
const BED_LOWPASS: Curve = [[-60, 15000], [0, 12000], [200, 4000], [1000, 1600], [4000, 800], [6500, 500]];
const DRONE_DB: Curve = [[0, -30], [200, -26], [1000, -20], [4000, -15.5], [6500, -15], [7000, -13.5]];
const BED_CENTS: Curve = [[4000, 0], [6500, -35], [7000, -50]];
/** Share of the reverb sent to the long tail (the short one gets the rest). */
const LONG_SHARE: Curve = [[0, 0], [200, 0.15], [1000, 0.45], [4000, 0.85], [6500, 1]];
const WETNESS: Curve = [[-60, 0.55], [0, 0.7], [1000, 1], [4000, 1.2], [7000, 1.35]];

type Vowel = readonly [number, number, number];
/** Formants of a low male voice. */
const VOWEL = {
  mm: [260, 650, 2300],
  oo: [300, 870, 2240],
  oh: [480, 820, 2500],
  ah: [730, 1090, 2440],
} as const satisfies Record<string, Vowel>;

/** Each zone's harmony over the drone on D (MIDI notes). */
const CHORD = {
  shallows: [57, 69], // A3 A4: the open fifth, light coming down through the water
  gloaming: [50, 53, 57], // D F A: the minor third enters
  stygian: [38, 44, 50, 53], // D Ab D F: the tritone under the third
  abyss: [50, 51, 57, 58], // D Eb A Bb: clusters a semitone apart
  dreaming: [50, 53, 56, 60], // D F Ab C: a chord that never resolves
  floor: [50, 54, 57, 58], // D F# A Bb: the first consonance, with one wrong note
  bloom: [38, 50, 54, 57, 58, 62, 66],
} as const;

/** [ratio to the prime, amplitude, share of the decay] */
type Partials = ReadonlyArray<readonly [number, number, number]>;
/** A cast bell, in tune. */
const BELL: Partials = [[0.5, 0.35, 1], [1, 1, 0.8], [1.183, 0.45, 0.5], [1.5, 0.3, 0.42], [2, 0.42, 0.32], [2.66, 0.16, 0.2], [3.01, 0.1, 0.15]];
/** The bell buoy: the same shape with slightly wrong partials. */
const BUOY: Partials = [[0.5, 0.3, 1], [1, 1, 0.8], [1.21, 0.42, 0.46], [1.53, 0.3, 0.4], [2.03, 0.55, 0.3], [2.79, 0.3, 0.18], [3.4, 0.15, 0.12]];
const GONG: Partials = [
  [1, 1, 1],
  [1.47, 0.6, 0.85],
  [2.09, 0.5, 0.7],
  [2.56, 0.32, 0.55],
  [3.18, 0.28, 0.45],
  [3.93, 0.24, 0.38],
  [4.6, 0.2, 0.32],
  [5.43, 0.16, 0.26],
  [6.71, 0.12, 0.2],
  [8.12, 0.08, 0.15],
];

/** A damped mode: [frequency, amplitude, decay time constant in seconds]. */
type Mode = readonly [number, number, number];
interface Strike {
  at: number;
  gain?: number;
  modes: readonly Mode[];
  noise?: number;
  noiseTau?: number;
}

const LAYERS = ['drone', 'surface', 'gloaming', 'stygian', 'abyss', 'dreaming', 'floor'] as const;
type LayerName = (typeof LAYERS)[number];
/** A zone's layer crossfades over 200 m around each of its boundaries. */
const zone = (lo: number, hi: number, d: number) => smooth(lo - 100, lo + 100, d) * (1 - smooth(hi - 100, hi + 100, d));
/** The camera rests 40 m below the score, so a score of 7,000 m puts it at 7,040: the floor is complete there. */
const floorIn = (d: number) => smooth(6860, 7040, d);
const PRESENCE: Record<LayerName, (d: number) => number> = {
  drone: () => 1,
  surface: (d) => 1 - smooth(100, 300, d),
  gloaming: (d) => zone(200, 1000, d),
  stygian: (d) => zone(1000, 4000, d),
  abyss: (d) => zone(4000, 6000, d),
  dreaming: (d) => smooth(5900, 6100, d) * (1 - floorIn(d)),
  floor: floorIn,
};
/** Calibration of each layer (measured offline, see tests/audio-levels.cjs). */
const LEVEL: Record<LayerName, number> = {
  drone: 0.42,
  surface: 2.1,
  gloaming: 0.8,
  stygian: 0.6,
  abyss: 0.6,
  dreaming: 1,
  floor: 0.96,
};

interface Layer {
  kit: Kit;
  /** The layer's level into the bed, and into its reverb: both follow presence. */
  out: GainNode;
  wet: GainNode;
  quietSince: number;
  /** Re-aim this layer's own parameters at a depth. */
  depth?: (d: number, tc: number) => void;
  /** Schedule this layer's own automation up to `horizon` (audio time). */
  tick?: (now: number, horizon: number) => void;
}

interface Spot {
  next: number;
  interval: () => number;
  fire: (t: number) => void;
}

/**
 * Pitch, filter and pan movements here are slow, so they are computed once
 * per 128-sample block instead of per sample: a modulated biquad otherwise
 * recomputes its coefficients 48,000 times a second.
 */
function krate(...params: AudioParam[]) {
  for (const p of params) {
    try {
      p.automationRate = 'k-rate';
    } catch {
      /* fixed rate, or an older browser */
    }
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Unity below the knee, then a tanh shoulder to a hard ceiling of -1.3 dBFS. */
function softCeiling(): Float32Array<ArrayBuffer> {
  const n = 4097;
  const knee = 0.7;
  const room = dB(-1.2) - knee;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    c[i] = Math.sign(x) * (ax <= knee ? ax : knee + room * Math.tanh((ax - knee) / room));
  }
  return c;
}

/** Collects the nodes of one voice or one layer, so they stop and disconnect together. */
class Kit {
  private readonly ctx: BaseAudioContext;
  private readonly rand: () => number;
  private readonly onDone: (() => void) | undefined;
  private nodes: AudioNode[] = [];
  private sources: AudioScheduledSourceNode[] = [];
  private links: Array<[AudioNode, AudioNode]> = [];
  private disposed = false;

  constructor(ctx: BaseAudioContext, rand: () => number, onDone?: () => void) {
    this.ctx = ctx;
    this.rand = rand;
    this.onDone = onDone;
  }

  gain(v = 1): GainNode {
    const g = this.ctx.createGain();
    g.gain.value = v;
    this.nodes.push(g);
    return g;
  }

  filter(type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    krate(f.frequency, f.detune, f.Q, f.gain);
    this.nodes.push(f);
    return f;
  }

  pan(x: number): StereoPannerNode | GainNode {
    if (typeof this.ctx.createStereoPanner !== 'function') return this.gain(1);
    const p = this.ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, x));
    krate(p.pan);
    this.nodes.push(p);
    return p;
  }

  merger(): ChannelMergerNode {
    const m = this.ctx.createChannelMerger(2);
    this.nodes.push(m);
    return m;
  }

  /** An oscillator; `fast` keeps per-sample pitch for chirps shorter than a tenth of a second. */
  osc(type: OscillatorType, freq: number, start: number, stop?: number, detune = 0, fast = false): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    if (!fast) krate(o.frequency, o.detune);
    this.add(o, start, stop);
    return o;
  }

  /** A noise loop (or a one-shot slice of it) from a random point in the buffer. */
  noise(buf: AudioBuffer, start: number, stop?: number, rate = 1, loop = true): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    s.playbackRate.value = rate;
    this.nodes.push(s);
    this.sources.push(s);
    s.start(start, this.rand() * buf.duration * (loop ? 1 : 0.5));
    if (stop !== undefined) s.stop(stop);
    return s;
  }

  /** A short rendered sound, played once. */
  buffer(buf: AudioBuffer, start: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.playbackRate.value = rate;
    this.add(s, start);
    return s;
  }

  lfo(freq: number, depth: number, target: AudioParam, start: number, stop?: number): OscillatorNode {
    const o = this.osc('sine', freq, start, stop);
    const g = this.gain(depth);
    o.connect(g).connect(target);
    return o;
  }

  /** Feed a shared node into this kit; the link is cut when the kit is done. */
  link(from: AudioNode, to: AudioNode) {
    from.connect(to);
    this.links.push([from, to]);
  }

  /** Stop every source at t (layers run until they have faded out). */
  stop(t: number) {
    for (const s of this.sources) {
      try {
        s.stop(t);
      } catch {
        /* never started */
      }
    }
  }

  /** Disconnect everything once every source has ended. */
  release() {
    let left = this.sources.length;
    if (!left) {
      this.dispose();
      return;
    }
    const ended = () => {
      if (--left === 0) this.dispose();
    };
    for (const s of this.sources) s.onended = ended;
  }

  private add(s: AudioScheduledSourceNode, start: number, stop?: number) {
    this.nodes.push(s);
    this.sources.push(s);
    s.start(start);
    if (stop !== undefined) s.stop(stop);
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const n of this.nodes) n.disconnect();
    for (const [from, to] of this.links) {
      try {
        from.disconnect(to);
      } catch {
        /* already cut */
      }
    }
    this.onDone?.();
  }
}

export class Sound {
  /** The audio context, once start() has opened one. */
  ctx: BaseAudioContext | null = null;

  private realtime = false;
  private started = false;
  private built = false;
  private ambienceOn = true;
  private rand: () => number = Math.random;

  // the mix
  private master!: GainNode;
  private ui!: GainNode;
  private bed!: GainNode;
  private bedWet!: GainNode;
  private bedTone!: BiquadFilterNode;
  private wetTone!: BiquadFilterNode;
  private bedFade!: GainNode;
  private wetFade!: GainNode;
  private tense!: GainNode;
  private duckGain!: GainNode;
  private wetDuck!: GainNode;
  private throb!: GainNode;
  private throbDepth!: GainNode;
  private verb!: GainNode;
  private nearIn!: GainNode;
  private farIn!: GainNode;
  private tune!: AudioNode;
  private tuneParam: AudioParam | null = null;
  private warpA!: GainNode;
  private warpB!: GainNode;

  // material
  private brown!: AudioBuffer;
  private pink!: AudioBuffer;
  private clicks!: AudioBuffer;
  private keyBufs: AudioBuffer[] = [];
  private spaceBuf!: AudioBuffer;
  private backBuf!: AudioBuffer;
  private clickBuf!: AudioBuffer;
  private dialBuf!: AudioBuffer;
  private clunkBuf!: AudioBuffer;
  private carriageBuf!: AudioBuffer;
  private knockBuf!: AudioBuffer;

  private layers = new Map<LayerName, Layer>();
  private spots: Spot[] = [];
  private targets = new WeakMap<AudioParam, number>();

  // state
  private depth = -32;
  private appliedDepth = Number.NaN;
  private appliedAt = -1;
  private lastDepthAt = 0;
  private madness = 0;
  private tension = 0;
  private muted = false;
  private hidden = false;
  private volume = 0.8;
  private voices = 0;
  private cycle0 = 0;
  private beatAt = 0;
  private pulseAt = 0;
  private hushUntil = 0;
  private duckEnd = 0;
  private duckDepth = 0;
  private eyeUntil = 0;
  private eyeFloor = false;
  private lastPump = -1;
  private lastKey = -1;
  private lastTick = -1;
  private lastDial = -1;
  private dialMark = -1;
  private lastRefuse = -1;
  private lastCreak = -9;
  private lastUnspeakable = -99;
  private lastAccept = -99;
  private lastTier = 1;
  private buoyPan = -0.35;
  private wokeAt = -1e9;
  private fadeIn = 0.08;
  private sleepTimer = 0;

  get running(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  /** Event voices still sounding (for tests and measurement). */
  get activeVoices(): number {
    return this.voices;
  }

  /** Ambient layers currently built (for tests and measurement). */
  get activeLayers(): string[] {
    return [...this.layers.keys()];
  }

  /**
   * Call from a user gesture (tap, click, key). The first call opens the
   * context and fades the bed in over 3 s; later calls make sure a context
   * that iOS has suspended comes back.
   */
  async start(opts: SoundOptions = {}): Promise<void> {
    if (this.started) {
      await this.wake();
      return;
    }
    let ctx: BaseAudioContext;
    if (opts.context) {
      ctx = opts.context;
    } else {
      const w = typeof window === 'undefined' ? undefined : (window as typeof window & { webkitAudioContext?: typeof AudioContext });
      const AC = w ? (w.AudioContext ?? w.webkitAudioContext) : undefined;
      if (!AC) return;
      try {
        ctx = new AC({ latencyHint: 'balanced' });
      } catch {
        return;
      }
      this.realtime = true;
    }
    this.ctx = ctx;
    this.started = true;
    this.rand = mulberry32(opts.seed ?? Math.floor(Math.random() * 0x100000000));
    this.ambienceOn = opts.ambience !== false;
    // iOS only lets a context start inside the gesture that called start(), so resume before any await.
    const woken = this.wake();
    this.build();
    if (this.realtime) {
      window.setInterval(() => this.pump(), 120);
      // If iOS suspends or interrupts the context later, the next touch brings it back.
      const unlock = () => {
        if (this.ctx?.state !== 'running') void this.wake();
      };
      for (const type of ['touchend', 'pointerup', 'click', 'keydown']) window.addEventListener(type, unlock, { capture: true, passive: true });
      ctx.onstatechange = () => this.catchUp();
      if (this.muted || this.hidden) this.sleepSoon();
    }
    await woken;
  }

  /** Muting fades out and then suspends the context, so a muted game costs nothing. */
  setMuted(m: boolean) {
    this.muted = !!m;
    this.fadeIn = 0.08;
    if (this.built) this.changed();
  }

  setVolume(v: number) {
    this.volume = clamp01(Number.isFinite(v) ? v : 0.8);
    if (this.built) this.fadeMaster();
  }

  /** The tab is hidden: fade out and pause. */
  suspend() {
    this.hidden = true;
    if (this.built) this.changed();
  }

  /** The tab is back: resume and fade in over a second. */
  resume() {
    this.hidden = false;
    this.fadeIn = 0.33;
    if (this.built) this.changed();
  }

  /** Call every frame with the camera depth in metres. */
  setDepth(m: number) {
    if (!Number.isFinite(m)) return;
    const prev = this.depth;
    this.depth = m;
    if (!this.built || !this.live()) return;
    const ctx = this.ctx!;
    const now = ctx.currentTime;
    const dt = now - this.lastDepthAt;
    this.lastDepthAt = now;
    if ((prev < 0) !== (m < 0)) {
      if (m >= 0) this.splash(now + 0.01);
      else this.breach(now + 0.01);
      this.applyDepth(0.06);
    } else if (Math.abs(m - this.appliedDepth) >= 4 && now - this.appliedAt >= 0.05) {
      this.applyDepth();
    }
    if (prev < 7000 && m >= 7000) {
      this.hush(now);
      // the Eye opened on the way down: it blooms once the floor has fallen silent
      if (now < this.eyeUntil) this.floorEye(this.hushUntil + 0.8);
    }
    if (m < 6800) this.eyeFloor = false;
    // a brass dial ticks off each new 100 m mark on the way down, with a deeper clunk at each 1,000 m;
    // a mark ticks again only once the camera has risen 50 m above it
    const mark = Math.floor(m / 100);
    if (mark > this.dialMark) {
      if (m > prev && prev >= 0 && now - this.lastDial > 0.045) {
        this.lastDial = now;
        this.dial(now + 0.005, Math.floor(mark / 10) > Math.floor(this.dialMark / 10));
      }
      this.dialMark = mark;
    } else if (m < this.dialMark * 100 - 50) {
      this.dialMark = mark;
    }
    // the hull complains when the pressure changes quickly
    if (dt > 0 && dt < 0.25 && m > 150 && Math.abs(m - prev) / dt > 90 && now - this.lastCreak > 1.3) {
      const deep = smooth(200, 6000, m);
      if (this.rand() < (0.15 + 0.45 * deep) * dt) {
        this.lastCreak = now;
        this.creakAt(now + 0.03, 0.55 + 0.45 * deep);
      }
    }
    if (now - this.lastPump > 0.08) this.pump();
  }

  /** 0..1 from sanity: detunes the bed, makes it throb, lets the whispers in. */
  setMadness(m: number) {
    const v = clamp01(Number.isFinite(m) ? m : 0);
    if (Math.abs(v - this.madness) < 0.004) return;
    this.madness = v;
    if (this.built && this.live()) this.applyMadness();
  }

  /** 0..1 over the last seconds of air: your heart, and the world narrowing. */
  setTension(x: number) {
    const v = clamp01(Number.isFinite(x) ? x : 0);
    if (Math.abs(v - this.tension) < 0.01 && (v > 0 || this.tension === 0)) return;
    this.tension = v;
    if (!this.built || !this.live()) return;
    this.applyTension();
    if (v > 0.01 && this.ctx!.currentTime - this.lastPump > 0.05) this.pump();
  }

  /**
   * Schedules ambience and heartbeats a little ahead on the audio clock.
   * Runs on a timer in real time; an offline render calls it as it goes.
   */
  pump() {
    const ctx = this.ctx;
    if (!ctx || !this.built || !this.live()) return;
    const now = ctx.currentTime;
    this.lastPump = now;
    const horizon = now + LOOK;
    if (this.ambienceOn) {
      for (const s of this.spots) {
        while (s.next < now - 0.05) s.next += s.interval();
        while (s.next < horizon) {
          const at = s.next;
          s.next += s.interval();
          if (this.voices < VOICE_CAP) s.fire(at);
        }
      }
      for (const [name, L] of this.layers) {
        if (L.quietSince >= 0 && now - L.quietSince > 6) {
          L.kit.stop(now + 0.05);
          L.kit.release();
          this.layers.delete(name);
          continue;
        }
        L.tick?.(now, horizon);
      }
      this.pulse(now, horizon);
    }
    this.heartbeat(now, horizon);
  }

  // ------------------------------------------------------------ interface sounds

  /** A button. */
  click() {
    if (!this.audible()) return;
    this.play(this.clickBuf, this.at(0.004), 0.22, { rate: 0.97 + this.rand() * 0.06 });
  }

  /** A typed key: a typewriter, never twice the same. Pass 'space' or 'back' for those keys. */
  key(kind?: 'space' | 'back') {
    if (!this.audible()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastKey < 0.03 || this.voices >= VOICE_CAP) return;
    this.lastKey = now;
    const buf = kind === 'space' ? this.spaceBuf : kind === 'back' ? this.backBuf : this.keyBufs[Math.floor(this.rand() * this.keyBufs.length)];
    this.play(buf, this.at(0.004), kind === 'space' ? 0.27 : 0.23, { rate: 0.97 + this.rand() * 0.06, pan: (this.rand() - 0.5) * 0.3 });
  }

  /** The last seconds of air; urgent for the final three. */
  tick(urgent: boolean) {
    if (!this.audible()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastTick < 0.2) return;
    this.lastTick = now;
    const t = this.at(0.004);
    this.play(this.dialBuf, t, urgent ? 0.26 : 0.2, { rate: urgent ? 1.12 : 0.86, wet: 0.08 });
    if (urgent) this.play(this.clunkBuf, t, 0.1, { rate: 0.8 });
  }

  /**
   * A true answer. The carriage returns, the bed holds its breath, then the
   * answer is heard: rarer answers are not louder so much as stranger.
   * 1 a knock on the hull   2 a soft bell on A   3 and the choir on D and A
   * 4 and the minor third, a shimmer   5 and the tritone, a low swell
   * 6 the full choir, gliding toward a chord it never reaches, and a breath
   */
  accept(tier: Tier) {
    if (!this.audible()) return;
    const n = Math.max(1, Math.min(6, Math.round(Number(tier)) || 1));
    const t0 = this.at(0.008);
    this.lastAccept = this.ctx!.currentTime;
    this.lastTier = n;
    this.carriage(t0);
    // the rarer the answer, the longer the deep holds its breath under it
    this.duck(t0, [3, 3, 3, 3.5, 4.5, 7][n - 1], [0.45, 0.45, 0.6, 0.9, 1.4, 4.5][n - 1], [0.25, 0.25, 0.35, 0.5, 0.8, 1.6][n - 1]);
    const t = t0 + 0.32;
    if (n === 1) {
      // knock, knock
      const rate = 0.96 + this.rand() * 0.08;
      this.play(this.knockBuf, t, 0.4, { rate, wet: 0.35 });
      this.play(this.knockBuf, t + 0.19, 0.27, { rate: rate * 0.97, wet: 0.35 });
      return;
    }
    // the bell on A; under the Unspeakable it is only the first sound of the choir
    this.bell(t, NOTE(69), n === 6 ? 0.14 : 0.15 + 0.014 * (n - 2), 2.6 + 0.5 * n, BELL, { wet: 0.5 + 0.08 * n, bloom: 0.004 });
    if (n === 3) this.chord(t + 0.1, [50, 57], 0.11, 3.4, { vowel: VOWEL.oo, wet: 0.7 });
    if (n === 4) this.chord(t + 0.1, [50, 53, 57], 0.12, 4, { vowel: VOWEL.oo, wet: 0.8 });
    if (n === 5) this.chord(t + 0.1, [44, 50, 53, 57], 0.12, 4.6, { vowel: VOWEL.oh, wet: 0.9 });
    if (n >= 4) this.shimmer(t + 0.5, 0.02 + 0.004 * (n - 4), 4 + n * 0.4);
    if (n >= 5) this.lowSwell(t, 0.1 + 0.02 * (n - 5), 3.5 + (n - 5) * 1.5);
    if (n === 6) {
      this.lastUnspeakable = t0;
      this.chord(t + 0.05, [38, 50, 53, 56, 60, 65], 0.34, 8.5, {
        vowel: VOWEL.ah,
        attack: 1.4,
        toward: [38, 50, 54, 57, 58, 66],
        glide: 4.5,
        wet: 1.1,
      });
      this.breathe(t + 0.2, 0.1, 6, this.ui);
      this.whisperAt(t + 2.6, 0.22);
    }
  }

  /** A wrong answer: a muffled low cluster on a felted piano and a groan from the hull. Never a buzzer. */
  refuse() {
    if (!this.audible()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastRefuse < 0.12) return;
    this.lastRefuse = now;
    const t0 = this.at(0.008);
    this.carriage(t0, 0.6);
    const t = t0 + 0.14;
    const k = this.voice();
    const felt = k.filter('lowpass', 1100, 0.6);
    felt.frequency.setValueAtTime(1100, t);
    felt.frequency.exponentialRampToValueAtTime(240, t + 0.9);
    const g = k.gain(0);
    this.pluck(g.gain, t, 0.01, 0.12, 1.2);
    felt.connect(g).connect(this.ui);
    const w = k.gain(0.35);
    g.connect(w).connect(this.verb);
    // D, Eb and E pressed with the flat of a hand, a finger at a time, and the D an octave down
    [[38, 0.5], [50, 1], [51, 0.85], [52, 0.75]].forEach(([m, a], i) => {
      const v = k.gain(0);
      const on = t + i * 0.013;
      v.gain.setValueAtTime(0, t);
      v.gain.setValueAtTime(0, on);
      v.gain.linearRampToValueAtTime(a, on + 0.006);
      v.connect(felt);
      for (const det of [-4, 5]) k.osc('sawtooth', NOTE(m), t, t + 1.35, det + (this.rand() - 0.5) * 6).connect(v);
    });
    k.release();
    this.creakAt(t + 0.05, 0.6, this.ui, 0.5);
    if (this.rand() < 0.2 + this.madness * 0.6) this.whisperAt(t + 0.3, 0.1 + this.madness * 0.12);
  }

  /** Out of air: the last breath escapes upward and the deep closes over it. */
  timeout() {
    if (!this.audible()) return;
    const t = this.at(0.01);
    this.duck(t, 5, 1.6, 0.6);
    this.bubblesAt(t, 18, 0.2, { spread: 1.4, low: 300, high: 1300 });
    this.lowSwell(t + 0.1, 0.13, 3);
    this.chord(t + 0.15, [38, 39, 45], 0.13, 3.2, { cutoff: 900, toward: [37, 38, 44], glide: 2.5, wet: 0.6 });
  }

  /** The rush of sinking, shaped like the camera's ease: loudest at the fastest point. */
  descend(ms: number, metres: number) {
    if (!this.audible()) return;
    const t = this.at(0.012);
    const dur = Math.max(0.4, (Number(ms) || 0) / 1000);
    const x = clamp01((Number(metres) || 0) / 1000);
    const mid = t + dur * 0.5;
    const end = t + dur * 1.1;
    // under the rarest answers the choir is the event: the rush stays beneath it
    const under = this.ctx!.currentTime - this.lastAccept < 0.1 && this.lastTier >= 5 ? 0.6 : 1;
    const k = this.voice();
    const m = k.merger();
    for (let side = 0; side < 2; side++) {
      const src = k.noise(this.pink, t, end + 0.05, side ? 1 : 0.92);
      const bp = k.filter('bandpass', 300, 0.8);
      bp.frequency.setValueAtTime(300, t);
      bp.frequency.linearRampToValueAtTime(1000 - side * 120, mid);
      bp.frequency.linearRampToValueAtTime(180, end);
      src.connect(bp).connect(m, 0, side);
    }
    const rush = k.gain(0);
    rush.gain.setValueAtTime(0, t);
    rush.gain.linearRampToValueAtTime((0.16 + 0.27 * x) * under, mid);
    rush.gain.linearRampToValueAtTime(0, end);
    m.connect(rush).connect(this.ui);
    const send = k.gain(0.4);
    rush.connect(send).connect(this.verb);
    // pressure building on the hull
    const low = k.noise(this.brown, t, end + 0.05);
    const lp = k.filter('lowpass', 130, 0.8);
    const pg = k.gain(0);
    pg.gain.setValueAtTime(0, t);
    pg.gain.linearRampToValueAtTime(0.15 * (0.3 + x), t + dur * 0.7);
    pg.gain.linearRampToValueAtTime(0, end);
    low.connect(lp).connect(pg).connect(this.ui);
    k.release();
    this.bubblesAt(t + 0.05, 2 + Math.round(5 * x), 0.08, { spread: dur * 0.6, low: 600, high: 1600 });
  }

  /**
   * Crossing into a new zone (and the tolling question): one deep stroke on
   * a bowed gong. At the floor the stroke is silence instead.
   */
  zone() {
    if (!this.audible()) return;
    if (this.ctx!.currentTime < this.hushUntil) return;
    this.gong(this.at(0.02), 0.11);
  }

  /** The drowned steeple's bell tolls three times: for a question asked under the bell omen. */
  toll() {
    if (!this.audible()) return;
    const t = this.at(0.02);
    const k = this.voice();
    const lp = k.filter('lowpass', 2600, 0.6);
    lp.connect(this.ui);
    lp.connect(k.gain(0.9)).connect(this.verb);
    for (let i = 0; i < 3; i++) this.strike(k, t + i * 2.4, NOTE(62) * 0.995, 0.11 * (1 - i * 0.15), 7, BELL, lp);
    k.release();
  }

  /**
   * The great Eye opens. Anywhere above the floor the deep looks up for a
   * moment: the bed is heard clearly, something inhales, a whisper. At the
   * floor the bed opens fully and the choir blooms, after the silence.
   */
  eye() {
    if (!this.audible()) return;
    const t = this.at(0.02);
    this.eyeUntil = this.ctx!.currentTime + 9;
    if (this.depth >= 6900) {
      this.floorEye(Math.max(t, this.hushUntil + 0.8));
      return;
    }
    this.applyTone(0.6);
    this.stare(t + 0.8, 7);
    // with an Unspeakable answer the choir has already breathed and whispered
    if (t - this.lastUnspeakable > 1.2) {
      this.breathe(t, 0.12, 5, this.ui);
      this.whisperAt(t + 1.6, 0.25);
    }
  }

  /** A whisper close to one ear. */
  whisper(vol = 0.3) {
    if (!this.audible()) return;
    this.whisperAt(this.at(0.02), clamp01(vol));
  }

  bubbles(n: number, vol = 0.05) {
    if (!this.audible()) return;
    this.bubblesAt(this.at(0.01), Math.max(0, Math.min(40, Math.floor(n))), clamp01(vol) * 4);
  }

  /** The bell buoy, now. */
  buoyBell() {
    if (!this.audible()) return;
    this.buoyAt(this.at(0.02), true);
  }

  /** Something very large calls, far off. */
  leviathan() {
    if (!this.audible()) return;
    this.leviathanAt(this.at(0.05), true);
  }

  /** The hull groans under the pressure. */
  creak() {
    if (!this.audible()) return;
    this.creakAt(this.at(0.02), 0.7);
  }

  /** Three small bells rising: something has been foretold. */
  omen() {
    if (!this.audible()) return;
    const t = this.at(0.02);
    [69, 72, 75].forEach((m, i) => this.bell(t + i * 0.22, NOTE(m), 0.035, 3, BELL, { pan: (i - 1) * 0.5, wet: 0.8 }));
  }

  /** Haptic tick where supported (Android); silently ignored elsewhere. */
  static buzz(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* ignore */
    }
  }

  // ------------------------------------------------------------ context

  private wake(): Promise<void> {
    const ctx = this.ctx;
    if (!this.realtime || !ctx || this.muted || this.hidden) return Promise.resolve();
    this.session(IOS_SESSION);
    this.wokeAt = performance.now();
    if (ctx.state === 'running') return Promise.resolve();
    const ac = ctx as AudioContext;
    try {
      // Older iOS also wants a buffer started inside the gesture.
      const s = ac.createBufferSource();
      s.buffer = ac.createBuffer(1, 1, ac.sampleRate);
      s.connect(ac.destination);
      s.onended = () => s.disconnect();
      s.start();
    } catch {
      /* ignore */
    }
    return ac.resume().catch(() => undefined);
  }

  /** Safari's audio session (iOS 17+); see IOS_SESSION. */
  private session(type: 'playback' | 'ambient') {
    try {
      const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (s && s.type !== type) s.type = type;
    } catch {
      /* not supported */
    }
  }

  /** Muted or visibility changed. */
  private changed() {
    if (this.muted || this.hidden) {
      if (this.muted) this.session('ambient');
      this.fadeMaster();
      this.sleepSoon();
    } else {
      void this.wake();
      this.catchUp();
    }
  }

  /**
   * Nothing follows depth, madness or tension while the game is silent;
   * re-aim everything when sound returns, then fade in.
   */
  private catchUp() {
    if (!this.built || !this.live()) return;
    this.applyDepth(0.2);
    this.applyMadness();
    this.applyTension();
    this.fadeMaster(this.fadeIn);
  }

  private fadeMaster(tc?: number) {
    if (!this.built) return;
    const on = !this.muted && !this.hidden;
    const g = this.master.gain;
    const now = this.ctx!.currentTime;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.setTargetAtTime(on ? this.volume : 0, now, tc ?? (on ? 0.08 : 0.025));
  }

  /** Suspend once the fade has finished, if we are still silent. */
  private sleepSoon() {
    if (!this.realtime) return;
    clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => {
      const ctx = this.ctx as AudioContext | null;
      if ((this.muted || this.hidden) && ctx?.state === 'running') void ctx.suspend().catch(() => undefined);
    }, 220);
  }

  /** The context is producing sound and can be steered. */
  private live(): boolean {
    if (!this.realtime) return true;
    return !this.muted && !this.hidden && this.ctx!.state === 'running';
  }

  /** An event would be heard now (or in a moment, while a resume is in flight). */
  private audible(): boolean {
    if (!this.built || this.muted || this.hidden || this.voices >= HARD_CAP) return false;
    if (!this.realtime) return true;
    return this.ctx!.state === 'running' || performance.now() - this.wokeAt < 1500;
  }

  private at(lead = 0.012): number {
    return this.ctx!.currentTime + lead;
  }

  // ------------------------------------------------------------ the graph

  private build() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const gain = (v: number) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    const filter = (type: BiquadFilterType, f: number, q: number) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };

    // Master: the compressor only catches peaks; the ceiling is absolute.
    this.master = gain(0);
    const bus = gain(1);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -8;
    comp.knee.value = 6;
    comp.ratio.value = 12;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    const ceiling = ctx.createWaveShaper();
    ceiling.curve = softCeiling();
    ceiling.oversample = 'none';
    bus.connect(filter('highpass', 24, 0.6)).connect(comp).connect(ceiling).connect(this.master).connect(ctx.destination);

    this.ui = gain(1);
    this.ui.connect(bus);

    // The bed and its sends share the depth filter, the fade and the ducks.
    this.bed = gain(1);
    this.bedTone = filter('lowpass', 12000, 0.6);
    this.bedFade = gain(0);
    this.tense = gain(1);
    this.duckGain = gain(1);
    this.throb = gain(1);
    this.bed.connect(this.bedTone).connect(this.bedFade).connect(this.tense).connect(this.duckGain).connect(this.throb).connect(bus);
    const throbLfo = ctx.createOscillator();
    throbLfo.frequency.value = 0.43;
    this.throbDepth = gain(0);
    throbLfo.connect(this.throbDepth).connect(this.throb.gain);
    throbLfo.start(t);

    // Reverb: a short tail near the surface, a long one in the deep, crossfaded by depth.
    this.verb = gain(1);
    this.nearIn = gain(1);
    this.farIn = gain(0);
    this.verb.connect(this.nearIn);
    this.verb.connect(this.farIn);
    const verbOut = gain(0.5);
    verbOut.connect(bus);
    const near = ctx.createConvolver();
    near.buffer = this.impulse(1.6, 1.7);
    const nearPre = ctx.createDelay(0.5);
    nearPre.delayTime.value = 0.022;
    this.nearIn.connect(filter('highpass', 110, 0.6)).connect(nearPre).connect(near).connect(verbOut);
    const far = ctx.createConvolver();
    const farPre = ctx.createDelay(0.5);
    farPre.delayTime.value = 0.1;
    this.farIn.connect(filter('highpass', 70, 0.6)).connect(farPre).connect(far).connect(verbOut);
    // The long tail costs the most to make; build it once the first tap has been answered. It decays as a
    // 7.5 s space would but ends at 3.4 s, faded late: what it leaves out is below -35 dB, and the cost of a
    // convolver grows with the length of its tail (this one is most of the engine's CPU).
    const longTail = () => (far.buffer = this.impulse(3.4, 7.5, 3));
    if (this.realtime) window.setTimeout(longTail, 30);
    else longTail();

    this.bedWet = gain(1);
    this.wetTone = filter('lowpass', 12000, 0.6);
    this.wetFade = gain(0);
    this.wetDuck = gain(1);
    this.bedWet.connect(this.wetTone).connect(this.wetFade).connect(this.wetDuck).connect(this.verb);

    // The bed's tuning in cents: flat of the instruments below 4,000 m.
    if (typeof ctx.createConstantSource === 'function') {
      const c = ctx.createConstantSource();
      c.offset.value = 0;
      c.start(t);
      this.tune = c;
      this.tuneParam = c.offset;
    } else {
      this.tune = gain(0);
    }
    // Madness: two slow wobbles that pull the bed's voices apart.
    const warp = (f: number) => {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = gain(0);
      o.connect(g);
      o.start(t);
      return g;
    };
    this.warpA = warp(0.071);
    this.warpB = warp(0.113);

    this.brown = this.makeNoise('brown', 5);
    this.pink = this.makeNoise('pink', 5);
    this.clicks = this.makeClicks(4);
    this.renderInterface();

    this.built = true;
    this.cycle0 = t;
    if (this.ambienceOn) this.spots = this.makeSpots(t);
    this.applyDepth(0.05);
    this.applyMadness();
    this.applyTension();
    // The first tap fades the bed in over 3 s; the interface is heard at once.
    for (const g of [this.bedFade.gain, this.wetFade.gain]) g.setTargetAtTime(1, t, 1);
    this.fadeMaster(0.02);
  }

  /** Re-aims everything that follows depth. */
  private applyDepth(tc = 0.5) {
    if (!this.built) return;
    const now = this.ctx!.currentTime;
    const d = this.depth;
    this.appliedDepth = d;
    this.appliedAt = now;
    if (this.ambienceOn) {
      for (const name of LAYERS) {
        const p = PRESENCE[name](d);
        let L = this.layers.get(name);
        if (p > 0.002) {
          if (!L) {
            L = this.makeLayer(name, now);
            this.layers.set(name, L);
          }
          L.quietSince = -1;
          const level = name === 'drone' ? dB(along(DRONE_DB, d) + 12) : p;
          this.glide(L.out.gain, level * LEVEL[name], tc);
          this.glide(L.wet.gain, level * LEVEL[name], tc);
          L.depth?.(d, tc);
        } else if (L) {
          this.glide(L.out.gain, 0, tc);
          this.glide(L.wet.gain, 0, tc);
          if (L.quietSince < 0) L.quietSince = now;
        }
      }
    }
    if (this.tuneParam) this.glide(this.tuneParam, along(BED_CENTS, d), Math.max(tc, 1));
    const share = along(LONG_SHARE, d);
    const wet = along(WETNESS, d);
    this.glide(this.nearIn.gain, wet * Math.sqrt(1 - share), tc);
    this.glide(this.farIn.gain, wet * Math.sqrt(share), tc);
    this.applyTone(tc);
  }

  /** The bed's low-pass: depth closes it, tension narrows it, the Eye opens it. */
  private applyTone(tc = 0.5) {
    const now = this.ctx!.currentTime;
    const open = this.eyeFloor || now < this.eyeUntil;
    let f = open ? 15000 : along(BED_LOWPASS, this.depth, true);
    f *= glideHz(1, 0.18, this.tension);
    this.glide(this.bedTone.frequency, f, tc);
    this.glide(this.wetTone.frequency, f, tc);
    if (now < this.eyeUntil) {
      // let the glimpse close again by itself
      const back = Math.min(along(BED_LOWPASS, this.depth, true), 15000);
      this.bedTone.frequency.setTargetAtTime(back, this.eyeUntil, 1.5);
      this.wetTone.frequency.setTargetAtTime(back, this.eyeUntil, 1.5);
      this.targets.set(this.bedTone.frequency, back);
      this.targets.set(this.wetTone.frequency, back);
    }
  }

  private applyMadness() {
    if (!this.built) return;
    const m = this.madness;
    this.glide(this.warpA.gain, 22 * m, 1.2);
    this.glide(this.warpB.gain, -16 * m, 1.2);
    const depth = 0.22 * smooth(0.45, 1, m);
    this.glide(this.throbDepth.gain, depth, 0.8);
    this.glide(this.throb.gain, 1 - depth, 0.8);
  }

  private applyTension(tc = 0.25) {
    if (!this.built) return;
    const x = this.tension;
    this.glide(this.tense.gain, dB(-7 * x), x > 0 ? tc : 0.6);
    this.applyTone(x > 0 ? tc : 0.6);
  }

  /** Hold the bed down for a moment (deeper ducks win while they last). */
  private duck(t: number, depthDb: number, hold: number, release = 0.5) {
    if (t < this.duckEnd && depthDb < this.duckDepth) return;
    this.duckEnd = t + hold;
    this.duckDepth = depthDb;
    for (const g of [this.duckGain.gain, this.wetDuck.gain]) {
      g.cancelScheduledValues(t);
      g.setTargetAtTime(dB(-depthDb), t, 0.08);
      g.setTargetAtTime(1, t + hold, release);
    }
  }

  /** The Eye at the floor, once per arrival: the bed opens fully and the choir blooms on D F# A Bb. */
  private floorEye(at: number) {
    if (this.eyeFloor) return;
    this.eyeFloor = true;
    this.applyTone(1.4);
    this.chord(at, CHORD.bloom, 0.18, 20, { vowel: VOWEL.ah, attack: 4.5, dest: this.bed, wet: 1, wetDest: this.bedWet, tuned: true });
    this.breathe(at - 0.3, 0.04, 6, this.bed);
  }

  /** The floor: everything stops for two seconds. Then the heart. */
  private hush(now: number) {
    this.hushUntil = now + 2.2;
    this.duck(now + 0.01, 42, 2, 0.7);
  }

  /** Aim a parameter at a value, skipping repeats so the timeline stays short. */
  private glide(p: AudioParam, v: number, tc: number) {
    const last = this.targets.get(p);
    if (last !== undefined && Math.abs(last - v) <= Math.abs(v) * 0.004 + 1e-6) return;
    this.targets.set(p, v);
    p.setTargetAtTime(v, this.ctx!.currentTime, Math.max(0.01, tc));
  }

  /** Linear attack to the peak, optional hold, then an exponential fall to silence. */
  private pluck(p: AudioParam, t: number, attack: number, peak: number, decay: number, hold = 0) {
    const v = Math.max(peak, 1e-6);
    p.setValueAtTime(0, t);
    p.linearRampToValueAtTime(v, t + attack);
    if (hold > 0) p.setValueAtTime(v, t + attack + hold);
    p.exponentialRampToValueAtTime(v * SILENT, t + attack + hold + Math.max(0.01, decay));
  }

  private voice(): Kit {
    this.voices++;
    return new Kit(this.ctx!, this.rand, () => this.voices--);
  }

  /** A node carrying the bed's tuning (and the madness wobble) into a kit. */
  private tuned(k: Kit, warp?: GainNode): GainNode {
    const g = k.gain(1);
    k.link(this.tune, g);
    if (warp) k.link(warp, g);
    return g;
  }

  private between(a: number, b: number): number {
    return a + this.rand() * (b - a);
  }

  // ------------------------------------------------------------ material

  private makeNoise(kind: 'brown' | 'pink', seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const raw = new Float32Array(len);
    let last = 0;
    let b0 = 0;
    let b1 = 0;
    let b2 = 0;
    let b3 = 0;
    let b4 = 0;
    let b5 = 0;
    let b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = this.rand() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        raw[i] = last;
      } else {
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
        b6 = w * 0.115926;
      }
    }
    // No DC, a known level (RMS 0.25), and a seamless loop: the head is crossfaded with the tail.
    let mean = 0;
    for (let i = 0; i < len; i++) mean += raw[i];
    mean /= len;
    let sq = 0;
    for (let i = 0; i < len; i++) {
      raw[i] -= mean;
      sq += raw[i] * raw[i];
    }
    const scale = 0.25 / Math.sqrt(sq / len || 1);
    const fade = Math.floor(sr * 0.08);
    const out = ctx.createBuffer(1, len - fade, sr);
    const d = out.getChannelData(0);
    for (let i = 0; i < len - fade; i++) {
      const k = i < fade ? i / fade : 1;
      const v = (raw[i] * k + (i < fade ? raw[len - fade + i] * (1 - k) : 0)) * scale;
      d[i] = v > 1 ? 1 : v < -1 ? -1 : v; // the rare 4-sigma sample
    }
    return out;
  }

  /** Sparse clicks of varying size: shrimp and the small things that hunt them. */
  private makeClicks(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    let i = 0;
    for (;;) {
      i += 3 + Math.floor((-Math.log(1 - this.rand()) * sr) / 7);
      if (i >= len - 8) break;
      const a = (0.1 + 0.9 * Math.pow(this.rand(), 3)) * (this.rand() < 0.5 ? -1 : 1);
      d[i] += a;
      d[i + 1] -= 0.6 * a;
      d[i + 2] += 0.25 * a;
      if (this.rand() < 0.2) {
        const j = i + 40 + Math.floor(this.rand() * 200);
        if (j < len - 3) {
          d[j] += 0.5 * a;
          d[j + 1] -= 0.3 * a;
        }
      }
    }
    for (let k = 0; k < len; k++) d[k] = Math.max(-1, Math.min(1, d[k]));
    return buf;
  }

  /**
   * A dark tail: decaying noise that loses its highs as it fades, ending at true silence.
   * A `fade` above 1 holds the decay longer before the end fades it out.
   */
  private impulse(seconds: number, rt60: number, fade = 1): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.floor(sr * seconds);
    const buf = ctx.createBuffer(2, len, sr);
    const k = (6.9 * seconds) / rt60;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const x = i / len;
        lp += (this.rand() * 2 - 1 - lp) * (0.62 - 0.54 * Math.sqrt(x));
        d[i] = lp * Math.exp(-k * x) * (1 - Math.pow(x, fade)) * Math.min(1, i / (sr * 0.012));
      }
    }
    return buf;
  }

  /** Damped modes rendered once into a short buffer, for interface sounds that must be crisp and cheap. */
  private render(seconds: number, strikes: readonly Strike[]): AudioBuffer {
    const ctx = this.ctx!;
    const sr = ctx.sampleRate;
    const len = Math.ceil(sr * seconds);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    for (const s of strikes) {
      const i0 = Math.floor(s.at * sr);
      const g = s.gain ?? 1;
      for (const [f, a, tau] of s.modes) {
        const w = (2 * Math.PI * f) / sr;
        const k = Math.exp(-1 / (tau * sr));
        let env = a * g;
        for (let i = i0; i < len && env > 1e-5; i++) {
          d[i] += env * Math.sin(w * (i - i0));
          env *= k;
        }
      }
      if (s.noise) {
        const k = Math.exp(-1 / ((s.noiseTau ?? 0.002) * sr));
        let env = s.noise * g;
        let prev = 0;
        for (let i = i0; i < len && env > 1e-5; i++) {
          const w = this.rand() * 2 - 1;
          d[i] += env * (w - prev) * 0.5;
          prev = w;
          env *= k;
        }
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i]));
    const tail = Math.floor(sr * 0.006);
    for (let i = 0; i < len; i++) d[i] *= (0.9 / (peak || 1)) * Math.min(1, (len - 1 - i) / tail);
    return buf;
  }

  private renderInterface() {
    const r = (a: number, b: number) => this.between(a, b);
    const typebar = (): Strike => ({
      at: 0,
      modes: [
        [r(1800, 2500), 0.5, 0.006],
        [r(3100, 4100), 0.32, 0.0035],
        [r(430, 640), 0.3, 0.014],
        [r(150, 200), 0.22, 0.012],
      ],
      noise: 0.8,
      noiseTau: 0.0012,
    });
    this.keyBufs = [0, 1, 2, 3, 4].map(() => this.render(0.08, [typebar()]));
    this.spaceBuf = this.render(0.16, [{ at: 0, modes: [[260, 0.6, 0.03], [700, 0.3, 0.012], [120, 0.5, 0.025], [2100, 0.18, 0.004]], noise: 0.45, noiseTau: 0.002 }]);
    this.backBuf = this.render(0.05, [{ at: 0, modes: [[2800, 0.5, 0.003], [1250, 0.3, 0.005]], noise: 0.9, noiseTau: 0.0008 }]);
    this.clickBuf = this.render(0.1, [{ at: 0, modes: [[640, 0.6, 0.012], [1500, 0.25, 0.005], [210, 0.3, 0.015]], noise: 0.3, noiseTau: 0.001 }]);
    this.dialBuf = this.render(0.06, [{ at: 0, modes: [[3100, 0.5, 0.004], [5200, 0.3, 0.002], [1250, 0.35, 0.007]], noise: 0.4, noiseTau: 0.0006 }]);
    this.clunkBuf = this.render(0.25, [{ at: 0, modes: [[900, 0.4, 0.014], [430, 0.5, 0.03], [170, 0.6, 0.04], [2300, 0.2, 0.006]], noise: 0.4, noiseTau: 0.0015 }]);
    // the carriage: a ratchet that runs and slows, then the stop
    const ratchet: Strike[] = [];
    let at = 0;
    for (let i = 0; i < 14; i++) {
      ratchet.push({ at, gain: 0.5 + 0.3 * this.rand(), modes: [[r(2500, 3100), 0.25, 0.002], [1400, 0.15, 0.003]], noise: 0.3, noiseTau: 0.0006 });
      at += 0.008 + i * 0.0016;
    }
    ratchet.push({ at: at + 0.03, modes: [[300, 0.6, 0.04], [140, 0.5, 0.05], [820, 0.3, 0.015]], noise: 0.5, noiseTau: 0.002 });
    this.carriageBuf = this.render(at + 0.3, ratchet);
    // a wooden knock on the hull, heard from inside
    this.knockBuf = this.render(0.5, [
      {
        at: 0,
        modes: [[132, 0.5, 0.11], [290, 0.45, 0.075], [520, 0.6, 0.055], [810, 0.4, 0.04], [1240, 0.22, 0.024], [1900, 0.08, 0.012]],
        noise: 0.25,
        noiseTau: 0.0015,
      },
    ]);
  }

  // ------------------------------------------------------------ layers

  private makeLayer(name: LayerName, now: number): Layer {
    const kit = new Kit(this.ctx!, this.rand);
    const out = kit.gain(0);
    out.connect(this.bed);
    const wet = kit.gain(0);
    wet.connect(this.bedWet);
    const L: Layer = { kit, out, wet, quietSince: -1 };
    const t = now + 0.01;
    switch (name) {
      case 'drone':
        this.droneLayer(L, t);
        break;
      case 'surface':
        this.surfaceLayer(L, t);
        break;
      case 'gloaming':
        this.pad(L, t, CHORD.gloaming, { vowel: VOWEL.mm, level: 0.16, pair: true, drift: 4, swell: 1 / (2 * CYCLE), wet: 0.6 });
        break;
      case 'stygian':
        this.pad(L, t, CHORD.stygian, { vowel: VOWEL.oo, level: 0.2, pair: true, drift: 5, swell: 1 / (4 * CYCLE), wet: 0.8 });
        this.clickLayer(L, t);
        break;
      case 'abyss':
        // the choir far off, and long silences: it comes and goes on a six-cycle tide
        this.pad(L, t, CHORD.abyss, { vowel: VOWEL.oh, level: 0.1, pair: false, drift: 6, swell: 1 / (3 * CYCLE), tide: 1 / (6 * CYCLE), wet: 1.8 });
        break;
      case 'dreaming':
        this.pad(L, t, CHORD.dreaming, { vowel: VOWEL.ah, level: 0.21, pair: true, drift: 9, swell: 1 / (2 * CYCLE), wet: 0.45 });
        this.breathLayer(L, t);
        break;
      case 'floor':
        this.pad(L, t, CHORD.floor, { vowel: VOWEL.oh, level: 0.1, pair: true, drift: 3, swell: 1 / (3 * CYCLE), wet: 1 });
        break;
    }
    return L;
  }

  /** One drone on D that never stops; its filter breathes on the 7 s cycle. */
  private droneLayer(L: Layer, t: number) {
    const k = L.kit;
    const tn = this.tuned(k, this.warpA);
    const lp = k.filter('lowpass', 600, 0.9);
    const body = k.gain(1);
    lp.connect(body).connect(L.out);
    k.lfo(1 / CYCLE, 700, lp.detune, t);
    const voice = (midi: number, type: OscillatorType, amp: number, dest: AudioNode, det = 0) => {
      const o = k.osc(type, NOTE(midi), t, undefined, det);
      tn.connect(o.detune);
      const g = k.gain(amp);
      o.connect(g).connect(dest);
      return g;
    };
    voice(38, 'sine', 0.1, body); // D2, the note that never stops
    voice(50, 'sawtooth', 0.045, lp, 3); // D3, soft, through the breathing filter: its overtones reach a phone
    voice(62, 'sine', 0.015, body, -2); // D4, a quiet copy that phones can play
    const sub = voice(26, 'sine', 0, body); // D1, the sub-bass of the dark
    L.depth = (d, tc) => this.glide(sub.gain, 0.05 * smooth(900, 2600, d), tc);
  }

  /** Surf, wind in the rigging, and the open fifth on A. */
  private surfaceLayer(L: Layer, t: number) {
    const k = L.kit;
    const surf = k.gain(1);
    const under = k.filter('lowpass', 9000, 0.6);
    const m = k.merger();
    m.connect(under).connect(surf).connect(L.out);
    for (let side = 0; side < 2; side++) {
      const src = k.noise(this.pink, t, undefined, side ? 1 : 0.93);
      const bp = k.filter('bandpass', 700, 0.5);
      const amp = k.gain(0.05);
      src.connect(bp).connect(amp).connect(m, 0, side);
      // one swell drives loudness and brightness, so each wave crests brighter and hisses as it breaks
      const wave = k.osc('sine', side ? 0.081 : 0.113, t);
      const toAmp = k.gain(0.04);
      const toBright = k.gain(700);
      wave.connect(toAmp).connect(amp.gain);
      wave.connect(toBright).connect(bp.detune);
      k.lfo(side ? 0.19 : 0.153, 0.012, amp.gain, t);
      const foam = k.gain(0.012);
      wave.connect(k.gain(0.012)).connect(foam.gain);
      src.connect(k.filter('highpass', 2600, 0.5)).connect(foam).connect(m, 0, side);
    }
    const air = k.gain(0);
    air.connect(L.out);
    const wind = k.noise(this.pink, t, undefined, 1.07);
    const wbp = k.filter('bandpass', 700, 0.9);
    const gust = k.gain(0.03);
    const wp = k.pan(0);
    wind.connect(wbp).connect(gust).connect(wp).connect(air);
    k.lfo(0.027, 500, wbp.detune, t);
    k.lfo(0.063, 0.018, gust.gain, t);
    k.lfo(0.017, 0.008, gust.gain, t);
    if ('pan' in wp) k.lfo(0.021, 0.45, wp.pan, t);
    const whistle = k.filter('bandpass', 1240, 16);
    const wg = k.gain(0.09);
    wind.connect(whistle).connect(wg).connect(wp);
    k.lfo(0.041, 240, whistle.detune, t);
    k.lfo(0.07, 0.07, wg.gain, t);
    this.pad(L, t, CHORD.shallows, { cutoff: 1100, level: 0.04, type: 'triangle', swell: 1 / (3 * CYCLE), wet: 0.5 });
    L.depth = (d, tc) => {
      const below = smooth(-2, 2, d);
      this.glide(under.frequency, glideHz(9000, 520, below) * glideHz(1, 0.4, smooth(0, 250, d)), tc);
      this.glide(surf.gain, mix(1, 0.75, below), tc);
      this.glide(air.gain, 1 - smooth(-8, 1, d), tc);
    };
  }

  /** The clicks of small living things, all around and never regular. */
  private clickLayer(L: Layer, t: number) {
    const k = L.kit;
    const m = k.merger();
    k.noise(this.clicks, t, undefined, 1).connect(m, 0, 0);
    k.noise(this.clicks, t, undefined, 0.87).connect(m, 0, 1);
    const bp = k.filter('bandpass', 1300, 0.7);
    const g = k.gain(0.35);
    m.connect(bp).connect(g).connect(L.out);
    const w = k.gain(0.25);
    g.connect(w).connect(L.wet);
  }

  /** Something enormous breathing on the 7 s cycle: pink noise through a band that opens and closes. */
  private breathLayer(L: Layer, t: number) {
    const k = L.kit;
    const src = k.noise(this.pink, t, undefined, 0.55);
    const f1 = k.filter('bandpass', 200, 1.3);
    const f2 = k.filter('bandpass', 700, 2.2);
    const f2g = k.gain(0.5);
    const env = k.gain(0);
    src.connect(f1).connect(env);
    src.connect(f2).connect(f2g).connect(env);
    const lift = k.gain(0.36);
    env.connect(lift).connect(L.out);
    const w = k.gain(0.7);
    lift.connect(w).connect(L.wet);
    let next = this.cycle0 + 2.4;
    while (next < t + 0.2) next += CYCLE;
    L.tick = (now, horizon) => {
      while (next < horizon) {
        const at = Math.max(next, now + 0.02);
        const inhale = 2.6 + this.rand() * 0.3;
        const ex = at + inhale + 0.4;
        env.gain.setTargetAtTime(0.9, at, inhale / 2.5);
        f1.frequency.setTargetAtTime(560, at, inhale / 2);
        f2.frequency.setTargetAtTime(1500, at, inhale / 2);
        env.gain.setTargetAtTime(1, ex, 0.25);
        env.gain.setTargetAtTime(0, ex + 0.7, 0.9);
        f1.frequency.setTargetAtTime(170, ex, 1.1);
        f2.frequency.setTargetAtTime(600, ex, 1.1);
        next += CYCLE;
      }
    };
  }

  /** A held chord of sawtooth voices through vowel formants (or a plain low-pass), detuned with the bed. */
  private pad(
    L: Layer,
    t: number,
    notes: readonly number[],
    o: {
      vowel?: Vowel;
      cutoff?: number;
      level: number;
      pair?: boolean;
      drift?: number;
      /** Voices swell in turn at this rate (Hz). */
      swell?: number;
      /** The whole chord comes and goes at this rate (Hz), nearly to silence. */
      tide?: number;
      wet?: number;
      type?: OscillatorType;
    },
  ) {
    const k = L.kit;
    const base = o.level / Math.sqrt(notes.length * (o.pair ? 2 : 1));
    const sum = k.gain(base);
    if (o.tide) k.lfo(o.tide, base * 0.65, sum.gain, t);
    const head = o.vowel ? this.formants(k, sum, o.vowel) : sum.connect(k.filter('lowpass', o.cutoff ?? 900, 0.7));
    head.connect(L.out);
    if (o.wet) {
      const w = k.gain(o.wet);
      head.connect(w).connect(L.wet);
    }
    const tA = this.tuned(k, this.warpA);
    const tB = this.tuned(k, this.warpB);
    const swell = o.swell ? k.osc('sine', o.swell, t) : null;
    notes.forEach((m, i) => {
      const vg = k.gain(1);
      if (swell) {
        const sg = k.gain(i % 2 ? -0.35 : 0.35);
        swell.connect(sg).connect(vg.gain);
      }
      vg.connect(k.pan(notes.length > 1 ? -0.55 + (1.1 * i) / (notes.length - 1) : 0)).connect(sum);
      // each note wanders on its own, its pair together
      let drift: GainNode | null = null;
      if (o.drift) {
        drift = k.gain(o.drift);
        k.osc('sine', 0.02 + this.rand() * 0.05, t).connect(drift);
      }
      for (const det of o.pair ? [-6, 6] : [0]) {
        const osc = k.osc(o.type ?? 'sawtooth', NOTE(m), t, undefined, det + (this.rand() - 0.5) * 6);
        (i % 2 ? tB : tA).connect(osc.detune);
        drift?.connect(osc.detune);
        osc.connect(vg);
      }
    });
  }

  private formants(k: Kit, input: AudioNode, v: Vowel, gain = 2.4): GainNode {
    const out = k.gain(1);
    const qs = [5, 8, 10];
    const amps = [1, 0.5, 0.18];
    v.forEach((f, i) => input.connect(k.filter('bandpass', f, qs[i])).connect(k.gain(amps[i] * gain)).connect(out));
    return out;
  }

  // ------------------------------------------------------------ ambient events

  private makeSpots(t: number): Spot[] {
    const every = (min: number, max: number, fire: (at: number) => void): Spot => ({
      next: t + 1.5 + this.rand() * min,
      interval: () => this.between(min, max),
      fire,
    });
    const cycles = (n: number, phase: number, fire: (at: number) => void): Spot => {
      const period = CYCLE * n;
      let next = this.cycle0 + phase;
      while (next < t + 1) next += period;
      return { next, interval: () => period, fire };
    };
    return [
      cycles(1, 0.3, (at) => this.buoyAt(at)),
      every(16, 42, (at) => this.gulls(at)),
      every(1.4, 4.6, (at) => this.slap(at)),
      every(1.5, 5, (at) => this.drift(at)),
      cycles(2, 3.4, (at) => this.sonar(at)),
      every(14, 34, (at) => this.creakIdle(at)),
      every(24, 50, (at) => this.leviathanAt(at)),
      every(30, 55, (at) => this.steeple(at)),
      cycles(1, 5.2, (at) => this.stone(at)),
      every(10, 24, (at) => this.bowed(at)),
      every(6, 15, (at) => this.murmur(at)),
      every(26, 55, (at) => this.unsound(at)),
    ];
  }

  /** The bell buoy rings on the 7 s cycle, but not every time; underwater it is muffled and soon gone. */
  private buoyAt(t: number, force = false) {
    const d = this.depth;
    const fade = 1 - smooth(0, 160, d);
    if (fade < 0.02 || (!force && this.rand() > 0.55)) return;
    const below = smooth(-2, 3, d);
    this.buoyPan = Math.max(-0.8, Math.min(0.8, this.buoyPan + (this.rand() - 0.5) * 0.3));
    const k = this.voice();
    const lp = k.filter('lowpass', below ? glideHz(900, 380, smooth(0, 160, d)) : 7000, 0.6);
    const p = k.pan(this.buoyPan);
    lp.connect(p).connect(this.bed);
    const w = k.gain(0.55);
    p.connect(w).connect(this.bedWet);
    const tn = this.tuned(k);
    const vol = 0.1 * mix(1, 0.6, below) * fade;
    let at = t;
    const strikes = 1 + Math.floor(this.rand() * 3);
    for (let i = 0; i < strikes; i++) {
      this.strike(k, at, NOTE(57), vol * (0.55 + 0.45 * this.rand()), 4.8, BUOY, lp, 0, tn);
      at += 0.5 + this.rand() * 1.1;
    }
    k.release();
  }

  /** Gulls far off, above the water only. */
  private gulls(t: number) {
    if (this.depth > -4 || this.rand() < 0.3) return;
    const k = this.voice();
    const out = k.gain(1);
    const p = k.pan((this.rand() < 0.5 ? -1 : 1) * (0.35 + 0.45 * this.rand()));
    out.connect(k.filter('lowpass', 2800, 0.7)).connect(p).connect(this.bed);
    const w = k.gain(0.9);
    p.connect(w).connect(this.bedWet);
    const calls = 2 + Math.floor(this.rand() * 3);
    const base = 1100 + this.rand() * 300;
    const vol = 0.12 + this.rand() * 0.07;
    let at = t;
    for (let i = 0; i < calls; i++) {
      const len = 0.24 + this.rand() * 0.12;
      const f = base * (1 - i * 0.05);
      const o = k.osc('sawtooth', f, at, at + len + 0.05, 0, true);
      o.frequency.setValueAtTime(f * 0.82, at);
      o.frequency.linearRampToValueAtTime(f * 1.22, at + len * 0.28);
      o.frequency.exponentialRampToValueAtTime(f * 0.7, at + len);
      k.lfo(28 + this.rand() * 10, f * 0.012, o.frequency, at, at + len + 0.05);
      const g = k.gain(0);
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vol, at + 0.03);
      g.gain.setValueAtTime(vol, at + len * 0.55);
      g.gain.linearRampToValueAtTime(0, at + len);
      o.connect(k.filter('bandpass', 2300, 2.5)).connect(g).connect(out);
      at += len + 0.12 + this.rand() * 0.16;
    }
    k.release();
  }

  /** Water slapping the hull of the boat. */
  private slap(t: number) {
    if (this.depth > -3) return;
    const k = this.voice();
    const n = k.noise(this.pink, t, t + 0.5, 1, false);
    const bp = k.filter('bandpass', 380 + this.rand() * 450, 1.1);
    const g = k.gain(0);
    const v = 0.4 + this.rand() * 0.35;
    this.pluck(g.gain, t, 0.004, v, 0.12 + this.rand() * 0.1);
    const slosh = k.filter('bandpass', 900 + this.rand() * 600, 0.9);
    const sg = k.gain(0);
    const st = t + 0.06 + this.rand() * 0.08;
    sg.gain.setValueAtTime(0, t);
    sg.gain.setValueAtTime(0, st);
    sg.gain.linearRampToValueAtTime(v * 0.45, st + 0.03);
    sg.gain.exponentialRampToValueAtTime(v * 0.45 * SILENT, st + 0.3);
    const p = k.pan((this.rand() - 0.5) * 0.6);
    n.connect(bp).connect(g).connect(p);
    n.connect(slosh).connect(sg).connect(p);
    p.connect(this.bed);
    k.release();
  }

  /** Bubbles rising past the glass in the shallows. */
  private drift(t: number) {
    const d = this.depth;
    if (d < 0 || d > 320) return;
    this.bubblesAt(t, 2 + Math.floor(this.rand() * 4), 0.2 * (1 - smooth(0, 320, d)), { dest: this.bed, wet: this.bedWet });
  }

  /** The Gloaming's sonar: a pure A with a small downward bend and a very long echo. Nothing answers. */
  private sonar(t: number) {
    const p = PRESENCE.gloaming(this.depth);
    if (p < 0.05 || this.rand() > 0.85) return;
    const k = this.voice();
    const out = k.gain(p);
    out.connect(this.bed);
    const w = k.gain(1.1);
    out.connect(w).connect(this.bedWet);
    const tn = this.tuned(k);
    const f = NOTE(81);
    for (let i = 0; i < 5; i++) {
      const at = t + i * 0.92;
      const o = k.osc('sine', f, at, at + 2.3);
      o.frequency.setValueAtTime(f, at);
      o.frequency.exponentialRampToValueAtTime(f * 0.985, at + 1.9);
      tn.connect(o.detune);
      const g = k.gain(0);
      this.pluck(g.gain, at, 0.006, 0.11 * Math.pow(0.45, i), 2);
      const head = i ? g.connect(k.filter('lowpass', 2400 - i * 380, 0.7)) : g;
      o.connect(g);
      head.connect(k.pan(i ? (i % 2 ? -0.5 : 0.5) * (i / 4) : 0)).connect(out);
    }
    k.release();
  }

  private creakIdle(t: number) {
    const d = this.depth;
    if (d < 200 || this.rand() > 0.25 + 0.35 * smooth(200, 6000, d)) return;
    this.creakAt(t, 0.25 + 0.2 * smooth(200, 6000, d));
  }

  /** The hull: noise through a resonant band that sweeps, stuttering like wood and iron slipping. */
  private creakAt(t: number, vol: number, dest: AudioNode = this.bed, wet = 0.6) {
    if (this.voices >= VOICE_CAP) return;
    const k = this.voice();
    const dur = 0.6 + this.rand() * 1.3;
    const src = k.noise(this.pink, t, t + dur + 0.05, 0.7);
    const f = 200 + this.rand() * 360;
    const end = f * (0.55 + this.rand() * 0.9);
    const r1 = k.filter('bandpass', f, 18);
    const r2 = k.filter('bandpass', f * 2.27, 22);
    r1.frequency.setValueAtTime(f, t);
    r1.frequency.exponentialRampToValueAtTime(end, t + dur);
    r2.frequency.setValueAtTime(f * 2.27, t);
    r2.frequency.exponentialRampToValueAtTime(end * 2.27, t + dur);
    const stutter = k.gain(3);
    k.lfo(8 + this.rand() * 9, 2, stutter.gain, t, t + dur + 0.05);
    const g = k.gain(0);
    this.pluck(g.gain, t, dur * 0.25, vol, dur * 0.5, dur * 0.25);
    const p = k.pan(this.rand() * 1.4 - 0.7);
    src.connect(r1).connect(stutter);
    src.connect(r2).connect(stutter);
    stutter.connect(g).connect(p).connect(dest);
    const w = k.gain(wet);
    p.connect(w).connect(dest === this.bed ? this.bedWet : this.verb);
    k.release();
  }

  /** Something very large, far off in the Stygian dark. */
  private leviathanAt(t: number, force = false) {
    const d = this.depth;
    const p = band(1200, 1700, 3800, 4300, d);
    if (!force && this.rand() > p * 0.7) return;
    const k = this.voice();
    const dur = 4.5 + this.rand() * 2.5;
    const base = (48 + this.rand() * 22) * Math.pow(2, (this.rand() - 0.5) / 6);
    const o = k.osc('sawtooth', base, t, t + dur + 0.1);
    o.frequency.setValueAtTime(base * 1.5, t);
    o.frequency.exponentialRampToValueAtTime(base * 1.2, t + dur * 0.35);
    o.frequency.exponentialRampToValueAtTime(base * 0.72, t + dur);
    const growl = k.osc('sine', 24 + this.rand() * 8, t, t + dur + 0.1);
    const gg = k.gain(base * 0.1);
    growl.connect(gg).connect(o.frequency);
    this.tuned(k).connect(o.detune);
    const throat = k.filter('bandpass', 320, 4);
    throat.frequency.setValueAtTime(260, t);
    throat.frequency.linearRampToValueAtTime(480, t + dur * 0.4);
    throat.frequency.linearRampToValueAtTime(230, t + dur);
    const g = k.gain(0);
    this.pluck(g.gain, t, dur * 0.35, 0.42, dur * 0.65);
    const pan = k.pan(this.rand() * 1.8 - 0.9);
    o.connect(throat).connect(g).connect(pan).connect(this.bed);
    const w = k.gain(1.4);
    pan.connect(w).connect(this.bedWet);
    k.release();
  }

  /** A drowned steeple, its bell still swaying. No one has rung it in centuries. It is ringing now. */
  private steeple(t: number) {
    if (this.rand() > band(2300, 2450, 3050, 3200, this.depth)) return;
    const k = this.voice();
    const lp = k.filter('lowpass', 1300, 0.6);
    const p = k.pan(this.rand() * 1.2 - 0.6);
    lp.connect(p).connect(this.bed);
    const w = k.gain(1.2);
    p.connect(w).connect(this.bedWet);
    const tn = this.tuned(k);
    const n = 3 + Math.floor(this.rand() * 3);
    for (let i = 0; i < n; i++) this.strike(k, t + i * (2.7 + this.rand() * 0.5), NOTE(62) * 0.985, 0.045 * (1 - i * 0.1), 6, BELL, lp, 0, tn);
    k.release();
  }

  /** Masonry settling somewhere far below, then a long silence. */
  private stone(t: number) {
    const p = band(3900, 4100, 6000, 6300, this.depth);
    if (this.rand() > p * 0.35) return;
    const k = this.voice();
    const out = k.gain(1);
    const pan = k.pan(this.rand() * 1.4 - 0.7);
    out.connect(pan).connect(this.bed);
    const w = k.gain(1.6);
    pan.connect(w).connect(this.bedWet);
    const hits = this.rand() < 0.35 ? 2 : 1;
    for (let i = 0; i < hits; i++) {
      const at = t + i * (0.35 + this.rand() * 0.5);
      const v = 0.12 * (i ? 0.5 : 1);
      const o = k.osc('sine', 50, at, at + 1.1);
      o.frequency.setValueAtTime(50, at);
      o.frequency.exponentialRampToValueAtTime(30, at + 0.6);
      const og = k.gain(0);
      this.pluck(og.gain, at, 0.008, v, 0.9);
      o.connect(og).connect(out);
      // the grind of it, an octave and more up, for speakers too small for the thud
      // (brown noise is nearly all sub-bass: cut below 150 Hz so the grind costs no headroom the thud needs)
      const n = k.noise(this.brown, at, at + 0.7, 1, false);
      const hp = k.filter('highpass', 150, 0.7);
      const lp = k.filter('lowpass', 700, 0.8);
      const ng = k.gain(0);
      this.pluck(ng.gain, at, 0.012, v * 2.3, 0.75);
      n.connect(hp).connect(lp).connect(ng).connect(out);
    }
    k.release();
  }

  /** Bowed metal: a resonant band on noise gliding slowly, like a waterphone. */
  private bowed(t: number) {
    if (this.rand() > band(3800, 4200, 6100, 6500, this.depth) * 0.8) return;
    const k = this.voice();
    const dur = 3.5 + this.rand() * 3;
    const src = k.noise(this.pink, t, t + dur + 0.1, 0.8);
    const base = 320 + this.rand() * 360;
    const glide = Math.pow(2, ((this.rand() < 0.5 ? -1 : 1) * (2 + this.rand() * 4)) / 12);
    const g = k.gain(0);
    this.pluck(g.gain, t, dur * 0.4, 2, dur * 0.6);
    const tn = this.tuned(k);
    for (const [ratio, amp] of [[1, 1], [1.41, 0.6], [2.13, 0.35]] as const) {
      const bp = k.filter('bandpass', base * ratio, 70);
      bp.frequency.setValueAtTime(base * ratio, t);
      bp.frequency.exponentialRampToValueAtTime(base * ratio * glide, t + dur);
      tn.connect(bp.detune);
      src.connect(bp).connect(k.gain(amp)).connect(g);
    }
    const p = k.pan(this.rand() * 1.6 - 0.8);
    g.connect(p).connect(this.bed);
    const w = k.gain(1.3);
    p.connect(w).connect(this.bedWet);
    k.release();
  }

  /** Madness: someone is speaking, very close. */
  private murmur(t: number) {
    if (this.madness < 0.35 || this.rand() > this.madness) return;
    this.whisperAt(t, 0.1 + 0.15 * this.madness);
  }

  /** Madness: a bell heard backwards, swelling out of nothing and stopping short. */
  private unsound(t: number) {
    if (this.madness < 0.6 || this.rand() > this.madness * 0.7) return;
    const k = this.voice();
    const dur = 1.6 + this.rand() * 1.2;
    const out = k.gain(0);
    out.gain.setValueAtTime(0.0002, t);
    out.gain.exponentialRampToValueAtTime(0.075, t + dur);
    out.gain.linearRampToValueAtTime(0, t + dur + 0.12);
    const p = k.pan(this.rand() < 0.5 ? -0.6 : 0.6);
    out.connect(p).connect(this.bed);
    const w = k.gain(0.9);
    p.connect(w).connect(this.bedWet);
    const tn = this.tuned(k);
    const prime = NOTE([62, 63, 56][Math.floor(this.rand() * 3)]);
    for (const [ratio, amp] of BELL.slice(0, 5)) {
      const o = k.osc('sine', prime * ratio, t, t + dur + 0.15);
      tn.connect(o.detune);
      o.connect(k.gain(amp)).connect(out);
    }
    k.release();
  }

  /** The heart that is not yours, about 48 a minute, from the Dreaming Deep down. */
  private pulse(now: number, horizon: number) {
    const v = smooth(5850, 6150, this.depth);
    if (v < 0.01 || now < this.hushUntil) {
      this.pulseAt = Math.max(this.pulseAt, this.hushUntil);
      return;
    }
    if (this.pulseAt < now) this.pulseAt = now + 0.1;
    while (this.pulseAt < horizon) {
      this.thump(this.pulseAt, 0.18 * v, this.bed);
      this.thump(this.pulseAt + 0.26, 0.11 * v, this.bed);
      this.pulseAt += 1.25 * (0.97 + 0.06 * this.rand());
    }
  }

  /** Your own heart, in the last seconds of air. */
  private heartbeat(now: number, horizon: number) {
    if (this.tension <= 0.01) {
      this.beatAt = 0;
      return;
    }
    if (this.beatAt < now) this.beatAt = now + 0.03;
    while (this.beatAt < horizon) {
      const v = 0.45 + 0.55 * this.tension;
      this.thump(this.beatAt, 0.3 * v, this.ui);
      this.thump(this.beatAt + 0.2, 0.19 * v, this.ui);
      this.beatAt += 1.05 - 0.55 * this.tension;
    }
  }

  // ------------------------------------------------------------ voices

  private play(buf: AudioBuffer, t: number, vol: number, o: { rate?: number; pan?: number; wet?: number } = {}) {
    const k = this.voice();
    const g = k.gain(vol);
    k.buffer(buf, t, o.rate ?? 1).connect(g);
    const out = o.pan ? g.connect(k.pan(o.pan)) : g;
    out.connect(this.ui);
    if (o.wet) out.connect(k.gain(o.wet)).connect(this.verb);
    k.release();
  }

  /** Enter: the typewriter's carriage returns, and its little bell rings in D. */
  private carriage(t: number, vol = 1) {
    this.play(this.carriageBuf, t, 0.09 * vol, { rate: 0.98 + this.rand() * 0.04 });
    this.bell(t, NOTE(86), 0.012 * vol, 1.2, [[1, 1, 1], [2.76, 0.4, 0.5], [5.4, 0.2, 0.25]], { wet: 0.25 });
  }

  /** A brass dial tick for every 100 m; a deeper clunk at each 1,000 m. */
  private dial(t: number, thousand: boolean) {
    if (this.voices >= VOICE_CAP) return;
    if (thousand) this.play(this.clunkBuf, t, 0.12, { wet: 0.2 });
    else this.play(this.dialBuf, t, 0.06, { rate: 0.95 + this.rand() * 0.1 });
  }

  /** One strike of a bell: additive partials, the high ones dying first, the prime warbling. */
  private strike(k: Kit, t: number, prime: number, vol: number, decay: number, partials: Partials, dest: AudioNode, bloom = 0, tn?: AudioNode) {
    const part = (f: number, amp: number, end: number, attack: number) => {
      const o = k.osc('sine', f, t, end + 0.05);
      if (tn) tn.connect(o.detune);
      const g = k.gain(0);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(Math.max(vol * amp, 1e-6), t + attack);
      g.gain.exponentialRampToValueAtTime(Math.max(vol * amp * SILENT, 1e-9), end);
      o.connect(g).connect(dest);
    };
    for (const [ratio, amp, share] of partials) {
      if (prime * ratio < 9000) part(prime * ratio, amp, t + decay * share, 0.003 + (ratio > 1.3 ? bloom : 0));
    }
    part(prime + 0.9, 0.4, t + decay * 0.75, 0.003);
  }

  private bell(t: number, prime: number, vol: number, decay: number, partials: Partials, o: { pan?: number; wet?: number; bloom?: number } = {}) {
    const k = this.voice();
    const out = k.gain(1);
    const p = k.pan(o.pan ?? 0);
    out.connect(p).connect(this.ui);
    if (o.wet) p.connect(k.gain(o.wet)).connect(this.verb);
    this.strike(k, t, prime, vol, decay, partials, out, o.bloom ?? 0);
    k.release();
  }

  /** Crossing into a zone: one deep stroke on a bowed gong. Bowed, so it swells rather than strikes. */
  private gong(t: number, vol: number) {
    const k = this.voice();
    const out = k.gain(0);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(vol, t + 0.9);
    out.gain.exponentialRampToValueAtTime(vol * SILENT, t + 8);
    out.connect(this.ui);
    out.connect(k.gain(1)).connect(this.verb);
    for (const [ratio, amp, share] of GONG) {
      const o = k.osc('sine', NOTE(38) * ratio, t, t + 8.05, (this.rand() - 0.5) * 6);
      const g = k.gain(0);
      // the bow wakes the low modes first; the high ones bloom later and die sooner
      const peak = t + 0.5 + ratio * 0.12;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, peak);
      g.gain.exponentialRampToValueAtTime(amp * SILENT * 10, Math.max(peak + 0.6, t + 0.9 + 7 * share));
      o.connect(g).connect(out);
    }
    k.release();
  }

  /** A swelling chord of sawtooth voices through vowel formants (the choir) or a plain low-pass. */
  private chord(
    t: number,
    notes: readonly number[],
    vol: number,
    dur: number,
    o: { attack?: number; vowel?: Vowel; cutoff?: number; toward?: readonly number[]; glide?: number; dest?: AudioNode; wet?: number; wetDest?: AudioNode; tuned?: boolean } = {},
  ) {
    const k = this.voice();
    const a = o.attack ?? Math.min(1.2, dur * 0.35);
    const env = k.gain(0);
    this.pluck(env.gain, t, a, vol / Math.sqrt(notes.length * 2), dur - a);
    const head = o.vowel ? this.formants(k, env, o.vowel) : env.connect(k.filter('lowpass', o.cutoff ?? 900, 0.7));
    head.connect(o.dest ?? this.ui);
    if (o.wet) head.connect(k.gain(o.wet)).connect(o.wetDest ?? this.verb);
    const tn = o.tuned ? this.tuned(k) : null;
    notes.forEach((m, i) => {
      const p = k.pan(notes.length > 1 ? -0.6 + (1.2 * i) / (notes.length - 1) : 0);
      p.connect(env);
      const target = o.toward?.[i];
      for (const det of [-7, 6]) {
        const osc = k.osc('sawtooth', NOTE(m), t, t + dur + 0.05, det + (this.rand() - 0.5) * 5);
        if (tn) tn.connect(osc.detune);
        // a glide toward another chord, slow enough that it never arrives
        if (target !== undefined) osc.frequency.setTargetAtTime(NOTE(target), t + 0.4, o.glide ?? 4.5);
        osc.connect(p);
      }
    });
    k.release();
  }

  /** High glassy partials trembling: the deep noticing you. */
  private shimmer(t: number, vol: number, dur: number) {
    const k = this.voice();
    const out = k.gain(0);
    this.pluck(out.gain, t, dur * 0.35, vol, dur * 0.65);
    out.connect(k.gain(0.5)).connect(this.ui);
    out.connect(k.gain(1.3)).connect(this.verb);
    for (const [m, x] of [[86, -0.5], [93, 0.5], [98, 0]] as const) {
      const o = k.osc('sine', NOTE(m), t, t + dur + 0.05, (this.rand() - 0.5) * 8);
      const tr = k.gain(0.6);
      k.lfo(0.7 + this.rand() * 0.9, 0.35, tr.gain, t, t + dur + 0.05);
      o.connect(tr).connect(k.pan(x)).connect(out);
    }
    k.release();
  }

  /** A low swell on D, with a copy an octave up for small speakers. */
  private lowSwell(t: number, vol: number, dur: number) {
    const k = this.voice();
    const g = k.gain(0);
    this.pluck(g.gain, t, dur * 0.4, vol, dur * 0.6);
    g.connect(this.ui);
    g.connect(k.gain(0.5)).connect(this.verb);
    for (const [m, a] of [[26, 0.8], [38, 0.6], [50, 0.12]] as const) k.osc('sine', NOTE(m), t, t + dur + 0.05).connect(k.gain(a)).connect(g);
    k.release();
  }

  /** One vast breath: in, rising and opening, then out. */
  private breathe(t: number, vol: number, dur: number, dest: AudioNode) {
    const k = this.voice();
    const src = k.noise(this.pink, t, t + dur + 0.1, 0.6);
    const bp = k.filter('bandpass', 200, 1.2);
    const inhale = dur * 0.4;
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(700, t + inhale);
    bp.frequency.exponentialRampToValueAtTime(160, t + dur);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + inhale);
    g.gain.linearRampToValueAtTime(vol * 0.8, t + inhale + 0.3);
    g.gain.exponentialRampToValueAtTime(vol * SILENT, t + dur);
    src.connect(bp).connect(g).connect(dest);
    g.connect(k.gain(0.9)).connect(dest === this.bed ? this.bedWet : this.verb);
    k.release();
  }

  /** Being looked at: a faint high pair, beating, and nothing else. */
  private stare(t: number, dur: number) {
    const k = this.voice();
    const g = k.gain(0);
    this.pluck(g.gain, t, dur * 0.4, 0.02, dur * 0.6);
    g.connect(this.ui);
    g.connect(k.gain(1.2)).connect(this.verb);
    k.osc('sine', NOTE(98), t, t + dur + 0.05).connect(k.pan(-0.4)).connect(g);
    k.osc('sine', NOTE(98) + 2.7, t, t + dur + 0.05).connect(k.pan(0.4)).connect(g);
    k.release();
  }

  /** A heartbeat thump, felt more than heard, with a knock that small speakers can carry. */
  private thump(t: number, vol: number, dest: AudioNode) {
    if (this.voices >= VOICE_CAP) return;
    const k = this.voice();
    const o = k.osc('sine', 70, t, t + 0.34);
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
    const g = k.gain(0);
    this.pluck(g.gain, t, 0.007, vol, 0.24);
    o.connect(g).connect(dest);
    // the wall of the chamber, two octaves up, so a phone hears the beat too
    const wall = k.osc('sine', 280, t, t + 0.2);
    wall.frequency.setValueAtTime(280, t);
    wall.frequency.exponentialRampToValueAtTime(170, t + 0.12);
    const wg = k.gain(0);
    this.pluck(wg.gain, t, 0.005, vol * 0.18, 0.1);
    wall.connect(wg).connect(dest);
    const n = k.noise(this.brown, t, t + 0.14, 1, false);
    const lp = k.filter('lowpass', 320, 0.9);
    const ng = k.gain(0);
    this.pluck(ng.gain, t, 0.004, vol * 0.8, 0.07);
    n.connect(lp).connect(ng).connect(dest);
    k.release();
  }

  /** A whisper: breath shaped into syllables by two moving formants, with a little sibilance, close to one ear. */
  private whisperAt(t: number, vol: number) {
    if (this.voices >= VOICE_CAP || vol <= 0) return;
    const k = this.voice();
    const src = k.noise(this.pink, t, undefined, 1);
    const f1 = k.filter('bandpass', 700, 5);
    const f2 = k.filter('bandpass', 1800, 7);
    const env = k.gain(0);
    src.connect(f1).connect(k.gain(3)).connect(env);
    src.connect(f2).connect(k.gain(2.2)).connect(env);
    const sib = k.gain(0);
    src.connect(k.filter('highpass', 4800, 0.8)).connect(sib);
    const side = this.rand() < 0.5 ? -1 : 1;
    const p = k.pan(side * 0.85);
    env.connect(p);
    sib.connect(p);
    p.connect(this.ui);
    p.connect(k.gain(0.5)).connect(this.verb);
    env.gain.setValueAtTime(0, t);
    sib.gain.setValueAtTime(0, t);
    let x = t;
    const syllables = 3 + Math.floor(this.rand() * 5);
    for (let i = 0; i < syllables; i++) {
      const len = 0.09 + this.rand() * 0.13;
      const a = vol * (0.5 + 0.5 * this.rand());
      f1.frequency.setTargetAtTime(380 + this.rand() * 520, x, 0.02);
      f2.frequency.setTargetAtTime(1100 + this.rand() * 1500, x, 0.03);
      env.gain.setTargetAtTime(a, x, 0.018);
      env.gain.setTargetAtTime(0, x + len * 0.7, 0.03);
      if (this.rand() < 0.4) {
        sib.gain.setTargetAtTime(a * 0.35, x, 0.01);
        sib.gain.setTargetAtTime(0, x + 0.06, 0.02);
      }
      x += len + 0.025 + this.rand() * 0.07;
    }
    if ('pan' in p) p.pan.linearRampToValueAtTime(side * (0.85 - 0.4 * this.rand()), x);
    src.stop(x + 0.35);
    k.release();
  }

  private bubblesAt(t: number, n: number, vol: number, o: { spread?: number; low?: number; high?: number; dest?: AudioNode; wet?: AudioNode } = {}) {
    if (n <= 0 || vol <= 0 || this.voices >= VOICE_CAP) return;
    const k = this.voice();
    const out = k.gain(1);
    out.connect(o.dest ?? this.ui);
    out.connect(k.gain(0.5)).connect(o.wet ?? this.verb);
    const spread = o.spread ?? 0.9;
    let at = t;
    for (let i = 0; i < n; i++) {
      const size = this.rand();
      const f = mix(o.high ?? 1400, o.low ?? 320, size) * (0.85 + 0.3 * this.rand());
      const len = 0.03 + size * 0.07;
      const osc = k.osc('sine', f, at, at + len + 0.03, 0, true);
      osc.frequency.setValueAtTime(f, at);
      osc.frequency.exponentialRampToValueAtTime(f * (1.5 + 0.6 * this.rand()), at + len);
      const g = k.gain(0);
      this.pluck(g.gain, at, 0.003, vol * (0.45 + 0.55 * this.rand()), len);
      osc.connect(g).connect(k.pan(this.rand() * 1.6 - 0.8)).connect(out);
      at += (spread / n) * (0.3 + 1.4 * this.rand());
    }
    k.release();
  }

  /** Going under: the slap of the surface, the plunge, and the world closing in. */
  private splash(t: number) {
    if (!this.audible()) return;
    const k = this.voice();
    const n = k.noise(this.pink, t, t + 0.6, 1, false);
    const hp = k.filter('highpass', 900, 0.7);
    const g = k.gain(0);
    this.pluck(g.gain, t, 0.004, 0.2, 0.4);
    n.connect(hp).connect(g).connect(this.ui);
    const o = k.osc('sine', 150, t, t + 0.5);
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.3);
    const og = k.gain(0);
    this.pluck(og.gain, t, 0.008, 0.16, 0.4);
    o.connect(og).connect(this.ui);
    const b = k.noise(this.brown, t, t + 1.4);
    const bg = k.gain(0);
    this.pluck(bg.gain, t, 0.05, 0.16, 1.2);
    b.connect(k.filter('lowpass', 500, 0.7)).connect(bg).connect(this.ui);
    g.connect(k.gain(0.4)).connect(this.verb);
    k.release();
    this.bubblesAt(t + 0.08, 12, 0.1, { spread: 1.2, low: 260, high: 1300 });
  }

  /** Surfacing: a rush up and the air opening. */
  private breach(t: number) {
    if (!this.audible()) return;
    const k = this.voice();
    const n = k.noise(this.pink, t, t + 1.2, 1, false);
    const bp = k.filter('bandpass', 300, 0.8);
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + 0.5);
    const g = k.gain(0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.08 * SILENT, t + 1.1);
    n.connect(bp).connect(g).connect(this.ui);
    g.connect(k.gain(0.4)).connect(this.verb);
    k.release();
  }
}
