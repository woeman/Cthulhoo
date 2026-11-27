import { describe, expect, it } from 'vitest';
import { SIGN_WORDS, makeSign, parseSign, signSpoken } from '../src/party/codes';
import {
  GRACE_MS,
  LONE_BONUS,
  RISE_MS,
  advance,
  again,
  alarmAt,
  begin,
  candleDepth,
  cleanDepths,
  cleanName,
  cleanPrompts,
  configure,
  hear,
  heraldsOf,
  join,
  leave,
  mediumOf,
  newRoom,
  scoreCandle,
  setOnline,
  speak,
  tick,
  viewFor,
  type Room,
  type Seal,
} from '../src/party/room';
import type { PromptDef } from '../src/game/types';

const DEPTHS = [0, 100, 250, 400, 600, 800, 1000];

const planets: PromptDef = {
  id: 'planets',
  text: 'Name a planet of the Solar System.',
  category: 'science',
  answers: [
    { answer: 'Mars', tier: 1 },
    { answer: 'Saturn', tier: 1 },
    { answer: 'Neptune', tier: 3 },
    { answer: 'Mercury', tier: 4 },
    { answer: 'Uranus', tier: 5 },
  ],
  traps: [{ answer: 'Pluto', reason: 'Pluto was demoted in 2006.' }],
  decoys: ['Moon'],
};
const metals: PromptDef = {
  id: 'metals',
  text: 'Name a metal.',
  category: 'science',
  answers: [
    { answer: 'Iron', tier: 1 },
    { answer: 'Gallium', tier: 5 },
  ],
};

const seal = (sitter: string, answer: string, tier: number, input = answer): Seal => ({ sitter, input, answer, tier, at: 0 });

describe('signs', () => {
  it('makes séance and cult signs', () => {
    let k = 0;
    const seq = [0.0, 0.0, 0.99, 0.99];
    const rand = () => seq[k++ % seq.length];
    expect(makeSign('seance', rand)).toBe(`${SIGN_WORDS[0]}-2`);
    expect(makeSign('seance', rand)).toBe(`${SIGN_WORDS[SIGN_WORDS.length - 1]}-9`);
    for (let i = 0; i < 200; i++) {
      expect(makeSign('seance')).toMatch(/^[A-Z]{4,7}-[2-9]$/);
      expect(makeSign('cult')).toMatch(/^[A-Z]{4,7}-[1-9]\d$/);
    }
  });

  it('reads a sign however it is typed', () => {
    for (const s of ['DAGON-7', 'dagon 7', 'Dagon7', ' dagon—7 ', 'd.a.g.o.n 7']) expect(parseSign(s, 'seance')).toBe('DAGON-7');
    expect(parseSign('brine-42', 'cult')).toBe('BRINE-42');
  });

  it('mends one slip in the word, and only when one word fits', () => {
    expect(parseSign('DAGNO-7', 'seance')).toBe('DAGON-7');
    expect(parseSign('KRAKN 3', 'seance')).toBe('KRAKEN-3');
    expect(parseSign('ZZZZZ-7', 'seance')).toBeNull();
  });

  it('refuses the wrong shape of number', () => {
    expect(parseSign('DAGON-1', 'seance')).toBeNull();
    expect(parseSign('DAGON-0', 'seance')).toBeNull();
    expect(parseSign('DAGON-42', 'seance')).toBeNull();
    expect(parseSign('DAGON-7', 'cult')).toBeNull();
    expect(parseSign('DAGON', 'seance')).toBeNull();
    expect(parseSign('', 'seance')).toBeNull();
  });

  it('keeps every word at least two slips from every other', () => {
    for (const w of SIGN_WORDS) expect(parseSign(`${w}-5`, 'seance')).toBe(`${w}-5`);
    expect(new Set(SIGN_WORDS).size).toBe(SIGN_WORDS.length);
  });

  it('says a sign aloud', () => {
    expect(signSpoken('DAGON-7')).toBe('Dagon seven');
    expect(signSpoken('BRINE-42')).toBe('Brine four two');
  });
});

describe('scoring a candle', () => {
  it('sinks a lone voice half as deep again and splits a chorus', () => {
    expect(LONE_BONUS).toBe(1.5);
    expect(candleDepth(1000, 1)).toBe(1500);
    expect(candleDepth(1000, 2)).toBe(500);
    expect(candleDepth(100, 3)).toBe(30);
    expect(candleDepth(250, 1)).toBe(380);
    expect(candleDepth(0, 1)).toBe(0);
    expect(candleDepth(400, 0)).toBe(0);
  });

  it('counts answers by what they were taken as, not how they were typed', () => {
    const r = scoreCandle(planets, ['a', 'b', 'c', 'd'], { a: seal('a', 'Saturn', 1, 'saturn'), b: seal('b', 'Saturn', 1, 'Satrun'), c: seal('c', 'Uranus', 5) }, DEPTHS);
    const by = Object.fromEntries(r.voices.map((v) => [v.sitter, v]));
    expect(by.a).toMatchObject({ voices: 2, depth: 50, input: 'saturn' });
    expect(by.b).toMatchObject({ voices: 2, depth: 50, input: 'Satrun' });
    expect(by.c).toMatchObject({ voices: 1, depth: 1200 });
    expect(by.d).toMatchObject({ input: null, answer: null, tier: 0, voices: 0, depth: 0 });
    expect(r.voices.map((v) => v.sitter)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('shows the rarest answers nobody gave, and never the question’s answers early', () => {
    const r = scoreCandle(planets, ['a'], { a: seal('a', 'Uranus', 5) }, DEPTHS);
    expect(r.unsaid).toEqual([
      { answer: 'Mercury', tier: 4 },
      { answer: 'Neptune', tier: 3 },
      { answer: 'Mars', tier: 1 },
    ]);
    expect(Object.keys(r.prompt).sort()).toEqual(['category', 'id', 'text']);
  });

  it('crowns the deepest, every one of them on a tie, and nobody when nobody sank', () => {
    expect(heraldsOf({ a: 900, b: 1200, c: 1200 }, ['a', 'b', 'c'])).toEqual(['b', 'c']);
    expect(heraldsOf({ a: 0, b: 0 }, ['a', 'b'])).toEqual([]);
    expect(heraldsOf({}, [])).toEqual([]);
  });

  it('hears answers the way the daily dive does', () => {
    expect(hear(planets, 'nepture')).toEqual({ kind: 'sealed', answer: 'Neptune', tier: 3 });
    expect(hear(planets, 'pluto')).toEqual({ kind: 'refused', verdict: 'trap', reason: 'Pluto was demoted in 2006.' });
    expect(hear(planets, 'the moon')).toEqual({ kind: 'refused', verdict: 'decoy' });
    expect(hear(planets, 'Vulcan')).toEqual({ kind: 'refused', verdict: 'unknown' });
    expect(hear(planets, '   ')).toEqual({ kind: 'empty' });
  });
});

describe('what a device may send', () => {
  it('cleans questions down to what the relay needs', () => {
    const [p] = cleanPrompts([{ ...planets, lore: 'x', answers: [...planets.answers, { answer: 'Bad' }, { answer: 'Vesta', tier: 9 }], extra: 1 }], 5);
    expect(p.answers.at(-1)).toEqual({ answer: 'Vesta', aliases: [], tier: 6 });
    expect(p.answers).toHaveLength(6);
    expect(p.traps).toEqual([{ answer: 'Pluto', aliases: [], reason: 'Pluto was demoted in 2006.' }]);
    expect('extra' in p).toBe(false);
    expect(cleanPrompts([{ id: 'x', text: 'y', answers: [] }, null, 'z', { id: 'a'.repeat(81), text: 'y', answers: [{ answer: 'a', tier: 1 }] }], 5)).toEqual([]);
    expect(cleanPrompts([planets, metals, planets], 2)).toHaveLength(2);
    expect(cleanPrompts('nope', 5)).toEqual([]);
  });

  it('takes a tier table of seven numbers only', () => {
    expect(cleanDepths(DEPTHS)).toEqual(DEPTHS);
    expect(cleanDepths([5, 100, 250, 400, 600, 800, 99999])).toEqual([0, 100, 250, 400, 600, 800, 5000]);
    expect(cleanDepths([0, 1, 2])).toBeNull();
    expect(cleanDepths([0, 1, 2, 3, 4, 5, 'x'])).toBeNull();
  });

  it('cleans names of control and direction characters', () => {
    expect(cleanName('  Ada \u202e  Lovelace\u0007  ')).toBe('Ada Lovelace');
    expect(cleanName('x'.repeat(40))).toHaveLength(16);
    expect(cleanName(undefined)).toBe('');
  });
});

function room(): Room {
  const r = newRoom('DAGON-7', 1000);
  join(r, 'ada1', 'Ada', false, 1000);
  join(r, 'bram', 'Bram', false, 1000);
  join(r, 'cleo', 'Cleo', false, 1000);
  join(r, 'tele', '', true, 1000);
  return r;
}

describe('a séance', () => {
  it('seats a circle and a table, with unique names and marks', () => {
    const r = room();
    const dup = join(r, 'ada2', 'ada', false, 1000);
    expect(dup.ok && dup.sitter.name).toBe('ada II');
    expect(r.sitters.map((s) => s.mark)).toEqual([0, 1, 2, -1, 3]);
    expect(r.sitters.find((s) => s.table)?.name).toBe('The table');
    expect(join(r, 'nobody', '   ', false, 1000)).toMatchObject({ ok: false, code: 'name' });
    expect(join(r, 'BAD ID!', 'Eve', false, 1000)).toMatchObject({ ok: false, code: 'bad' });
  });

  it('holds twelve at most', () => {
    const r = newRoom('DAGON-7', 0);
    for (let i = 0; i < 12; i++) expect(join(r, `sitter${i}`, `S${i}`, false, 0).ok).toBe(true);
    expect(join(r, 'late1', 'Late', false, 0)).toMatchObject({ ok: false, code: 'full' });
    expect(join(r, 'table1', '', true, 0).ok).toBe(true);
  });

  it('gives the candles to the first who is still here', () => {
    const r = room();
    expect(mediumOf(r)).toBe('ada1');
    setOnline(r, 'ada1', false);
    expect(mediumOf(r)).toBe('bram');
    setOnline(r, 'ada1', true);
    expect(mediumOf(r)).toBe('ada1');
    expect(configure(r, 'bram', 3, 20, 2000)).toMatchObject({ ok: false, code: 'medium' });
    expect(configure(r, 'ada1', 4, 20, 2000)).toMatchObject({ ok: false, code: 'bad' });
    expect(configure(r, 'ada1', 3, 20, 2000).ok).toBe(true);
    expect(r.config).toEqual({ candles: 3, seconds: 20 });
  });

  it('plays a whole séance', () => {
    const r = room();
    configure(r, 'ada1', 3, 20, 1000);
    expect(begin(r, 'ada1', [planets, metals], DEPTHS, 10_000).ok).toBe(true);
    expect(r.phase).toBe('candle');
    expect(r.litAt).toBe(10_000 + RISE_MS);
    expect(r.deadline).toBe(r.litAt + 20_000);
    expect(alarmAt(r)).toBe(r.deadline + GRACE_MS + 50);

    // A refusal costs nothing and is kept once; a trap gives its reason.
    const t1 = speak(r, 'bram', 'Pluto', 12_000);
    expect(t1.ok && t1.heard).toEqual({ kind: 'refused', verdict: 'trap', reason: 'Pluto was demoted in 2006.' });
    speak(r, 'bram', 'pluto', 12_100);
    expect(viewFor(r, 'bram', 12_200).tries).toEqual(['Pluto']);
    expect(speak(r, 'tele', 'Mars', 12_000)).toMatchObject({ ok: false, code: 'phase' });

    // Sealed answers stay secret until the candle is out.
    expect(speak(r, 'ada1', 'Uranus', 13_000).ok).toBe(true);
    expect(speak(r, 'ada1', 'Mars', 13_100)).toMatchObject({ ok: false, code: 'sealed' });
    const seen = viewFor(r, 'cleo', 13_200);
    expect(seen.sealed).toEqual(['ada1']);
    expect(seen.yours).toBeNull();
    expect(JSON.stringify(seen)).not.toContain('Uranus');
    expect(viewFor(r, 'ada1', 13_200).yours).toEqual({ input: 'Uranus', answer: 'Uranus', tier: 5 });

    // Everyone still here has sealed: the candle goes out early.
    speak(r, 'bram', 'Saturn', 14_000);
    speak(r, 'cleo', 'saturn', 15_000);
    expect(r.phase).toBe('reveal');
    expect(r.totals).toEqual({ ada1: 1200, bram: 50, cleo: 50 });
    expect(viewFor(r, 'cleo', 15_100).results[0].voices[0]).toMatchObject({ sitter: 'ada1', answer: 'Uranus', depth: 1200 });

    // The second candle: Cleo drops out and the clock puts it out.
    expect(advance(r, 'bram', 16_000)).toMatchObject({ ok: false, code: 'medium' });
    expect(advance(r, 'ada1', 16_000).ok).toBe(true);
    expect(r.candle).toBe(1);
    speak(r, 'ada1', 'Iron', 18_000);
    setOnline(r, 'cleo', false);
    speak(r, 'bram', 'Galium', 19_000);
    expect(r.phase).toBe('reveal');
    expect(r.results[1].voices.find((v) => v.sitter === 'cleo')).toMatchObject({ input: null, depth: 0 });
    expect(r.totals).toEqual({ ada1: 1350, bram: 1250, cleo: 50 });

    // The last rites: the deepest is the Herald of the Deep.
    advance(r, 'ada1', 20_000);
    expect(r.phase).toBe('ended');
    expect(viewFor(r, 'bram', 20_000).heralds).toEqual(['ada1']);

    // The same circle may sit again; whoever left loses their seat.
    expect(again(r, 'ada1', 21_000).ok).toBe(true);
    expect(r.phase).toBe('lobby');
    expect(r.sitters.map((s) => s.id)).toEqual(['ada1', 'bram', 'tele']);
    expect(r.totals).toEqual({ ada1: 0, bram: 0 });
  });

  it('lets the clock put out a candle, and refuses an answer that comes too late', () => {
    const r = room();
    begin(r, 'ada1', [planets], DEPTHS, 0);
    expect(tick(r, r.deadline)).toBe(false);
    expect(speak(r, 'ada1', 'Mars', r.deadline + GRACE_MS).ok).toBe(true);
    expect(speak(r, 'bram', 'Neptune', r.deadline + GRACE_MS + 1)).toMatchObject({ ok: false, code: 'late' });
    expect(tick(r, r.deadline + GRACE_MS + 1)).toBe(true);
    expect(r.phase).toBe('reveal');
    expect(alarmAt(r)).toBeNull();
    expect(r.totals.ada1).toBe(150);
  });

  it('lets a latecomer answer the candle that burns', () => {
    const r = room();
    begin(r, 'ada1', [planets], DEPTHS, 0);
    join(r, 'dora', 'Dora', false, 5000);
    expect(r.circle).toContain('dora');
    expect(speak(r, 'dora', 'Mercury', 6000).ok).toBe(true);
    expect(r.totals.dora).toBe(0);
  });

  it('clears empty seats when the first candle is lit, and lets a sitter leave the lobby', () => {
    const r = room();
    setOnline(r, 'cleo', false);
    leave(r, 'bram', 500);
    expect(r.sitters.map((s) => s.id)).toEqual(['ada1', 'cleo', 'tele']);
    begin(r, 'ada1', [planets], DEPTHS, 1000);
    expect(r.sitters.map((s) => s.id)).toEqual(['ada1', 'tele']);
    expect(r.circle).toEqual(['ada1']);
  });

  it('refuses a medium who sends nothing to ask', () => {
    const r = room();
    expect(begin(r, 'ada1', [], DEPTHS, 0)).toMatchObject({ ok: false, code: 'bad' });
    expect(begin(r, 'ada1', [planets], [1, 2], 0)).toMatchObject({ ok: false, code: 'bad' });
    expect(r.phase).toBe('lobby');
  });

  it('keeps names fixed once the candles are lit', () => {
    const r = room();
    begin(r, 'ada1', [planets], DEPTHS, 0);
    join(r, 'ada1', 'Someone Else', false, 100);
    expect(r.sitters[0].name).toBe('Ada');
  });
});
