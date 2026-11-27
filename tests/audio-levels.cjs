#!/usr/bin/env node
// Renders the sound engine offline in headless Chromium and prints its levels:
// sample peak, RMS and loudness (BS.1770 K-weighted LUFS, gated) for the bed
// of every zone and for the game's events, plus "phone" loudness, which is
// the same measure after a steep 300 Hz high-pass (roughly what a phone
// speaker can play). Event rows also give "lift": the event's loudest 400 ms
// over the bed it plays on.
//
//   node tests/audio-levels.cjs                  every scenario
//   node tests/audio-levels.cjs bed accept       only scenarios whose name contains one of the words
//   node tests/audio-levels.cjs --old old.ts     also render an older engine.ts, for comparison
//   node tests/audio-levels.cjs --json out.json  also write every number as JSON
//
// Needs Node 22.13+ (it strips the TypeScript itself) and Playwright with
// Chromium, which is not a dependency of the game.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const nodeModule = require('node:module');

/** The engine as a classic script that sets window[globalName]; `extra` runs inside its scope. */
function load(file, globalName, extra = '') {
  if (typeof nodeModule.stripTypeScriptTypes !== 'function') throw new Error('Needs Node 22.13 or later (module.stripTypeScriptTypes).');
  const emit = process.emitWarning;
  process.emitWarning = () => undefined; // the stripper is still "experimental"
  try {
    const js = nodeModule.stripTypeScriptTypes(fs.readFileSync(file, 'utf8'), { mode: 'strip' });
    return `(() => {\n${js.replace(/^export /gm, '')}\nwindow.${globalName} = Sound;\n${extra}\n})();`;
  } finally {
    process.emitWarning = emit;
  }
}

// Everything below runs in the page.
function harness() {
  const SR = 48000;
  const realTimeout = window.setTimeout.bind(window);
  const realClear = window.clearTimeout.bind(window);
  const sleep = (ms) => new Promise((r) => realTimeout(r, ms));

  // Timers on the audio clock, for an engine that schedules with setTimeout.
  let clock = null;
  let timers = [];
  let timerId = 1;
  window.setTimeout = (fn, ms = 0, ...args) => {
    if (!clock) return realTimeout(fn, ms, ...args);
    const id = timerId++;
    timers.push({ id, at: clock.currentTime + Math.max(0, Number(ms) || 0) / 1000, fn: () => fn(...args) });
    return id;
  };
  window.clearTimeout = (id) => {
    const i = timers.findIndex((t) => t.id === id);
    if (i >= 0) timers.splice(i, 1);
    else realClear(id);
  };
  const runTimers = (now) => {
    for (let guard = 0; guard < 2000; guard++) {
      let best = -1;
      for (let i = 0; i < timers.length; i++) if (timers[i].at <= now + 1e-9 && (best < 0 || timers[i].at < timers[best].at)) best = i;
      if (best < 0) return;
      timers.splice(best, 1)[0].fn();
    }
  };

  const mulberry32 = (seed) => {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  /** Counts every node the engine creates. */
  const countNodes = (ctx) => {
    const n = { total: 0 };
    for (const name of Object.getOwnPropertyNames(BaseAudioContext.prototype)) {
      if (!name.startsWith('create') || name === 'createBuffer' || name === 'createPeriodicWave') continue;
      const orig = ctx[name];
      if (typeof orig !== 'function') continue;
      ctx[name] = (...a) => {
        n.total++;
        return orig.apply(ctx, a);
      };
    }
    return n;
  };

  // ---------------------------------------------------------------- loudness

  // BS.1770 K-weighting at 48 kHz, as [b0, b1, b2, a1, a2]
  const SHELF = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const RLB = [1, -2, 1, -1.99004745483398, 0.99007225036621];
  const highpass = (f) => {
    const w = (2 * Math.PI * f) / SR;
    const c = Math.cos(w);
    const al = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + al;
    return [(1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, (-2 * c) / a0, (1 - al) / a0];
  };
  const PHONE = highpass(300);
  const HOP = Math.round(0.1 * SR);
  /**
   * Energy of each 100 ms bin from sample i0 to i1 after K-weighting (and,
   * for "phone", a fourth-order 300 Hz high-pass first). Filters sample by
   * sample, so a long render needs no copies.
   */
  const bins = (x, i0, i1, phone) => {
    const stages = phone ? [PHONE, PHONE, SHELF, RLB] : [SHELF, RLB];
    const c = Float64Array.from(stages.flat());
    const z = new Float64Array(stages.length * 4); // x1 x2 y1 y2 per stage
    const n = Math.floor((i1 - i0) / HOP);
    const out = new Float64Array(n);
    const last = i0 + n * HOP;
    for (let i = 0; i < last; i++) {
      let v = x[i];
      for (let k = 0, o = 0; k < stages.length; k++, o += 5) {
        const s = k * 4;
        const y = c[o] * v + c[o + 1] * z[s] + c[o + 2] * z[s + 1] - c[o + 3] * z[s + 2] - c[o + 4] * z[s + 3];
        z[s + 1] = z[s];
        z[s] = v;
        z[s + 3] = z[s + 2];
        z[s + 2] = y;
        v = y;
      }
      if (i >= i0) out[((i - i0) / HOP) | 0] += v * v;
    }
    return out;
  };
  const lufsOf = (z) => -0.691 + 10 * Math.log10(z + 1e-20);
  const db = (v) => 20 * Math.log10(v + 1e-20);
  const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);

  /** Loudness measures of one stereo buffer between t0 and t1 (seconds). */
  function measure(buf, t0, t1) {
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    const i0 = Math.max(0, Math.round(t0 * SR));
    const i1 = Math.min(L.length, Math.round(t1 * SR));
    let peak = 0;
    let sq = 0;
    for (let i = i0; i < i1; i++) {
      peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      sq += L[i] * L[i] + R[i] * R[i];
    }
    const out = { peak: r1(db(peak)), rms: r1(10 * Math.log10(sq / Math.max(1, 2 * (i1 - i0)) + 1e-20)) };
    for (const phone of [false, true]) {
      const bl = bins(L, i0, i1, phone);
      const br = bins(R, i0, i1, phone);
      // mean square of each block of n bins, both channels summed (BS.1770 channel weights are 1)
      const blocks = (len) => {
        const n = Math.round(len * 10);
        const z = [];
        for (let j = 0; j + n <= bl.length; j++) {
          let e = 0;
          for (let i = j; i < j + n; i++) e += bl[i] + br[i];
          z.push(e / (n * HOP));
        }
        return z;
      };
      const mom = blocks(0.4);
      // gated integrated loudness (absolute gate -70, relative gate -10 LU)
      const abs = mom.filter((z) => lufsOf(z) > -70);
      let integrated = -Infinity;
      if (abs.length) {
        const rel = lufsOf(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
        const g = abs.filter((z) => lufsOf(z) > rel);
        integrated = lufsOf(g.reduce((a, b) => a + b, 0) / g.length);
      }
      const st = blocks(3);
      if (phone) out.phone = r1(integrated);
      else {
        out.lufs = r1(integrated);
        out.momMax = r1(lufsOf(Math.max(0, ...mom)));
        out.stMax = r1(lufsOf(Math.max(0, ...st)));
        out.stProfile = st.filter((_, i) => i % 50 === 0).map((z) => r1(lufsOf(z)));
      }
    }
    return out;
  }

  // --------------------------------------------------------------- scenarios

  const BEDS = { title: -32, shallows: 40, gloaming: 600, stygian: 2500, abyss: 5000, dreaming: 6500, floor: 7040 };
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2); // the camera's tween
  /** The camera sinking from one score to another, as app.ts drives it (camera = score + 40). */
  const tween = (t0, from, to, ms) => (t) => {
    if (t <= t0) return from + 40;
    const x = Math.min(1, (t - t0) / (ms / 1000));
    return from + 40 + (to - from) * ease(x);
  };
  const descentMs = (gain) => 1500 + Math.min(gain, 1600) * 1.5;
  const S = {};

  for (const [zone, depth] of Object.entries(BEDS)) S[`bed ${zone}`] = { dur: 66, depth, win: [6, 66], old: true };
  // Render cost of the continuous layers alone: no stepping, so no events either.
  for (const [zone, depth] of Object.entries(BEDS)) S[`cpu ${zone}`] = { dur: 30, depth, win: [6, 30], old: true, quanta: 1e9 };
  S['bed abyss, madness 1'] = { dur: 66, depth: 5000, madness: 1, win: [6, 66], old: true };
  S['bed floor, eye open'] = { dur: 36, depth: 7040, win: [6, 36], ref: [1, 6], events: [[6, (s) => s.eye()]], old: true };
  S['bed stygian, last 6 s of air'] = {
    dur: 18,
    depth: 2500,
    ref: [3, 9],
    win: [9, 15],
    tension: (t) => (t < 9 || t >= 15 ? 0 : (t - 9) / 6),
    events: [10, 11, 12, 13, 14].map((t, i) => [t, (s) => s.tick(5 - i <= 3)]),
    old: true,
  };

  // Events on the Gloaming bed: the bed is measured for 6 s, then the event.
  const onBed = (fn, len = 8, depth = 600) => ({ dur: 10 + len, depth, ref: [4, 10], win: [10, 10 + len], events: [[10, fn]], old: true });
  const EVENTS = {
    click: [(s) => s.click(), 1],
    'key x8': [(s) => [0, 0.21, 0.43, 0.64, 0.85, 1.07, 1.28, 1.49].forEach((d) => setT(d, () => s.key())), 2],
    tick: [(s) => s.tick(false), 1],
    'tick urgent': [(s) => s.tick(true), 1],
    'accept 1': [(s) => s.accept(1), 6],
    'accept 2': [(s) => s.accept(2), 6],
    'accept 3': [(s) => s.accept(3), 6],
    'accept 4': [(s) => s.accept(4), 7],
    'accept 5': [(s) => s.accept(5), 8],
    'accept 6': [(s) => s.accept(6), 10],
    refuse: [(s) => s.refuse(), 3],
    timeout: [(s) => s.timeout(), 5],
    'descend 1000 m': [(s) => s.descend(3000, 1000), 4],
    zone: [(s) => s.zone(), 8],
    toll: [(s) => s.toll?.(), 9],
    eye: [(s) => s.eye(), 10],
    whisper: [(s) => s.whisper(0.55), 3],
    'bubbles plunge': [(s) => s.bubbles(16, 0.08), 3],
  };
  // a delayed call inside an event, on the audio clock (both engines go through it)
  let pending = [];
  const setT = (delay, fn) => pending.push([delay, fn]);
  for (const [name, [fn, len]] of Object.entries(EVENTS)) {
    S[`${name} on bed`] = onBed(fn, len);
    S[`${name} alone`] = { dur: 1 + len, ambience: false, win: [0.5, 0.5 + len], events: [[0.5, fn]], depth: 600 };
  }
  S['buoy bell on bed'] = onBed((s) => s.buoyBell(), 6, -32);
  S['eye at floor on bed'] = onBed((s) => s.eye(), 14, 7040);
  S['splash: title to play'] = { dur: 16, depth: (t) => (t < 10 ? -32 : tween(10, -72, 0, 3800)(t)), ref: [4, 10], win: [10, 16], old: true, quanta: 8 };

  // Realistic dives: the accept, the rush, the camera's ease, zone() at each boundary.
  const dive = (from, to, tier, extra = []) => {
    const ms = descentMs(to - from);
    const cam = tween(10, from, to, ms);
    const events = [[10, (s) => (s.accept(tier), s.descend(ms, to - from))], ...extra];
    let prev = from;
    for (const b of [200, 1000, 4000, 6000, 7000]) {
      if (from < b && to >= b) {
        // the first frame at which the score passes the boundary
        let t = 10;
        while (cam(t) - 40 < b && t < 10 + ms / 1000) t += 1 / 60;
        events.push([t, (s) => s.zone()]);
      }
      prev = b;
    }
    void prev;
    return { dur: 10 + ms / 1000 + 9, depth: cam, ref: [4, 10], win: [10, 10 + ms / 1000 + 9], events, old: true, quanta: 8 };
  };
  S['dive 600 to 1600, tier 3'] = dive(600, 1600, 3);
  S['dive 5200 to 7000, tier 6, eye'] = dive(5200, 7000, 6, [[16, (s) => s.eye()]]);

  // A whole session of seven questions, about four and a half minutes.
  {
    const events = [[12, (s) => s.click()]];
    const path = [[-72, -72]]; // [score, at]
    let t = 12;
    let score = 0;
    const camSegs = [[12, -72, 0, 3800]];
    let sanity = 100;
    const mad = (sn) => Math.pow(Math.max(0, Math.min(1, (100 - sn) / 75)), 1.3);
    const plan = [
      { tier: 2, gain: 300 },
      { tier: 3, gain: 700, ticks: true },
      { tier: 1, gain: 150, refuse: true },
      { timeout: true },
      { tier: 4, gain: 1200 },
      { tier: 5, gain: 1600, ticks: true },
      { tier: 6, gain: 3050 },
    ];
    t = 20;
    for (const q of plan) {
      const at = t;
      for (let i = 0; i < 9; i++) events.push([at + 6 + i * 0.22, (s) => s.key()]);
      if (q.refuse) events.push([at + 8.2, (s) => s.refuse()]);
      if (q.ticks || q.timeout) {
        for (let i = 0; i < 5; i++) events.push([at + 10 + i, (s) => s.tick(5 - i <= 3)]);
      }
      if (q.timeout) {
        events.push([at + 15, (s) => s.timeout()]);
        sanity -= 9;
      } else {
        const ms = descentMs(q.gain);
        const go = q.ticks ? at + 13.4 : at + 10.5;
        events.push([go, (s) => (s.accept(q.tier), s.descend(ms, q.gain))]);
        camSegs.push([go, score, score + q.gain, ms]);
        for (const b of [200, 1000, 4000, 6000, 7000]) {
          if (score < b && score + q.gain >= b) {
            const cam = tween(go, score, score + q.gain, ms);
            let tb = go;
            while (cam(tb) - 40 < b && tb < go + ms / 1000) tb += 1 / 60;
            events.push([tb, (s) => s.zone()]);
          }
        }
        sanity -= (7 * q.gain) / 1000 + (q.tier === 6 ? 5 : 0);
        score += q.gain;
        if (q.tier === 6) events.push([go + ms / 1000 + 1.5, (s) => s.eye()]);
      }
      if (q.refuse) sanity -= 3;
      const m = mad(sanity);
      events.push([at + 17, (s) => s.setMadness(m)]);
      t += 32;
    }
    void path;
    const depth = (time) => {
      let d = -32;
      for (const [t0, from, to, ms] of camSegs) if (time >= t0) d = tween(t0, from, to, ms)(time);
      return d;
    };
    S['session, seven questions'] = { dur: t + 20, depth, win: [3, t + 20], events, old: true, quanta: 8 };
  }

  // Worst case: everything at once, at the floor, mad, out of air, at full volume.
  const everything = (s) => {
    s.accept(6);
    s.descend(3900, 1800);
    s.zone();
    s.eye();
    s.refuse();
    s.timeout();
    s.bubbles(40, 1);
    s.whisper(1);
    s.tick(true);
    s.buoyBell?.();
    s.leviathan?.();
    s.creak?.();
    s.omen?.();
  };
  S['stress: everything at once'] = { dur: 24, depth: 7040, madness: 1, tension: () => 1, win: [0, 24], events: [[6, everything]], old: true };
  S['spam: keys, refusals, accepts'] = {
    dur: 40,
    depth: 2500,
    win: [0, 40],
    quanta: 8,
    events: [
      ...Array.from({ length: 300 }, (_, i) => [1 + i * 0.01, (s) => s.key()]),
      [2, (s) => Array.from({ length: 20 }, () => s.refuse())],
      [3, (s) => Array.from({ length: 10 }, () => s.accept(6))],
      [4, (s) => Array.from({ length: 10 }, () => (s.bubbles(40, 1), s.zone(), s.whisper(1)))],
    ],
  };
  // Every voice ends and disconnects: all the public calls, then silence.
  S['lifecycle: every call, then 30 s'] = {
    dur: 40,
    ambience: false,
    depth: 2500,
    win: [0, 40],
    events: [1, 3].map((t) => [t, (s) => (everything(s), s.key(), s.click(), s.tick(false))]),
  };
  S['lifecycle: sweep to the floor and back'] = {
    dur: 150,
    depth: (t) => (t < 60 ? 40 + (7000 * t) / 60 : t < 70 ? 7040 : Math.max(-32, 7040 - ((t - 70) * 7072) / 40)),
    win: [0, 150],
    quanta: 8,
  };

  async function run(name, engine) {
    const sc = S[name];
    const frames = Math.round(sc.dur * SR);
    const ctx = new OfflineAudioContext(2, frames, SR);
    const nodes = countNodes(ctx);
    const seed = sc.seed ?? 11;
    const realRandom = Math.random;
    Math.random = mulberry32(seed); // the old engine draws from Math.random
    clock = ctx;
    timers = [];
    pending = [];
    let s;
    if (engine === 'new') {
      s = new window.NewSound();
      s.setVolume(sc.volume ?? 1);
      await s.start({ context: ctx, seed, ambience: sc.ambience !== false });
    } else {
      const AC = window.AudioContext;
      window.AudioContext = function () {
        return ctx;
      };
      s = new window.OldSound();
      s.setVolume(sc.volume ?? 1);
      try {
        await s.start();
      } catch {
        /* an offline context cannot resume before it renders */
      }
      window.AudioContext = AC;
    }
    sc.init?.(s, ctx);
    const depthAt = typeof sc.depth === 'function' ? sc.depth : () => sc.depth;
    const events = (sc.events ?? []).map(([t, fn]) => [t, fn]).sort((a, b) => a[0] - b[0]);
    let ei = 0;
    let voicesMax = 0;
    const later = [];
    const step = (now) => {
      s.setDepth(depthAt(now));
      if (sc.tension) s.setTension(sc.tension(now));
      while (ei < events.length && events[ei][0] <= now + 1e-9) {
        events[ei++][1](s, ctx);
        for (const [d, fn] of pending) later.push([now + d, fn]);
        pending = [];
      }
      later.sort((a, b) => a[0] - b[0]);
      while (later.length && later[0][0] <= now + 1e-9) later.shift()[1]();
      runTimers(now);
      s.pump?.();
      if (typeof s.activeVoices === 'number') voicesMax = Math.max(voicesMax, s.activeVoices);
    };
    s.setMadness(sc.madness ?? 0);
    step(0);
    const stepFrames = 128 * (sc.quanta ?? 40);
    const last = Math.floor((frames - 1) / stepFrames);
    let k = 0;
    const next = () => {
      k++;
      if (k <= last) ctx.suspend((k * stepFrames) / SR).then(() => {
        step(ctx.currentTime);
        next();
        ctx.resume();
      });
    };
    next();
    const t0 = performance.now();
    const buf = await ctx.startRendering();
    const renderMs = performance.now() - t0;
    await sleep(50); // let the last 'ended' events arrive
    clock = null;
    Math.random = realRandom;
    const r = { name, engine, ...measure(buf, sc.win[0], sc.win[1]), nodes: nodes.total, realtime: r1(sc.dur / (renderMs / 1000)) };
    if (sc.ref) {
      const ref = measure(buf, sc.ref[0], sc.ref[1]);
      r.bed = ref.lufs;
      r.lift = r1(r.momMax - ref.lufs);
    }
    if (typeof s.activeVoices === 'number') {
      r.voicesMax = voicesMax;
      r.voicesEnd = s.activeVoices;
      r.layersEnd = s.activeLayers.join(' ');
    }
    return r;
  }

  window.H = { names: () => Object.keys(S), oldToo: (n) => !!S[n].old, run, measure, scenarios: S };
}

async function main() {
  const args = process.argv.slice(2);
  const opt = (flag) => {
    const i = args.indexOf(flag);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const oldFile = opt('--old');
  const jsonFile = opt('--json');
  const words = args;
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    console.error('Playwright is not installed here (it is not a dependency of the game).');
    process.exit(2);
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('[page]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  await page.addScriptTag({ content: load(path.join(__dirname, '..', 'src', 'audio', 'engine.ts'), 'NewSound') });
  if (oldFile) await page.addScriptTag({ content: load(path.resolve(oldFile), 'OldSound') });
  await page.evaluate(harness);
  const names = (await page.evaluate(() => window.H.names())).filter((n) => !words.length || words.some((w) => n.includes(w)));
  const rows = [];
  const fmt = (v, w = 6) => String(v ?? '').padStart(w);
  console.log(
    `${'scenario'.padEnd(38)}${'eng'.padStart(4)}${fmt('peak')}${fmt('rms')}${fmt('LUFS')}${fmt('phone')}${fmt('mom')}${fmt('bed')}${fmt('lift')}${fmt('nodes', 7)}${fmt('vMax', 5)}${fmt('vEnd', 5)}${fmt('x rt', 6)}`,
  );
  for (const name of names) {
    const engines = ['new'];
    if (oldFile && (await page.evaluate((n) => window.H.oldToo(n), name))) engines.push('old');
    for (const engine of engines) {
      const r = await page.evaluate(([n, e]) => window.H.run(n, e), [name, engine]);
      rows.push(r);
      console.log(
        `${name.padEnd(38).slice(0, 38)}${fmt(engine, 4)}${fmt(r.peak)}${fmt(r.rms)}${fmt(r.lufs)}${fmt(r.phone)}${fmt(r.momMax)}${fmt(r.bed)}${fmt(r.lift)}${fmt(r.nodes, 7)}${fmt(r.voicesMax, 5)}${fmt(r.voicesEnd, 5)}${fmt(r.realtime, 6)}`,
      );
      if (name.startsWith('session') || name.startsWith('lifecycle')) {
        console.log(`    short-term LUFS every 5 s: ${r.stProfile.join(' ')}${r.layersEnd !== undefined ? `   layers at end: ${r.layersEnd}` : ''}`);
      }
    }
  }
  await browser.close();
  if (jsonFile) fs.writeFileSync(jsonFile, JSON.stringify(rows, null, 2));
}

module.exports = { load, harness };
if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
