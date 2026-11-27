import { describe, expect, it } from 'vitest';
import { Sound } from '../src/audio/engine';

// A stand-in for Web Audio that records the graph and rejects what a browser
// would reject (bad automation values, sources started twice), so the engine
// can be exercised without a browser. tests/audio-levels.cjs renders the real
// thing in Chromium and measures it.

class FakeParam {
  events = 0;
  constructor(public value = 0) {}
  private ok(what: string, v: number, t: number) {
    if (!Number.isFinite(v)) throw new Error(`${what}: value ${v}`);
    if (!Number.isFinite(t) || t < 0) throw new Error(`${what}: time ${t}`);
    this.events++;
  }
  setValueAtTime(v: number, t: number) {
    this.ok('setValueAtTime', v, t);
    return this;
  }
  linearRampToValueAtTime(v: number, t: number) {
    this.ok('linearRampToValueAtTime', v, t);
    return this;
  }
  exponentialRampToValueAtTime(v: number, t: number) {
    this.ok('exponentialRampToValueAtTime', v, t);
    if (v <= 0) throw new RangeError(`exponential ramp to ${v}`);
    return this;
  }
  setTargetAtTime(v: number, t: number, tc: number) {
    this.ok('setTargetAtTime', v, t);
    if (!(tc > 0)) throw new RangeError(`time constant ${tc}`);
    return this;
  }
  setValueCurveAtTime(values: ArrayLike<number>, t: number, d: number) {
    for (const v of Array.from(values)) this.ok('setValueCurveAtTime', v, t);
    if (!(d > 0)) throw new RangeError(`curve duration ${d}`);
    return this;
  }
  cancelScheduledValues(t: number) {
    this.ok('cancelScheduledValues', 0, t);
    return this;
  }
}

class FakeNode {
  readonly outputs = new Set<FakeNode | FakeParam>();
  constructor(readonly ctx: FakeContext) {
    ctx.nodes.push(this);
  }
  connect<T extends FakeNode | FakeParam>(dest: T, _output?: number, _input?: number): T {
    if (!(dest instanceof FakeNode || dest instanceof FakeParam)) throw new TypeError('connect to nothing');
    this.outputs.add(dest);
    return dest;
  }
  disconnect(dest?: FakeNode | FakeParam) {
    if (dest === undefined) this.outputs.clear();
    else if (!this.outputs.delete(dest)) throw new Error('InvalidAccessError: not connected');
  }
}

class FakeGain extends FakeNode {
  gain = new FakeParam(1);
}
class FakeFilter extends FakeNode {
  type = 'lowpass';
  frequency = new FakeParam(350);
  Q = new FakeParam(1);
  detune = new FakeParam(0);
  gain = new FakeParam(0);
}
class FakePanner extends FakeNode {
  pan = new FakeParam(0);
}
class FakeDelay extends FakeNode {
  delayTime = new FakeParam(0);
}
class FakeCompressor extends FakeNode {
  threshold = new FakeParam(-24);
  knee = new FakeParam(30);
  ratio = new FakeParam(12);
  attack = new FakeParam(0.003);
  release = new FakeParam(0.25);
}
class FakeShaper extends FakeNode {
  curve: Float32Array | null = null;
  oversample = 'none';
}
class FakeConvolver extends FakeNode {
  buffer: FakeBuffer | null = null;
}

class FakeBuffer {
  private data: Float32Array[];
  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  get duration() {
    return this.length / this.sampleRate;
  }
  getChannelData(c: number) {
    return this.data[c];
  }
}

class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  started = -1;
  stopped = Infinity;
  ended = false;
  start(t = 0) {
    if (this.started >= 0) throw new Error('InvalidStateError: started twice');
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`start at ${t}`);
    this.started = t;
  }
  stop(t = 0) {
    if (this.started < 0) throw new Error('InvalidStateError: stopped before it started');
    if (!Number.isFinite(t) || t < 0) throw new RangeError(`stop at ${t}`);
    this.stopped = t;
  }
  get endsAt() {
    return this.stopped;
  }
}
class FakeOscillator extends FakeSource {
  type = 'sine';
  frequency = new FakeParam(440);
  detune = new FakeParam(0);
}
class FakeConstant extends FakeSource {
  offset = new FakeParam(1);
}
class FakeBufferSource extends FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  detune = new FakeParam(0);
  override get endsAt() {
    if (this.loop || !this.buffer) return this.stopped;
    return Math.min(this.stopped, this.started + this.buffer.duration / this.playbackRate.value);
  }
}

class FakeContext {
  nodes: FakeNode[] = [];
  buffers: FakeBuffer[] = [];
  currentTime = 0;
  sampleRate = 48000;
  state = 'running';
  onstatechange: (() => void) | null = null;
  destination = new FakeNode(this);
  createGain = () => new FakeGain(this);
  createBiquadFilter = () => new FakeFilter(this);
  createStereoPanner = () => new FakePanner(this);
  createDelay = () => new FakeDelay(this);
  createDynamicsCompressor = () => new FakeCompressor(this);
  createWaveShaper = () => new FakeShaper(this);
  createConvolver = () => new FakeConvolver(this);
  createChannelMerger = () => new FakeNode(this);
  createOscillator = () => new FakeOscillator(this);
  createConstantSource = () => new FakeConstant(this);
  createBufferSource = () => new FakeBufferSource(this);
  createBuffer = (channels: number, length: number, rate: number) => {
    const b = new FakeBuffer(channels, length, rate);
    this.buffers.push(b);
    return b;
  };
  /** Moves the clock and ends every source that has finished by then. */
  advance(seconds: number) {
    this.currentTime += seconds;
    for (const n of this.nodes) {
      if (n instanceof FakeSource && !n.ended && n.started >= 0 && n.endsAt <= this.currentTime) {
        n.ended = true;
        n.onended?.();
      }
    }
  }
}

const DEPTHS = [-32, 40, 600, 2500, 5000, 6500, 7040];

async function started(opts: { ambience?: boolean } = {}) {
  const ctx = new FakeContext();
  const sound = new Sound();
  await sound.start({ context: ctx as unknown as BaseAudioContext, seed: 5, ...opts });
  return { ctx, sound };
}

function everything(s: Sound) {
  s.click();
  s.key();
  s.key('space');
  s.key('back');
  s.tick(false);
  s.tick(true);
  for (let tier = 1; tier <= 6; tier++) s.accept(tier);
  s.refuse();
  s.timeout();
  s.descend(3000, 1000);
  s.zone();
  s.toll();
  s.eye();
  s.whisper(0.55);
  s.bubbles(16, 0.08);
  s.buoyBell();
  s.leviathan();
  s.creak();
  s.omen();
}

/** Runs the game's per-frame calls for a while, at 60 frames a second. */
function frames(ctx: FakeContext, s: Sound, seconds: number, depth: (t: number) => number) {
  for (let i = 0; i < seconds * 60; i++) {
    ctx.advance(1 / 60);
    s.setDepth(depth(i / 60));
    s.setMadness(0.2);
    s.setTension(0);
  }
}

describe('sound engine', () => {
  it('is safe to call before it starts, and without Web Audio', async () => {
    const s = new Sound();
    expect(() => {
      s.setMuted(false);
      s.setVolume(0.8);
      s.setDepth(500);
      s.setMadness(1);
      s.setTension(1);
      s.pump();
      everything(s);
      s.suspend();
      s.resume();
      Sound.buzz([20, 40]);
    }).not.toThrow();
    await s.start(); // no AudioContext in Node: a quiet no-op
    expect(s.running).toBe(false);
  });

  it('plays every call at every depth, mad or sane, without bad automation', async () => {
    const { ctx, sound } = await started();
    for (const m of [0, 1]) {
      for (const d of DEPTHS) {
        sound.setDepth(d);
        sound.setMadness(m);
        sound.setTension(m);
        sound.pump();
        everything(sound);
        sound.setDepth(Number.NaN);
        sound.setMadness(Number.NaN);
        ctx.advance(0.5);
        sound.pump();
      }
    }
    for (const b of ctx.buffers) {
      for (let c = 0; c < b.numberOfChannels; c++) {
        const data = b.getChannelData(c);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v));
        expect(Number.isFinite(peak)).toBe(true);
        expect(peak).toBeLessThanOrEqual(1);
      }
    }
  });

  it('ends and disconnects every event voice, and leaves the shared graph as it was', async () => {
    const { ctx, sound } = await started({ ambience: false });
    const shared = ctx.nodes.slice();
    const wiring = shared.map((n) => n.outputs.size);
    for (let i = 0; i < 3; i++) {
      everything(sound);
      ctx.advance(0.3);
    }
    expect(sound.activeVoices).toBeGreaterThan(20);
    ctx.advance(60);
    expect(sound.activeVoices).toBe(0);
    const made = ctx.nodes.slice(shared.length);
    expect(made.length).toBeGreaterThan(200);
    expect(made.filter((n) => n.outputs.size > 0)).toHaveLength(0);
    expect(shared.map((n) => n.outputs.size)).toEqual(wiring);
  });

  it('builds a zone only while it can be heard, and tears it down after', async () => {
    const { ctx, sound } = await started();
    sound.setDepth(-32);
    sound.pump();
    expect(sound.activeLayers.sort()).toEqual(['drone', 'surface']);
    const before = ctx.nodes.length;
    frames(ctx, sound, 20, (t) => Math.min(7040, 40 + t * 700));
    frames(ctx, sound, 10, () => 7040);
    expect(sound.activeLayers.sort()).toEqual(['drone', 'floor']);
    ctx.advance(1);
    // every layer that came and went is fully disconnected
    const live = new Set(ctx.nodes.filter((n) => n.outputs.size > 0));
    expect(live.size).toBeLessThan(before + 400);
    frames(ctx, sound, 30, (t) => Math.max(-32, 7040 - t * 700));
    frames(ctx, sound, 10, () => -32);
    expect(sound.activeLayers.sort()).toEqual(['drone', 'surface']);
  });

  it('makes nothing while muted or hidden', async () => {
    const { ctx, sound } = await started({ ambience: false });
    sound.setMuted(true);
    const n = ctx.nodes.length;
    everything(sound);
    sound.setMuted(false);
    sound.suspend();
    everything(sound);
    expect(ctx.nodes.length).toBe(n);
    sound.resume();
    sound.click();
    expect(ctx.nodes.length).toBeGreaterThan(n);
  });

  it('limits keys and caps voices', async () => {
    const { sound } = await started({ ambience: false });
    for (let i = 0; i < 50; i++) sound.key();
    expect(sound.activeVoices).toBe(1);
    for (let i = 0; i < 200; i++) sound.accept(6);
    expect(sound.activeVoices).toBeLessThan(110);
  });

  it('costs almost nothing per frame', async () => {
    const { ctx, sound } = await started({ ambience: false });
    sound.setDepth(600);
    const params = () => {
      let events = 0;
      for (const n of ctx.nodes) for (const v of Object.values(n)) if (v instanceof FakeParam) events += v.events;
      return events;
    };
    const nodes = ctx.nodes.length;
    const auto = params();
    // ten seconds of a camera bobbing at one depth: nothing new at all
    frames(ctx, sound, 10, (t) => 600 + Math.sin(t * 3));
    expect(ctx.nodes.length).toBe(nodes);
    expect(params() - auto).toBeLessThan(40);
    // a 1,000 m descent: a dial tick each 100 m, and a bounded amount of automation
    frames(ctx, sound, 3, (t) => 640 + 1000 * (t < 1.5 ? 4 * (t / 3) ** 3 : 1 - (-2 * (t / 3) + 2) ** 3 / 2));
    expect(ctx.nodes.length - nodes).toBeLessThan(60);
    expect(params() - auto).toBeLessThan(1500);
  });
});
