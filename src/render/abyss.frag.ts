// The abyss: one full-screen fragment shader, drawn as an engraving.
// Near the surface it is ink on bone paper (a hatched night sky, a ruled sea,
// light shafts). Sinking, the plate inverts: the paper goes black and the ink
// turns into glowing lines, lit only by the diver's lamp, living light and,
// at the bottom, the drowned city and the thing that watches from it.
//
// It follows the art kit's line rules (docs/art/04-line-and-texture.md): wavy
// sea lines 5 to 6 CSS px apart, a 30° set where it is darker, a −55° set where
// it is darker still, and with madness a fourth set 6° off vertical. Creatures
// are dark shapes against light with a thin rim (05-creatures-and-glyphs.md).
//
// Cost: every zone's work sits behind a uniform branch, so a frame only pays
// for what is on screen at that depth; noise is a vectorised hash, no texture.

export const VERT = /* glsl */ `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 uRes;      // render pixels
uniform float uPx;      // render pixels per CSS pixel
uniform float uTime;    // seconds (runs slowly with reduced motion)
uniform float uDepth;   // camera depth in metres (negative = above the water)
uniform float uInvert;  // 0 = ink on paper, 1 = glowing lines on black
uniform vec3 uPaper;
uniform vec3 uInk;
uniform vec3 uGround;
uniform vec3 uLine;
uniform vec3 uGlow;
uniform vec3 uAccent;
uniform vec3 uFog;
uniform vec3 uIris;
uniform float uMadness;
uniform float uVel;     // descent speed, 0..1.6
uniform float uFlash;
uniform float uEye;     // 0 closed .. 1 open
uniform vec2 uLook;     // gaze, about -1..1, with its saccades already eased
uniform float uTension;
uniform float uLamp;    // the lamp, with its flicker
uniform float uCreature;
uniform float uCity;
uniform float uMotion;  // 1 normal, 0.3 reduced motion
uniform vec4 uZone;     // x the Gloaming's last light, y Stygian life, z monoliths, w wrongness
uniform vec4 uLife;     // x blink (1 shut), y pupil (0 tight .. 1 wide), z heartbeat, w motes noticing
uniform vec2 uSeed;     // film grain offset in whole pixels

#define PI 3.14159265

// ---------------------------------------------------------------- noise
// Four pseudo-random numbers for one lattice cell (a hash without sine).
vec4 hash4(vec2 p) {
  vec4 q = fract(p.xyxy * vec4(0.1031, 0.1030, 0.0973, 0.1099));
  q += dot(q, q.wzxy + 33.33);
  return fract((q.xxyz + q.yzzw) * q.zywx);
}
float hash12(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
// Smooth value noise: one vectorised hash serves all four corners.
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec4 h = fract((i.x + i.y * 157.0 + vec4(0.0, 1.0, 157.0, 158.0)) * 0.1031);
  h *= h + 33.33;
  h *= h + h;
  h = fract(h);
  return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
}
float fbm(vec2 p) {
  return noise(p) * 0.5 + noise(p * 2.03 + vec2(17.3, 5.1)) * 0.3 + noise(p * 4.07 + vec2(3.7, 41.9)) * 0.2;
}
mat2 rot(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

// Coverage of one family of engraved lines. ph is the phase in line units,
// c the wanted coverage (0..1 of the spacing), aa the antialias width.
float engrave(float ph, float c, float aa) {
  float f = abs(fract(ph) - 0.5) * 2.0;
  return (1.0 - smoothstep(c - aa, c + aa, f)) * smoothstep(0.0, aa * 0.6, c);
}

float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}
// An arc of radius r centred on +y, reaching ap either side of it; sc = (sin ap, cos ap).
float sdArc(vec2 p, vec2 sc, float r) {
  p.x = abs(p.x);
  return (sc.y * p.x > sc.x * p.y) ? length(p - sc * r) : abs(length(p) - r);
}

// ---------------------------------------------------------------- creatures
// A swaying, tapering arm growing up from base, with suckers on its inner
// edge. Returns an approximate distance; info = (across -1..1, 0 base..1 tip, along, sucker ring).
float tentacle(vec2 p, vec2 base, float len, float thick, float phase, float curl, float t, out vec4 info) {
  vec2 q = p - base;
  float k = clamp(-q.y / len, 0.0, 1.0);
  float sway = sin(k * 4.0 - t * 0.5 + phase) * 0.05 * k + sin(k * 10.0 + t * 0.33 + phase * 1.7) * 0.012 * k;
  float k3 = k * k * k;
  float cx = sway + curl * k3 + curl * 0.6 * k3 * k3;
  float w = thick * pow(1.0 - k, 0.8) + 0.002;
  float xr = q.x - cx;
  float d = max(max(abs(xr) - w, q.y), -q.y - len);
  float side = curl > 0.0 ? 1.0 : -1.0;
  float gap = max(0.014, w * 1.7);
  vec2 sp = vec2((xr - side * w * 0.42) / max(w, 0.004), (fract(-q.y / gap) - 0.5) * gap / max(w, 0.004));
  float sucker = smoothstep(0.12, 0.0, abs(length(sp) - 0.3)) * step(d, 0.0) * step(k, 0.92) * step(0.004, w);
  info = vec4(xr / max(w, 0.001), k, -q.y, sucker);
  return d;
}

// A medusa drifting in the last light: a slowly pulsing bell with a scalloped
// margin, two oral arms and fine threads. q in bell radii, y down. Distance in bell radii.
float medusa(vec2 q, float pulse, float t) {
  vec2 b = q * vec2(1.0 - 0.05 * pulse, 1.0 + 0.07 * pulse);
  float bell = max(length(b * vec2(1.0, 1.3)) - 1.0, b.y - 0.1 - 0.06 * cos(b.x * 15.0));
  float y = q.y - 0.05;
  float sw = sin(y * 2.1 - t * 0.8) * 0.1 * y;
  float arms = abs(abs(q.x - sw) - 0.16 - 0.05 * sin(y * 4.0 + t * 0.6)) - 0.07 * (1.0 - smoothstep(0.0, 2.4, y));
  arms = max(arms, max(-y, y - 2.4));
  float threads = 1e3;
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float th = abs(q.x - (fi - 1.5) * 0.5 - sin(y * (1.4 + fi * 0.3) - t * 0.6 + fi * 1.7) * 0.16 * y) - 0.02;
    threads = min(threads, max(th, max(-y, y - (2.8 + fi * 0.45))));
  }
  return min(bell, min(arms, threads));
}

// ---------------------------------------------------------------- stone
// A field of leaning monoliths repeated across the screen. q in screen heights,
// y down; W the spacing; top the height of the tallest tops. Returns distance
// (negative inside) and face coordinates (x in half-widths, y down from the top).
float slabField(vec2 q, float W, float top, float seed, out vec2 uv) {
  float best = 1e3;
  uv = vec2(0.0);
  float c0 = floor(q.x / W) - (fract(q.x / W) < 0.5 ? 1.0 : 0.0);
  for (int k = 0; k < 2; k++) {
    float cx = c0 + float(k);
    vec4 r = hash4(vec2(cx, seed));
    float hw = W * (0.2 + 0.2 * r.y);
    vec2 l = q - vec2((cx + 0.5 + (r.x - 0.5) * 0.32) * W, 0.0);
    float ty = top + r.w * 0.2 - step(0.84, r.x) * 0.14;      // now and then one stands taller
    l.x += (r.z - 0.5) * 0.3 * (l.y - 0.2);                   // they lean, and not together
    float topY = ty + l.x * (fract(r.y * 9.7) - 0.5) * 1.5;   // tops cut at angles that disagree
    topY += step(0.7, r.z) * step(0.5, fract(l.x / hw * 1.5 + 0.5)) * 0.03; // a stepped crown
    float d = max(abs(l.x) - hw, topY - l.y);
    if (d < best) {
      best = d;
      uv = vec2(l.x / hw, l.y - topY);
    }
  }
  return best;
}

// A colossal slab standing at one edge of the screen. side -1 left, +1 right; inner is
// how far its edge stands from the centre at the bottom; lean tips it in towards the top.
// Returns distance (negative inside); uv = (depth into the stone from its edge, y below its top).
float edgeSlab(vec2 p, float side, float inner, float lean, float topY, float slope, out vec2 uv) {
  float ex = side * inner - side * lean * (0.5 - p.y);
  float into = side * (p.x - ex);
  float ty = topY + slope * into;
  uv = vec2(into, p.y - ty);
  return max(-into, ty - p.y);
}

// Irregular ashlar: courses that run a little off level and joints cut at the wrong
// slope. uv in screen heights. Returns the distance to the nearest joint, and a random
// number for the block, which picks the few joints that hold light.
vec2 masonry(vec2 uv, float seed) {
  float ch = 0.07;
  float yy = uv.y / ch + uv.x * 0.45;
  float row = floor(yy);
  float fy = fract(yy);
  vec4 r = hash4(vec2(row, seed));
  float bw = ch * (1.0 + r.x * 1.6);
  float xx = (uv.x + (fy - 0.5) * ch * (r.y - 0.5) * 0.8) / bw + r.z * 7.0;
  float fx = fract(xx);
  return vec2(min(min(fy, 1.0 - fy) * ch, min(fx, 1.0 - fx) * bw), fract(floor(xx) * 0.618 + r.w));
}

// The top of a wall cut into steps that climb towards its inner edge and stop there, in
// the air. into: distance from that edge; rise: how much lower each step outwards is.
float stairs(float into, float y, float top, float rise, float sw) {
  float k = max(floor(into / sw), 0.0);
  float f = into / sw - k;
  float tk = top + rise * k;
  float d = tk - y;
  if (d > 0.0) {
    if (k > 0.5 && y > tk - rise) d = min(d, f * sw);   // beside the riser of the step above
  } else if (y < tk + rise) {
    d = max(d, -(1.0 - f) * sw);                        // inside, near this step's own riser
  }
  return d;
}

// One glyph of the Drowned Script, hanging from its waterline at y = 0 (y grows down).
// g in glyph units (a cell is about 0.62 wide and 1 tall); r picks the glyph.
float glyph(vec2 g, vec4 r) {
  float sx = (r.x - 0.5) * 0.16;
  float y1 = 0.16 + 0.2 * r.y;
  float d = sdSeg(g, vec2(sx, 0.0), vec2(sx, y1));
  vec2 q = g - vec2(sx, y1);
  float k = floor(r.z * 6.0);
  float flip = r.w < 0.5 ? -1.0 : 1.0;
  float e;
  if (k < 1.0) {            // a ring, sometimes with a seed in it
    float l = length(q - vec2(0.0, 0.15));
    e = abs(l - 0.15);
    if (r.w > 0.4) e = min(e, l - 0.025);
  } else if (k < 2.0) {     // a hook that curls back on itself and ends in a dot
    vec2 c = q - vec2(0.1 * flip, 0.1);
    e = sdArc(rot(-1.9 * flip) * c, vec2(0.8, -0.6), 0.1);
    e = min(e, length(c - vec2(0.03 * flip, -0.02)) - 0.028);
  } else if (k < 3.0) {     // a zigzag that runs down to a dot
    vec2 b = vec2(0.16 * flip, 0.13);
    vec2 c = vec2(-0.1 * flip, 0.29);
    e = min(sdSeg(q, vec2(0.0), b), sdSeg(q, b, c));
    e = min(e, length(q - c - vec2(0.06 * flip, 0.07)) - 0.03);
  } else if (k < 4.0) {     // two claws curling up from the stem's end
    vec2 c = vec2(abs(q.x), q.y) - vec2(0.12, 0.05);
    e = sdArc(rot(0.7) * c, vec2(0.87, -0.5), 0.12);
  } else if (k < 5.0) {     // the stem forks at an angle that disagrees with itself
    vec2 b1 = vec2(-0.17, 0.22 + 0.06 * flip);
    vec2 b2 = vec2(0.12, 0.3 - 0.05 * flip);
    e = min(sdSeg(q, vec2(0.0), b1), sdSeg(q, vec2(0.0), b2));
    e = min(e, min(length(q - b1) - 0.032, length(q - b2) - 0.032));
  } else {                  // a cup hung from the stem, its lip turned in, seeds beneath
    e = sdArc(q - vec2(0.0, 0.02), vec2(0.94, 0.34), 0.15);
    e = min(e, length(q - vec2(0.07 * flip, 0.25)) - 0.026);
  }
  return min(d, e);
}

// ---------------------------------------------------------------- the eye
// After the art kit's layers: an almond with pointed corners and creased lids, an iris
// of fine radial strokes round a collarette, a cuttlefish W pupil and a curved glint.
// ep: eye space (corners at x = ±0.5, y down). Returns the colour inside the lids (rgb)
// and how much of the pixel is inside (a). Light outside the lids goes to rim; skin
// says how much of the flesh round the eye hides the water.
vec4 greatEye(vec2 ep, float open, vec2 gaze, float dil, float t, float aaE, out vec3 rim, out float skin) {
  float u = ep.x * 2.0;
  float s = max(1.0 - u * u, 0.0);
  float corner = step(abs(u), 1.0);
  float up = 0.31 * open * s * (1.0 + 0.07 * u);
  float lo = 0.23 * open * s * (0.72 + 0.28 * s);
  float dU = ep.y + up;                 // > 0 below the upper lid
  float dL = lo - ep.y;                 // > 0 above the lower lid
  float inside = corner * smoothstep(-aaE, aaE, min(dU, dL));

  // creases that follow the lids and meet in the corners
  float cr = 0.0;
  for (int i = 1; i < 4; i++) {
    float fi = float(i);
    float yc = -(0.31 * s * (1.0 + 0.07 * u)) * (1.0 + 0.2 * fi) * mix(0.45, 1.0, open) - 0.012 * fi * s;
    cr += smoothstep(0.0055, 0.0015, abs(ep.y - yc)) * (1.0 - fi * 0.22);
  }
  float ycl = 0.23 * s * mix(0.5, 1.0, open) * 1.45 + 0.01 * s;
  cr += smoothstep(0.005, 0.0015, abs(ep.y - ycl)) * 0.6;
  cr *= corner * smoothstep(0.0, 0.35, s);
  float aboveU = -dU;
  float belowL = -dL;
  skin = corner * max(smoothstep(0.0, 0.02, aboveU) * (1.0 - smoothstep(0.1, 0.2, aboveU / max(s, 0.05))),
                      smoothstep(0.0, 0.02, belowL) * (1.0 - smoothstep(0.06, 0.13, belowL / max(s, 0.05))));
  skin = max(skin, (1.0 - inside) * corner * step(min(dU, dL), 0.0) * step(aboveU, 0.0) * step(belowL, 0.0));

  // the wet margins of the lids, glinting a little along their length
  float shimmer = 0.6 + 0.4 * noise(vec2(u * 7.0 + t * 0.2, 3.0));
  float wetL = smoothstep(0.012, 0.002, abs(dL)) * corner;
  float wetU = smoothstep(0.009, 0.0015, abs(dU)) * corner;
  rim = (uGlow * 0.55 + uIris * 0.3) * wetL * shimmer * (0.4 + 0.6 * open);
  rim += (uIris * 0.35 + uGlow * 0.1) * wetU * (0.5 + 0.5 * open);
  rim += (uLine * 0.3 + uIris * 0.12) * cr;

  vec3 col = vec3(0.0);
  if (inside > 0.0) {
    // the eyeball: dark and wet, engraved with lines that bow over its curve
    vec2 bq = ep * vec2(1.6, 2.3);
    float zb = sqrt(max(0.0, 1.0 - dot(bq, bq)));
    float ball = engrave((ep.y - zb * 0.12) * 60.0, 0.12 + 0.14 * zb, 0.28);
    col = uGround * 0.5 + uFog * 0.14 * zb + uLine * ball * 0.1 * (0.3 + zb);
    // the iris sits behind the cornea and turns with the gaze
    vec2 ip = ep - gaze * vec2(0.15, 0.08);
    float ir = length(ip);
    float R = 0.2;
    float rn = ir / R;
    float irisM = 1.0 - smoothstep(R - aaE, R + aaE, ir);
    if (irisM > 0.0) {
      float a = atan(ip.y, ip.x);
      float wob = noise(vec2(a * 5.0 + 3.0, rn * 2.0 + t * 0.04));   // the fibres stir
      float sp = a * (36.0 / PI) + (wob - 0.5) * 0.9;
      float idx = floor(sp);
      float reach = 0.72 + 0.12 * step(0.5, fract(idx * 0.5)) + 0.1 * step(0.6, fract(idx * 0.3334));
      float outer = engrave(sp, 0.42, 0.16) * smoothstep(0.52, 0.56, rn) * (1.0 - smoothstep(reach - 0.02, reach, rn));
      outer = max(outer, engrave(sp + 0.5, 0.3, 0.16) * smoothstep(reach + 0.04, reach + 0.08, rn) * step(rn, 0.93));
      float inner = engrave(sp + 0.5 + (wob - 0.5) * 0.8, 0.26 + 0.16 * (1.0 - rn), 0.2) * step(rn, 0.52) * smoothstep(0.24, 0.34, rn);
      float collar = smoothstep(0.035, 0.008, abs(rn - 0.53 - 0.025 * (wob - 0.5)));
      float limbus = smoothstep(0.03, 0.006, abs(rn - 0.97));
      float strokes = max(max(outer, inner * 0.7), max(collar, limbus));
      vec3 irisC = uIris * (0.1 + 0.08 * (1.0 - rn)) + uIris * strokes * (0.62 + 0.4 * smoothstep(0.9, 0.3, rn));
      irisC *= 1.0 - 0.35 * smoothstep(0.75, 1.0, rn) * (1.0 - limbus);   // shadowed at the rim, like a cup
      irisC *= mix(0.45, 1.0, smoothstep(0.18, 0.4, rn));                  // and deep round the pupil
      // the cuttlefish W: wide when it first opens, a tight W once it has found you
      float hx = mix(0.105, 0.13, dil);
      float px = ip.x / hx;
      float amp = mix(0.034, 0.02, dil);
      float wv = cos(px * 7.8);   // the ends curl down, as in the art kit's layers
      float yc = -0.004 - amp * (wv - 0.35 * (1.0 - px * px));
      float th = mix(0.011, 0.03, dil) * pow(max(0.0, 1.0 - px * px), 0.6) * (1.0 + 0.25 * (1.0 - wv));
      float dP = max(abs(ip.y - yc) - th, (abs(px) - 1.0) * hx);
      float pupil = 1.0 - smoothstep(-aaE, aaE, dP);
      irisC += uIris * smoothstep(0.012, 0.0, abs(dP - 0.004)) * 0.35;   // a lit ruff round the pupil
      irisC = mix(irisC, uIris * 0.04, pupil);
      col = mix(col, irisC, irisM);
    }
    // the upper lid shades the ball, and the lower lid holds a line of wet light
    col *= mix(0.28, 1.0, smoothstep(0.0, 0.14, dU));
    col += uGlow * 0.12 * smoothstep(0.03, 0.0, dL) * shimmer;
    // the glint: a thin arc of light on the cornea, which turns less than the iris
    vec2 gq = ep - gaze * vec2(0.05, 0.03);
    float gr = length(gq);
    float gl = smoothstep(0.011, 0.004, abs(gr - 0.152)) * smoothstep(0.955, 0.99, dot(gq / max(gr, 1e-4), vec2(-0.628, -0.778)));
    col += vec3(1.0, 0.97, 0.93) * gl * 0.9;
    col += vec3(1.0, 0.95, 0.9) * 0.05 * exp(-dot(gq - vec2(-0.095, -0.118), gq - vec2(-0.095, -0.118)) * 900.0);
  }
  return vec4(col, inside);
}

void main() {
  float t = uTime;
  vec2 frag = gl_FragCoord.xy;
  float cssH = uRes.y / uPx;
  float aspect = uRes.x / uRes.y;
  float vy = 1.0 - frag.y / uRes.y;              // 0 top .. 1 bottom
  vec2 p0 = (frag - 0.5 * uRes) / uRes.y;        // aspect-correct
  p0.y = -p0.y;                                  // y down, like depth
  float nx = p0.x / max(aspect, 0.3);            // -0.5 .. 0.5 across the screen
  float edge = length(vec2(nx * 1.7, p0.y * 1.3));   // 0 centre .. ~1.1 corners
  float rimW = smoothstep(0.45, 1.05, edge);
  // The words sit in the middle third: keep that calm.
  float mid = smoothstep(0.2, 0.33, vy) * (1.0 - smoothstep(0.67, 0.8, vy));

  // Madness bends the plate, mostly at its edges.
  float mad = uMadness;
  vec2 warp = vec2(sin(p0.y * 9.0 + t * 0.9), cos(p0.x * 7.0 - t * 0.7)) * (0.016 * mad * mad * (0.3 + 0.7 * rimW));
  vec2 p = p0 + warp;
  vec2 css = frag / uPx + vec2(warp.x, -warp.y) * cssH;

  float depth = uDepth;
  float spacing = 5.0;                           // CSS px between engraved lines
  float aa = 1.7 / (spacing * uPx);
  float camScroll = depth * 0.0045;              // parallax scroll in screen heights

  // ---------------------------------------------- marine snow and living motes
  // Snow from 200 m, full by ~1,250 m, always drifting up (fast while sinking),
  // 1 to 3 px flakes, about a hundred on a phone; motes from 350 m, each breathing
  // on its own 7 s phase. Two layers of cells, near and far.
  float snow = 0.0;
  float motes = 0.0;
  float lures = 0.0;
  float snowAmt = smoothstep(150.0, 1250.0, depth);
  float moteAmt = smoothstep(300.0, 600.0, depth);
  if (snowAmt + moteAmt > 0.001) {
    float stretch = 1.0 + uVel * 5.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float scale = 9.0 + fi * 9.0;              // cells per screen height, near to far
      float speed = 1.45 - fi * 0.5;
      vec2 q = p * scale;
      q.y += (camScroll * speed + t * 0.011 * (1.0 + fi * 0.4)) * scale;
      q.x += sin(q.y * 0.21 + fi * 2.0 + t * 0.15) * 0.25;
      vec2 cell = mod(floor(q), 512.0);
      vec4 r = hash4(cell + fi * 57.3);
      vec2 dv = (fract(q) - 0.5 - (r.xy - 0.5) * 0.6) * vec2(1.0, 1.0 / stretch);
      float d = length(dv) * cssH / scale;      // CSS px
      float rad = (0.45 + r.z * 0.9) * (1.0 - fi * 0.22);
      snow += step(0.45 - fi * 0.1, r.w) * smoothstep(rad + 0.6, rad - 0.4, d) * (1.0 - fi * 0.2);
      if (r.w > 0.9) {                                        // only the few living cells pay for light
        float breath = sin(t * 0.8976 + r.y * 6.283);         // one 7 s breath each, shared by motes and lures
        float core = 1.0 / (1.0 + d * d * 0.3) + 0.25 / (1.0 + d * d * 0.04);   // a bright core in a soft halo
        motes += step(r.z, 0.7) * (0.55 + 0.45 * breath) * core * (1.0 - fi * 0.25);
        lures += step(0.975, r.w) * step(0.7, r.z) * (0.6 - 0.4 * breath) * core;
      }
    }
    snow *= snowAmt;
    motes *= moteAmt;
    lures *= uZone.y;
  }

  // ------------------------------------------------- bubbles (near the surface)
  float rings = 0.0;
  float bubbleAmt = (1.0 - smoothstep(120.0, 420.0, depth)) * smoothstep(-3.0, 2.0, depth);
  if (bubbleAmt > 0.001) {
    vec2 q = p * 9.0;
    q.y += t * 1.4 + camScroll * 14.0;
    vec2 cell = floor(q);
    vec4 r = hash4(cell + 51.0);
    vec2 f = fract(q) - 0.5;
    f.x += sin(q.y * 2.0 + r.x * 6.0) * 0.08;
    float rr = 0.05 + r.y * 0.09;
    rings = step(0.86, r.w) * smoothstep(0.024, 0.0, abs(length(f - (r.xz - 0.5) * 0.5) - rr)) * bubbleAmt;
  }

  // Leviathan, only ever seen in a flash: a vast squid, most of it off the frame.
  float levi = 1e3;
  if (uFlash > 0.02) {
    vec2 q = p - vec2(0.2, -0.1);
    float mantle = length(q * vec2(0.55, 1.9)) - 0.17;
    vec2 fq = q - vec2(0.38, 0.0);
    float fin = (abs(fq.x) * 0.8 + abs(fq.y) * 1.3) - 0.12;
    float arms = abs(q.y + sin(q.x * 9.0 + t) * 0.03 * q.x - 0.02 * sin(q.x * 3.0)) - 0.03 * smoothstep(-0.9, -0.1, q.x);
    arms = max(arms, q.x + 0.05);
    levi = min(min(mantle, fin), arms);
  }

  // ================================================================ SURFACE PLATE
  vec3 colS = uPaper;
  if (uInvert < 0.999) {
    float span = 90.0;                                   // metres per screen height
    float wy = depth + (vy - 0.42) * span;
    float waterline = (sin(css.x * 0.021 + t * 0.6) * 0.7 + sin(css.x * 0.047 - t * 0.9) * 0.35) * 0.5;
    float above = smoothstep(-1.0, -6.0, depth);         // is the camera above the water?
    float moonX = 0.2 * aspect;
    float aa6 = 1.7 / (6.0 * uPx);
    float aa7 = 1.7 / (7.0 * uPx);
    float ink;
    if (wy < waterline) {
      // ---- a hatched night sky; round the moon, a corona of rings inside a pale halo
      vec2 mp = p - vec2(moonX, -0.3);
      float moonD = length(mp);
      float R = 0.072;
      float px = 1.5 / uRes.y;
      float disc = 1.0 - smoothstep(R - px, R + px, moonD);
      float halo = exp(-moonD * moonD * 16.0);
      float HR = 0.235;                                   // the halo ring
      float ringD = moonD - HR;
      float cloud = smoothstep(0.58, 0.8, fbm(vec2(p.x * 1.5 + t * 0.01, p.y * 7.0 + 2.0))) * smoothstep(0.08, 0.2, moonD);
      float fog = exp(-pow((wy - waterline) / 7.0, 2.0));   // fog on the water at the horizon
      float tone = mix(0.3, 0.66, smoothstep(0.0, 0.42, vy)) + halo * 0.5 - cloud * 0.24 + fog * 0.22;
      tone += smoothstep(0.03, 0.0, abs(ringD)) * 0.18;
      tone = clamp(tone, 0.0, 1.0);
      float dark = 1.0 - tone;
      float inner = 1.0 - smoothstep(-0.002, 0.002, ringD);
      float phH = css.y / spacing + sin(css.x * 0.008) * 0.2;
      float phC = moonD * cssH / spacing;
      ink = engrave(mix(phH, phC, inner), dark * 0.95, aa);
      ink = max(ink, engrave(dot(css, vec2(0.866, 0.5)) / 6.0, clamp((dark - 0.56) * 1.3, 0.0, 0.6), aa6));
      ink = max(ink, engrave(dot(css, vec2(-0.574, 0.819)) / 7.0, clamp((dark - 0.74) * 1.6, 0.0, 0.6), aa7));
      ink *= smoothstep(0.0025, 0.007, abs(ringD));       // the halo itself: a ring of bare paper
      if (disc > 0.0) {
        // the moon: a lit sphere; maria cut in fine strokes that follow its curve, the dark side hatched
        vec2 mq = mp / R;
        float z = sqrt(max(0.0, 1.0 - dot(mq, mq)));
        float lit = dot(vec3(mq.x, -mq.y, z), vec3(0.62, 0.12, 0.775));
        float shade = smoothstep(0.05, -0.08, lit);
        float mf = fbm(mq * 1.1 + vec2(4.0, 1.3));
        float maria = smoothstep(0.47, 0.55, mf);
        float lon = mq.x / sqrt(max(1.0 - mq.y * mq.y, 0.04));
        float aaM = 26.0 / (R * cssH * uPx);
        // the seas: fine strokes that follow the curve of the sphere, heavier where they are darkest
        float mInk = engrave(lon * 11.0 + mq.y * 0.8, 0.16 + 0.2 * smoothstep(0.55, 0.68, mf), aaM) * maria * smoothstep(0.05, 0.45, z);
        float shadowInk = max(engrave((css.x - css.y) / (spacing * 0.8), 0.55, aa * 1.25),
                              engrave((css.x + css.y) / (spacing * 0.9), 0.3 * smoothstep(-0.05, -0.35, lit), aa * 1.1));
        ink = mix(ink, mix(mInk, shadowInk, shade), disc);
      }
      ink = max(ink, smoothstep(px * 2.5, 0.0, abs(moonD - R)) * 0.9);
      // stars are bare paper in the dark upper sky
      vec2 sq = p * 55.0;
      vec4 sr = hash4(floor(sq) + 11.0);
      float star = step(0.982, sr.w) * smoothstep(0.2, 0.0, length(fract(sq) - 0.5 - (sr.xy - 0.5) * 0.6));
      ink *= 1.0 - star * (1.0 - disc) * smoothstep(0.5, 0.15, vy);
      ink *= 1.0 - smoothstep(1.2, 0.0, abs(wy - waterline)) * 0.7;   // horizon glint
    } else {
      float under = wy - waterline;
      // ---- under the water: ruled lines that swell as the light fails
      float tone = mix(0.7, 0.17, smoothstep(0.0, 260.0, under));
      // shafts of light fanning down from the surface, gone by about 900 m
      vec2 rd = p - vec2(-0.32 * aspect, -1.5);
      float ang = rd.x / rd.y;
      float rays = noise(vec2(ang * 11.0 + t * 0.03, 0.5)) * noise(vec2(ang * 23.0 - t * 0.02, 4.5));
      rays = smoothstep(0.15, 0.5, rays) * smoothstep(2.6, 0.6, rd.y);
      tone += rays * 0.36 * (1.0 - smoothstep(0.0, 700.0, under)) * smoothstep(0.0, 5.0, under);
      // caustics: a net of light under the surface while it is near
      vec2 cc = css * 0.012 + vec2(t * 0.05, -t * 0.03);
      float caus = smoothstep(0.1, 0.0, abs(noise(cc * 2.0) - 0.5) + abs(noise(cc * 2.0 + 7.3 + t * 0.02) - 0.5) - 0.05);
      tone += caus * 0.3 * (1.0 - smoothstep(0.0, 90.0, under)) * smoothstep(0.62, 0.0, vy - (1.0 - smoothstep(0.0, 40.0, depth)) * 0.3);
      tone += (1.0 - smoothstep(0.0, 6.0, under)) * 0.2;
      tone += 0.12 * mid;                                  // paler where the words sit
      tone += uFlash * 0.6;
      tone = clamp(tone, 0.0, 1.0);
      float dark = 1.0 - tone;
      float wave = sin(css.x * 0.018 + t * 0.5 + css.y * 0.004) * 0.35 + (fbm(css * 0.006 + vec2(t * 0.02, 0.0)) - 0.5) * 1.7;
      float ph = (css.y + depth * 0.6) / spacing + wave;
      float inkU = engrave(ph, dark * 0.86, aa);
      // the crossing sets are ruled straight, as an engraver would, and come in only where it is darker
      inkU = max(inkU, engrave(dot(css, vec2(0.866, 0.5)) / 6.0, clamp((dark - 0.6) * 1.6, 0.0, 0.6), aa6));
      inkU = max(inkU, engrave(dot(css, vec2(-0.574, 0.819)) / 7.0, clamp((dark - 0.78) * 1.8, 0.0, 0.6), aa7));
      inkU = max(inkU, rings);

      // ---- the sea seen from above: perspective ruling and a road of moonlight
      float inkA = 0.0;
      if (above > 0.001) {
        float hv = 0.42 - depth / span;
        float u = max(vy - hv, 0.0);
        float persp = sqrt(u) * 62.0;
        float freq = 0.055 / (u * 7.0 + 0.25);
        float wv = sin(css.x * freq + t * 0.9 + persp * 0.8) * 0.28 + (noise(vec2(css.x * freq * 0.4, persp * 0.35 + t * 0.2)) - 0.5) * 0.9;
        float road = exp(-pow((p.x - moonX) / (0.035 + u * 0.55), 2.0));
        // glints: dashes of bare paper broken into each wave line, longer near the viewer
        // glints: lens-shaped dashes of bare paper in each wave line, longer near the viewer
        float line = floor(persp + wv);
        float gn = noise(vec2(css.x * 0.07 / (0.3 + u * 4.0) + line * 3.7, line * 1.31 + t * 0.3));
        float glint = smoothstep(0.42, 0.68, gn + road * 0.1) * road;
        float toneA = 0.26 + road * 0.3 + glint * 0.6 + (1.0 - smoothstep(0.0, 0.05, u)) * 0.3;
        float cover = (1.0 - clamp(toneA, 0.0, 1.0)) * 0.9;
        float density = 31.0 / max(sqrt(u), 0.02) / uRes.y; // lines per render pixel
        float lineInk = engrave(persp + wv, cover, min(0.5, density * 2.0));
        inkA = mix(lineInk, cover, smoothstep(0.25, 0.55, density));
      }
      ink = mix(inkU, inkA, above);
    }
    ink = max(ink, smoothstep(0.02, -0.02, levi) * uFlash);
    // The Eye, if it opens this near the surface, is cut in the same ink as a white-line
    // engraving: what glows in the deep is bare paper here, and its darkness is ink.
    if (uEye > 0.01) {
      float es = 0.6 * max(min(aspect, 1.0), 0.55) + 0.1;
      vec2 ep = (p - vec2(0.0, -0.14)) / es;
      if (abs(ep.x) < 0.56 && ep.y > -0.52 && ep.y < 0.42) {
        vec3 rim;
        float skin;
        vec4 e = greatEye(ep, uEye * (1.0 - uLife.x * 0.97), uLook, uLife.y, t, 1.6 / (uRes.y * es), rim, skin);
        float lumIn = dot(e.rgb, vec3(0.3, 0.5, 0.2)) / max(dot(uIris, vec3(0.3, 0.5, 0.2)), 0.05);
        float shade = engrave(dot(css, vec2(0.866, 0.5)) / 6.0, 0.45, aa6);
        ink = max(ink * (1.0 - skin * uEye), shade * skin * uEye);
        ink = mix(ink, 1.0 - smoothstep(0.08, 0.6, lumIn), e.a * uEye);
        ink = max(ink, clamp(dot(rim, vec3(0.3, 0.5, 0.2)) * 4.0, 0.0, 1.0) * uEye);
      }
    }
    // madness: the angle no engraver would choose, at the edges of the plate
    if (mad > 0.35) ink = max(ink, engrave(dot(css, vec2(0.995, -0.1)) / 9.0, clamp((mad - 0.35) * 0.5, 0.0, 0.3) * rimW, 1.7 / (9.0 * uPx)));
    float grain = (hash12(floor(css * 1.3)) - 0.5) * 0.06 + (noise(css * 0.004) - 0.5) * 0.12;
    vec3 paper = uPaper * (1.0 - grain * 0.6);
    colS = mix(paper, uInk, clamp(ink, 0.0, 1.0) * 0.93);
    float pe = length(p * vec2(0.82 / max(aspect, 0.5), 1.0));
    colS = mix(colS, uInk, smoothstep(0.58, 1.08, pe) * 0.5);   // foxed edges
  }

  // =================================================================== DEEP PLATE
  vec3 colD = uGround;
  if (uInvert > 0.001) {
    // ---------------------------------------------------------- the light
    // A tonal image first: the lamp's pool, fog volumes that carry a little light,
    // and darkness everywhere else. The lines are only drawn where there is light.
    float lr = length((p - vec2(0.0, 0.06)) * vec2(1.0, 1.2));
    float lamp = uLamp * exp(-lr * lr * 5.0);
    float haze = fbm(vec2(p.x * 1.5 + t * 0.012, p.y * 2.2 - camScroll * 0.6));
    float murk = smoothstep(0.4, 0.82, haze);
    float breath = 1.0 + 0.1 * uZone.w * sin(t * 0.8976);   // the Dreaming Deep breathes
    float L = (0.03 + murk * 0.17) * breath + lamp * 0.36 + uFlash * 0.7;
    float day = 0.0;
    if (uZone.x > 0.001) {
      // the Gloaming: the last of the daylight, far above, in thin cold rays
      vec2 rd = p - vec2(-0.3 * aspect, -1.45);
      float ang = rd.x / rd.y;
      float rays = noise(vec2(ang * 8.0 + t * 0.02, 1.5)) * noise(vec2(ang * 19.0 - t * 0.015, 6.5));
      float top = pow(1.0 - vy, 1.7);
      float ll = uZone.x * top * (0.12 + smoothstep(0.12, 0.5, rays) * 0.32) * (1.0 - smoothstep(600.0, 1300.0, depth) * 0.6);
      L += ll;
      day = ll / max(L, 0.001);
    }
    // the floor of the city gives off a light of its own
    L += uCity * (0.03 + 0.06 * smoothstep(0.1, 0.5, p.y));

    // ---------------------------------------------------------- shapes in the water
    float occ = 0.0;       // 1 where something hides the water's lines
    float bend = 0.0;      // how far the lines bow round things
    vec3 farC = vec3(0.0); // far things, painted behind the eye
    float farM = 0.0;
    vec3 nearC = vec3(0.0); // near things, painted in front of everything but the snow
    float nearM = 0.0;
    vec3 add = vec3(0.0);   // light given off

    // Stygian Dark: a vast arm crossing the far water, an absence of light with a faint rim
    if (uZone.y > 0.001) {
      float ay = 0.3 - (depth - 900.0) * 0.0003;   // far off, so it crosses the frame slowly as you sink
      vec2 q = vec2(p.x / max(aspect, 0.45) * 0.5, p.y - ay);
      float spine = 0.05 * sin(q.x * 6.0 + t * 0.09) + 0.03 * sin(q.x * 13.0 - t * 0.13) - 0.06 * q.x;
      float taper = smoothstep(0.7, -0.5, q.x);
      float r = mix(0.006, 0.085, taper * taper);
      float d = abs(q.y - spine) - r;
      if (d < 0.08) {
        float cellx = fract(q.x * mix(40.0, 14.0, taper)) - 0.5;
        vec2 sc = vec2(cellx / mix(40.0, 14.0, taper), q.y - (spine + r * 0.6));
        float suck = smoothstep(0.0035, 0.0, abs(length(sc) - r * 0.22)) * step(0.012, r) * step(0.0, sc.y);
        float m = smoothstep(0.003, -0.003, d) * uZone.y;
        farM = max(farM, m * 0.8);
        farC = mix(farC, uGround * 0.55 + uFog * 0.05, m);
        add += uGlow * (smoothstep(0.006, 0.0, abs(d)) * 0.14 + suck * 0.1) * uZone.y;
        L += 0.06 * exp(-max(d, 0.0) * 30.0) * uZone.y;   // fog lit behind it
      }
    }

    // Abyss and below: monoliths, two depths of them, a few joints holding light
    if (uZone.z + uCity > 0.001) {
      float amt = max(uZone.z, uCity);
      // Near stones at the edges of the frame. In the Abyss they are so tall their tops are
      // lost above it; in the city they are walls, low enough for the Eye to look over them,
      // and they rise from below as you come down among them.
      float halfW = 0.5 * aspect;
      float wA = uZone.z * (1.0 - uCity);
      float dAB = 1e3;
      vec2 uvAB = vec2(0.0);
      float sAB = -1.0;
      if (wA > 0.001) {
        float up = 1.0 - smoothstep(3600.0, 4300.0, depth);
        vec2 uvA;
        vec2 uvB;
        float dA = edgeSlab(p, -1.0, halfW - 0.055, 0.03, -0.72 + up * 1.4, 0.35, uvA);
        float dB = edgeSlab(p, 1.0, halfW - 0.04, 0.02, -0.3 + up * 1.0, -0.55, uvB);
        dAB = min(dA, dB);
        uvAB = dA < dB ? uvA : uvB;
        sAB = dA < dB ? -1.0 : 1.0;
      }
      float dCD = 1e3;
      vec2 uvCD = vec2(0.0);
      float sCD = -1.0;
      if (uCity > 0.001) {
        float up = (1.0 - uCity) * 0.9;
        vec2 uvC;
        float dC = edgeSlab(p, -1.0, halfW - 0.085, 0.025, 0.04 + up, -0.5, uvC);
        // the right wall leans out, against the rest, and its stairs climb to nothing
        float intoD = p.x - (halfW - 0.07 + 0.015 * (0.5 - p.y));
        float dD = max(-intoD, stairs(intoD, p.y, 0.12 + up, 0.045, 0.024));
        dCD = min(dC, dD);
        uvCD = dC < dD ? uvC : vec2(intoD, p.y - 0.12 - up);
        sCD = dC < dD ? -1.0 : 1.0;
      }
      // far stones, dark against the fog with a thin rim of light; they rise as you sink
      float grow = smoothstep(3800.0, 6500.0, depth);
      vec2 uvF = vec2(0.0);
      float fTop = mix(0.2, -0.1, grow) + (1.0 - amt) * 0.5;
      float dF = 1e3;
      // no top can stand more than 0.19 above fTop, so the water above it skips the field,
      // and so does the stone already hidden behind an opaque near one
      bool hidden = (uCity > 0.999 && dCD < -0.004) || (wA > 0.999 && dAB < -0.004);
      if (!hidden && p.y > fTop - 0.2) dF = slabField(vec2(p.x + 3.0 + t * 0.002, p.y), 0.17 - 0.03 * uCity, fTop, 7.0, uvF);
      if (uCity > 0.001 && !hidden) {
        // a trilithon in the far city, its lintel set at an angle no mason would choose
        vec2 tq = rot(0.07) * (p - vec2(0.06, 0.29 + (1.0 - uCity) * 0.5));
        float posts = max(abs(abs(tq.x) - 0.045) - 0.011, -tq.y);
        float lintel = max(abs(tq.x) - 0.075, abs(tq.y + 0.011) - 0.011);
        float dT = min(posts, lintel);
        if (dT < dF) uvF = vec2(tq.x / 0.075, tq.y + 0.022);
        dF = min(dF, dT);
      }
      if (dF < 0.01) {
        float m = smoothstep(0.003, -0.003, dF) * amt;
        float tool = engrave(uvF.x * 3.0, 0.18, 0.2);
        vec3 stone = uGround * 0.6 + uFog * (0.08 + 0.04 * tool) * (1.0 - smoothstep(0.0, 0.5, uvF.y));
        farC = mix(farC, stone, m);
        farM = max(farM, m * 0.9);
        add += uGlow * smoothstep(0.004, 0.0, abs(dF)) * 0.1 * amt * (1.0 - 0.7 * smoothstep(0.0, 0.4, uvF.y));
      }
      bool wall = dCD < 0.006;   // the city's walls stand in front of the older stones
      float dN = wall ? dCD : dAB;
      if (dN < 0.02) {
        vec2 uvN = wall ? uvCD : uvAB;
        float sideN = wall ? sCD : sAB;
        float wN = wall ? uCity : wA;
        float m = smoothstep(0.003, -0.003, dN) * wN;
        vec2 wuv = vec2(uvN.x, uvN.y + (wall ? 0.0 : camScroll * 0.3));
        vec2 jm = masonry(wuv, sideN * 5.0 + (wall ? 14.0 : 11.0));
        float joint = smoothstep(0.003, 0.0, jm.x);
        float tool = engrave(uvN.x * cssH / 7.0, 0.16 + 0.2 * smoothstep(0.06, 0.0, uvN.x), 1.7 / (7.0 * uPx));
        float lit = smoothstep(0.12, 0.0, uvN.x) * (0.4 + lamp * 1.5);
        vec3 stone = uGround * 0.35 + uLine * (tool * 0.16 + joint * 0.07) * lit;
        stone += uGlow * joint * step(0.84, jm.y) * (0.13 + 0.07 * sin(t * 0.8976 + wuv.y * 3.0 + sideN)) * (1.0 - 0.6 * mid);
        if (wall) {
          // the walls carry the Drowned Script, hung from carved waterlines, a few rows of it
          vec2 dq = vec2(uvN.x - 0.045, uvN.y - 0.25);
          bool door = sideN < 0.0 && abs(dq.x) < 0.04 && abs(dq.y) < 0.09;
          float H = 0.052;
          float gy = uvN.y / H;
          float row = floor(gy);
          float gw = H * 0.62;
          float colI = floor((uvN.x - 0.01) / gw);
          vec4 rr = hash4(vec2(row, sideN * 3.0 + 1.0));
          float rowOn = step(0.4, rr.x) * step(0.0, colI) * step(colI, floor(rr.y * 2.99)) * step(0.0, row);
          if (sideN < 0.0 && abs(dq.y) < 0.13) rowOn = 0.0;   // no script across the door
          if (rowOn > 0.0) {
            vec2 g = vec2(fract((uvN.x - 0.01) / gw) - 0.5, fract(gy) - 0.12) * vec2(0.62, 1.0);
            float dg = glyph(g, hash4(vec2(colI + row * 7.0, sideN + 4.0)));
            dg = min(dg, abs(g.y));   // the waterline the glyphs hang from
            float px = 1.0 / (H * cssH * uPx);
            float stroke = smoothstep(0.045 + px, 0.045 - px, dg);
            float wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 0.6 - uvN.y * 5.0 + sideN), 3.0);
            stone += uGlow * stroke * (0.1 + 0.45 * wave) * (1.0 - 0.85 * mid);
          }
          // one door, its opening the shape of a lens, with a little light inside
          if (door) {
            float lens = max(length(dq - vec2(0.0952, 0.0)), length(dq + vec2(0.0952, 0.0))) - 0.1212;
            float lm = smoothstep(0.002, -0.002, lens);
            stone = mix(stone, uGround * 0.3 + uGlow * 0.14 * (1.0 - abs(dq.x) / 0.026), lm);
            stone += uGlow * smoothstep(0.004, 0.0, abs(lens)) * 0.3;
          }
        }
        nearC = mix(nearC, stone * wN, m);
        nearM = max(nearM, m);
        add += uLine * smoothstep(0.005, 0.0, abs(dN)) * (0.08 + lamp * 0.3) * wN;
        bend += exp(-max(dN, 0.0) * 30.0) * 0.5 * wN;
      }
    }

    // The Dreaming Deep: the city hangs upside down above you, faintly, where the surface should be
    float ghost = uZone.w * (1.0 - smoothstep(6700.0, 7000.0, depth));
    if (ghost > 0.001 && p.y < -0.05) {
      vec2 uvG;
      float dG = slabField(vec2(p.x * 1.3 + 5.0 - t * 0.003, -p.y), 0.15, 0.24, 3.0, uvG);
      float mG = smoothstep(0.004, -0.004, dG) * ghost * 0.45 * smoothstep(-0.05, -0.2, p.y);
      farC = mix(farC, uGround * 0.7, mG);
      farM = max(farM, mG);
      add += uGlow * smoothstep(0.004, 0.0, abs(dG)) * 0.07 * ghost * (1.0 - smoothstep(0.0, 0.3, uvG.y));
    }

    // Stygian Dark: arms rising from the murk at the edges, a third reaching down from above
    float body = 1e3;
    if (uCreature > 0.001) {
      float rise = (1.0 - uCreature) * 0.55;
      float cw = min(aspect, 1.2);
      vec4 i1;
      vec4 i2;
      vec4 i3;
      float b1 = tentacle(p, vec2(-0.5 * aspect - 0.04, 0.72 + rise), 0.9, 0.06, 0.0, 0.05 + 0.11 * cw, t, i1);
      float b2 = tentacle(p, vec2(0.5 * aspect + 0.05, 0.76 + rise), 1.0, 0.07, 2.1, -(0.06 + 0.12 * cw), t * 0.9, i2);
      float b3 = tentacle(vec2(p.x, -p.y), vec2(0.32 * aspect, 0.6 + rise * 1.4), 0.42, 0.04, 4.0, -0.08, t * 1.2, i3);
      body = min(min(b1, b2), b3);
      float suck = max(max(i1.w, i2.w), i3.w);
      float m = smoothstep(0.004, -0.004, body);
      // roots lost in fog: the silhouette fades towards the bottom of the frame
      float roots = smoothstep(0.25, 0.55, p.y);
      vec3 flesh = mix(uGround * 0.3, uGround * 0.6 + uFog * 0.12, roots);
      flesh += uGlow * suck * 0.16 * uCreature;
      vec2 q = p * 38.0;
      vec2 f = fract(q) - 0.5;
      vec4 r = hash4(floor(q) + 4.0);
      float photo = smoothstep(0.02, 0.0, abs(body + 0.006)) * step(0.5, r.x) * exp(-dot(f, f) * 30.0) * (0.5 + 0.5 * sin(t * 0.9 + r.y * 12.0));
      nearC = mix(nearC, flesh, m * uCreature);
      nearM = max(nearM, m * uCreature);
      add += uGlow * (smoothstep(0.012, 0.0, abs(body)) * 0.22 * uCreature + photo * 1.2 * uCreature);
      L += 0.09 * exp(-max(body, 0.0) * 14.0) * uCreature;   // seen against the light, not in it
      bend += exp(-max(body, 0.0) * 18.0) * 1.1 * uCreature;
      L += 0.06 * roots * uCreature;
    }

    // the Gloaming: medusae drifting up through the last light
    if (uZone.x > 0.001) {
      for (int i = 0; i < 2; i++) {
        float fi = float(i);
        float sz = 0.05 - fi * 0.017;
        float jy = 0.75 - mod(t * (0.006 - fi * 0.002) + camScroll * (0.35 - fi * 0.15) + fi * 0.7, 1.9);
        vec2 jc = vec2((fi * 0.62 - 0.3) * min(aspect, 1.0) + 0.02 * sin(t * 0.05 + fi), jy);
        vec2 q = (p - jc) / sz;
        if (abs(q.x) < 1.5 && q.y > -1.4 && q.y < 4.6) {
          float pulse = 0.5 + 0.5 * sin(t * 0.8976 + fi * 2.0);
          float d = medusa(q, pulse, t + fi * 3.0) * sz;
          float m = smoothstep(0.002, -0.002, d) * uZone.x * (1.0 - fi * 0.35);
          nearC = mix(nearC, uGround * 0.35 + uFog * 0.08 * day, m);
          nearM = max(nearM, m * 0.85);
          add += mix(uLine, uAccent, 0.5) * smoothstep(0.003, 0.0, abs(d)) * 0.25 * uZone.x * step(q.y, 0.3);
        }
      }
    }

    // ---------------------------------------------------------- engrave the water
    vec2 lc = css;
    if (uZone.w > 0.001) {
      // the Dreaming Deep: in places the ruling turns a few degrees off true
      float a = uZone.w * 0.1 * (noise(p * 1.3 + vec2(t * 0.015, 3.0)) - 0.5) * (0.4 + 0.6 * rimW);
      vec2 cen = 0.5 * uRes / uPx;
      lc = cen + rot(a) * (css - cen);
      // and the ruling bows towards the place where the Eye opens, as if drawn to it
      vec2 pe = (p - vec2(0.0, -0.14)) * vec2(1.0, 1.6);
      bend += uZone.w * (1.1 + 0.5 * sin(t * 0.8976)) * exp(-dot(pe, pe) * 9.0) * (1.0 - uEye);
    }
    float wave = sin(lc.x * 0.015 + t * 0.35 + lc.y * 0.003) * 0.45 + (haze - 0.5) * 2.4;
    float ph = (lc.y + depth * 0.35) / spacing + wave + bend;
    float lit = clamp(L, 0.0, 1.0);
    // light lines where there is light: thin and dim in the murk, swelling in the lamp
    float lines = engrave(ph, clamp((lit - 0.02) * 0.62, 0.0, 0.42), aa);
    lines = max(lines, engrave(dot(lc, vec2(0.866, 0.5)) / 7.0 + wave * 0.4, clamp((lit - 0.38) * 0.7, 0.0, 0.25) * (1.0 - 0.6 * mid), 1.7 / (7.0 * uPx)));
    float wrong = max(clamp((mad - 0.35) * 0.55, 0.0, 0.3) * (0.1 + 0.9 * rimW) * (1.0 - 0.5 * mid), uZone.w * 0.12 * rimW);
    if (wrong > 0.001) lines = max(lines, engrave(dot(lc, vec2(0.995, -0.1)) / 9.0, wrong * (0.4 + lit), 1.7 / (9.0 * uPx)));
    lines *= 1.0 - max(max(occ, farM), nearM);
    vec3 lineCol = mix(uLine, mix(uFog, vec3(0.92), 0.45), day * 0.85);
    vec3 c = uGround + uFog * haze * 0.07;
    c += lineCol * lines * (0.3 + 1.25 * lit) * (1.0 - 0.15 * mid);
    c = mix(c, farC, farM);

    // ---------------------------------------------------------- the eye
    if (uEye > 0.01) {
      float es = 0.6 * max(min(aspect, 1.0), 0.55) + 0.1;
      vec2 ep = (p - vec2(0.0, -0.14)) / es;
      c += uIris * 0.06 * uEye * exp(-dot(ep, ep) * 3.0);   // its own light in the water
      if (abs(ep.x) < 0.56 && ep.y > -0.52 && ep.y < 0.42) {
        vec3 rim;
        float skin;
        vec4 e = greatEye(ep, uEye * (1.0 - uLife.x * 0.97), uLook, uLife.y, t, 1.6 / (uRes.y * es), rim, skin);
        c = mix(c, uGround * 0.4 + uFog * 0.04, skin * uEye * (1.0 - nearM));
        c = mix(c, e.rgb, e.a);
        c += rim * uEye;
      }
    }

    c = mix(c, nearC, nearM);
    c += add;
    // snow and motes drift past in front of everything, lit by the lamp
    float near = 1.0 - nearM * 0.6;
    c += mix(uLine, vec3(0.9), 0.3) * snow * (0.3 + lamp * 0.8 + day * 0.4) * near;
    vec3 moteCol = uGlow * (1.0 + uLife.w * 1.5 * (1.0 - smoothstep(0.1, 0.6, length(p - vec2(0.0, -0.22)))));
    c += moteCol * motes * 0.9 + uAccent * lures * 0.9;
    colD = c * mix(1.0, 0.22, smoothstep(0.35, 1.0, length(p * vec2(0.9 / max(aspect, 0.5), 1.0))));
  }

  // The ink-wash front: darkness rises from the bottom of the plate as you pass
  // through the gloaming, with a wet, ragged edge.
  vec3 col = colD;
  if (uInvert < 0.999) {
    col = colS;
    if (uInvert > 0.001) {
      float uvY = 1.0 - vy;
      float front = uInvert * 1.5 - 0.25;
      float en = fbm(css * 0.006 + vec2(0.0, t * 0.05)) * 0.35 + (noise(css * 0.03 - t * 0.04) - 0.5) * 0.08;
      float wash = smoothstep(front + 0.06, front - 0.06, uvY + en - 0.17);
      col = mix(colS, colD, wash);
      col = mix(col, uInk, smoothstep(0.035, 0.0, abs(uvY + en - 0.17 - front)) * 0.6);
    }
  }

  // Tension, the last breaths of air: the edges close in on a red heartbeat,
  // and the middle of the plate, where the words are, stays clear.
  if (uTension > 0.001) {
    float e = length(vec2(nx * 1.5, p0.y * 1.25));
    float close = smoothstep(0.62 - 0.18 * uTension, 1.2, e) * uTension;
    col = mix(col, col * 0.4, close * 0.7);
    col = mix(col, uAccent * 0.5, close * (0.28 + 0.32 * uLife.z));
  }
  // Madness: colours split at the edges.
  if (mad > 0.01) {
    float f = mad * rimW;
    col.r += sin(p.y * 40.0 + t * 2.0) * 0.025 * f;
    col.b += cos(p.x * 33.0 - t * 1.7) * 0.025 * f;
  }
  col += (hash12(frag + uSeed) - 0.5) * mix(0.03, 0.045, uInvert); // film grain
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
