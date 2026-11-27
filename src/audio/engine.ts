// Generative sound for the descent. Everything is synthesised with Web Audio:
// no audio files. A bed of filtered sea noise and a buoy bell at the surface;
// a low drone that grows a tritone as you sink; a drowned choir in the dark;
// hull creaks, distant leviathan calls and whispers when sanity thins.
// Event sounds (sonar pings, refusals, the descent) are built on demand.

type Tier = number;

const NOTE = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export class Sound {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private bus!: GainNode; // everything goes here, then master
  private verbSend!: GainNode;
  private noise!: AudioBuffer;
  private pink!: AudioBuffer;
  private seaFilter!: BiquadFilterNode;
  private seaGain!: GainNode;
  private swellGain!: GainNode;
  private droneGain!: GainNode;
  private droneFilter!: BiquadFilterNode;
  private tritone!: GainNode;
  private choirGain!: GainNode;
  private choirVoices: OscillatorNode[] = [];
  private depth = -30;
  private madness = 0;
  private tension = 0;
  private muted = false;
  private volume = 0.8;
  private timers: number[] = [];
  private heartTimer = 0;
  private started = false;

  get running(): boolean {
    return this.started && this.ctx?.state === 'running';
  }

  /** Must be called from a user gesture (tap/click/keypress). */
  async start(): Promise<void> {
    if (this.started) {
      await this.ctx?.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'playback' });
    this.ctx = ctx;
    this.started = true;
    try {
      (navigator as unknown as { audioSession?: { type: string } }).audioSession!.type = 'ambient';
    } catch {
      /* not supported */
    }

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.02;
    comp.release.value = 0.4;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0.9;
    this.bus.connect(comp).connect(this.master).connect(ctx.destination);

    const verb = ctx.createConvolver();
    verb.buffer = this.impulse(4.2);
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    this.verbSend = ctx.createGain();
    this.verbSend.gain.value = 1;
    this.verbSend.connect(verb).connect(verbOut).connect(this.bus);

    this.noise = this.makeNoise('brown', 6);
    this.pink = this.makeNoise('pink', 6);
    this.buildBed();
    this.buildDrone();
    this.buildChoir();
    this.scheduleAmbience();
    this.applyDepth(true);
    await ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.08);
  }

  setVolume(v: number) {
    this.volume = clamp01(v);
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.08);
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    if (this.started) void this.ctx?.resume();
  }

  // ------------------------------------------------------------- utilities

  private makeNoise(kind: 'brown' | 'pink' | 'white', seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w * 0.5;
        else if (kind === 'brown') {
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.2;
        } else {
          b0 = 0.99886 * b0 + w * 0.0555179;
          b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522;
          b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
      // crossfade the loop seam
      const fade = Math.floor(ctx.sampleRate * 0.05);
      for (let i = 0; i < fade; i++) {
        const k = i / fade;
        d[i] = d[i] * k + d[len - fade + i] * (1 - k);
      }
    }
    return buf;
  }

  /** A dark, long tail: decaying noise that loses its highs as it fades. */
  private impulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const k = 0.5 - 0.47 * t; // lowpass closes over time
        lp += (Math.random() * 2 - 1 - lp) * k;
        d[i] = lp * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
      }
    }
    return buf;
  }

  private loop(buf: AudioBuffer, rate = 1): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.loopStart = Math.random() * (buf.duration - 1);
    s.start(0, s.loopStart);
    return s;
  }

  private lfo(freq: number, depth: number, target: AudioParam, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.value = depth;
    o.connect(g).connect(target);
    o.start();
    return o;
  }

  private panner(x: number): StereoPannerNode | GainNode {
    const ctx = this.ctx!;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, x));
      return p;
    }
    return ctx.createGain();
  }

  private env(g: GainNode, t: number, a: number, peak: number, d: number) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // ----------------------------------------------------------- continuous

  private buildBed() {
    const ctx = this.ctx!;
    // The sea: brown noise through a lowpass that closes as you sink.
    const sea = this.loop(this.noise, 0.9);
    this.seaFilter = ctx.createBiquadFilter();
    this.seaFilter.type = 'lowpass';
    this.seaFilter.Q.value = 0.6;
    this.seaGain = ctx.createGain();
    this.seaGain.gain.value = 0.0;
    sea.connect(this.seaFilter).connect(this.seaGain).connect(this.bus);
    this.lfo(0.07, 140, this.seaFilter.frequency);

    // Surface swell: waves breaking in the fog, only near the top.
    const swell = this.loop(this.pink, 1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.5;
    this.swellGain = ctx.createGain();
    this.swellGain.gain.value = 0;
    const swellAmp = ctx.createGain();
    swellAmp.gain.value = 0.5;
    this.lfo(0.13, 0.45, swellAmp.gain);
    this.lfo(0.071, 260, bp.frequency);
    swell.connect(bp).connect(swellAmp).connect(this.swellGain).connect(this.bus);
    swellAmp.connect(this.verbSend);
  }

  private buildDrone() {
    const ctx = this.ctx!;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 180;
    this.droneFilter.Q.value = 2;
    this.droneFilter.connect(this.droneGain).connect(this.bus);
    this.droneGain.connect(this.verbSend);
    const voice = (f: number, type: OscillatorType, gain: number, dest: AudioNode) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g).connect(dest);
      o.start();
      this.lfo(0.03 + Math.random() * 0.05, f * 0.004, o.frequency);
      return o;
    };
    voice(NOTE(26), 'sine', 0.5, this.droneFilter); // D1
    voice(NOTE(26) * 1.003, 'triangle', 0.22, this.droneFilter);
    voice(NOTE(33), 'sine', 0.28, this.droneFilter); // A1
    this.tritone = ctx.createGain();
    this.tritone.gain.value = 0;
    this.tritone.connect(this.droneFilter);
    voice(NOTE(32), 'sawtooth', 0.09, this.tritone); // G#1: the devil's interval
    voice(NOTE(27), 'triangle', 0.12, this.tritone); // Eb1 rubbing on D
  }

  private buildChoir() {
    const ctx = this.ctx!;
    this.choirGain = ctx.createGain();
    this.choirGain.gain.value = 0;
    const out = ctx.createGain();
    out.gain.value = 0.5;
    this.choirGain.connect(out).connect(this.bus);
    this.choirGain.connect(this.verbSend);
    // A drowned choir singing "oo": sawtooths through vowel formants.
    const notes = [50, 53, 57, 63]; // D3 F3 A3 Eb4
    notes.forEach((n, i) => {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = NOTE(n);
      o.detune.value = (Math.random() - 0.5) * 14;
      this.lfo(4.6 + Math.random(), 6, o.detune); // vibrato
      this.lfo(0.05 + Math.random() * 0.04, 9, o.detune);
      const f1 = ctx.createBiquadFilter();
      f1.type = 'bandpass';
      f1.frequency.value = 320;
      f1.Q.value = 6;
      const f2 = ctx.createBiquadFilter();
      f2.type = 'bandpass';
      f2.frequency.value = 800;
      f2.Q.value = 9;
      const g = ctx.createGain();
      g.gain.value = 0.0;
      // each voice swells in and out on its own slow breath
      const sw = ctx.createGain();
      sw.gain.value = 0.14;
      this.lfo(0.04 + i * 0.013, 0.12, sw.gain);
      const pan = this.panner((i / (notes.length - 1)) * 1.4 - 0.7);
      o.connect(f1).connect(sw);
      o.connect(f2).connect(sw);
      sw.connect(pan).connect(this.choirGain);
      o.start();
      this.choirVoices.push(o);
      void g;
    });
  }

  private scheduleAmbience() {
    const every = (min: number, max: number, fn: () => void) => {
      const tick = () => {
        fn();
        this.timers.push(window.setTimeout(tick, (min + Math.random() * (max - min)) * 1000));
      };
      this.timers.push(window.setTimeout(tick, (min + Math.random() * (max - min)) * 500));
    };
    every(7, 13, () => {
      if (this.depth < 40) this.buoyBell();
    });
    every(1.2, 4, () => {
      if (this.depth > -2 && this.depth < 500) this.bubbles(2 + Math.floor(Math.random() * 4), 0.05 * (1 - this.depth / 500));
    });
    every(18, 42, () => {
      if (this.depth > 800) this.leviathan();
    });
    every(9, 26, () => {
      if (this.depth > 1500) this.creak();
    });
    every(5, 14, () => {
      if (this.madness > 0.35 && Math.random() < this.madness) this.whisper(0.6 * this.madness);
    });
  }

  /** Call often; it only re-targets params when depth moves meaningfully. */
  setDepth(m: number) {
    if (Math.abs(m - this.depth) < 8) return;
    this.depth = m;
    this.applyDepth(false);
  }

  private applyDepth(now: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const tc = now ? 0.01 : 0.6;
    const d = this.depth;
    const above = smooth(4, -10, d);
    this.seaFilter.frequency.setTargetAtTime(150 + 1300 * Math.pow(1 - smooth(0, 3000, d), 2) + above * 900, t, tc);
    this.seaGain.gain.setTargetAtTime(0.32 + 0.18 * smooth(0, 1000, d), t, tc);
    this.swellGain.gain.setTargetAtTime(0.55 * smooth(60, -2, d), t, tc);
    this.droneGain.gain.setTargetAtTime(0.05 + 0.35 * smooth(60, 3500, d), t, tc);
    this.droneFilter.frequency.setTargetAtTime(110 + 240 * smooth(0, 7000, d) + this.madness * 200, t, tc);
    this.tritone.gain.setTargetAtTime(smooth(2500, 6500, d) + this.madness * 0.4, t, tc);
    this.choirGain.gain.setTargetAtTime(0.9 * smooth(900, 5000, d), t, tc);
  }

  setMadness(m: number) {
    this.madness = clamp01(m);
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const v of this.choirVoices) v.detune.setTargetAtTime((Math.random() - 0.5) * 40 * this.madness, t, 2);
    this.applyDepth(false);
  }

  /** 0..1: the last seconds of air. Drives a heartbeat. */
  setTension(x: number) {
    this.tension = clamp01(x);
    if (this.tension > 0.01 && !this.heartTimer) this.heartbeat();
  }

  private heartbeat() {
    if (!this.ctx || this.tension <= 0.01) {
      this.heartTimer = 0;
      return;
    }
    const t = this.ctx.currentTime;
    const vol = 0.25 + this.tension * 0.55;
    this.thump(t, vol);
    this.thump(t + 0.22, vol * 0.7);
    const gap = 1100 - this.tension * 620;
    this.heartTimer = window.setTimeout(() => this.heartbeat(), gap);
  }

  private thump(t: number, vol: number) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.16);
    const g = ctx.createGain();
    this.env(g, t, 0.008, vol, 0.22);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.3);
  }

  // --------------------------------------------------------- ambient events

  buoyBell() {
    if (!this.ctx) return;
    // A bell buoy tolling somewhere out in the fog: FM bell, far away.
    this.bell(NOTE(57), 0.06, 5, -0.6 + Math.random() * 1.2, 0.85);
  }

  private bell(freq: number, vol: number, decay: number, pan: number, wet = 0.6) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const car = ctx.createOscillator();
    car.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.frequency.value = freq * 1.41;
    const mg = ctx.createGain();
    mg.gain.setValueAtTime(freq * 2.2, t);
    mg.gain.exponentialRampToValueAtTime(freq * 0.1, t + decay);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    this.env(g, t, 0.006, vol, decay);
    const p = this.panner(pan);
    const dry = ctx.createGain();
    dry.gain.value = 1 - wet;
    const send = ctx.createGain();
    send.gain.value = wet;
    car.connect(g).connect(p);
    p.connect(dry).connect(this.bus);
    p.connect(send).connect(this.verbSend);
    car.start(t);
    mod.start(t);
    car.stop(t + decay + 0.1);
    mod.stop(t + decay + 0.1);
  }

  bubbles(n: number, vol = 0.05) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let i = 0; i < n; i++) {
      const t = ctx.currentTime + i * (0.04 + Math.random() * 0.12);
      const o = ctx.createOscillator();
      const f = 300 + Math.random() * 700;
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (2 + Math.random()), t + 0.05);
      const g = ctx.createGain();
      this.env(g, t, 0.004, vol * (0.5 + Math.random() * 0.5), 0.06);
      const p = this.panner(Math.random() * 1.6 - 0.8);
      o.connect(g).connect(p).connect(this.bus);
      p.connect(this.verbSend);
      o.start(t);
      o.stop(t + 0.12);
    }
  }

  leviathan() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.05;
    const dur = 4 + Math.random() * 3;
    const base = 70 + Math.random() * 50;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(base, t + dur * 0.6);
    o.frequency.exponentialRampToValueAtTime(base * 0.7, t + dur);
    const fm = ctx.createOscillator();
    fm.frequency.value = 6 + Math.random() * 8;
    const fg = ctx.createGain();
    fg.gain.value = base * 0.08;
    fm.connect(fg).connect(o.frequency);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(260, t);
    lp.frequency.linearRampToValueAtTime(520, t + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(180, t + dur);
    lp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.panner(Math.random() * 1.8 - 0.9);
    const send = ctx.createGain();
    send.gain.value = 1.2;
    o.connect(lp).connect(g).connect(p);
    p.connect(this.bus);
    p.connect(send).connect(this.verbSend);
    o.start(t);
    fm.start(t);
    o.stop(t + dur + 0.1);
    fm.stop(t + dur + 0.1);
  }

  /** The bathysphere's hull groaning under the pressure. */
  creak() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const dur = 0.6 + Math.random() * 1.2;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const f = 180 + Math.random() * 260;
    bp.frequency.setValueAtTime(f, t);
    bp.frequency.linearRampToValueAtTime(f * (0.6 + Math.random() * 0.8), t + dur);
    bp.Q.value = 28;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = this.panner(Math.random() * 1.4 - 0.7);
    src.connect(bp).connect(g).connect(p).connect(this.bus);
    p.connect(this.verbSend);
    src.start(t, Math.random() * 4, dur + 0.1);
  }

  whisper(vol = 0.3) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const syll = 3 + Math.floor(Math.random() * 5);
    const p = this.panner(Math.random() < 0.5 ? -0.85 : 0.85);
    const send = ctx.createGain();
    send.gain.value = 0.8;
    p.connect(this.bus);
    p.connect(send).connect(this.verbSend);
    for (let i = 0; i < syll; i++) {
      const st = t + i * (0.11 + Math.random() * 0.1);
      const src = ctx.createBufferSource();
      src.buffer = this.pink;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1400;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      const vf = 1800 + Math.random() * 2200;
      bp.frequency.setValueAtTime(vf, st);
      bp.frequency.linearRampToValueAtTime(vf * (0.6 + Math.random() * 0.7), st + 0.12);
      bp.Q.value = 4;
      const g = ctx.createGain();
      this.env(g, st, 0.03, vol * (0.4 + Math.random() * 0.6), 0.12);
      src.connect(hp).connect(bp).connect(g).connect(p);
      src.start(st, Math.random() * 4, 0.2);
    }
  }

  // ----------------------------------------------------------- game events

  click() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(420, t + 0.05);
    const g = ctx.createGain();
    this.env(g, t, 0.003, 0.05, 0.07);
    o.connect(g).connect(this.bus);
    o.start(t);
    o.stop(t + 0.1);
  }

  key() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 + Math.random() * 1600;
    bp.Q.value = 3;
    const g = ctx.createGain();
    this.env(g, t, 0.001, 0.05, 0.03);
    src.connect(bp).connect(g).connect(this.bus);
    src.start(t, Math.random() * 4, 0.05);
  }

  /** Sonar ping plus a stinger that grows with the tier. */
  accept(tier: Tier) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.01;
    const pings = [1320, 1175, 1046, 880, 740, 587];
    const f = pings[Math.max(0, Math.min(5, tier - 1))];
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.985, t + 1.6);
    const g = ctx.createGain();
    this.env(g, t, 0.004, 0.16, 1.8);
    const send = ctx.createGain();
    send.gain.value = 1.4;
    o.connect(g);
    g.connect(this.bus);
    g.connect(send).connect(this.verbSend);
    o.start(t);
    o.stop(t + 2);
    // the echo comes back from below, later the deeper you've gone
    this.timers.push(window.setTimeout(() => this.echo(f * 0.5, 0.05), 380 + tier * 60));
    if (tier >= 3) this.swellChord(tier >= 5 ? [38, 45, 50, 53] : [45, 50, 57], 0.05 + tier * 0.012, 2.6 + tier * 0.4);
    if (tier >= 5) this.bell(NOTE(38 + (tier === 6 ? -5 : 0)), 0.09, 6, 0, 0.7);
    if (tier >= 6) {
      this.boom(0.5);
      this.whisper(0.35);
    }
  }

  private echo(f: number, vol: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.value = f;
    const g = ctx.createGain();
    this.env(g, t, 0.01, vol, 1.2);
    const p = this.panner((Math.random() - 0.5) * 0.6);
    o.connect(g).connect(p).connect(this.verbSend);
    o.start(t);
    o.stop(t + 1.4);
  }

  private swellChord(midis: number[], vol: number, dur: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.05;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    g.connect(lp);
    lp.connect(this.bus);
    lp.connect(this.verbSend);
    for (const m of midis) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = NOTE(m);
        o.detune.value = det;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
  }

  private boom(vol: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(64, t);
    o.frequency.exponentialRampToValueAtTime(26, t + 2.2);
    const g = ctx.createGain();
    this.env(g, t, 0.02, vol, 2.6);
    o.connect(g);
    g.connect(this.bus);
    g.connect(this.verbSend);
    o.start(t);
    o.stop(t + 2.8);
  }

  refuse() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const g = ctx.createGain();
    this.env(g, t, 0.005, 0.12, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + 0.45);
    g.connect(lp).connect(this.bus);
    for (const f of [98, 103.8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(g);
      o.start(t);
      o.stop(t + 0.6);
    }
    this.thump(t, 0.22);
    if (Math.random() < 0.5 + this.madness * 0.5) this.whisper(0.18 + this.madness * 0.2);
  }

  timeout() {
    if (!this.ctx) return;
    this.bubbles(14, 0.07);
    this.boom(0.3);
    this.swellChord([37, 38, 44], 0.05, 2.5);
  }

  /** The rush of sinking: falling filtered noise for the length of the descent. */
  descend(ms: number, metres: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.02;
    const dur = ms / 1000;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 3;
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    const g = ctx.createGain();
    const peak = 0.12 + Math.min(1, metres / 1000) * 0.16;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + dur * 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 1.1);
    src.connect(lp).connect(g).connect(this.bus);
    g.connect(this.verbSend);
    src.start(t, Math.random() * 4);
    src.stop(t + dur * 1.15);
    // the cable sings a falling tone
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(320, t);
    o.frequency.exponentialRampToValueAtTime(70, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.025, t + dur * 0.5);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(og).connect(this.verbSend);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** Crossing into a new zone: a deep tolling and a chord from below. */
  zone() {
    if (!this.ctx) return;
    this.bell(NOTE(31), 0.12, 7, 0, 0.75);
    this.swellChord([26, 33, 38], 0.07, 4.5);
  }

  tick(urgent: boolean) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.pink;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = urgent ? 1800 : 1200;
    bp.Q.value = 9;
    const g = ctx.createGain();
    this.env(g, t, 0.001, urgent ? 0.35 : 0.2, 0.05);
    src.connect(bp).connect(g).connect(this.bus);
    src.start(t, Math.random() * 4, 0.08);
  }

  omen() {
    if (!this.ctx) return;
    [69, 72, 75].forEach((m, i) => this.timers.push(window.setTimeout(() => this.bell(NOTE(m), 0.04, 3.5, (i - 1) * 0.5, 0.8), i * 180)));
  }

  /** The eye opens: everything below seems to inhale. */
  eye() {
    if (!this.ctx) return;
    this.boom(0.6);
    this.swellChord([26, 27, 33, 38, 39], 0.08, 7);
    this.timers.push(window.setTimeout(() => this.whisper(0.4), 1200));
  }

  /** Haptic tick where supported (Android); silently ignored elsewhere. */
  static buzz(pattern: number | number[]) {
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* ignore */
    }
  }
}
