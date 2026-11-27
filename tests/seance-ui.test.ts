import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_THEME } from '../src/game/theme';
import type { PromptDef } from '../src/game/types';
import { weekOf } from '../src/party/cult';
import { addSitter, candleOut, newPass, startPass, takeLantern } from '../src/party/passplay';
import type { CandleResult, SeanceView, Voice } from '../src/party/types';
import {
  MARK_GLYPHS,
  SEATS,
  burnt,
  capitalise,
  cardinal,
  choosePrompts,
  columnScale,
  deepest,
  gainsOf,
  glyphId,
  lanternResume,
  listNames,
  ordinal,
  relayId,
  revealOrder,
  sameWords,
  seatAngle,
  seatOf,
  seatsOf,
  secondsLeft,
  shareLink,
  shortMetres,
  standings,
  tableWords,
  tablesOf,
  tierDepths,
  tintOf,
  totalsBefore,
  voiceNote,
  voiceNoteSpoken,
  weekCells,
  weekSpan,
  type TableSeat,
} from '../src/screens/seance/model';

const CATEGORIES = ['geography', 'science', 'history', 'culture', 'nature', 'myth'];
const PROMPTS: PromptDef[] = Array.from({ length: 60 }, (_, i) => ({
  id: `q${String(i).padStart(2, '0')}`,
  text: `Question ${i}`,
  category: CATEGORIES[i % CATEGORIES.length],
  answers: [
    { answer: `Common ${i}`, tier: 1 },
    { answer: `Rare ${i}`, tier: 5 },
  ],
}));
const BANK = { prompts: PROMPTS, byId: new Map(PROMPTS.map((p) => [p.id, p])), days: [] };

const voice = (sitter: string, depth: number, input: string | null = 'x', voices = 1): Voice => ({ sitter, input, answer: input, tier: input === null ? 0 : 1, voices, depth });

describe('marks and seats', () => {
  it('keeps the glyphs in the order they stand round the table', () => {
    expect(MARK_GLYPHS).toEqual(['tide', 'fang', 'anchor', 'talon', 'sounding', 'maw', 'root', 'veil', 'spire', 'knot', 'hand', 'void']);
    expect(SEATS).toBe(12);
    expect(glyphId(0)).toBe('g-tide');
    expect(glyphId(11)).toBe('g-void');
    expect(glyphId(12)).toBe('g-tide');
    expect(glyphId(-1)).toBe('g-void');
  });

  it('gives a small circle six different colours before any repeats', () => {
    const first = [0, 1, 2, 3, 4, 5].map(tintOf);
    expect(new Set(first).size).toBe(6);
    for (const t of first) expect(t).toBeGreaterThanOrEqual(1);
    expect(tintOf(6)).toBe(tintOf(0));
  });

  it('sits mark N - 1 in chair N, and a table in none', () => {
    expect(seatOf(0)).toBe(1);
    expect(seatOf(11)).toBe(12);
    expect(seatOf(12)).toBe(1);
    expect(seatOf(-1)).toBe(0);
    expect(seatOf(Number.NaN)).toBe(0);
  });

  it('puts chair 1 at the top and goes round clockwise', () => {
    expect(seatAngle(1)).toEqual({ cos: 0, sin: -1 });
    expect(seatAngle(4)).toEqual({ cos: 1, sin: 0 });
    expect(seatAngle(7).cos).toBeCloseTo(0);
    expect(seatAngle(7).sin).toBeCloseTo(1);
    expect(seatAngle(10).cos).toBeCloseTo(-1);
  });

  it('makes a mark the relay will take, and a different one for a table', () => {
    const ok = /^[a-z0-9-]{4,40}$/;
    expect(relayId('AbC-12xyz')).toBe('abc-12xyz');
    expect(relayId('ab')).toBe('abseat');
    expect(relayId('')).toBe('seat00');
    expect(relayId('k3p9w2', true)).toBe('k3p9w2-table');
    for (const raw of ['', 'x', 'ÉÉÉÉ', 'a b c d e', 'z'.repeat(60), 'Q9_!_r']) {
      expect(relayId(raw)).toMatch(ok);
      expect(relayId(raw, true)).toMatch(ok);
    }
  });
});

describe('the questions', () => {
  it('takes the depths from the theme, silence first', () => {
    const d = tierDepths(PLACEHOLDER_THEME);
    expect(d).toHaveLength(7);
    expect(d[0]).toBe(0);
    for (const t of PLACEHOLDER_THEME.tiers) expect(d[t.tier]).toBe(t.depth);
  });

  it('never asks the day’s questions or those already asked, and asks as many as the candles', () => {
    const avoid = PROMPTS.slice(0, 7).map((p) => p.id);
    const asked = PROMPTS.slice(7, 12).map((p) => p.id);
    const set = choosePrompts(BANK, avoid, 'DAGON-7', 0, 1, 5, asked);
    expect(set).toHaveLength(5);
    for (const p of set) {
      expect(avoid).not.toContain(p.id);
      expect(asked).not.toContain(p.id);
    }
    expect(choosePrompts(BANK, avoid, 'DAGON-7', 0, 1, 0)).toHaveLength(1);
  });

  it('asks the same circle the same questions, and new ones when it sits again', () => {
    const a = choosePrompts(BANK, [], 'DAGON-7', 0, 1, 7).map((p) => p.id);
    expect(choosePrompts(BANK, [], 'dagon-7', 0, 1, 7).map((p) => p.id)).toEqual(a);
    expect(choosePrompts(BANK, [], 'DAGON-7', 1, 1, 7).map((p) => p.id)).not.toEqual(a);
  });
});

describe('the reveal', () => {
  it('surfaces silence first, then shallowest to deepest, ties in the circle’s order', () => {
    const order = revealOrder([voice('a', 600), voice('b', 0, null), voice('c', 150), voice('d', 150), voice('e', 0, 'x')]);
    expect(order.map((v) => v.sitter)).toEqual(['b', 'e', 'c', 'd', 'a']);
  });

  it('says how alone a voice was', () => {
    expect(voiceNote({ input: null, voices: 0 })).toBe('The candle went out');
    expect(voiceNote({ input: 'Mars', voices: 1 })).toBe('A lone voice · ×1.5');
    expect(voiceNote({ input: 'Mars', voices: 3 })).toBe('A chorus of 3 · the depth is shared');
    expect(voiceNoteSpoken({ input: 'Mars', voices: 2 })).toBe('a chorus of 2, the depth shared');
    expect(voiceNoteSpoken({ input: 'Mars', voices: 1 })).toBe('a lone voice, half as deep again');
  });

  it('only says “taken as” when the words differ', () => {
    expect(sameWords('nigeria', 'Nigeria')).toBe(true);
    expect(sameWords('Côte d’Ivoire', 'Cote dIvoire')).toBe(true);
    expect(sameWords('Ivory Coast', 'Côte d’Ivoire')).toBe(false);
  });

  it('ranks the circle deepest first, ties sharing a rank', () => {
    const rows = standings(['a', 'b', 'c', 'd'], { a: 300, b: 500, c: 300, d: 0 }, { a: 100 });
    expect(rows.map((r) => [r.id, r.rank, r.tied])).toEqual([
      ['b', 1, false],
      ['a', 2, true],
      ['c', 2, true],
      ['d', 4, false],
    ]);
    expect(rows[1].gain).toBe(100);
  });

  it('works back to the totals before a candle, and its gains', () => {
    const result: CandleResult = { prompt: { id: 'q', text: 'Q', category: 'c' }, voices: [voice('a', 150), voice('b', 0, null)], unsaid: [] };
    expect(totalsBefore({ a: 400, b: 90 }, result)).toEqual({ a: 250, b: 90 });
    expect(totalsBefore({ a: 100 }, result)).toEqual({ a: 0, b: 0 });
    expect(gainsOf(result)).toEqual({ a: 150, b: 0 });
    expect(deepest({ a: 400, b: 90 })).toBe(400);
    expect(deepest({})).toBe(0);
    expect(deepest({ a: 400, b: 90 }, ['b'])).toBe(90);
  });
});

describe('the candle', () => {
  it('counts whole seconds, the full count until it catches', () => {
    expect(secondsLeft(0, 1000, 31_000)).toBe(30);
    expect(secondsLeft(11_500, 1000, 31_000)).toBe(20);
    expect(secondsLeft(30_900, 1000, 31_000)).toBe(1);
    expect(secondsLeft(31_000, 1000, 31_000)).toBe(0);
    expect(secondsLeft(40_000, 1000, 31_000)).toBe(0);
  });

  it('burns down from 0 to 1', () => {
    expect(burnt(0, 1000, 31_000)).toBe(0);
    expect(burnt(16_000, 1000, 31_000)).toBe(0.5);
    expect(burnt(99_000, 1000, 31_000)).toBe(1);
    expect(burnt(5, 10, 10)).toBe(0);
    expect(burnt(10, 10, 10)).toBe(1);
  });

  it('lets a lantern that burnt out while the page was away gutter', () => {
    const s = newPass();
    addSitter(s, 'Wren');
    addSitter(s, 'Bram');
    startPass(s, ['q00'], [0, 100, 250, 400, 600, 800, 1000]);
    expect(lanternResume(s, 0)).toBeNull();
    takeLantern(s, 1000);
    expect(lanternResume(s, candleOut(s) - 1)).toBeNull();
    expect(lanternResume(s, candleOut(s))).toBe('gutter');
  });
});

describe('words', () => {
  it('lists names as a person says them', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['Ada'])).toBe('Ada');
    expect(listNames(['Ada', 'Bram'])).toBe('Ada and Bram');
    expect(listNames(['Ada', 'Bram', 'Cleo'])).toBe('Ada, Bram and Cleo');
  });

  it('counts in words', () => {
    expect(ordinal(2)).toBe('second');
    expect(ordinal(12)).toBe('twelfth');
    expect(ordinal(13)).toBe('13th');
    expect(cardinal(4)).toBe('four');
    expect(cardinal(12)).toBe('twelve');
    expect(cardinal(30)).toBe('30');
    expect(capitalise('five candles')).toBe('Five candles');
    expect(capitalise('')).toBe('');
  });

  it('puts the sign on the game’s own address', () => {
    expect(shareLink('https://example.org/Cthulhoo/?state=lobby#top', 'DAGON-7')).toBe('https://example.org/Cthulhoo/?seance=DAGON-7');
    expect(shareLink('https://example.org/', 'BRINE-42', 'cult')).toBe('https://example.org/?cult=BRINE-42');
    expect(shareLink('not a url', 'DAGON-7')).toBe('?seance=DAGON-7');
  });

  it('writes small depths for the board’s cells', () => {
    expect(shortMetres(0)).toBe('0');
    expect(shortMetres(840)).toBe('840');
    expect(shortMetres(1000)).toBe('1k');
    expect(shortMetres(1234)).toBe('1.2k');
    expect(shortMetres(9960)).toBe('10k');
    expect(shortMetres(12_400)).toBe('12k');
  });

  it('gives the water column a round foot below the deepest diver', () => {
    expect(columnScale(0)).toBe(1000);
    expect(columnScale(900)).toBe(1500);
    expect(columnScale(3030)).toBe(3500);
    for (const m of [10, 999, 1500, 4321, 12_000]) expect(columnScale(m)).toBeGreaterThan(m);
  });
});

describe('the cult’s week', () => {
  it('marks today and leaves the days to come empty', () => {
    const cells = weekCells({ week: 4, today: 9 }, [100, 200, null, 400, 500, 600, 700]);
    expect(cells.map((c) => c.state)).toEqual(['past', 'past', 'past', 'past', 'past', 'today', 'future']);
    expect(cells.map((c) => c.depth)).toEqual([100, 200, null, 400, 500, 600, null]);
    expect(cells[0].day).toBe(4);
  });

  it('names the week as a person says it', () => {
    expect(weekSpan(weekOf(1))).toBe('23–29 November');
    expect(weekSpan(weekOf(9))).toBe('30 November – 6 December');
    expect(weekSpan(32)).toBe('28 December 2026 – 3 January 2027');
  });
});

describe('the circle from a relay view', () => {
  const view: Pick<SeanceView, 'sitters' | 'you' | 'medium'> = {
    you: 'b',
    medium: 'a',
    sitters: [
      { id: 'a', name: 'Wren', mark: 0, joined: 1, online: true, table: false },
      { id: 't', name: 'The table', mark: -1, joined: 2, online: true, table: true },
      { id: 'b', name: 'Bram', mark: 1, joined: 3, online: false, table: false },
    ],
  };

  it('leaves the tables out and knows who is who', () => {
    expect(seatsOf(view)).toEqual([
      { id: 'a', name: 'Wren', mark: 0, online: true, you: false, medium: true },
      { id: 'b', name: 'Bram', mark: 1, online: false, you: true, medium: false },
    ]);
    expect(tablesOf(view)).toBe(1);
  });

  it('describes the table for a screen reader', () => {
    const seat = (name: string, mark: number, state: TableSeat['state']): TableSeat => ({ id: name, name, mark, state });
    expect(tableWords([])).toBe('A séance table: all twelve chairs empty.');
    expect(tableWords([seat('Wren', 0, 'sealed'), seat('Harrow', 1, 'waiting'), seat('Ilse', 2, 'away'), seat('Bram', 3, 'sealed'), seat('', 4, 'empty')])).toBe(
      'A séance table: four of twelve chairs taken, by Wren, Harrow, Ilse and Bram. Sealed: Wren and Bram. Still to seal: Harrow. Stepped away: Ilse.',
    );
    expect(tableWords([seat('Wren', 0, 'waiting')])).toBe('A séance table: one of twelve chairs taken, by Wren. Nobody has sealed yet. Still to seal: Wren.');
    expect(tableWords([seat('Wren', 0, 'seated'), seat('The table', -1, 'seated')])).toBe('A séance table: one of twelve chairs taken, by Wren.');
  });
});
