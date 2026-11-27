import { FRAG, VERT } from './abyss.frag';
import { eyeAt, invertAt, paletteAt, smoothstep, type Palette } from './palette';

// Drives the abyss shader: camera depth with eased descents, flashes, the eye,
// tension and madness. Resolution adapts to keep phones smooth, and rendering
// pauses whenever the page is hidden. Everything that changes once per frame
// (zone weights, the lamp's flicker, the Eye's blinks, pupil and gaze, the
// heartbeat) is worked out here so the shader only does per-pixel work.

interface Tween {
  from: number;
  to: number;
  start: number;
  dur: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const UNIFORMS = [
  'uRes', 'uPx', 'uTime', 'uDepth', 'uInvert', 'uPaper', 'uInk', 'uGround', 'uLine', 'uGlow', 'uAccent', 'uFog', 'uIris',
  'uMadness', 'uVel', 'uFlash', 'uEye', 'uLook', 'uTension', 'uLamp', 'uCreature', 'uCity', 'uMotion',
  'uZone', 'uLife', 'uSeed',
] as const;
type UniformName = (typeof UNIFORMS)[number];

/** The idle cycle of the art kit: idle things breathe once every seven seconds. */
const BREATH = 7000;
/** How fast the shader clock runs with reduced motion: the sea all but stops. */
const CALM_CLOCK = 0.12;

/** 0 below a, rising to 1 by b, holding until c, gone by d. */
const band = (x: number, a: number, b: number, c: number, d: number) => smoothstep(a, b, x) * (1 - smoothstep(c, d, x));

export interface AbyssOptions {
  reducedMotion: boolean;
  /** Fixed render scale (render pixels per CSS pixel), for screenshots and trailers. */
  pinScale?: number;
}

export class Abyss {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private u = {} as Record<UniformName, WebGLUniformLocation | null>;
  private raf = 0;
  private last = performance.now();
  /** Shader seconds. Runs slowly with reduced motion, so toggling it never jumps. */
  private clock = 0;
  private scale = 1;
  private pinScale = 0;
  private maxScale = 1;
  private frameTimes: number[] = [];
  private lastScaleChange = 0;
  private running = false;

  depth = -32;
  private tween: Tween | null = null;
  private prevDepth = -32;
  private vel = 0;
  flash = 0;
  private eye = 0;
  private eyeTarget = 0;
  private look = { x: 0, y: 0.4 };
  madness = 0;
  tension = 0;
  /** 0..1: how close the things in the dark have come. Eases towards visitTarget, which decays. */
  private visit = 0;
  private visitTarget = 0;
  private motion = 1;
  palette: Palette = paletteAt(0);
  onDepth?: (depth: number) => void;

  // The Eye's life: blinks, the pupil and the gaze.
  private blink = 0;
  private blinkAt = -1;
  private blinkDur = 0;
  private blinkDepth = 1;
  private nextBlink = 0;
  private pupil = 0.35;
  private wasOpen = false;
  private gaze = { x: 0, y: 0.4 };
  private glance = { x: 0, y: 0 };
  private nextGlance = 0;
  private pointer = { x: 0, y: 0, at: -1e9 };
  /** The motes brighten together for one breath when the deep notices an answer. */
  private noticeAt = -1e9;
  private noticeAmt = 0;
  private beat = 0;
  private stutterAt = -1e9;
  private grainAt = 0;
  private seed: [number, number] = [0, 0];

  constructor(parent: HTMLElement, opts: AbyssOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'abyss';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.prepend(this.canvas);
    this.motion = opts.reducedMotion ? 0.3 : 1;
    this.pinScale = opts.pinScale && opts.pinScale > 0 ? Math.min(opts.pinScale, 3) : 0;
    this.init();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    // The Eye follows a finger or cursor for a while after it moves.
    const follow = (e: PointerEvent) => {
      const h = Math.max(1, window.innerHeight);
      const x = (e.clientX - window.innerWidth / 2) / (h * 0.3);
      const y = (e.clientY - h * 0.36) / (h * 0.3);
      const k = Math.min(1, 1 / Math.max(1e-3, Math.hypot(x, y)));
      this.pointer = { x: x * k, y: y * k, at: performance.now() };
    };
    window.addEventListener('pointermove', follow, { passive: true });
    window.addEventListener('pointerdown', follow, { passive: true });
  }

  get ok(): boolean {
    return !!this.gl;
  }

  setReducedMotion(on: boolean) {
    this.motion = on ? 0.3 : 1;
  }

  private init() {
    const gl = this.canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'default' });
    if (!gl) return;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.warn('[abyss] shader:', gl.getShaderInfoLog(s));
        return null;
      }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VERT);
    const fs = sh(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('[abyss] link:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of UNIFORMS) this.u[n] = gl.getUniformLocation(prog, n);
    this.gl = gl;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.stop();
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.init();
      this.start();
    });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const small = Math.min(window.innerWidth, window.innerHeight) < 600;
    this.maxScale = this.pinScale || (small ? Math.min(dpr, 1.6) : Math.min(dpr, 1.35));
    this.scale = this.maxScale;
    this.resize();
  }

  private resize() {
    const w = Math.max(1, Math.round(window.innerWidth * this.scale));
    const h = Math.max(1, Math.round(window.innerHeight * this.scale));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl?.viewport(0, 0, w, h);
    }
  }

  start() {
    if (this.running || !this.gl || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.frame(now);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Sink (or rise) to a depth over a duration. Resolves when the camera arrives. */
  descendTo(target: number, durMs = 2400): Promise<void> {
    if (durMs <= 0 || !this.gl) {
      this.depth = target;
      this.tween = null;
      this.onDepth?.(target);
      return Promise.resolve();
    }
    this.tween = { from: this.depth, to: target, start: performance.now(), dur: durMs };
    return new Promise((res) => setTimeout(res, durMs));
  }

  jumpTo(depth: number) {
    this.tween = null;
    this.depth = depth;
    this.prevDepth = depth;
  }

  pulse(strength = 1) {
    this.flash = Math.max(this.flash, strength);
  }

  /** Something comes closer for a while (after deep answers), and the motes notice. */
  summon(strength = 1) {
    this.visitTarget = Math.max(this.visitTarget, Math.min(1, strength));
    this.noticeAt = performance.now();
    this.noticeAmt = Math.min(1, strength);
  }

  /** Open (1) or close (0) the great eye. */
  setEye(open: number) {
    this.eyeTarget = open;
  }

  lookAt(x: number, y: number) {
    this.look = { x, y };
  }

  private adapt(dt: number, now: number) {
    if (this.pinScale) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 45) return;
    const sorted = this.frameTimes.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes.length = 0;
    if (now - this.lastScaleChange < 1500) return;
    if (median > 21 && this.scale > 0.55) {
      this.scale = Math.max(0.55, this.scale * 0.82);
      this.lastScaleChange = now;
      this.resize();
    } else if (median < 15 && this.scale < this.maxScale) {
      this.scale = Math.min(this.maxScale, this.scale * 1.08);
      this.lastScaleChange = now;
      this.resize();
    }
  }

  /** Blinks, pupil and gaze of the great Eye. Quick saccades, long fixations, nothing bounces. */
  private liveEye(open: number, now: number, dt: number, calm: boolean) {
    const isOpen = open > 0.15;
    if (isOpen && !this.wasOpen) this.pupil = 1; // it opens wide, then narrows onto you
    this.wasOpen = isOpen;

    if (open > 0.6 && !calm) {
      if (this.blinkAt < 0 && now >= this.nextBlink) {
        const slow = Math.random() < 0.3; // now and then a slow, heavy half-close
        this.blinkAt = now;
        this.blinkDur = slow ? 2400 : 700;
        this.blinkDepth = slow ? 0.62 : 1;
      }
    } else if (this.blinkAt < 0) {
      this.nextBlink = now + 3000 + Math.random() * 3000;
    }
    if (this.blinkAt >= 0) {
      const k = (now - this.blinkAt) / this.blinkDur;
      if (k >= 1) {
        this.blinkAt = -1;
        this.blink = 0;
        this.nextBlink = now + 6000 + Math.random() * 9000;
      } else {
        this.blink = this.blinkDepth * (k < 0.32 ? smoothstep(0, 0.32, k) : 1 - smoothstep(0.32, 1, k));
      }
    }

    const breath = Math.sin((now / BREATH) * Math.PI * 2);
    const rest = calm ? 0.3 : 0.3 + 0.07 * breath - this.flash * 0.25;
    this.pupil += (rest - this.pupil) * (1 - Math.pow(0.45, dt / 1000));

    if (!calm && now >= this.nextGlance) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() < 0.4 ? 0 : 0.12 + Math.random() * 0.3;
      this.glance = { x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6 };
      this.nextGlance = now + 1300 + Math.random() * 3400;
    }
    const age = now - this.pointer.at;
    const follow = calm ? 0 : 0.75 * (1 - smoothstep(2500, 4500, age));
    const tx = this.look.x + this.glance.x + (this.pointer.x - this.look.x - this.glance.x) * follow;
    const ty = this.look.y + this.glance.y + (this.pointer.y - this.look.y - this.glance.y) * follow;
    const k = 1 - Math.pow(calm ? 0.3 : 0.0004, dt / 1000);
    this.gaze.x += (tx - this.gaze.x) * k;
    this.gaze.y += (ty - this.gaze.y) * k;
  }

  private frame(now: number) {
    const gl = this.gl!;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.adapt(dt, now);
    const calm = this.motion < 1;
    this.clock += (dt / 1000) * (calm ? CALM_CLOCK : 1);

    if (this.tween) {
      const k = Math.min(1, (now - this.tween.start) / this.tween.dur);
      this.depth = this.tween.from + (this.tween.to - this.tween.from) * easeInOut(k);
      if (k >= 1) this.tween = null;
    }
    const v = Math.abs(this.depth - this.prevDepth) / Math.max(dt, 1); // metres per ms
    this.prevDepth = this.depth;
    this.vel += ((calm ? 0 : Math.min(1.6, v * 2.2)) - this.vel) * 0.15;
    this.flash *= Math.pow(0.0025, dt / 1000);
    if (this.flash < 0.002) this.flash = 0;
    this.eye += (this.eyeTarget - this.eye) * (1 - Math.pow(0.12, dt / 1000));
    this.visitTarget *= Math.pow(0.93, dt / 1000);
    if (!calm && Math.random() < dt / 40000) this.visitTarget = Math.max(this.visitTarget, 0.5 + Math.random() * 0.4);
    this.visit += (this.visitTarget - this.visit) * (1 - Math.pow(0.25, dt / 1000)); // things rise, never pop
    this.onDepth?.(this.depth);

    const d = this.depth;
    const pal = paletteAt(d);
    this.palette = pal;
    const eyeOpen = Math.max(this.eye, eyeAt(d));
    this.liveEye(eyeOpen, now, dt, calm);

    // The lamp: a steady flicker, and deeper down it sometimes stutters.
    const c = this.clock;
    let lamp = smoothstep(250, 900, d);
    if (!calm) {
      lamp *= 0.93 + 0.035 * Math.sin(c * 3.1) + 0.025 * Math.sin(c * 7.7 + 1.3) + 0.012 * Math.sin(c * 17.3 + 0.4);
      if (d > 3000 && Math.random() < dt / 26000) this.stutterAt = now;
      const s = (now - this.stutterAt) / 420;
      if (s >= 0 && s < 1) lamp *= 1 - 0.55 * Math.sin(s * Math.PI) * (0.6 + 0.4 * Math.sin(s * 40));
    }

    // The heartbeat of the last seconds: lub-dub, quicker as the air runs out.
    this.beat = (this.beat + (dt / 1000) * (1 + this.tension * 1.2)) % 1;
    const b = this.beat;
    const lub = (x: number) => (x < 0 ? 0 : smoothstep(0, 0.035, x) * Math.exp(-Math.max(0, x - 0.035) * 13));
    const heart = calm ? 0 : Math.min(1, lub(b) + 0.6 * lub(b - 0.24));

    const nk = (now - this.noticeAt) / BREATH;
    const notice = nk >= 0 && nk < 1 ? this.noticeAmt * Math.pow(Math.sin(nk * Math.PI), 2) : 0;

    if (now - this.grainAt > (calm ? 400 : 0)) {
      this.grainAt = now;
      this.seed = [Math.floor(Math.random() * 512), Math.floor(Math.random() * 512)];
    }

    const u = this.u;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uPx, this.canvas.width / Math.max(1, window.innerWidth));
    gl.uniform1f(u.uTime, this.clock);
    gl.uniform1f(u.uDepth, d);
    gl.uniform1f(u.uInvert, invertAt(d));
    gl.uniform3fv(u.uPaper, pal.paper);
    gl.uniform3fv(u.uInk, pal.ink);
    gl.uniform3fv(u.uGround, pal.ground);
    gl.uniform3fv(u.uLine, pal.line);
    gl.uniform3fv(u.uGlow, pal.glow);
    gl.uniform3fv(u.uAccent, pal.accent);
    gl.uniform3fv(u.uFog, pal.fog);
    gl.uniform3fv(u.uIris, pal.iris);
    gl.uniform1f(u.uMadness, this.madness);
    gl.uniform1f(u.uVel, this.vel);
    gl.uniform1f(u.uFlash, this.flash);
    gl.uniform1f(u.uEye, eyeOpen);
    gl.uniform2f(u.uLook, this.gaze.x, this.gaze.y);
    gl.uniform1f(u.uTension, this.tension);
    gl.uniform1f(u.uLamp, lamp);
    // The arms belong to the Stygian Dark: gone below 4,800 m, so deeper frames skip their cost.
    gl.uniform1f(u.uCreature, smoothstep(900, 1700, d) * (0.15 + 0.85 * this.visit) * (1 - smoothstep(3800, 4800, d)));
    gl.uniform1f(u.uCity, smoothstep(6000, 6950, d));
    gl.uniform1f(u.uMotion, this.motion);
    gl.uniform4f(
      u.uZone,
      band(d, 140, 320, 900, 1400), // the Gloaming's last light, and its jellyfish
      band(d, 900, 1400, 3900, 4500), // the Stygian Dark: the far arm and the lure
      band(d, 3600, 4300, 6400, 7000), // the Cyclopean Abyss: monoliths
      smoothstep(5700, 6500, d), // the Dreaming Deep: wrongness
    );
    gl.uniform4f(u.uLife, this.blink, this.pupil, heart, notice);
    gl.uniform2f(u.uSeed, this.seed[0], this.seed[1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
