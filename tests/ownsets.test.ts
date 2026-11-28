import { describe, expect, it } from 'vitest';
import { OWN_EXAMPLE, OWN_NAME_MAX, OWN_QUESTIONS_MAX, OWN_SETS_MAX, OWN_TEXT_MAX, OWN_TOTAL_MAX, addOwnAnswer, dealTwo, dropOwnSet, loadOwnSets, newOwnSet, ownPrompts, ownQueue, ownSetOf, ownTopics, parseOwnSet, readSetFile, saveOwnSet, setFileName, setFileText, tierByPlace, uniqueSetName, type KeyStore, type OwnSet } from '../src/game/ownsets';
import { OWN_GROUP, cleanChoice, ownOfTopic, ownTopic } from '../src/game/topics';
import { cleanPrompts, hear } from '../src/party/room';

const SET = { id: 'abc123', name: 'Week 3' };
const read = (text: string) => parseOwnSet(text, SET);
const tiers = (text: string) => read(text).questions.map((q) => q.prompt.answers.map((a) => a.tier));

describe('a teacher’s own set, read from its text', () => {
  it('reads questions, answers, spellings, a note and a refusal', () => {
    const { questions, problems, name } = read(OWN_EXAMPLE);
    expect(problems).toEqual([]);
    expect(name).toBeUndefined();
    expect(questions.map((q) => [q.line, q.prompt.text])).toEqual([
      [1, 'Name a stock exchange.'],
      [10, 'What does the E in ESG stand for?'],
      [13, 'Name one of the four Ps of marketing.'],
    ]);
    const [exchanges, esg, ps] = questions.map((q) => q.prompt);
    expect(exchanges).toMatchObject({ category: 'own', topic: 'Week 3' });
    expect(exchanges.answers).toEqual([
      { answer: 'New York Stock Exchange', aliases: ['NYSE'], tier: 1 },
      { answer: 'Nasdaq', tier: 2 },
      { answer: 'London Stock Exchange', aliases: ['LSE'], tier: 3 },
      { answer: 'ASX', aliases: ['Australian Securities Exchange'], tier: 4 },
      { answer: 'Tokyo Stock Exchange', aliases: ['TSE'], tier: 5 },
      { answer: 'Euronext', tier: 6 },
    ]);
    expect(exchanges.traps).toEqual([{ answer: 'Dow Jones', aliases: ['S&P 500'], reason: 'That is an index, not an exchange.' }]);
    expect(esg.answers).toEqual([{ answer: 'Environmental', aliases: ['Environment'], tier: 3 }]);
    expect(ps.rules).toBe('The classic four.');
    expect(ps.answers.map((a) => [a.answer, a.tier])).toEqual([
      ['Price', 1],
      ['Product', 2],
      ['Promotion', 3],
      ['Place', 4],
    ]);
  });

  it('gives the relay questions it takes whole, and the deep answers it knows', () => {
    const prompts = read(OWN_EXAMPLE).questions.map((q) => q.prompt);
    const sent = cleanPrompts(JSON.parse(JSON.stringify(prompts)), 10);
    expect(sent.map((p) => [p.id, p.text, p.topic, p.answers.length, p.traps?.length ?? 0])).toEqual(prompts.map((p) => [p.id, p.text, 'Week 3', p.answers.length, p.traps?.length ?? 0]));
    const [exchanges, esg] = sent;
    expect(hear(exchanges, 'nyse')).toEqual({ kind: 'sealed', answer: 'New York Stock Exchange', tier: 1 });
    expect(hear(exchanges, 'australian securities exchange')).toEqual({ kind: 'sealed', answer: 'ASX', tier: 4 });
    expect(hear(exchanges, 'Nasdaq!')).toMatchObject({ kind: 'sealed', answer: 'Nasdaq' });
    expect(hear(exchanges, 'dow jones')).toEqual({ kind: 'refused', verdict: 'trap', reason: 'That is an index, not an exchange.' });
    expect(hear(exchanges, 's&p 500')).toMatchObject({ kind: 'refused', verdict: 'trap' });
    expect(hear(exchanges, 'the moon')).toEqual({ kind: 'refused', verdict: 'unknown' });
    expect(hear(esg, 'enviromental')).toMatchObject({ kind: 'sealed', answer: 'Environmental' });
  });

  it('takes a set as teachers paste one: numbered, bulleted, from a spreadsheet, from Windows', () => {
    const text = '\ufeffSet: Capitals \r\n\r\n1. What is the capital of France?\r\n- Paris\tParee\r\n\r\n\r\nQ2: Name a city of Australia. \r\n  1) Sydney\r\n  2) Melbourne | Melb\r\n  a) Perth\r\n* Hobart\r\n• Darwin\r\n– Adelaide\r\n\r\nQuestion 3. 1984: who wrote it?\r\nGeorge Orwell | Orwell | Eric Blair\r\n-5\r\n3.14\r\n';
    const { name, questions, problems } = read(text);
    expect(name).toBe('Capitals');
    expect(problems).toEqual([]);
    expect(questions.map((q) => [q.line, q.prompt.text, q.prompt.answers.map((a) => a.answer)])).toEqual([
      [3, 'What is the capital of France?', ['Paris']],
      [7, 'Name a city of Australia.', ['Sydney', 'Melbourne', 'Perth', 'Hobart', 'Darwin', 'Adelaide']],
      [15, '1984: who wrote it?', ['George Orwell', '-5', '3.14']],
    ]);
    expect(questions[0].prompt.answers[0].aliases).toEqual(['Paree']);
    expect(questions[1].prompt.answers[1].aliases).toEqual(['Melb']);
    expect(read('# Week 4\nWhat is two and two?\n4 | Four').name).toBe('Week 4');
    expect(read('What is two and two?\n4 | Four').name).toBeUndefined();
  });

  it('sinks answers by where they stand, unless a line or the question says how deep', () => {
    expect([1, 2, 3, 6].map((n) => Array.from({ length: n }, (_, i) => tierByPlace(i, n)))).toEqual([[1], [1, 2], [1, 2, 3], [1, 2, 3, 4, 5, 6]]);
    expect(Array.from({ length: 8 }, (_, i) => tierByPlace(i, 8))).toEqual([1, 1, 2, 3, 4, 4, 5, 6]);
    expect(Array.from({ length: 30 }, (_, i) => tierByPlace(i, 30)).filter((t) => t === 6)).toHaveLength(5);
    expect(tiers('Name a planet.\nEarth\nMars\nMercury [6]\nVenus')).toEqual([[1, 2, 6, 4]]);
    expect(tiers('Name a planet. [4]\nEarth\nMars [1]\nVenus')).toEqual([[4, 1, 4]]);
    expect(tiers('What is the capital of France?\nParis')).toEqual([[1]]);
    // Only a tier from 1 to 6 at the very end is read as one.
    expect(read('Name an isotope.\nCarbon [14]\nUranium [235] | U-235 [5]').questions[0].prompt.answers).toEqual([
      { answer: 'Carbon [14]', tier: 1 },
      { answer: 'Uranium [235]', aliases: ['U-235'], tier: 5 },
    ]);
  });

  it('says what it left out, and on which line', () => {
    const long = 'x'.repeat(301);
    const text = ['Name a planet.', '', `${long}`, 'Earth', '', 'Name a moon.', 'Titan', `${'y'.repeat(201)}`, `Europa | ${'z'.repeat(201)}`, '', '[3]', 'Mars', '', 'Name a planet.', 'Venus'].join('\n');
    const { questions, problems } = read(text);
    expect(questions.map((q) => q.prompt.text)).toEqual(['Name a moon.', 'Name a planet.']);
    expect(questions[0].prompt.answers).toEqual([
      { answer: 'Titan', tier: 1 },
      { answer: 'Europa', tier: 2 },
    ]);
    expect(problems.map((p) => [p.line, p.text.slice(0, 44)])).toEqual([
      [1, 'No answers are written under this question y'],
      [3, 'This question is longer than 300 letters, so'],
      [8, '“yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy…” '],
      [9, '“zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz…” '],
      [11, 'A question needs its words on its first line'],
    ]);
  });

  it('keeps one of an answer written twice, and joins new spellings to it', () => {
    const { questions, problems } = read('Name a planet.\nMars\nEarth | Terra\nmars. | The Red Planet\nMARS\nSol III | terra | Earth\nJupiter | Mars');
    expect(questions[0].prompt.answers).toEqual([
      { answer: 'Mars', aliases: ['The Red Planet'], tier: 1 },
      { answer: 'Earth', aliases: ['Terra'], tier: 2 },
      { answer: 'Sol III', tier: 3 },
      { answer: 'Jupiter', tier: 4 },
    ]);
    expect(problems).toEqual([
      { line: 6, text: '“terra” is already written under this question (for “Earth”): the first stands.' },
      { line: 6, text: '“Earth” is already written under this question (for “Earth”): the first stands.' },
      { line: 7, text: '“Mars” is already written under this question (for “Mars”): the first stands.' },
    ]);
  });

  it('warns of an answer nobody could type, and of two the deep cannot tell apart', () => {
    const { questions, problems } = read('Name a capital.\n東京\nKyoto | 京都\nParis\nPari\nNot: Rome\nRome | Roma\nNot: Milan -- Not a capital.\nMilans');
    expect(questions[0].prompt.answers.map((a) => a.answer)).toEqual(['東京', 'Kyoto', 'Paris', 'Pari', 'Milans']);
    expect(questions[0].prompt.decoys).toEqual(['Rome']);
    expect(problems.map((p) => [p.line, p.text.split(':')[0]])).toEqual([
      [7, '“Rome” is written under Not'],
      [2, '“東京” cannot be typed as an answer'],
    ]);
    expect(questions[0].mute).toEqual(['東京']);
    // A name in other letters may stand for show, so long as one of its spellings can be typed.
    const shown = read('Name a capital.\n東京 | Tokyo\nKyoto | 京都');
    expect(shown.problems).toEqual([]);
    expect(shown.questions[0].mute).toBeUndefined();
    expect(hear(shown.questions[0].prompt, 'tokyo')).toMatchObject({ kind: 'sealed', answer: '東京' });
    expect(hear(shown.questions[0].prompt, '京都')).toMatchObject({ kind: 'refused' });
    // Written out as an answer of its own, a plural stands beside the refusal of the singular.
    expect(hear(questions[0].prompt, 'milans')).toMatchObject({ kind: 'sealed', answer: 'Milans' });
    expect(hear(questions[0].prompt, 'Milan')).toEqual({ kind: 'refused', verdict: 'trap', reason: 'Not a capital.' });
    expect(hear(questions[0].prompt, 'rome')).toEqual({ kind: 'refused', verdict: 'decoy' });
    // A plural written out as an answer of its own stands beside the singular.
    const fruit = read('Name a fruit.\nApple\nApples');
    expect(fruit.problems).toEqual([]);
    expect(hear(fruit.questions[0].prompt, 'apples')).toMatchObject({ answer: 'Apples' });
    expect(hear(fruit.questions[0].prompt, 'apple')).toMatchObject({ answer: 'Apple' });
  });

  it('names each question by its set and its words, whatever order it stands in', () => {
    const a = read('Name a planet.\nEarth\n\nName a moon.\nTitan').questions.map((q) => q.prompt.id);
    const b = read('Name a  MOON\nTitan\nEuropa\n\n3) Name a planet!\nMars').questions.map((q) => q.prompt.id);
    expect(b).toEqual([a[1], a[0]]);
    expect(a[0]).toMatch(/^own-abc123-[a-z0-9]+$/);
    expect(new Set(a).size).toBe(2);
    expect(parseOwnSet('Name a planet.\nEarth', { id: 'zzz999', name: 'Other' }).questions[0].prompt.id).not.toBe(a[0]);
    const twice = read('Name a planet.\nEarth\n\nName a planet\nMars');
    expect(twice.questions).toHaveLength(1);
    expect(twice.problems).toEqual([{ line: 4, text: 'This question is written twice in the set: the second is left out.' }]);
    const many = read(Array.from({ length: OWN_QUESTIONS_MAX + 3 }, (_, i) => `Question number ${i}?\nYes`).join('\n\n'));
    expect(many.questions).toHaveLength(OWN_QUESTIONS_MAX);
    expect(many.problems).toHaveLength(1);
  });
});

describe('an answer a class gave that the set did not hold', () => {
  const set: OwnSet = { id: 'abc123', name: 'Week 3', text: `Set: Week 3\r\n\r\n${OWN_EXAMPLE.replace(/\n/g, '\r\n')}`, at: 1 };
  const [exchanges, esg, ps] = parseOwnSet(set.text, set).questions.map((q) => q.prompt);

  it('is written under its question, after the last answer, and then counts', () => {
    const text = addOwnAnswer(set, exchanges.id, '  Hong Kong   Stock Exchange ')!;
    expect(text.split('\n').slice(8, 11)).toEqual(['Euronext', 'Hong Kong Stock Exchange', 'Not: Dow Jones | S&P 500 -- That is an index, not an exchange.']);
    const again = parseOwnSet(text, set).questions[0].prompt;
    expect(again.id).toBe(exchanges.id);
    expect(again.answers.at(-1)).toEqual({ answer: 'Hong Kong Stock Exchange', tier: 6 });
    expect(again.answers).toHaveLength(7);
    expect(hear(again, 'hong kong stock exchange')).toMatchObject({ kind: 'sealed', answer: 'Hong Kong Stock Exchange' });
    // The last question of the text, with a note after its answers.
    const more = addOwnAnswer(set, ps.id, 'People')!;
    expect(more.trimEnd().split('\n').slice(-3)).toEqual(['Place | Distribution', 'People', 'Note: The classic four.']);
    expect(parseOwnSet(more, set).questions[2].prompt.answers.map((a) => [a.answer, a.tier])).toEqual([['Price', 1], ['Product', 2], ['Promotion', 3], ['Place', 4], ['People', 5]]);
    // A question that set its own depth gives it to the new answer too.
    expect(parseOwnSet(addOwnAnswer(set, esg.id, 'Ecology')!, set).questions[1].prompt.answers.at(-1)).toEqual({ answer: 'Ecology', tier: 3 });
  });

  it('is left alone when it cannot stand as an answer', () => {
    expect(addOwnAnswer(set, exchanges.id, 'Dow Jones')).toBeNull();
    expect(addOwnAnswer(set, exchanges.id, 's&p 500')).toBeNull();
    // What the set takes already is left as it is.
    expect(addOwnAnswer(set, exchanges.id, 'nyse')).toBe(set.text);
    expect(addOwnAnswer(set, exchanges.id, '東京')).toBeNull();
    expect(addOwnAnswer(set, exchanges.id, '   ')).toBeNull();
    expect(addOwnAnswer(set, exchanges.id, 'Not: this')).toBeNull();
    expect(addOwnAnswer(set, exchanges.id, 'Deutsche Börse [4]')).toBeNull();
    expect(addOwnAnswer(set, exchanges.id, '- a list')).toBeNull();
    expect(addOwnAnswer(set, 'own-abc123-gone', 'Hong Kong')).toBeNull();
    expect(addOwnAnswer(set, exchanges.id, 'x'.repeat(201))).toBeNull();
    // A stroke or a tab in what was typed cannot cut the line in two.
    expect(addOwnAnswer(set, exchanges.id, 'Shanghai|Shenzhen')!.split('\n')).toContain('Shanghai Shenzhen');
  });

  it('finds the set a question came from', () => {
    const sets: OwnSet[] = [{ id: 'abc1', name: 'Other', text: '', at: 0 }, set];
    expect(ownSetOf(exchanges.id, sets)).toBe(set);
    expect(ownSetOf('own-zzz-1', sets)).toBeUndefined();
    expect(ownSetOf('planets', sets)).toBeUndefined();
  });
});

describe('a set as a file', () => {
  it('goes out with its name and comes back the same', () => {
    const set = { name: 'Week 3', text: `\n${OWN_EXAMPLE}\n\n` };
    const file = setFileText(set);
    expect(file.startsWith('Set: Week 3\n\nName a stock exchange.\n')).toBe(true);
    expect(readSetFile(file, 'whatever.txt')).toEqual({ name: 'Week 3', text: OWN_EXAMPLE.trim() });
    // Kept with a name line of its own, it is not named twice.
    expect(setFileText({ name: 'Week 3', text: 'Set: Old name\nName a planet.\nMars' })).toBe('Set: Week 3\n\nName a planet.\nMars\n');
    expect(readSetFile('Name a planet.\r\nMars\r\n', 'cthulhoo-set-solar_system-quiz.TXT')).toEqual({ name: 'solar system quiz', text: 'Name a planet.\nMars' });
    expect(readSetFile('Name a planet.\nMars', '.txt').name).toBe('A set');
    expect(readSetFile(`Set: ${'n'.repeat(60)}\nQ?\nA`, 'x.txt').name).toHaveLength(OWN_NAME_MAX);
  });

  it('names its file plainly', () => {
    expect(setFileName({ name: 'Week 3: Markets & Money' })).toBe('cthulhoo-set-week-3-markets-money.txt');
    expect(setFileName({ name: 'Économie' })).toBe('cthulhoo-set-economie.txt');
    expect(setFileName({ name: '東京' })).toBe('cthulhoo-set-questions.txt');
  });
});

function boxOf(full = false): KeyStore & { raw(): string | null } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      if (full) throw new Error('QuotaExceededError');
      m.set(k, v);
    },
    removeItem: (k) => void m.delete(k),
    raw: () => m.get('cthulhoo.v1.ownSets') ?? null,
  };
}

describe('sets kept on the teacher’s device', () => {
  it('keeps a set, changes it and forgets it', () => {
    const box = boxOf();
    expect(loadOwnSets(box)).toEqual([]);
    const a = newOwnSet('Week 3', 'Name a planet.\nMars', 1000);
    expect(a.id).toMatch(/^[a-z0-9]{4,24}$/);
    expect(saveOwnSet(a, box)).toBe('kept');
    const b = newOwnSet('Week 3', '', 2000, loadOwnSets(box));
    expect(b.name).toBe('Week 3 (2)');
    expect(saveOwnSet(b, box)).toBe('kept');
    expect(loadOwnSets(box).map((s) => [s.name, s.at])).toEqual([
      ['Week 3', 1000],
      ['Week 3 (2)', 2000],
    ]);
    expect(saveOwnSet({ ...a, text: 'Name a moon.\nTitan', at: 3000 }, box)).toBe('kept');
    expect(loadOwnSets(box)[0]).toEqual({ ...a, text: 'Name a moon.\nTitan', at: 3000 });
    // A set renamed to another's name is told apart.
    expect(saveOwnSet({ ...b, name: 'week 3' }, box)).toBe('kept');
    expect(loadOwnSets(box)[1].name).toBe('week 3 (2)');
    dropOwnSet(a.id, box);
    expect(loadOwnSets(box).map((s) => s.id)).toEqual([b.id]);
    expect(uniqueSetName('  ', [])).toBe('A set');
    expect(uniqueSetName('x'.repeat(40), [{ id: 'q', name: 'x'.repeat(OWN_NAME_MAX), text: '', at: 0 }])).toBe(`${'x'.repeat(OWN_NAME_MAX - 4)} (2)`);
  });

  it('holds only so many, and says when the device will not keep one', () => {
    const box = boxOf();
    for (let i = 0; i < OWN_SETS_MAX; i++) expect(saveOwnSet(newOwnSet(`Set ${i}`, '', i), box)).toBe('kept');
    expect(saveOwnSet(newOwnSet('One more', '', 99), box)).toBe('many');
    expect(loadOwnSets(box)).toHaveLength(OWN_SETS_MAX);
    // One already kept can still be changed.
    expect(saveOwnSet({ ...loadOwnSets(box)[0], text: 'Q?\nA' }, box)).toBe('kept');
    expect(saveOwnSet(newOwnSet('Week 3'), boxOf(true))).toBe('full');
    expect(saveOwnSet(newOwnSet('Week 3'), null)).toBe('full');
    expect(loadOwnSets(null)).toEqual([]);
    // All the sets together take only so much of the device: the one that would pass it is not kept, and the rest stand.
    const roomy = boxOf();
    const long = 'Q?\nA\n\n'.repeat(OWN_TEXT_MAX / 6).slice(0, OWN_TEXT_MAX);
    const fit = Math.floor(OWN_TOTAL_MAX / OWN_TEXT_MAX);
    for (let i = 0; i < fit; i++) expect(saveOwnSet(newOwnSet(`Long ${i}`, long, i), roomy)).toBe('kept');
    expect(saveOwnSet(newOwnSet('Too much', long, 99), roomy)).toBe('full');
    expect(loadOwnSets(roomy)).toHaveLength(fit);
    expect(saveOwnSet(newOwnSet('Short', 'Q?\nA', 100), roomy)).toBe(fit * OWN_TEXT_MAX + 4 > OWN_TOTAL_MAX ? 'full' : 'kept');
  });

  it('is not fooled by junk in the storage', () => {
    const box = boxOf();
    box.setItem('cthulhoo.v1.ownSets', 'not json');
    expect(loadOwnSets(box)).toEqual([]);
    box.setItem('cthulhoo.v1.ownSets', JSON.stringify({ v: 1, sets: [{ id: 'good1', name: 'Kept', text: 'Q?\nA', at: 5 }, { id: 'BAD ID', text: 'x' }, { id: 'good1', text: 'twice' }, null, { id: 'good2', name: 7, text: 'Q?\nA' }] }));
    expect(loadOwnSets(box)).toEqual([
      { id: 'good1', name: 'Kept', text: 'Q?\nA', at: 5 },
      { id: 'good2', name: 'A set', text: 'Q?\nA', at: 0 },
    ]);
  });
});

describe('own sets as topics for a class', () => {
  const sets: OwnSet[] = [
    { id: 'aaaa', name: 'Week 1', text: 'One?\nA\n\nTwo?\nB\n\nThree?\nC', at: 1 },
    { id: 'bbbb', name: 'Empty', text: 'A question with no answers', at: 2 },
    { id: 'cccc', name: 'Week 2', text: 'Four?\nD\n\nFive?\nE', at: 3 },
  ];

  it('offers the sets that hold a question', () => {
    const topics = ownTopics(sets);
    expect(topics).toEqual([
      { id: 'own:aaaa', name: 'Week 1', group: OWN_GROUP, count: 3 },
      { id: 'own:cccc', name: 'Week 2', group: OWN_GROUP, count: 2 },
    ]);
    expect(ownOfTopic(ownTopic('aaaa'))).toBe('aaaa');
    expect(ownOfTopic('pack:finance')).toBeNull();
    expect(ownOfTopic('science')).toBeNull();
    // A choice kept from before a set was deleted forgets it.
    expect(cleanChoice(['own:aaaa', 'own:gone', 'science'], topics)).toEqual(['own:aaaa']);
  });

  it('asks the ticked sets in the order they were written', () => {
    expect(ownPrompts(['own:cccc', 'science', 'own:aaaa'], sets).map((p) => p.text)).toEqual(['One?', 'Two?', 'Three?', 'Four?', 'Five?']);
    expect(ownPrompts(['own:cccc'], sets).map((p) => [p.text, p.topic])).toEqual([
      ['Four?', 'Week 2'],
      ['Five?', 'Week 2'],
    ]);
    expect(ownPrompts(['science', 'pack:finance'], sets)).toEqual([]);
    expect(ownPrompts([], sets)).toEqual([]);
  });

  it('asks what this class has not been asked first, then round again from the oldest', () => {
    const all = ownPrompts(['own:aaaa', 'own:cccc'], sets);
    const id = (t: string) => all.find((p) => p.text === t)!.id;
    const order = (asked: string[]) => ownQueue(all, asked).map((p) => p.text);
    expect(order([])).toEqual(['One?', 'Two?', 'Three?', 'Four?', 'Five?']);
    expect(order([id('Two?'), 'something-else', id('One?')])).toEqual(['Three?', 'Four?', 'Five?', 'Two?', 'One?']);
    expect(order([id('Five?'), id('One?'), id('Two?'), id('Three?'), id('Four?'), id('Five?')])).toEqual(['One?', 'Two?', 'Three?', 'Four?', 'Five?']);
  });

  it('deals own questions in turn with the rest', () => {
    expect(dealTwo(['a', 'b', 'c'], ['x', 'y', 'z'], 4)).toEqual(['a', 'x', 'b', 'y']);
    expect(dealTwo(['a'], ['x', 'y', 'z'], 5)).toEqual(['a', 'x', 'y', 'z']);
    expect(dealTwo(['a', 'b', 'c'], [], 2)).toEqual(['a', 'b']);
    expect(dealTwo(['a', 'b', 'c'], ['x'], 3)).toEqual(['a', 'x', 'b']);
    expect(dealTwo([], [], 3)).toEqual([]);
  });
});
