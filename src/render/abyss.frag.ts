// The abyss: one full-screen fragment shader, drawn as an engraving.
// Near the surface it is ink on bone paper (a hatched night sky, a ruled sea,
// light shafts). Sinking, the plate inverts: the paper goes black and the ink
// turns into glowing lines, lit only by the diver's lamp, bioluminescence and,
// at the bottom, the drowned city and the thing that watches from it.

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
uniform float uTime;
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
uniform float uVel;     // descent speed, 0..1+
uniform float uFlash;
uniform float uEye;     // 0 closed .. 1 open
uniform vec2 uLook;
uniform float uTension;
uniform float uLamp;
uniform float uCreature;
uniform float uCity;
uniform float uMotion;  // 1 normal, ~0.3 reduced motion

#define PI 3.14159265

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p = p * 2.03 + vec2(1.7, 9.2);
    a *= 0.5;
  }
  return s;
}
float fbm2(vec2 p) {
  return 0.66 * vnoise(p) + 0.34 * vnoise(p * 2.1 + 3.1);
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
  float m = 1.0 - smoothstep(c - aa, c + aa, f);
  return m * smoothstep(0.0, aa * 0.6, c);
}

// A swaying, tapering tentacle growing up from base, with suckers on its
// inner edge. Returns an approximate distance; fills sucker rings.
float tentacle(vec2 p, vec2 base, float len, float thick, float phase, float curl, float t, out float sucker) {
  vec2 q = p - base;
  float k = clamp(-q.y / len, 0.0, 1.0); // 0 at base, 1 at tip (y grows downward)
  float sway = sin(k * 4.0 - t * 0.5 + phase) * 0.05 * k + sin(k * 10.0 + t * 0.33 + phase * 1.7) * 0.012 * k;
  float cx = sway + curl * k * k * k + curl * 0.6 * pow(k, 6.0);
  float w = thick * pow(1.0 - k, 0.8) + 0.002;
  float xr = q.x - cx;
  float d = abs(xr) - w;
  d = max(d, q.y);
  d = max(d, -q.y - len);
  float side = curl > 0.0 ? 1.0 : -1.0;
  float gap = max(0.014, w * 1.7);
  float along = -q.y / gap;
  vec2 sp = vec2((xr - side * w * 0.42) / max(w, 0.004), (fract(along) - 0.5) * gap / max(w, 0.004));
  float sr = length(sp);
  sucker = smoothstep(0.12, 0.0, abs(sr - 0.3)) * step(d, 0.0) * step(k, 0.92) * step(0.004, w);
  return d;
}

// A vesica (almond) eye: lid distance, iris, pupil slit and limbal ring.
void eyeShape(vec2 p, float open, vec2 look, out float lid, out float iris, out float pupil, out float ring) {
  float w = 1.0;
  float h = max(0.02, open * 0.62);
  float r = (w * w / (2.0 * h) + h * 0.5) * 0.5;
  float c = (w * w / (2.0 * h) - h * 0.5) * 0.5;
  float d1 = length(p - vec2(0.0, c)) - r;
  float d2 = length(p - vec2(0.0, -c)) - r;
  lid = max(d1, d2);
  vec2 ip = p - look * 0.18;
  float ir = length(ip);
  iris = 1.0 - smoothstep(0.2, 0.215, ir);
  ring = smoothstep(0.03, 0.0, abs(ir - 0.205));
  vec2 pp = ip * vec2(4.2, 1.0);
  pupil = 1.0 - smoothstep(0.15, 0.165, length(pp));
}

// One carved glyph in a unit cell, chosen by id.
float glyphAt(vec2 g, float id) {
  vec2 f = fract(g) - 0.5;
  float h = hash12(vec2(id, floor(g.x) + floor(g.y) * 17.0));
  float s = 0.0;
  float lw = 0.07;
  s = max(s, step(0.3, h) * smoothstep(lw, 0.0, abs(f.x + 0.12)) * step(abs(f.y), 0.34));
  s = max(s, step(0.55, fract(h * 7.0)) * smoothstep(lw, 0.0, abs(f.y - 0.1)) * step(abs(f.x), 0.28));
  s = max(s, step(0.5, fract(h * 13.0)) * smoothstep(lw, 0.0, abs(length(f - vec2(0.1, -0.1)) - 0.16)));
  s = max(s, step(0.65, fract(h * 29.0)) * smoothstep(lw, 0.0, abs(f.x - f.y * 0.8)) * step(length(f), 0.36));
  return s * step(0.35, fract(h * 3.0));
}

void main() {
  float t = uTime * uMotion;
  vec2 frag = gl_FragCoord.xy;
  vec2 css = frag / uPx;                         // CSS pixels, origin bottom-left
  float cssH = uRes.y / uPx;
  float vy = 1.0 - frag.y / uRes.y;              // 0 top .. 1 bottom
  vec2 p = (frag - 0.5 * uRes) / uRes.y;         // aspect-correct
  p.y = -p.y;                                    // y down, like depth
  float aspect = uRes.x / uRes.y;

  // Madness bends the plate.
  float mad = uMadness;
  vec2 warp = vec2(sin(p.y * 9.0 + t * 0.9), cos(p.x * 7.0 - t * 0.7)) * 0.014 * mad * mad;
  p += warp;
  css += warp * cssH;

  float depth = uDepth;
  float spacing = 5.0;                           // CSS px between engraved lines
  float aa = 1.7 / (spacing * uPx);
  float camScroll = depth * 0.0045;              // parallax scroll in screen heights

  // ---------------------------------------------------------------- particles
  float snow = 0.0;
  float glowDots = 0.0;
  float rings = 0.0;
  float stretch = 1.0 + uVel * 9.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float scale = 7.0 + fi * 6.0;
    float speed = 0.55 + fi * 0.45;
    vec2 q = p * scale;
    q.y += camScroll * scale * speed + t * 0.03 * scale * (0.4 + fi * 0.2);
    q.x += sin(q.y * 0.15 + fi * 2.0 + t * 0.2) * 0.3;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 rnd = hash22(cell + fi * 17.0);
    vec2 off = (rnd - 0.5) * 0.7;
    vec2 dv = (f - off) * vec2(1.0, 1.0 / stretch);
    float d = length(dv);
    float present = step(0.62 - fi * 0.08, hash12(cell + 3.7 + fi));
    float size = (0.05 + rnd.x * 0.06) * (1.0 - fi * 0.18);
    snow += present * smoothstep(size, size * 0.25, d) * (0.55 + fi * 0.25);
    float bio = step(0.965, hash12(cell + 9.1 + fi * 3.0));
    float pulse = 0.5 + 0.5 * sin(t * (0.8 + rnd.y * 1.7) + rnd.x * 6.283);
    glowDots += bio * pulse * exp(-d * d * 90.0) * (1.0 + fi * 0.3);
  }

  // ----------------------------------------------------- bubbles (near surface)
  float bubbleAmt = (1.0 - smoothstep(120.0, 420.0, depth)) * smoothstep(-3.0, 2.0, depth);
  if (bubbleAmt > 0.001) {
    vec2 q = p * 9.0;
    q.y += t * 1.4 + camScroll * 14.0;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 rnd = hash22(cell + 51.0);
    f.x += sin(q.y * 2.0 + rnd.x * 6.0) * 0.08;
    float rr = 0.05 + rnd.y * 0.09;
    float on = step(0.86, hash12(cell + 77.0));
    rings = on * smoothstep(0.024, 0.0, abs(length(f - (rnd - 0.5) * 0.5) - rr)) * bubbleAmt;
  }

  // --------------------------------------------------------------- creatures
  float body = 1e3;
  float suck = 0.0;
  float photo = 0.0;
  if (uCreature > 0.001) {
    float rise = (1.0 - uCreature) * 0.55;
    float s1, s2, s3;
    // two rise from below at the edges; a third hangs from above
    float cw = min(aspect, 1.2);
    float b1 = tentacle(p, vec2(-0.5 * aspect - 0.04, 0.72 + rise), 0.9, 0.06, 0.0, 0.05 + 0.11 * cw, t, s1);
    float b2 = tentacle(p, vec2(0.5 * aspect + 0.05, 0.76 + rise), 1.0, 0.07, 2.1, -(0.06 + 0.12 * cw), t * 0.9, s2);
    float b3 = tentacle(vec2(p.x, -p.y), vec2(0.32 * aspect, 0.6 + rise * 1.4), 0.42, 0.04, 4.0, -0.08, t * 1.2, s3);
    body = min(min(b1, b2), b3);
    suck = max(max(s1, s2), s3);
    vec2 q = p * 38.0;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    float edge = smoothstep(0.02, 0.0, abs(body + 0.006));
    float blink = 0.5 + 0.5 * sin(t * 1.7 + hash12(cell) * 12.0);
    photo = edge * step(0.5, hash12(cell + 4.0)) * exp(-dot(f, f) * 30.0) * blink * uCreature;
  }

  // Leviathan, only ever seen in a flash.
  float levi = 1e3;
  if (uFlash > 0.02) {
    vec2 q = (p - vec2(0.12, -0.08)) * vec2(1.0, 2.4);
    float bodyE = length(q * vec2(0.5, 1.0)) - 0.3;
    float tail = length((rot(0.4) * (p - vec2(-0.62, -0.05))) * vec2(1.4, 3.6)) - 0.13;
    float fin = length((p - vec2(0.05, 0.07)) * vec2(2.5, 5.0)) - 0.1;
    levi = min(min(bodyE, tail), fin);
  }

  // ------------------------------------------------------------ drowned city
  float stone = 1e3;
  vec2 stoneUV = vec2(0.0);
  float stoneId = 0.0;
  float glyph = 0.0;
  if (uCity > 0.001) {
    float rise = (1.0 - uCity) * 0.95;
    for (int i = 0; i < 5; i++) {
      float fi = float(i);
      float x0 = (fi - 2.0) * 0.33 * max(aspect, 0.55) + (hash12(vec2(fi, 2.0)) - 0.5) * 0.08;
      float h = 0.38 + hash12(vec2(fi, 3.0)) * 0.5;
      float wdt = 0.08 + hash12(vec2(fi, 9.0)) * 0.08;
      float ang = (hash12(vec2(fi, 1.0)) - 0.5) * 0.42;
      vec2 q = rot(ang) * (p - vec2(x0, 0.6 + rise));
      float slope = (hash12(vec2(fi, 5.0)) - 0.5) * 1.9;  // tops meet at wrong angles
      float top = -h + q.x * slope;
      float d = max(abs(q.x) - wdt, max(top - q.y, q.y - 0.9));
      if (d < stone) {
        stone = d;
        stoneUV = vec2(q.x / wdt, q.y - top);
        stoneId = fi;
      }
    }
    if (stone < 0.0) {
      vec2 g = vec2(stoneUV.x * 2.2 + 3.0, stoneUV.y * 11.0);
      float rowOn = step(0.45, hash12(vec2(floor(g.y), stoneId)));
      float wave = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 0.9 - stoneUV.y * 7.0 + stoneId * 1.3), 3.0);
      glyph = glyphAt(g, stoneId) * rowOn * wave * step(0.06, stoneUV.y);
    }
  }

  // ----------------------------------------------------------------- the eye
  float lid = 1e3, iris = 0.0, pupil = 0.0, ring = 0.0;
  if (uEye > 0.01) {
    vec2 ep = (p - vec2(0.0, -0.14)) / (0.6 * max(min(aspect, 1.0), 0.55) + 0.1);
    eyeShape(ep, uEye, uLook, lid, iris, pupil, ring);
  }
  float inEye = 1.0 - smoothstep(-0.004, 0.004, lid);

  // =========================================================== SURFACE PLATE
  vec3 colS = uPaper;
  if (uInvert < 0.999) {
    float span = 90.0;                                   // metres per screen height
    float wy = depth + (vy - 0.42) * span;
    float waterline = (sin(css.x * 0.021 + t * 0.6) * 0.7 + sin(css.x * 0.047 - t * 0.9) * 0.35) * 0.5;
    float above = smoothstep(2.0, -6.0, depth);          // is the camera above the water?
    float moonX = 0.2 * aspect;
    float ink;
    if (wy < waterline) {
      // ---- a hatched night sky, a gibbous moon with engraved halo rings
      vec2 mp = p - vec2(moonX, -0.3);
      float moonD = length(mp);
      float R = 0.072;
      float px = 1.5 / uRes.y;
      float disc = 1.0 - smoothstep(R - px, R + px, moonD);
      float litD = length(mp - vec2(0.026, -0.008));
      float lit = disc * (1.0 - smoothstep(R * 1.02 - px, R * 1.02 + px, litD));
      float halo = exp(-moonD * moonD * 16.0);
      float cloud = smoothstep(0.5, 0.82, fbm(vec2(p.x * 1.9 + t * 0.012, p.y * 7.5 + 2.0)));
      float tone = mix(0.3, 0.66, smoothstep(0.0, 0.42, vy)) + halo * 0.5 - cloud * 0.28 * (1.0 - halo);
      tone = clamp(tone, 0.0, 1.0);
      float phH = css.y / spacing + sin(css.x * 0.008) * 0.2;
      float inkH = engrave(phH, (1.0 - tone) * 0.95, aa);
      float phC = moonD * cssH / spacing;
      float inkC = engrave(phC, (1.0 - tone) * 0.9, aa);
      ink = mix(inkH, inkC, smoothstep(0.3, 0.12, moonD));
      ink = max(ink, engrave((css.x + css.y) / (spacing * 1.3), smoothstep(0.42, 0.18, tone) * 0.7, aa));
      // the moon: bare paper where lit, hatched in shadow, ringed in ink
      float crater = smoothstep(0.55, 0.7, fbm2(mp * 55.0)) * 0.6;
      float shadowInk = engrave((css.x - css.y) / (spacing * 0.8), 0.55, aa);
      float moonInk = mix(shadowInk, crater * 0.5, lit / max(disc, 0.001));
      ink = mix(ink, moonInk, disc);
      ink = max(ink, smoothstep(px * 2.5, 0.0, abs(moonD - R)) * 0.9);
      // stars are bare paper in the dark upper sky
      vec2 sq = p * 55.0;
      vec2 sc = floor(sq);
      float star = step(0.982, hash12(sc)) * smoothstep(0.2, 0.0, length(fract(sq) - 0.5 - (hash22(sc) - 0.5) * 0.6));
      ink *= 1.0 - star * (1.0 - disc) * smoothstep(0.5, 0.15, vy);
      ink *= 1.0 - smoothstep(1.2, 0.0, abs(wy - waterline)) * 0.7;   // horizon glint
    } else {
      float under = wy - waterline;
      // ---- under the water: ruled lines swelling as the light fails
      float tone = mix(0.68, 0.16, smoothstep(0.0, 260.0, under));
      vec2 rp = vec2(p.x + p.y * 0.38, p.y);
      float shafts = pow(vnoise(vec2(rp.x * 4.5 + t * 0.05, 0.5)), 2.2) * 0.95 + pow(vnoise(vec2(rp.x * 12.0 - t * 0.08, 2.0)), 3.0) * 0.5;
      tone += shafts * (1.0 - smoothstep(0.0, 620.0, under)) * smoothstep(0.0, 5.0, under) * 0.6;
      float band = 1.0 - smoothstep(0.0, 6.0, under);
      float caus = smoothstep(0.16, 0.0, abs(vnoise(css * 0.03 + vec2(t * 0.3, 0.0)) - vnoise(css * 0.031 - vec2(0.0, t * 0.25))));
      tone += band * (0.2 + caus * 0.12);
      tone += uFlash * 0.6;
      tone = clamp(tone, 0.0, 1.0);
      float wave = sin(css.x * 0.018 + t * 0.5 + css.y * 0.004) * 0.35 + (fbm(css * 0.006 + vec2(t * 0.02, 0.0)) - 0.5) * 1.7;
      float bend = exp(-max(body, 0.0) * 22.0) * 0.9 * uCreature;
      float ph = (css.y + depth * 0.6) / spacing + wave + bend;
      float inkU = engrave(ph, (1.0 - tone) * 0.86, aa);
      inkU = max(inkU, engrave((css.x + css.y * 0.6) / (spacing * 1.25) + wave * 0.3, smoothstep(0.42, 0.1, tone) * 0.78, aa));
      inkU = max(inkU, rings);
      inkU = max(inkU, snow * 0.85 * smoothstep(0.0, 25.0, under));

      // ---- the sea seen from above: perspective ruling and a moon road
      float inkA = 0.0;
      if (above > 0.001) {
        float hv = 0.42 - depth / span;
        float u = max(vy - hv, 0.0);
        float persp = sqrt(u) * 62.0;
        float freq = 0.055 / (u * 7.0 + 0.25);
        float wv = sin(css.x * freq + t * 0.9 + persp * 0.8) * 0.28 + (vnoise(vec2(css.x * freq * 0.4, persp * 0.35 + t * 0.2)) - 0.5) * 0.9;
        float road = exp(-pow((p.x - moonX) / (0.035 + u * 0.55), 2.0));
        float glint = step(0.6, vnoise(vec2(css.x * 0.12, persp * 2.2 + t * 1.6)));
        float toneA = 0.26 + road * (0.25 + glint * 0.55) + (1.0 - smoothstep(0.0, 0.05, u)) * 0.3;
        float cover = (1.0 - clamp(toneA, 0.0, 1.0)) * 0.9;
        float density = 31.0 / max(sqrt(u), 0.02) / uRes.y; // lines per render pixel
        float lineInk = engrave(persp + wv, cover, min(0.5, density * 2.0));
        inkA = mix(lineInk, cover, smoothstep(0.25, 0.55, density));
      }
      ink = mix(inkU, inkA, above);
    }
    ink = max(ink, smoothstep(0.01, -0.01, body) * 0.92);
    ink = max(ink, smoothstep(0.02, -0.02, levi) * uFlash);
    float grain = vnoise(css * 0.9) * 0.07 + (fbm(css * 0.004) - 0.5) * 0.12;
    vec3 paper = uPaper * (1.0 - grain * 0.6);
    colS = mix(paper, uInk, clamp(ink, 0.0, 1.0) * 0.93);
    float edge = length(p * vec2(0.82 / max(aspect, 0.5), 1.0));
    colS = mix(colS, uInk, smoothstep(0.58, 1.08, edge) * 0.5);   // foxed edges
  }

  // ============================================================== DEEP PLATE
  vec3 colD = uGround;
  if (uInvert > 0.001) {
    float lr = length((p - vec2(0.0, 0.02)) * vec2(1.0, 1.15));
    float flicker = 0.92 + 0.08 * vnoise(vec2(t * 3.0, 1.0));
    float lamp = uLamp * flicker * exp(-lr * lr * 3.2);
    float haze = fbm(vec2(p.x * 1.6 + t * 0.015, p.y * 2.4 - camScroll * 0.6));
    float lastLight = (1.0 - vy) * 0.3 * (1.0 - smoothstep(300.0, 1200.0, depth));
    float L = 0.045 + haze * 0.09 + lamp * 0.42 + lastLight + uFlash * 0.7;
    float wave = sin(css.x * 0.015 + t * 0.35 + css.y * 0.003) * 0.45 + (haze - 0.5) * 2.4;
    float bend = exp(-max(body, 0.0) * 18.0) * 1.1 * uCreature + exp(-max(stone, 0.0) * 30.0) * 0.6 * uCity;
    float ph = (css.y + depth * 0.35) / spacing + wave + bend;
    float lineMask = engrave(ph, clamp(L, 0.0, 1.0) * 0.55, aa);
    float occ = max(smoothstep(0.004, -0.004, body), smoothstep(0.004, -0.004, stone));
    occ = max(occ, smoothstep(0.02, -0.02, levi) * uFlash);
    lineMask *= 1.0 - occ;
    float dots = snow * (0.25 + lamp * 1.6) * (1.0 - occ);
    vec3 c = uGround + uFog * haze * 0.09;
    c += uLine * (lineMask * (0.55 + L)) + uLine * dots * 0.9;
    c += uGlow * glowDots * 0.9 * (1.0 - occ);
    // creature: a faint glowing rim, sucker rings and photophores
    float rimC = smoothstep(0.014, 0.0, abs(body)) * uCreature;
    c += uGlow * (rimC * 0.22 + suck * 0.35 * uCreature + photo * 1.4);
    // stones: vertical tooling lines, a rim, carved glyphs that pulse
    if (uCity > 0.001) {
      float inStone = smoothstep(0.004, -0.004, stone);
      float tool = engrave(stoneUV.x * 4.0 + stoneUV.y * 0.6, 0.18 + 0.12 * lamp, 0.12);
      c += uGlow * inStone * tool * 0.07 * uCity;
      c += uGlow * smoothstep(0.01, 0.0, abs(stone)) * 0.3 * uCity;
      c += uGlow * glyph * 0.9 * uCity;
      c += uGlow * smoothstep(0.25, 0.85, vy) * uCity * 0.1;
    }
    // the eye: engraved iris of radial lines, a slit of nothing at its centre
    if (uEye > 0.01) {
      vec2 ep = (p - vec2(0.0, -0.14)) / (0.6 * max(min(aspect, 1.0), 0.55) + 0.1) - uLook * 0.18;
      float ang = atan(ep.y, ep.x);
      float radial = engrave(ang * 22.0 / PI + fbm2(ep * 9.0) * 1.5, 0.45, 0.08);
      vec3 eyeCol = uGround * 0.5 + uLine * 0.1 * engrave(ph * 1.3, 0.25, aa);
      eyeCol += uIris * iris * (0.3 + radial * 0.95);
      eyeCol += uGlow * ring * 0.5 * iris;
      eyeCol *= 1.0 - pupil;
      c = mix(c, eyeCol, inEye);
      c += uIris * smoothstep(0.03, 0.0, abs(lid)) * 0.45 * uEye;
    }
    colD = c;
    float edge = length(p * vec2(0.9 / max(aspect, 0.5), 1.0));
    colD *= mix(1.0, 0.22, smoothstep(0.35, 1.0, edge));
  }

  // The ink-wash front (art kit technique): darkness rises from the bottom of
  // the plate as you pass through the gloaming, instead of a muddy crossfade.
  float uvY = 1.0 - vy;
  float front = uInvert * 1.5 - 0.25;
  float edgeNoise = fbm(css * 0.006 + vec2(0.0, t * 0.05)) * 0.35 + (fbm(css * 0.03 - t * 0.04) - 0.5) * 0.08;
  float wash = smoothstep(front + 0.06, front - 0.06, uvY + edgeNoise - 0.17);
  wash = uInvert >= 0.999 ? 1.0 : (uInvert <= 0.001 ? 0.0 : wash);
  vec3 col = mix(colS, colD, wash);
  float frontEdge = smoothstep(0.035, 0.0, abs(uvY + edgeNoise - 0.17 - front)) * step(0.001, uInvert) * step(uInvert, 0.999);
  col = mix(col, uInk, frontEdge * 0.6);

  // Tension: the last breaths of air. A red heartbeat at the edges.
  if (uTension > 0.001) {
    float edge = length(p * vec2(0.8 / max(aspect, 0.5), 1.0));
    float beat = pow(0.5 + 0.5 * sin(uTime * (5.0 + uTension * 5.0)), 6.0);
    col = mix(col, uAccent * 0.42, smoothstep(0.3, 1.0, edge) * uTension * (0.45 + beat * 0.4));
  }
  if (mad > 0.01) {
    col.r += sin(p.y * 40.0 + t * 2.0) * 0.02 * mad;
    col.b += cos(p.x * 33.0 - t * 1.7) * 0.02 * mad;
  }
  col += (hash12(frag + fract(uTime) * 100.0) - 0.5) * 0.03; // film grain
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
