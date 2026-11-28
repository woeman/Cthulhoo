import { describe, expect, it } from 'vitest';
import { hashString, practiceQueue, practiceRank, practicePrompts } from '../src/game/daily';
import { Packs, TopicBook, cleanPack, cleanPackIndex, filedUnder } from '../src/game/packs';
import { DAILY_GROUP, choiceCount, choiceNames, chosenTopics, cleanChoice, dailyTopics, dealByTopic, fitBudget, isWholeDeep, packOfTopic, packTopic, topicsPhrase, type Topic } from '../src/game/topics';
import type { PromptDef } from '../src/game/types';
import { loadBank } from '../src/game/bank';
import { cleanPrompts } from '../src/party/room';
import { BEGIN_BUDGET, choosePrompts, configLine } from '../src/screens/seance/model';

const q = (id: string, category: string, answers = 3): PromptDef => ({
  id,
  text: `Name a ${id}.`,
  category,
  answers: Array.from({ length: answers }, (_, i) => ({ answer: `${id} ${i}`, tier: 1 + (i % 6) })),
});

const theme = { categories: { science: { name: 'Science', title: 'The Alchemist’s Ledger' }, myth: { name: 'Myth', title: 'Old Gods' }, sport: { name: 'Sport', title: 'The Drowned Games' } } };
const bankPrompts = [...Array.from({ length: 12 }, (_, i) => q(`sci-${i}`, 'science')), ...Array.from({ length: 3 }, (_, i) => q(`myth-${i}`, 'myth')), q('odd-1', 'unfiled')];
const bank = () => ({ prompts: bankPrompts, byId: new Map(bankPrompts.map((p) => [p.id, p])), days: [] });

const INDEX = {
  packs: [
    { id: 'ethics', name: 'Business Ethics', group: 'Business', order: 3, file: 'ethics.json', prompts: 0, answers: 0 },
    { id: 'finance', name: 'Finance', title: 'The Ledger', blurb: 'Markets.', group: 'Business', order: 1, file: 'finance.json', prompts: 2, answers: 6, asOf: '2026-11-28' },
    { id: 'anatomy', name: 'Anatomy', group: 'Science', order: 2, file: 'anatomy.json', prompts: 1, answers: 3 },
    { id: 'finance', name: 'Twice', group: 'Business', order: 9, file: 'again.json', prompts: 4, answers: 4 },
    { id: '../up', name: 'Bad', file: 'bad.json', prompts: 1 },
    { id: 'sneaky', name: 'Sneaky', file: '../data/theme.json', prompts: 1 },
    'nonsense',
  ],
};
const FILES: Record<string, unknown> = {
  'index.json': INDEX,
  'finance.json': { pack: { id: 'finance' }, prompts: [{ ...q('finance-asx', 'misc'), section: 'Markets', source: 'ASX' }, { ...q('finance-banks', 'misc'), asOf: '2025-01-01' }, q('sci-0', 'science'), q('finance-asx', 'misc'), { id: 'finance-broken' }] },
  'anatomy.json': { prompts: [q('anatomy-bones', 'science')] },
};
const fetcher = (calls: string[] = [], down: () => boolean = () => false) => async (file: string) => {
  calls.push(file);
  if (down() || !(file in FILES)) throw new Error('404');
  return FILES[file];
};

describe('topics', () => {
  it('lists the daily categories that have questions, in the theme’s order, then any the theme does not name', () => {
    const t = dailyTopics(bankPrompts, theme);
    expect(t.map((x) => [x.id, x.name, x.count])).toEqual([
      ['science', 'Science', 12],
      ['myth', 'Myth', 3],
      ['unfiled', 'unfiled', 1],
    ]);
    expect(t.every((x) => x.group === DAILY_GROUP)).toBe(true);
  });

  it('reads a choice: nothing ticked is the whole daily deep', () => {
    const topics: Topic[] = [...dailyTopics(bankPrompts, theme), { id: packTopic('finance'), name: 'Finance', group: 'Business', count: 2 }];
    expect(cleanChoice(['myth', 'gone', 'myth', 7, 'pack:finance'], topics)).toEqual(['myth', 'pack:finance']);
    expect(cleanChoice('myth', topics)).toEqual([]);
    expect(chosenTopics([], topics).map((t) => t.id)).toEqual(['science', 'myth', 'unfiled']);
    expect(chosenTopics(['pack:finance'], topics).map((t) => t.id)).toEqual(['pack:finance']);
    expect(isWholeDeep([], topics)).toBe(true);
    expect(isWholeDeep(['science', 'myth', 'unfiled'], topics)).toBe(true);
    expect(isWholeDeep(['science', 'myth', 'unfiled', 'pack:finance'], topics)).toBe(false);
    expect(choiceNames([], topics)).toEqual([]);
    expect(choiceNames(['pack:finance', 'myth'], topics)).toEqual(['Myth', 'Finance']);
    expect(choiceCount([], topics)).toBe(16);
    expect(choiceCount(['myth', 'pack:finance'], topics)).toBe(5);
    expect(packOfTopic('pack:finance')).toBe('finance');
    expect(packOfTopic('science')).toBeNull();
  });

  it('says a choice in a phrase', () => {
    expect(topicsPhrase([])).toBe('Every topic');
    expect(topicsPhrase(['Finance'])).toBe('Finance');
    expect(topicsPhrase(['Finance', 'Myth'])).toBe('Finance and Myth');
    expect(topicsPhrase(['A', 'B', 'C'])).toBe('A, B and C');
    expect(topicsPhrase(['A', 'B', 'C', 'D', 'E'])).toBe('A, B and 3 more');
    expect(configLine({ candles: 5, seconds: 30 })).toBe('Five candles · 30 seconds each');
    expect(configLine({ candles: 3, seconds: 20, topics: ['Finance', 'Myth'] })).toBe('Three candles · 20 seconds each · Finance and Myth');
  });

  it('deals a queue round its topics, inside each rank', () => {
    const ids = ['a1', 'a2', 'a3', 'a4', 'b1', 'c1', 'c2', 'a5', 'b2'];
    const rank = (id: string) => (id === 'a5' || id === 'b2' ? 0 : 8);
    expect(dealByTopic(ids, rank, (id) => id[0])).toEqual(['a1', 'b1', 'c1', 'a2', 'c2', 'a3', 'a4', 'a5', 'b2']);
    expect(dealByTopic([], rank, (id) => id)).toEqual([]);
  });

  it('keeps a sitting inside one message, skipping what will not fit', () => {
    const big = q('big', 'misc', 400);
    const small = [q('s1', 'misc'), q('s2', 'misc'), q('s3', 'misc')];
    const one = JSON.stringify(big).length;
    expect(fitBudget([big, big, ...small], 3, one + 2000).map((p) => p.id)).toEqual(['big', 's1', 's2']);
    expect(fitBudget([big, ...small], 9, 10).map((p) => p.id)).toEqual(['big']);
    expect(fitBudget(small, 2, Infinity)).toHaveLength(2);
  });
});

describe('the practice queue', () => {
  it('is the old practice set when nothing is narrowed', () => {
    for (const seed of [1, 7, 4242]) {
      expect(practiceQueue(bankPrompts, ['sci-3'], seed, 2, []).slice(0, 7)).toEqual(practicePrompts(bankPrompts, ['sci-3'], seed, 2, []));
    }
  });

  it('draws only from what it is given, and still puts what to avoid last', () => {
    const among = bankPrompts.filter((p) => p.category === 'myth');
    const ids = practiceQueue(bankPrompts, ['myth-1'], 5, undefined, [], among);
    expect([...ids].sort()).toEqual(['myth-0', 'myth-1', 'myth-2']);
    expect(ids[2]).toBe('myth-1');
    expect(practiceRank(bankPrompts, ['myth-1'])('myth-1')).toBe(0);
  });
});

describe('class packs', () => {
  it('reads the list of packs, leaving out empty ones and anything misnamed', () => {
    const list = cleanPackIndex(INDEX);
    expect(list.map((p) => p.id)).toEqual(['finance', 'anatomy']);
    expect(list[0]).toMatchObject({ name: 'Finance', title: 'The Ledger', group: 'Business', file: 'finance.json', prompts: 2, asOf: '2026-11-28' });
    expect(cleanPackIndex(null)).toEqual([]);
    expect(cleanPackIndex({ packs: 'x' })).toEqual([]);
  });

  it('takes a pack’s own questions only, each carrying the pack’s name and date', () => {
    const prompts = cleanPack(FILES['finance.json'], { id: 'finance', name: 'Finance', asOf: '2026-11-28' });
    expect(prompts.map((p) => p.id)).toEqual(['finance-asx', 'finance-banks']);
    expect(prompts[0]).toMatchObject({ topic: 'Finance', section: 'Markets', source: 'ASX', asOf: '2026-11-28' });
    expect(prompts[1].asOf).toBe('2025-01-01');
    expect(filedUnder(theme, prompts[0])).toBe('Finance · Markets');
    expect(filedUnder(theme, prompts[1])).toBe('Finance');
    expect(filedUnder(theme, bankPrompts[0])).toBe('The Alchemist’s Ledger');
  });

  it('fetches a pack once, when it is first asked for', async () => {
    const calls: string[] = [];
    const adopted: string[] = [];
    const packs = new Packs(fetcher(calls), (ps) => adopted.push(...ps.map((p) => p.id)));
    expect((await packs.index()).map((p) => p.id)).toEqual(['finance', 'anatomy']);
    const [a, b] = await Promise.all([packs.load('finance'), packs.load('finance')]);
    expect(a).toBe(b);
    expect(calls).toEqual(['index.json', 'finance.json']);
    expect(adopted).toEqual(['finance-asx', 'finance-banks']);
    expect(packs.packOf('finance-asx')).toBe('finance');
    await expect(packs.load('nope')).rejects.toThrow();
  });

  it('has no packs when none are published, and asks again later', async () => {
    let down = true;
    const calls: string[] = [];
    const packs = new Packs(fetcher(calls, () => down));
    expect(await packs.index()).toEqual([]);
    down = false;
    expect((await packs.index()).length).toBe(2);
    expect(calls).toEqual(['index.json', 'index.json']);
  });

  it('draws a pool from the ticked topics, and makes pack questions findable without adding them to the daily bank', async () => {
    const b = bank();
    const book = new TopicBook(b, theme, fetcher());
    expect((await book.all()).map((t) => t.id)).toEqual(['science', 'myth', 'unfiled', 'pack:finance', 'pack:anatomy']);
    expect((await book.pool([])).length).toBe(16);
    expect((await book.pool(['myth'])).map((p) => p.id)).toEqual(['myth-0', 'myth-1', 'myth-2']);
    const mixed = await book.pool(['myth', 'pack:finance']);
    expect(mixed.map((p) => p.id)).toEqual(['myth-0', 'myth-1', 'myth-2', 'finance-asx', 'finance-banks']);
    expect(b.byId.get('finance-asx')?.topic).toBe('Finance');
    expect(b.prompts).toHaveLength(16);
    expect(book.topicOf(mixed[3])).toBe('pack:finance');
    expect(book.topicOf(mixed[0])).toBe('myth');
  });

  it('will not quietly ask about something else when a ticked pack cannot be had', async () => {
    const book = new TopicBook(bank(), theme, fetcher([], () => true));
    await expect(book.pool(['pack:finance'])).rejects.toThrow();
    expect((await book.pool(['myth'])).length).toBe(3);
  });

  it('finds a saved séance’s pack questions again by their ids', async () => {
    const b = bank();
    const calls: string[] = [];
    const book = new TopicBook(b, theme, fetcher(calls));
    await book.ensure(['sci-0', 'anatomy-bones', 'unknown-thing']);
    expect(b.byId.has('anatomy-bones')).toBe(true);
    expect(calls).toEqual(['index.json', 'anatomy.json']);
    await book.ensure(['sci-0']);
    expect(calls).toHaveLength(2);
  });
});

describe('a sitting on chosen topics', () => {
  it('asks only about them, deals them evenly, and never asks today’s dive', async () => {
    const b = bank();
    const book = new TopicBook(b, theme, fetcher());
    const among = await book.pool(['science', 'pack:finance']);
    const set = choosePrompts(b, ['finance-asx'], 'DAGON-7', 0, 1, 4, [], { among, topicOf: (p) => book.topicOf(p) });
    expect(set).toHaveLength(4);
    expect(set.map((p) => book.topicOf(p)).sort()).toEqual(['pack:finance', 'science', 'science', 'science']);
    expect(set.some((p) => p.id === 'finance-asx')).toBe(false);
    // Two class packs, neither due in any daily dive: they take turns from the first question.
    const packs = choosePrompts(b, [], 'DAGON-7', 0, 1, 3, [], { among: await book.pool(['pack:finance', 'pack:anatomy']), topicOf: (p) => book.topicOf(p) });
    expect(packs.slice(0, 2).map((p) => book.topicOf(p)).sort()).toEqual(['pack:anatomy', 'pack:finance']);
    expect(book.topicOf(packs[2])).toBe('pack:finance');
  });

  it('is unchanged when no topics are ticked', () => {
    const b = bank();
    const plain = practicePrompts(b.prompts, ['sci-1', 'sci-2'], hashString('DAGON-7#2'), 1, []).slice(0, 5);
    expect(choosePrompts(b, ['sci-1'], 'DAGON-7', 2, 1, 5, ['sci-2']).map((p) => p.id)).toEqual(plain);
    expect(choosePrompts(b, ['sci-1'], 'DAGON-7', 2, 1, 5, ['sci-2'], { budget: BEGIN_BUDGET }).map((p) => p.id)).toEqual(plain);
  });
});

// ---------------------------------------------------------------- the published packs

// Every class pack in the repo, as the build will publish it. None yet is not a failure.
const PUBLISHED = import.meta.glob('/packs/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

describe('the class packs in the repo', () => {
  const index = cleanPackIndex(PUBLISHED['/packs/index.json']);

  it('lists only packs the game can load, each with the questions it claims', () => {
    const raw = (PUBLISHED['/packs/index.json'] as { packs?: { id?: string; prompts?: number }[] } | undefined)?.packs ?? [];
    // Nothing with questions is dropped by the game's own checks (a name too long, a bad id or file).
    expect(index.map((p) => p.id).sort()).toEqual(
      raw
        .filter((p) => (p.prompts ?? 0) > 0)
        .map((p) => p.id)
        .sort(),
    );
    for (const info of index) {
      const prompts = cleanPack(PUBLISHED[`/packs/${info.file}`], info);
      expect(prompts.length, info.id).toBe(info.prompts);
      expect(prompts.every((p) => p.topic === info.name)).toBe(true);
    }
  });

  it('never clashes with the daily bank or another pack', () => {
    const daily = new Set(loadBank().prompts.map((p) => p.id));
    const seen = new Set<string>();
    for (const info of index) {
      for (const p of cleanPack(PUBLISHED[`/packs/${info.file}`], info)) {
        expect(daily.has(p.id), p.id).toBe(false);
        expect(seen.has(p.id), p.id).toBe(false);
        seen.add(p.id);
      }
    }
  });

  it('reaches an online séance whole: every answer and spelling, in a message the relay takes', () => {
    const count = (p: PromptDef) => [
      p.id,
      p.answers.length,
      p.answers.reduce((n, a) => n + (a.aliases?.length ?? 0), 0),
      p.traps?.length ?? 0,
      (p.traps ?? []).reduce((n, t) => n + (t.aliases?.length ?? 0), 0),
      p.decoys?.length ?? 0,
    ];
    for (const info of index) {
      for (const p of cleanPack(PUBLISHED[`/packs/${info.file}`], info)) {
        const [kept] = cleanPrompts([p], 1);
        expect(count(kept), p.id).toEqual(count(p));
        expect(kept.topic).toBe(info.name);
        // One question must fit the opening message with room to spare for the rest of the sitting.
        expect(JSON.stringify(p).length, p.id).toBeLessThan(BEGIN_BUDGET / 2);
      }
    }
  });
});
