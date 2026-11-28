import { describe, expect, it } from 'vitest';
import { LOGS_KEPT, answersCsv, csvOf, dropClassLog, givenBy, ledgerId, listClassLogs, loadClassLog, logDivers, logFileName, marksCsv, questionCount, refusedOf, saveClassLog, uncountedOf, withLedger, type ClassLog, type LogStore, type LogWords } from '../src/party/class-log';
import { againClass, ask, configureClass, endClass, hostView, newClass, removeSeat, reveal, say, seatOnline, snapshot, takeSeat, type ClassRoom } from '../src/party/classroom';
import type { PromptDef } from '../src/game/types';

const DEPTHS = [0, 100, 250, 400, 600, 800, 1000];
const T0 = 1_000_000;
const NOW = Date.UTC(2026, 10, 28, 3, 0, 0);

const planets: PromptDef = {
  id: 'planets',
  text: 'Name a planet of the Solar System.',
  category: 'science',
  rules: 'The eight of today.',
  answers: [
    { answer: 'Mars', tier: 1 },
    { answer: 'Saturn', tier: 1 },
    { answer: 'Jupiter', tier: 2 },
    { answer: 'Neptune', tier: 3 },
    { answer: 'Mercury', tier: 4 },
    { answer: 'Uranus', tier: 5 },
    { answer: 'Venus', tier: 2 },
    { answer: 'Earth', tier: 1 },
  ],
  traps: [{ answer: 'Pluto', reason: 'Pluto was demoted in 2006.' }],
};

const moons: PromptDef = {
  id: 'own-abc-moons',
  text: 'Name a moon, of "any" planet.',
  category: 'own',
  topic: 'Week 3',
  answers: [
    { answer: 'Titan', tier: 1 },
    { answer: 'Europa', tier: 2 },
    { answer: 'Phobos', tier: 3 },
  ],
};

const dev = (n: number) => `dev-${String(n).padStart(4, '0')}`;
const WORDS: LogWords = { tier: (t) => ['', 'Commonplace', 'Curious', 'Obscure', 'Arcane', 'Forbidden', 'Unspeakable'][t] ?? '', table: (t) => ['', 'Kraken', 'Dagon'][t] ?? `Table ${t}`, mode: (m) => (m === 'blitz' ? 'Blitz' : m === 'last' ? 'Last diver standing' : 'Classic') };

function classOf(names: string[], tables = 0): ClassRoom {
  const room = newClass('DAGON-417', 'k'.repeat(24), T0);
  if (tables) expect(configureClass(room, { mode: 'classic', seconds: 30, tables, questions: 5 }, T0).ok).toBe(true);
  names.forEach((name, i) => expect(takeSeat(room, dev(i + 1), name, T0).ok).toBe(true));
  return room;
}

const view = (room: ClassRoom, at: number) => hostView(room, snapshot(room, at));

/** A class of four over two questions: Ada and Bram answer both, Cleo is refused, Dov says nothing and steps away. */
function held(): { room: ClassRoom; log: ClassLog } {
  const room = classOf(['Ada', 'Bram', 'Cleo', 'Dov']);
  expect(ask(room, planets, DEPTHS, T0)).toEqual({ ok: true });
  let at = room.litAt + 1;
  say(room, dev(1), 'mars', at);
  say(room, dev(2), 'Uranos', at);
  say(room, dev(3), 'Pluto', at);
  say(room, dev(3), ' pluto ', at);
  say(room, dev(3), 'The Moon', at);
  say(room, dev(3), 'Mars', at);
  reveal(room, at + 10);
  let log = withLedger(null, view(room, at + 10), NOW)!;
  seatOnline(room, dev(4), false);
  expect(ask(room, moons, DEPTHS, at + 10_000)).toEqual({ ok: true });
  at = room.litAt + 1;
  say(room, dev(1), 'Titan', at);
  say(room, dev(2), 'Titan', at);
  say(room, dev(3), '=SUM(A1)', at);
  reveal(room, at + 10);
  log = withLedger(log, view(room, at + 10), NOW + 60_000)!;
  endClass(room, at + 20);
  log = withLedger(log, view(room, at + 20), NOW + 90_000)!;
  return { room, log };
}

describe('the host’s record of a class', () => {
  it('keeps each question once, and how everyone stands at the last', () => {
    const { log } = held();
    expect(log).toMatchObject({ v: 1, sign: 'DAGON-417', at: NOW, ended: true });
    expect(log.id).toBe(`DAGON-417.${T0.toString(36)}.1`);
    expect(log.questions.map((q) => [q.n, q.mode, q.at, q.prompt.text, q.known])).toEqual([
      [1, 'classic', NOW, planets.text, 8],
      [2, 'classic', NOW + 60_000, moons.text, 3],
    ]);
    expect(log.questions[0].prompt).toEqual({ id: 'planets', text: planets.text, rules: 'The eight of today.' });
    expect(log.questions[1].prompt).toEqual({ id: 'own-abc-moons', text: moons.text, topic: 'Week 3' });
    expect(log.questions[0].unsaid.map((u) => u.answer)).toEqual(['Mercury', 'Neptune', 'Jupiter', 'Venus', 'Saturn']);
    expect(log.standings.map((s) => [s.name, s.total, s.rank])).toEqual([
      ['Bram', 1300, 1],
      ['Ada', 200, 2],
      ['Cleo', 100, 3],
      ['Dov', 0, 4],
    ]);
    // No ledger, no record: a view of the lobby or of a burning question keeps nothing.
    const room = classOf(['Ada']);
    expect(withLedger(null, view(room, T0), NOW)).toBeNull();
    expect(ledgerId(view(room, T0))).toBeNull();
  });

  it('keeps a question as it was first seen', () => {
    const room = classOf(['Ada', 'Bram']);
    ask(room, planets, DEPTHS, T0);
    const at = room.litAt + 1;
    say(room, dev(1), 'Mars', at);
    reveal(room, at + 5);
    const first = withLedger(null, view(room, at + 5), NOW)!;
    // The host sends Bram out afterwards: the question keeps his empty line.
    removeSeat(room, dev(2), at + 6);
    const again = withLedger(first, view(room, at + 7), NOW + 5)!;
    expect(again.questions).toHaveLength(1);
    expect(again.questions[0].rows.map((r) => r.name)).toEqual(['Ada', 'Bram']);
    expect(again.questions[0].at).toBe(NOW);
    expect(again.standings.map((s) => s.name)).toEqual(['Ada']);
    expect(logDivers(again).map((d) => [d.name, d.total, d.rank])).toEqual([
      ['Ada', 150, 1],
      ['Bram', 0, 2],
    ]);
  });

  it('starts a new record for another round, and for another class under the same sign', () => {
    const { room, log } = held();
    againClass(room, T0 + 500_000);
    ask(room, planets, DEPTHS, T0 + 500_010);
    reveal(room, room.litAt + 5);
    const v = view(room, room.litAt + 5);
    expect(ledgerId(v)).toBe(`DAGON-417.${T0.toString(36)}.2`);
    const next = withLedger(log, v, NOW + 1)!;
    expect(next.id).not.toBe(log.id);
    expect(next.questions.map((q) => q.n)).toEqual([1]);
    expect(next.at).toBe(NOW + 1);
    const other = newClass('DAGON-417', 'z'.repeat(24), T0 + 9_000_000);
    takeSeat(other, dev(1), 'Eve', T0 + 9_000_000);
    ask(other, planets, DEPTHS, T0 + 9_000_000);
    reveal(other, other.litAt + 5);
    expect(ledgerId(view(other, other.litAt + 5))).not.toBe(log.id);
  });

  it('reads each diver across the class, and each question across the divers', () => {
    const { log } = held();
    const divers = logDivers(log);
    expect(divers.map((d) => [d.name, d.rank, d.total, d.answered])).toEqual([
      ['Bram', 1, 1300, 2],
      ['Ada', 2, 200, 2],
      ['Cleo', 3, 100, 1],
      ['Dov', 4, 0, 0],
    ]);
    const bram = divers[0];
    expect(bram.cells[0]).toEqual({ answers: [{ answer: 'Uranus', tier: 5, depth: 1200, voices: 1, typed: 'Uranos' }], tries: [], gain: 1200, here: true });
    expect(divers[3].cells.map((c) => c?.here)).toEqual([true, false]);
    const [q1, q2] = log.questions;
    expect(givenBy(q1)).toEqual([['Bram'], ['Ada', 'Cleo']]);
    expect(refusedOf(q1)).toEqual([
      { text: 'Pluto', count: 1, names: ['Cleo'] },
      { text: 'The Moon', count: 1, names: ['Cleo'] },
    ]);
    expect(questionCount(q1)).toEqual({ seated: 4, here: 4, answered: 3, silent: 1, given: 2 });
    expect(questionCount(q2)).toEqual({ seated: 4, here: 3, answered: 2, silent: 1, given: 1 });
    // Someone refused everything they tried is told apart from someone who gave nothing, and from someone not there.
    expect(uncountedOf(q1)).toEqual({ refused: [], silent: ['Dov'], away: [] });
    expect(uncountedOf(q2)).toEqual({ refused: ['Cleo'], silent: [], away: ['Dov'] });
  });

  it('counts a diver refused the same thing by two divers once each', () => {
    const room = classOf(['Ada', 'Bram', 'Cleo']);
    ask(room, planets, DEPTHS, T0);
    const at = room.litAt + 1;
    for (const n of [1, 2]) say(room, dev(n), 'the sun', at);
    say(room, dev(3), 'The  Sun', at);
    say(room, dev(3), 'Krypton', at);
    reveal(room, at + 5);
    const log = withLedger(null, view(room, at + 5), NOW)!;
    expect(refusedOf(log.questions[0])).toEqual([
      { text: 'the sun', count: 3, names: ['Ada', 'Bram', 'Cleo'] },
      { text: 'Krypton', count: 1, names: ['Cleo'] },
    ]);
  });
});

describe('a class as a spreadsheet', () => {
  it('writes cells a spreadsheet reads, and none it would run', () => {
    expect(csvOf([['a', 'b,c', 'say "hi"', 7, 'two\nlines']])).toBe('a,"b,c","say ""hi""",7,"two\nlines"\r\n');
    expect(csvOf([['=1+1', '+44', '-5', '@x', 'a=b', -5]])).toBe("'=1+1,'+44,'-5,'@x,a=b,-5\r\n");
  });

  it('gives one row a diver, deepest first', () => {
    const { log } = held();
    expect(marksCsv(log, WORDS).split('\r\n')).toEqual([
      'Place,Name,Depth (m),Questions answered,Q1: Name a planet of the Solar System.,Q1 depth (m),"Q2: Name a moon, of ""any"" planet.",Q2 depth (m)',
      '1,Bram,1300,2,Uranus,1200,Titan,100',
      '2,Ada,200,2,Mars,100,Titan,100',
      '3,Cleo,100,1,Mars,100,,0',
      '4,Dov,0,0,,0,,0',
      '',
    ]);
  });

  it('gives one row an answer, with what was typed and what was refused', () => {
    const { log } = held();
    const rows = answersCsv(log, WORDS).split('\r\n');
    expect(rows[0]).toBe('Question,Question text,Played as,Name,Result,Typed,Counted as,Rarity,Divers who gave it,Depth (m)');
    expect(rows.slice(1, 8)).toEqual([
      '1,Name a planet of the Solar System.,Classic,Ada,counted,Mars,Mars,Commonplace,2,100',
      '1,Name a planet of the Solar System.,Classic,Bram,counted,Uranos,Uranus,Forbidden,1,1200',
      '1,Name a planet of the Solar System.,Classic,Cleo,counted,Mars,Mars,Commonplace,2,100',
      '1,Name a planet of the Solar System.,Classic,Cleo,refused,Pluto,,,,0',
      '1,Name a planet of the Solar System.,Classic,Cleo,refused,pluto,,,,0',
      '1,Name a planet of the Solar System.,Classic,Cleo,refused,The Moon,,,,0',
      '1,Name a planet of the Solar System.,Classic,Dov,no answer,,,,,0',
    ]);
    // What a diver typed is never run as a formula.
    expect(rows).toContain('2,"Name a moon, of ""any"" planet.",Classic,Cleo,refused,\'=SUM(A1),,,,0');
    expect(rows).toContain('2,"Name a moon, of ""any"" planet.",Classic,Dov,not here,,,,,0');
  });

  it('names the tables of a class that had them', () => {
    const room = classOf(['Ada', 'Bram'], 2);
    ask(room, planets, DEPTHS, T0);
    say(room, dev(2), 'Mars', room.litAt + 1);
    reveal(room, room.litAt + 5);
    const log = withLedger(null, view(room, room.litAt + 5), NOW)!;
    expect(log.tableTotals).toEqual([0, 0, 150]);
    expect(marksCsv(log, WORDS).split('\r\n').slice(0, 3)).toEqual(['Place,Name,Table,Depth (m),Questions answered,Q1: Name a planet of the Solar System.,Q1 depth (m)', '1,Bram,Dagon,150,1,Mars,150', '2,Ada,Kraken,0,0,,0']);
    expect(answersCsv(log, WORDS).split('\r\n')[1]).toBe('1,Name a planet of the Solar System.,Classic,Ada,Kraken,no answer,,,,,0');
  });

  it('names its files by the sign and the day', () => {
    const at = new Date(2026, 10, 28, 15, 30).getTime();
    expect(logFileName({ sign: 'DAGON-417', at }, 'marks')).toBe('cthulhoo-DAGON-417-2026-11-28-marks.csv');
    expect(logFileName({ sign: '../x', at: NaN }, 'answers')).toBe('cthulhoo-x-class-answers.csv');
  });
});

/** A browser's storage that holds only so many characters. */
function boxOf(room = Infinity): LogStore & { size(): number; keys(): string[] } {
  const m = new Map<string, string>();
  const size = () => [...m.values()].reduce((n, v) => n + v.length, 0);
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (size() - (m.get(k)?.length ?? 0) + v.length > room) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
    size,
    keys: () => [...m.keys()],
  };
}

describe('classes kept on the host’s device', () => {
  it('keeps a class, lists it, reads it back and forgets it', () => {
    const box = boxOf();
    const { log } = held();
    expect(listClassLogs(box)).toEqual([]);
    expect(saveClassLog(log, box)).toBe(true);
    expect(listClassLogs(box)).toEqual([{ id: log.id, sign: 'DAGON-417', at: NOW, ended: true, divers: 4, questions: 2, modes: ['classic'], topics: [], size: JSON.stringify(log).length }]);
    expect(loadClassLog(log.id, box)).toEqual(log);
    expect(loadClassLog('nothing', box)).toBeNull();
    // Kept again as it grows: still one of it.
    expect(saveClassLog({ ...log, ended: false }, box)).toBe(true);
    expect(listClassLogs(box).map((h) => h.ended)).toEqual([false]);
    dropClassLog(log.id, box);
    expect(listClassLogs(box)).toEqual([]);
    expect(loadClassLog(log.id, box)).toBeNull();
    expect(box.keys()).toEqual(['cthulhoo.v1.classLogs']);
  });

  it('lets the oldest make way when there are too many', () => {
    const box = boxOf();
    const { log } = held();
    for (let i = 0; i < LOGS_KEPT + 3; i++) expect(saveClassLog({ ...log, id: `c${i}`, at: NOW + i }, box)).toBe(true);
    const heads = listClassLogs(box);
    expect(heads).toHaveLength(LOGS_KEPT);
    expect(heads[0].id).toBe(`c${LOGS_KEPT + 2}`);
    expect(heads.at(-1)!.id).toBe('c3');
    expect(loadClassLog('c0', box)).toBeNull();
    expect(box.keys()).toHaveLength(LOGS_KEPT + 1);
  });

  it('lets the oldest make way when the device is full, and says so when even one will not fit', () => {
    const { log } = held();
    const one = JSON.stringify(log).length;
    const box = boxOf(one * 3 + 1200);
    for (let i = 0; i < 5; i++) expect(saveClassLog({ ...log, id: `c${i}`, at: NOW + i }, box)).toBe(true);
    const kept = listClassLogs(box).map((h) => h.id);
    expect(kept[0]).toBe('c4');
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(kept.length).toBeLessThan(5);
    for (const id of kept) expect(loadClassLog(id, box)).not.toBeNull();
    expect(saveClassLog(log, boxOf(100))).toBe(false);
    expect(saveClassLog(log, null)).toBe(false);
    // Room for the class but not for the list of classes: nothing is left behind unlisted.
    const tight = boxOf(one + 20);
    expect(saveClassLog(log, tight)).toBe(false);
    expect(tight.keys()).toEqual([]);
  });

  it('is not fooled by junk in the storage', () => {
    const box = boxOf();
    box.setItem('cthulhoo.v1.classLogs', '{"not":"a list"}');
    expect(listClassLogs(box)).toEqual([]);
    box.setItem('cthulhoo.v1.classLogs', JSON.stringify([{ id: 'x', sign: 'S', at: 5 }, { id: 7 }, null]));
    expect(listClassLogs(box)).toEqual([{ id: 'x', sign: 'S', at: 5, ended: false, divers: 0, questions: 0, modes: [], topics: [], size: 0 }]);
    box.setItem('cthulhoo.v1.classLog.x', '{"v":1,"id":"y"}');
    expect(loadClassLog('x', box)).toBeNull();
    box.setItem('cthulhoo.v1.classLog.x', 'not json');
    expect(loadClassLog('x', box)).toBeNull();
  });
});
