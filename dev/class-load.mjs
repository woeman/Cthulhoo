// Fills a convocation (a class-sized séance) with pretend divers and times it:
// everyone joins, answers a classic question, then a blitz, on a real relay.
//
//   cd worker && npx wrangler dev --port 8787 --ip 127.0.0.1     (in one terminal)
//   node dev/class-load.mjs 150                                  (in another)
//
// RELAY=https://… points it at another relay. It needs Node 22 (for WebSocket).
// It fails (exit 1) when an answer goes astray, a diver is not shown a reveal,
// or the relay takes too long to say what it heard.

import { readFileSync } from 'node:fs';

const RELAY = (process.env.RELAY ?? 'http://127.0.0.1:8787').replace(/\/+$/, '');
const N = Math.max(1, Number(process.argv[2] ?? 150));
const SLOW_MS = Number(process.env.SLOW_MS ?? 1500);
const DEPTHS = [0, 100, 250, 400, 600, 800, 1000];
const pack = JSON.parse(readFileSync(new URL('../packs/finance.json', import.meta.url), 'utf8'));
// The longest list in the class packs: every company listed on the NASDAQ.
const prompt = pack.prompts.find((p) => p.id === 'finance-nasdaq-companies') ?? pack.prompts[0];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 7;
const rand = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
const pick = (list) => list[Math.floor(rand() * list.length)];
const fails = [];
const fail = (text) => {
  fails.push(text);
  console.log(`  FAIL ${text}`);
};
const pct = (list, p) => {
  if (!list.length) return 0;
  const s = [...list].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const stats = (name, list) => console.log(`  ${name}: ${list.length} timed · median ${pct(list, 50)} ms · 95th ${pct(list, 95)} ms · slowest ${Math.max(0, ...list)} ms`);

/** One device on the relay: what it was last shown, and everything it was sent. */
class Device {
  constructor(sign, name) {
    this.name = name;
    this.view = null;
    this.got = 0;
    this.bytes = 0;
    this.errors = [];
    this.waits = [];
    this.replies = [];
    this.ws = new WebSocket(`${RELAY.replace(/^http/, 'ws')}/class/${sign}/socket`);
    this.open = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error(`${name}: the socket would not open`));
    });
    this.ws.onmessage = (e) => {
      if (typeof e.data !== 'string' || e.data === 'pong') return;
      this.got++;
      this.bytes += e.data.length;
      const msg = JSON.parse(e.data);
      if (msg.t === 'view') this.view = msg.view;
      else if (msg.t === 'error') this.errors.push(msg);
      else if (msg.t === 'heard' || msg.t === 'refused') this.replies.shift()?.(msg);
      this.waits = this.waits.filter((w) => !w(msg));
    };
  }

  send(msg) {
    this.ws.send(JSON.stringify(msg));
  }

  /** Resolves with the first message that passes the test (or the view already held). */
  until(test, ms = 20_000, what = 'a message') {
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: waited ${ms} ms for ${what}`)), ms);
      this.waits.push((msg) => {
        if (!test(msg)) return false;
        clearTimeout(t);
        res(msg);
        return true;
      });
    });
  }

  phase(phase, n, ms = 30_000) {
    if (this.view && this.view.phase === phase && (n === undefined || this.view.n === n)) return Promise.resolve(this.view);
    return this.until((m) => m.t === 'view' && m.view.phase === phase && (n === undefined || m.view.n === n), ms, `the ${phase} view`).then((m) => m.view);
  }

  /** Say an answer and time how long the relay takes to say what it heard. */
  say(text) {
    const at = Date.now();
    return new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error(`${this.name}: no word back on “${text}”`)), 20_000);
      this.replies.push((msg) => {
        clearTimeout(t);
        res({ msg, ms: Date.now() - at });
      });
      this.send({ t: 'say', text });
    });
  }
}

const typo = (s) => (s.length > 7 ? s.slice(0, 3) + s.slice(4) : s);

async function main() {
  console.log(`A convocation of ${N} on ${RELAY}, asked “${prompt.text}” (${prompt.answers.length} answers, ${JSON.stringify(prompt).length.toLocaleString('en')} characters)`);
  const opened = await fetch(`${RELAY}/class`, { method: 'POST' }).then((r) => r.json());
  if (!opened.sign || !opened.key) throw new Error(`The relay would not open a class: ${JSON.stringify(opened)}`);
  const { sign, key } = opened;
  console.log(`  sign ${sign}`);

  const host = new Device(sign, 'host');
  await host.open;
  host.send({ t: 'host', key });
  await host.phase('lobby');

  // A stranger without the key is not the host.
  const thief = new Device(sign, 'thief');
  await thief.open;
  thief.send({ t: 'host', key: 'not-the-key' });
  await thief.until((m) => m.t === 'error' && m.code === 'host', 5000, 'the refusal of a wrong key');

  // --- everyone sits down over about three seconds
  const t0 = Date.now();
  const joins = [];
  const divers = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      await sleep(rand() * 3000);
      const d = new Device(sign, `Diver ${i + 1}`);
      await d.open;
      const at = Date.now();
      d.send({ t: 'hello', id: `load-${String(i).padStart(4, '0')}`, name: `Diver ${i + 1}` });
      await d.phase('lobby');
      joins.push(Date.now() - at);
      return d;
    }),
  );
  console.log(`  everyone seated in ${Date.now() - t0} ms`);
  stats('sitting down', joins);
  const peek = await fetch(`${RELAY}/class/${sign}`).then((r) => r.json());
  if (peek.seats !== N) fail(`the relay counts ${peek.seats} seats, not ${N}`);

  // --- a classic question at four tables
  host.send({ t: 'config', mode: 'classic', seconds: 30, tables: 4, questions: 5, topics: ['Finance'] });
  await host.until((m) => m.t === 'view' && m.view.config.tables === 4, 10_000, 'the tables');
  let asked = Date.now();
  host.send({ t: 'ask', prompt, depths: DEPTHS });
  await Promise.all(divers.map((d) => d.phase('asking', 1)));
  console.log(`  question 1 on every screen ${Date.now() - asked} ms after the host asked`);
  const leaked = divers.find((d) => JSON.stringify(d.view).includes(prompt.answers[0].answer));
  if (leaked) fail(`${leaked.name} was sent an answer while the question burned`);

  const lit = divers[0].view.litAt - divers[0].view.now;
  const said = [];
  let refusedFirst = 0;
  await Promise.all(
    divers.map(async (d, i) => {
      await sleep(Math.max(0, lit) + rand() * 4000);
      const a = pick(prompt.answers).answer;
      const kind = i % 5;
      // One in five says nonsense first, one in five slips a key.
      if (kind === 0) {
        const r = await d.say(`zzq nonsense ${i}`);
        said.push(r.ms);
        if (r.msg.t !== 'refused') fail(`${d.name}: nonsense was taken`);
        else refusedFirst++;
      }
      const r = await d.say(kind === 1 ? typo(a) : a);
      said.push(r.ms);
      if (r.msg.t === 'refused' && kind !== 1) fail(`${d.name}: “${a}” was refused (${r.msg.verdict})`);
      // A slip that the deep could not mend: say it properly.
      if (r.msg.t === 'refused') {
        const again = await d.say(a);
        said.push(again.ms);
        if (again.msg.t !== 'heard') fail(`${d.name}: “${a}” was refused the second time`);
      }
    }),
  );
  stats('an answer heard', said);
  if (pct(said, 95) > SLOW_MS) fail(`the relay took ${pct(said, 95)} ms to hear the slowest twentieth of answers`);
  // Everyone is in, so the question closes by itself a moment later.
  const closing = Date.now();
  const hostReveal = await host.phase('reveal', 1);
  await Promise.all(divers.map((d) => d.phase('reveal', 1)));
  console.log(`  reveal on every screen ${Date.now() - closing} ms after the last answer (it waits 1,500 ms for stragglers)`);
  if (hostReveal.result.spoke !== N) fail(`the host was told ${hostReveal.result.spoke} answered, not ${N}`);
  if (hostReveal.standings.length !== N) fail(`the host was sent ${hostReveal.standings.length} standings, not ${N}`);
  if (hostReveal.result.tables?.length !== 4) fail('the tables were not scored');
  const noOutcome = divers.filter((d) => !d.view.you?.outcome || d.view.you.outcome.answers.length !== 1);
  if (noOutcome.length) fail(`${noOutcome.length} divers were not shown their own answer in the reveal`);
  const sumSeats = divers.reduce((n, d) => n + d.view.you.total, 0);
  const sumHost = hostReveal.standings.reduce((n, s) => n + s.total, 0);
  if (sumSeats !== sumHost) fail(`the divers' depths come to ${sumSeats} m and the host's standings to ${sumHost} m`);
  console.log(`  ${hostReveal.result.given} different answers given · ${refusedFirst} refusals first · deepest ${hostReveal.standings[0].total} m`);

  // --- a blitz: everyone gives answers as fast as they can for ten seconds
  host.send({ t: 'config', mode: 'blitz', seconds: 60, tables: 4, questions: 5 });
  await host.until((m) => m.t === 'view' && m.view.config.mode === 'blitz', 10_000, 'the blitz');
  asked = Date.now();
  host.send({ t: 'ask', prompt, depths: DEPTHS });
  await Promise.all(divers.map((d) => d.phase('asking', 2)));
  console.log(`  question 2 (blitz) on every screen ${Date.now() - asked} ms after the host asked`);
  const blitz = [];
  let heard = 0;
  let again = 0;
  const until = Date.now() + Math.max(0, lit) + 10_000;
  const counts = [];
  const offCount = host.until((m) => (m.t === 'count' && counts.push(m.answered), false), 60_000, 'nothing').catch(() => {});
  await Promise.all(
    divers.map(async (d) => {
      await sleep(Math.max(0, lit) + rand() * 500);
      const mine = new Set();
      while (Date.now() < until) {
        const a = pick(prompt.answers).answer;
        const r = await d.say(a);
        blitz.push(r.ms);
        if (r.msg.t === 'heard') {
          heard++;
          if (mine.has(r.msg.answer)) fail(`${d.name}: “${a}” was taken twice`);
          mine.add(r.msg.answer);
        } else if (r.msg.verdict === 'said') again++;
        else fail(`${d.name}: “${a}” was refused in the blitz (${r.msg.verdict})`);
        await sleep(150 + rand() * 250);
      }
      d.mine = mine.size;
    }),
  );
  void offCount;
  stats('a blitz answer heard', blitz);
  if (pct(blitz, 95) > SLOW_MS) fail(`in the blitz the relay took ${pct(blitz, 95)} ms to hear the slowest twentieth of answers`);
  console.log(`  ${heard} answers taken, ${again} said twice · the host was sent the count ${counts.length} times`);
  host.send({ t: 'reveal' });
  const blitzReveal = await host.phase('reveal', 2);
  await Promise.all(divers.map((d) => d.phase('reveal', 2)));
  const wrong = divers.filter((d) => d.view.you.outcome.answers.length !== d.mine);
  if (wrong.length) fail(`${wrong.length} divers were scored a different number of answers than the relay took from them`);
  if (blitzReveal.result.spoke !== N) fail(`the host was told ${blitzReveal.result.spoke} answered the blitz, not ${N}`);

  // --- a diver reloads, the host removes another, the class ends
  const back = new Device(sign, 'Diver 1 again');
  await back.open;
  back.send({ t: 'hello', id: 'load-0000', name: 'Diver 1', rejoin: true });
  const backView = await back.phase('reveal', 2);
  if (backView.you.total !== divers[0].view.you.total) fail('a diver who reloaded lost their depth');
  if (N > 1) {
    host.send({ t: 'remove', id: `load-${String(N - 1).padStart(4, '0')}` });
    await divers[N - 1].until((m) => m.t === 'error' && m.code === 'removed', 5000, 'being removed');
  }
  host.send({ t: 'end' });
  const ended = await host.phase('ended');
  if (ended.seats !== N - (N > 1 ? 1 : 0)) fail(`the class ended with ${ended.seats} seats`);
  await Promise.all(divers.slice(0, N - 1).map((d) => d.phase('ended')));

  const per = divers.map((d) => d.got);
  const bytes = divers.map((d) => d.bytes);
  console.log(`  each diver was sent ${pct(per, 50)} messages (most ${Math.max(...per)}), about ${Math.round(pct(bytes, 50) / 1024)} KB · the host ${host.got} messages, ${Math.round(host.bytes / 1024)} KB`);
  const errors = divers.flatMap((d) => d.errors.filter((e) => e.code !== 'removed').map((e) => `${d.name}: ${e.code} ${e.message}`));
  if (errors.length) fail(`${errors.length} errors, the first: ${errors[0]}`);
  for (const d of [host, thief, back, ...divers]) d.ws.close();
}

main()
  .catch((e) => fail(e.message))
  .finally(() => {
    console.log(fails.length ? `\n${fails.length} failed` : '\nThe class held.');
    setTimeout(() => process.exit(fails.length ? 1 : 0), 200);
  });
