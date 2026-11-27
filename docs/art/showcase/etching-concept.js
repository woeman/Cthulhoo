/**
 * etching-concept.js — CONCEPT SHADER for the "Ink & Phosphor" look.
 *
 * Reference, not production. It exists to show the signature technique so the
 * game's real renderer (src/render) can match it:
 *
 *   1. Build a TONAL image first (how much light reaches each pixel: rays,
 *      caustics, fog, motes, silhouettes). No colour yet.
 *   2. ENGRAVE it: convert tone into line-screen hatching. Wavy horizontal
 *      "engraved sea" lines everywhere; diagonal and cross-hatch layers only
 *      where it is darker. Line width swells with tone, like a burin cut.
 *   3. INVERT with depth: near the surface it is dark ink on bone paper. Around
 *      200 m an ink-wash front rises from the bottom of the screen and the same
 *      lines become light on black water, glowing in the zone's colour.
 *
 * WebGL1, one full-screen pass, no extensions. Lines are anti-aliased
 * analytically (their spacing is known in CSS pixels), so no derivatives needed.
 *
 *   import { createEtchingBackground } from './etching-concept.js';
 *   const bg = createEtchingBackground(canvas);
 *   bg.setDepth(4312);    // metres; eases towards it like a cable paying out
 */
import { paletteAt, hexToRgb, MAX_DEPTH } from '../../../art/js/depth.js';

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

export const FRAG = `
precision highp float;

uniform vec2  u_res;      // drawing-buffer size in device px
uniform float u_scale;    // device px per CSS px
uniform float u_time;     // seconds
uniform float u_depth;    // 0..1 (0 = surface, 1 = 7,000 m)
uniform float u_invert;   // 0 = ink on paper, 1 = light on void
uniform float u_sink;     // descent speed, + while sinking (marine snow rises)
uniform float u_eye;      // 0..1 how far the great Eye has opened
uniform float u_madness;  // 0..1 extra wrongness (wobble, a hatch angle that should not exist)
uniform vec3  u_water, u_fog, u_glow, u_accent, u_paper, u_ink;

/* ---------------------------------------------------------------- noise */
float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= 0.5; }
  return v;
}

/* ---------------------------------------------------------------- line screen
   Ink coverage (0..1) of a family of parallel lines.
   coord: position across the lines in CSS px; spacing: CSS px between lines;
   w: 0..1 half-width of each line as a fraction of the gap.                */
float lines(float coord, float spacing, float w) {
  float f = abs(fract(coord / spacing) - 0.5) * 2.0;   // 0 mid-gap .. 1 on the line centre
  float aa = 2.4 / (spacing * u_scale);
  return smoothstep(1.0 - w - aa, 1.0 - w + aa, f) * step(0.001, w);
}

/* ---------------------------------------------------------------- silhouettes */

// A vast tentacle crossing the far water (Stygian Dark).
// .x = signed distance to the body, .y = sucker rings along the underside.
vec2 tentacle(vec2 p, float t) {
  float x = p.x;
  float spine = 0.02 + 0.2 * sin(x * 1.5 + t * 0.09) + 0.06 * sin(x * 3.7 - t * 0.13);
  float taper = smoothstep(-1.5, 1.2, x);
  float r = mix(0.003, 0.2, taper * taper);
  float sd = abs(p.y - spine) - r;
  float freq = mix(26.0, 9.0, taper);
  float cell = fract(x * freq) - 0.5;
  vec2 c = vec2(cell / freq, p.y - (spine - r * 0.62));
  float ring = smoothstep(0.004, 0.0, abs(length(c) - r * 0.2)) * step(0.02, r) * smoothstep(0.0, -0.6, c.y / (r * 0.2));
  return vec2(sd, ring);
}

// Distance to the nearest edge between irregular cells: polygonal, fitted stones.
float stoneEdge(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr;
  float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 19.19));
    vec2 r = g + o - f;
    float dd = dot(r, r);
    if (dd < md) { md = dd; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = vec2(hash(n + g), hash(n + g + 19.19));
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.0001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return md;
}

// Cyclopean masonry with angles that are almost, but not quite, right.
// Returns 1 inside stone; "course" carries the stone joints.
float ruinLayer(vec2 p, float seed, float base, float hgt, out float course) {
  float w = 0.17;
  float cx = floor(p.x / w);
  float h1 = hash(vec2(cx, 3.1 + seed)), h2 = hash(vec2(cx, 5.7 + seed)), h3 = hash(vec2(cx, 9.7 + seed));
  float lean = (h3 - 0.5) * 0.35;                       // whole blocks lean
  float lx = p.x + lean * (p.y - base);
  float fx = fract(lx / w);
  float h = hgt * (0.25 + 0.75 * h1 * h2);
  h *= h1 > 0.86 ? 2.1 : 1.0;                           // the odd obelisk
  float slope = (h2 - 0.5) * 1.1;                       // slanted, wrong tops
  float top = base + h + slope * (fx - 0.5) * w;
  top -= h3 > 0.7 ? step(0.5, fract(fx * 2.0)) * 0.05 : 0.0;   // stepped crowns
  float gap = step(0.05 + 0.1 * h3, fx) * step(fx, 0.95 - 0.12 * h1);
  float inside = step(p.y, top) * gap;
  float e = stoneEdge(vec2(lx * 9.0, (p.y - base) * 7.0) + seed * 3.7);
  course = smoothstep(0.06, 0.0, e) * inside;
  return inside;
}

// The Watcher's eye: an almond that opens, an iris of radial burin strokes,
// and a W-shaped pupil like a cuttlefish's.
// .x inside the lids, .y inside the iris, .z iris line pattern, .w pupil.
vec4 eye(vec2 p, float open, float t, out float lidEdge, out float folds) {
  vec2 q = p - vec2(0.0, -0.1);
  float W = 0.78, H = 0.30 * open;
  float u = clamp(abs(q.x / W), 0.0, 1.0);
  float upper = H * (1.0 - pow(u, 2.0)) * (1.0 + 0.12 * (q.x / W));
  float lower = -0.75 * H * (1.0 - pow(u, 2.4));
  float inside = step(q.y, upper) * step(lower, q.y) * step(abs(q.x), W);
  lidEdge = (smoothstep(0.012, 0.0, abs(q.y - upper)) + smoothstep(0.01, 0.0, abs(q.y - lower)))
          * step(abs(q.x), W) * step(0.02, open);
  float fy = (q.y - upper) / max(0.02, 0.16 * open);
  folds = step(0.0, fy) * step(fy, 1.0) * step(abs(q.x), W * 1.1) * smoothstep(0.85, 1.0, fract(fy * 5.0)) * (1.0 - fy);
  float r = length(q);
  float R = 0.2;
  float iris = (1.0 - smoothstep(R - 0.004, R + 0.004, r)) * inside;
  float a = atan(q.y, q.x);
  float stri = 0.5 + 0.5 * sin(a * 96.0 + fbm(vec2(a * 6.0, r * 14.0)) * 7.0);
  float rings = smoothstep(0.93, 1.0, sin(r * 110.0 + fbm(vec2(a * 3.0, 1.0)) * 2.0) * 0.5 + 0.5) * smoothstep(0.06, 0.12, r);
  float breath = 0.5 + 0.5 * sin(t * 6.2831 / 7.0);
  float px = q.x / (0.12 + 0.01 * breath);
  float yc = 0.004 + 0.02 * cos(px * 7.0) * (1.0 - 0.25 * px * px);
  float thick = 0.022 * pow(max(0.0, 1.0 - px * px), 0.6) * (1.0 + 0.35 * (1.0 - cos(px * 7.0)) * 0.5);
  float pupil = smoothstep(0.003, 0.0, abs(q.y - yc) - thick) * step(abs(px), 1.0) * inside;
  return vec4(inside, iris, max(stri * (1.0 - rings * 0.6), rings), pupil);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;                       // 0..1, y up
  vec2 css = frag / u_scale;                    // CSS px
  float aspect = u_res.x / u_res.y;
  vec2 p = (frag - 0.5 * u_res) / u_res.y;      // aspect space, y up, centre 0
  float t = u_time;
  float d = u_depth;

  /* ---------------- 1. tone: how much light is here (0 dark .. 1 bright) */
  float ambient = 1.0 - smoothstep(0.0, 0.075, d);
  float tone = ambient * mix(0.45, 1.0, pow(uv.y, 1.3));

  // God rays from the surface, gone by ~900 m.
  float rayAmt = 1.0 - smoothstep(0.02, 0.13, d);
  vec2 src = vec2(-0.35 * aspect + 0.08 * sin(t * 0.03), 1.25);
  vec2 rd = p - src;
  float ang = atan(rd.x, -rd.y);
  float rays = fbm(vec2(ang * 7.0, t * 0.05)) * fbm(vec2(ang * 15.0 + 3.0, t * 0.03));
  rays = smoothstep(0.16, 0.42, rays) * smoothstep(2.2, 0.2, length(rd));
  tone += rays * rayAmt * 0.6;

  // Caustics dancing near the top, surface only.
  vec2 cc = css * 0.012 + vec2(t * 0.05, -t * 0.03);
  float n1 = abs(noise(cc * 2.0) - 0.5), n2 = abs(noise(cc * 2.0 + 7.3 + t * 0.02) - 0.5);
  float caus = smoothstep(0.08, 0.0, n1 + n2 - 0.05) * (1.0 - smoothstep(0.0, 0.05, d)) * smoothstep(0.45, 1.0, uv.y);
  tone += caus * 0.35;

  // Murk: slow drifting fog volumes that carry faint light in the deep.
  float murk = fbm(css * 0.0035 + vec2(t * 0.012, t * 0.004 - d * 9.0));
  float deepLight = 0.10 + 0.16 * smoothstep(0.35, 0.85, murk);
  tone = max(tone, deepLight * smoothstep(0.05, 0.25, d));

  // Silhouettes: mostly an absence of light, with a faint rim.
  float sil = 0.0, rim = 0.0, suck = 0.0;
  float tentVis = smoothstep(0.14, 0.22, d) * (1.0 - smoothstep(0.52, 0.6, d));
  if (tentVis > 0.0) {
    vec2 tq = tentacle(p * 0.8 + vec2(0.0, 0.08), t);
    sil = max(sil, smoothstep(0.004, -0.004, tq.x) * tentVis);
    rim = max(rim, smoothstep(0.01, 0.0, abs(tq.x)) * tentVis);
    suck = tq.y * tentVis;
  }
  float course = 0.0, courseFar = 0.0, far = 0.0;
  float ruinVis = smoothstep(0.55, 0.62, d);
  if (ruinVis > 0.0) {
    float grow = smoothstep(0.6, 1.0, d);
    far = ruinLayer(p * 1.6 + vec2(t * 0.002 + 3.0, 0.0), 7.0, -0.3, mix(0.25, 0.4, grow), courseFar) * ruinVis;
    float nearR = ruinLayer(p * mix(1.3, 1.0, grow) + vec2(t * 0.004, 0.0), 1.0, -0.62, mix(0.3, 0.55, grow), course) * ruinVis;
    sil = max(sil, nearR);
    sil = max(sil, far * 0.55);
    course *= nearR;
  }
  vec4 E = vec4(0.0);
  float lidEdge = 0.0, folds = 0.0;
  if (u_eye > 0.001) {
    E = eye(p, u_eye, t, lidEdge, folds);
    sil = max(sil, E.x);
  }
  tone *= 1.0 - 0.92 * sil;
  tone += rim * 0.25 + suck * 0.12;

  // Marine snow, rising when you sink.
  float snow = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 26.0 + fi * 21.0;
    vec2 q = css / scale;
    q.y -= t * (0.05 + 0.03 * fi) * (1.0 + 6.0 * max(u_sink, 0.0)) - 3.0 * d * (fi + 1.0);
    q.x += sin(t * 0.2 + fi) * 0.3;
    vec2 cell = floor(q), f = fract(q);
    float h = hash(cell + fi * 13.7);
    vec2 pos = vec2(hash(cell + 1.7 + fi), hash(cell + 9.1 + fi));
    float rr = mix(0.025, 0.07, h * h) * (1.0 + fi * 0.3);
    snow += smoothstep(rr, rr * 0.2, length(f - pos)) * step(0.55, h) * (0.5 + 0.25 * fi);
  }
  snow *= smoothstep(0.03, 0.18, d) * (1.0 - sil);

  // Bioluminescent motes that pulse and drift (from the Gloaming down).
  float motes, moteHue;
  {
    vec2 q = css / 140.0;
    q += vec2(sin(t * 0.07) * 0.5, t * 0.02);
    vec2 cell = floor(q), f = fract(q);
    float h = hash(cell + 4.2);
    vec2 pos = 0.2 + 0.6 * vec2(hash(cell + 2.3), hash(cell + 7.7));
    pos += 0.08 * vec2(sin(t * 0.4 + h * 30.0), cos(t * 0.3 + h * 20.0));
    float pulse = pow(0.5 + 0.5 * sin(t * (0.6 + h) + h * 40.0), 3.0);
    float dist = length((f - pos) * 140.0);
    motes = (smoothstep(3.5, 0.0, dist) + 0.35 * exp(-dist * 0.12)) * step(0.62, h) * pulse;
    moteHue = step(0.9, h);                       // a few are lures, in the accent colour
    motes *= smoothstep(0.05, 0.2, d) * (1.0 - sil);
  }

  /* ---------------- 2. engrave the tone into line-screen hatching */
  float wob = fbm(css * 0.01 + 3.1) * 7.0
            + (1.0 + u_madness * 3.0) * 2.2 * sin(css.x * 0.021 + fbm(css * 0.004) * 5.0 + t * 0.25);
  float seaY  = css.y + wob;                                   // wavy engraved-sea lines
  float diagA = dot(css, vec2(0.866, 0.5)) + wob * 0.4;        // 30 degrees
  float diagB = dot(css, vec2(-0.574, 0.819)) + wob * 0.3;     // -55 degrees
  float madC  = dot(css, vec2(0.995, -0.1));                   // the wrong extra angle

  // Paper side: ink where it is dark.
  float ink = 1.0 - clamp(tone, 0.0, 1.0);
  float hatch = lines(seaY, 5.0, clamp((ink - 0.04) * 0.95, 0.0, 0.85));
  hatch = max(hatch, lines(diagA, 6.0, clamp((ink - 0.56) * 1.3, 0.0, 0.6)));
  hatch = max(hatch, lines(diagB, 7.0, clamp((ink - 0.76) * 1.6, 0.0, 0.6)));
  float stipple = step(0.86, ink) * step(0.72, hash(floor(css / 2.0)));
  float inkMask = max(hatch, stipple);

  // Void side: light lines where there is light.
  float lit = clamp(tone, 0.0, 1.0);
  float glowLines = lines(seaY, 6.0, clamp((lit - 0.04) * 0.55, 0.0, 0.3));
  glowLines = max(glowLines, lines(diagA, 7.0, clamp((lit - 0.42) * 0.7, 0.0, 0.25)));
  glowLines = max(glowLines, lines(madC, 9.0, clamp((u_madness - 0.4) * lit, 0.0, 0.35)));
  float carved = max(course, courseFar * 0.5) * (1.0 - E.x);

  /* ---------------- 3. colour both worlds, then let the ink wash decide */
  float paperGrain = fbm(css * 0.045) * 0.6 + fbm(css * 0.7) * 0.4;
  vec3 paper = mix(u_paper, u_fog, 0.35) * (0.9 + 0.12 * paperGrain);
  paper *= 1.0 - 0.18 * smoothstep(0.55, 1.25, length(uv - 0.5) * 1.6);   // burnt plate edges
  vec3 paperCol = mix(paper, u_ink, inkMask * 0.9);
  paperCol = mix(paperCol, u_water * 0.85, 0.22 * (1.0 - uv.y));         // a wash of sea colour below

  // Lines lit by the dying daylight take the colour of the sea; lines lit from
  // within the deep take the zone's glow.
  float dayShare = clamp(ambient * 1.4, 0.0, 1.0);
  vec3 lineCol = mix(u_glow, mix(u_fog, vec3(1.0), 0.45), dayShare * 0.85);
  vec3 voidCol = u_water * (0.75 + 0.5 * murk);
  voidCol = mix(voidCol, u_fog, 0.3 * smoothstep(0.4, 0.9, murk) * (1.0 - sil));
  voidCol = mix(voidCol, u_fog * 0.8, far * 0.35);
  voidCol += lineCol * glowLines * (0.22 + 0.55 * lit);
  voidCol += u_glow * rim * 0.18;
  voidCol += u_glow * suck * 0.14;
  voidCol += u_glow * carved * 0.22;
  voidCol += mix(u_glow, vec3(1.0), 0.4) * snow * 0.45;
  voidCol += mix(u_glow, u_accent, moteHue) * motes * 1.1;

  if (u_eye > 0.001) {
    float rEye = length(p - vec2(0.0, -0.1));
    float irisLines = smoothstep(0.55, 0.8, E.z);
    float limbal = smoothstep(0.12, 0.2, rEye);                 // dark outer ring
    float collar = smoothstep(0.09, 0.05, rEye);                // bright ring around the pupil
    vec3 irisCol = u_accent * (0.18 + 0.85 * irisLines * (1.0 - 0.75 * limbal) + 0.5 * collar);
    voidCol = mix(voidCol, u_water * 0.6 + u_fog * 0.25, E.x * (1.0 - E.y));       // sclera
    voidCol += u_glow * E.x * (1.0 - E.y) * lines(css.y + wob * 0.6, 7.0, 0.12) * 0.25;
    voidCol = mix(voidCol, irisCol, E.y);
    voidCol = mix(voidCol, vec3(0.0), E.w);
    voidCol += u_glow * lidEdge * 0.6 + u_fog * folds * 0.9;
    voidCol += u_accent * 0.08 * exp(-rEye * 5.0) * u_eye;      // the Eye's own light in the water
  }

  // The ink-wash front: darkness rises from below as you pass through ~200 m.
  float front = u_invert * 1.5 - 0.25;
  float edgeNoise = fbm(css * 0.006 + vec2(0.0, t * 0.05)) * 0.35 + (fbm(css * 0.03 - t * 0.04) - 0.5) * 0.08;
  float wash = smoothstep(front + 0.06, front - 0.06, uv.y + edgeNoise - 0.17);
  wash = u_invert >= 0.999 ? 1.0 : (u_invert <= 0.001 ? 0.0 : wash);
  vec3 col = mix(paperCol, voidCol, wash);
  float frontEdge = smoothstep(0.035, 0.0, abs(uv.y + edgeNoise - 0.17 - front)) * step(0.001, u_invert) * step(u_invert, 0.999);
  col = mix(col, u_ink, frontEdge * 0.6);                       // a dark bleeding margin at the front

  // Film grain and vignette.
  float grain = hash(css + fract(t * 7.0) * 100.0) - 0.5;
  col += grain * mix(0.035, 0.05, wash);
  col *= 1.0 - wash * 0.55 * smoothstep(0.45, 1.15, length((uv - 0.5) * vec2(aspect, 1.0)) * 1.1);

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader error');
  return s;
}

/** Depth in metres → how inverted the page is (0 ink on paper → 1 light on void). */
export const invertAt = (m) => {
  const x = Math.min(1, Math.max(0, (m - 110) / 230));
  return x * x * (3 - 2 * x);
};

/** How far the great Eye has opened at a depth (starts opening at 6,650 m). */
export const eyeAt = (m) => Math.max(0, Math.min(1, (m - 6650) / 350));

export function createEtchingBackground(canvas, opts = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, preserveDrawingBuffer: !!opts.preserve });
  if (!gl) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || 'link error');
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {};
  for (const n of ['u_res', 'u_scale', 'u_time', 'u_depth', 'u_invert', 'u_sink', 'u_eye', 'u_madness',
                   'u_water', 'u_fog', 'u_glow', 'u_accent', 'u_paper', 'u_ink'])
    U[n] = gl.getUniformLocation(prog, n);

  const paper = hexToRgb(opts.paper || '#e7ddc6');
  const ink = hexToRgb(opts.ink || '#1d1813');
  const start = opts.depth ?? 0;
  const state = { target: start, shown: start, eye: eyeAt(start), madness: 0, sink: 0, time: opts.time ?? 0, running: true };
  const pal = { rgb: {}, lin: {} };
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const maxScale = opts.maxScale || 1.5;

  function resize() {
    const scale = Math.min(window.devicePixelRatio || 1, maxScale);
    const w = Math.max(1, Math.round(canvas.clientWidth * scale));
    const h = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    return scale;
  }

  function draw(dt, instant) {
    const scale = resize();
    const prev = state.shown;
    const k = instant || reduce ? 1 : 1 - Math.exp(-dt * 1.6);     // ease like a cable paying out
    state.shown += (state.target - state.shown) * k;
    state.sink = instant ? 0 : Math.max(-1, Math.min(1, (state.shown - prev) / Math.max(dt, 1e-3) / 600));
    const m = state.shown;
    paletteAt(m, pal);
    const eyeTarget = Math.max(eyeAt(m), opts.forceEye || 0);
    state.eye += (eyeTarget - state.eye) * (instant || reduce ? 1 : 1 - Math.exp(-dt * 0.8));
    gl.uniform2f(U.u_res, canvas.width, canvas.height);
    gl.uniform1f(U.u_scale, scale);
    gl.uniform1f(U.u_time, state.time);
    gl.uniform1f(U.u_depth, m / MAX_DEPTH);
    gl.uniform1f(U.u_invert, invertAt(m));
    gl.uniform1f(U.u_sink, state.sink);
    gl.uniform1f(U.u_eye, state.eye);
    gl.uniform1f(U.u_madness, state.madness);
    gl.uniform3fv(U.u_water, pal.rgb.water);
    gl.uniform3fv(U.u_fog, pal.rgb.fog);
    gl.uniform3fv(U.u_glow, pal.rgb.glow);
    gl.uniform3fv(U.u_accent, pal.rgb.accent);
    gl.uniform3fv(U.u_paper, paper);
    gl.uniform3fv(U.u_ink, ink);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  let last = performance.now();
  let raf = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!reduce) state.time += dt;
    draw(dt);
    if (state.running) raf = requestAnimationFrame(frame);
  }
  if (opts.static) draw(1, true); else raf = requestAnimationFrame(frame);

  return {
    setDepth(m, { instant = false } = {}) {
      state.target = Math.max(0, Math.min(MAX_DEPTH, m));
      if (instant) { state.shown = state.target; state.eye = Math.max(eyeAt(state.target), opts.forceEye || 0); }
      if (opts.static) draw(1, true);
    },
    setMadness(v) { state.madness = v; if (opts.static) draw(1, true); },
    setTime(s) { state.time = s; if (opts.static) draw(1, true); },
    get depth() { return state.shown; },
    render() { draw(1, true); },
    destroy() { state.running = false; cancelAnimationFrame(raf); },
  };
}
