import { FRAG, VERT } from './abyss.frag';
import { eyeAt, invertAt, paletteAt, smoothstep, type Palette } from './palette';

// Drives the abyss shader: camera depth with eased descents, flashes, the eye,
// tension and madness. Resolution adapts to keep phones smooth, and rendering
// pauses whenever the page is hidden.

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
] as const;
type UniformName = (typeof UNIFORMS)[number];

export interface AbyssOptions {
  reducedMotion: boolean;
}

export class Abyss {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private u = {} as Record<UniformName, WebGLUniformLocation | null>;
  private raf = 0;
  private t0 = performance.now();
  private last = performance.now();
  private scale = 1;
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
  /** 0..1: how close the things in the dark have come. Decays on its own. */
  private visit = 0;
  private motion = 1;
  palette: Palette = paletteAt(0);
  onDepth?: (depth: number) => void;

  constructor(parent: HTMLElement, opts: AbyssOptions) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'abyss';
    this.canvas.setAttribute('aria-hidden', 'true');
    parent.prepend(this.canvas);
    this.motion = opts.reducedMotion ? 0.3 : 1;
    this.init();
    window.addEventListener('resize', () => this.resize());
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
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
    this.maxScale = small ? Math.min(dpr, 1.6) : Math.min(dpr, 1.35);
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

  /** Something comes closer for a while (after deep answers, at random). */
  summon(strength = 1) {
    this.visit = Math.max(this.visit, Math.min(1, strength));
  }

  /** Open (1) or close (0) the great eye. */
  setEye(open: number) {
    this.eyeTarget = open;
  }

  lookAt(x: number, y: number) {
    this.look = { x, y };
  }

  private adapt(dt: number, now: number) {
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

  private frame(now: number) {
    const gl = this.gl!;
    const dt = Math.min(100, now - this.last);
    this.last = now;
    this.adapt(dt, now);

    if (this.tween) {
      const k = Math.min(1, (now - this.tween.start) / this.tween.dur);
      this.depth = this.tween.from + (this.tween.to - this.tween.from) * easeInOut(k);
      if (k >= 1) this.tween = null;
    }
    const v = Math.abs(this.depth - this.prevDepth) / Math.max(dt, 1); // metres per ms
    this.prevDepth = this.depth;
    this.vel += (Math.min(1.6, v * 2.2) - this.vel) * 0.15;
    this.flash *= Math.pow(0.0025, dt / 1000);
    if (this.flash < 0.002) this.flash = 0;
    this.eye += (this.eyeTarget - this.eye) * (1 - Math.pow(0.12, dt / 1000));
    this.visit *= Math.pow(0.93, dt / 1000);
    if (Math.random() < dt / 40000) this.summon(0.5 + Math.random() * 0.4);
    this.onDepth?.(this.depth);

    const d = this.depth;
    const pal = paletteAt(d);
    this.palette = pal;
    const u = this.u;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uPx, this.canvas.width / Math.max(1, window.innerWidth));
    gl.uniform1f(u.uTime, (now - this.t0) / 1000);
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
    gl.uniform1f(u.uEye, Math.max(this.eye, eyeAt(d)));
    gl.uniform2f(u.uLook, this.look.x, this.look.y);
    gl.uniform1f(u.uTension, this.tension);
    gl.uniform1f(u.uLamp, smoothstep(250, 900, d));
    gl.uniform1f(u.uCreature, smoothstep(900, 1700, d) * (0.15 + 0.85 * this.visit) * (1 - smoothstep(6000, 6800, d) * 0.6));
    gl.uniform1f(u.uCity, smoothstep(4600, 6900, d));
    gl.uniform1f(u.uMotion, this.motion);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
