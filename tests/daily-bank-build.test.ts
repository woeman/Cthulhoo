import { describe, expect, it } from 'vitest';
import placeholder from '../src/content/placeholder-bank.json';
import { BANK_MODULE, bankOf, dailyBank, readBank } from '../build/daily-bank.mjs';
import { bankFrom, cleanPrompt, collectBank, loadBank, makeBank } from '../src/game/bank';

// The build's half of loading the daily bank on demand: build/daily-bank.mjs
// reads data/, hands the script a list without answers and publishes each
// question as bank/<id>.json. The game's half is tested in bank.test.ts.

const q = (id: string, extra: Record<string, unknown> = {}) => ({ id, text: `Name a ${id}.`, category: 'science', answers: [{ answer: `${id} one`, tier: 1, aliases: ['first'] }], ...extra });

const FILES = {
  'b.json': { prompts: [q('bones', { text: 'A later file’s wording' }), q('rivers', { category: ' ', flavor: 'Wet.', rules: 'Any river.' })], days: [{ date: '2026-12-25', prompts: ['rivers'] }] },
  'a.json': { prompts: [q('bones'), { id: 'no-answers', text: 'Nothing to say', answers: [] }, { id: 'no-tier', text: 'Untiered', answers: [{ answer: 'x' }] }, 'nonsense', q('moons')] },
  'riddles.json': { riddles: [{ id: 'r1', text: 'What walks?' }], days: [{ date: '2026-12-25', riddle: 'r1' }], prompts: [q('from-riddles')] },
  'theme.json': { categories: { science: { name: 'Science' } }, prompts: [q('never-read')] },
  'notes.txt': 'not data',
  'list.json': ['not', 'a', 'bank'],
};

/** A folder's files as the build reads them: [name, text] pairs, in no particular order. */
const texts = (files: Record<string, unknown>): Array<[string, string]> => Object.entries(files).map(([name, body]) => [name, typeof body === 'string' ? body : JSON.stringify(body)]);

/** A plugin hook, called as the build calls it. */
function call(hook: unknown, context: object, ...args: unknown[]): unknown {
  return (hook as (...a: unknown[]) => unknown).apply(context, args);
}

/** The module the script imports, read back from the code the plugin wrote. */
function moduleOf(code: string): Record<string, unknown> {
  return Object.fromEntries(code.split('\n').map((line) => [/^export const (\w+) = /.exec(line)![1], JSON.parse(line.slice(line.indexOf(' = ') + 3, -1))]));
}

describe('reading data/ for the build', () => {
  it('takes the JSON files in name order, the first to use an id winning, and only questions the game can ask', () => {
    const bank = bankOf(texts(FILES));
    expect(bank.files).toEqual(['a.json', 'b.json', 'list.json', 'riddles.json', 'theme.json']);
    expect(bank.errors).toEqual([]);
    expect([...bank.prompts.keys()]).toEqual(['bones', 'moons', 'rivers', 'from-riddles']);
    expect(bank.prompts.get('bones')!.meta.text).toBe('Name a bones.');
    expect(bank.theme).toEqual(FILES['theme.json']);
    // A riddle file's questions are the bank's; its riddles go to the riddle deck without them.
    expect(bank.riddleFiles).toEqual([{ riddles: [{ id: 'r1', text: 'What walks?' }], days: [{ date: '2026-12-25', riddle: 'r1' }] }]);
    expect(bank.days).toEqual([
      { date: '2026-12-25', prompts: ['rivers'] },
      { date: '2026-12-25', riddle: 'r1' },
    ]);
    expect(bankOf([]).prompts.size).toBe(0);
    expect(readBank('/no/such/folder').prompts.size).toBe(0);
  });

  it('lists a question by its words and topic, with a stamp that changes only when its file would', () => {
    const bank = bankOf(texts(FILES));
    const rivers = bank.prompts.get('rivers')!;
    // An empty topic is left for the game to file under "misc", as it does for a whole question.
    expect(rivers.meta).toEqual({ id: 'rivers', text: 'Name a rivers.', v: rivers.meta.v, flavor: 'Wet.', rules: 'Any river.' });
    expect(rivers.meta.v).toMatch(/^[A-Za-z0-9_-]{8}$/);
    expect(JSON.parse(rivers.source)).toEqual(FILES['b.json'].prompts[1]);
    expect(bankOf(texts(FILES)).prompts.get('rivers')!.meta.v).toBe(rivers.meta.v);
    const wider = bankOf(texts({ ...FILES, 'b.json': { prompts: [q('rivers', { category: ' ', flavor: 'Wet.', rules: 'Any river.', decoys: ['canal'] })] } }));
    expect(wider.prompts.get('rivers')!.meta.v).not.toBe(rivers.meta.v);
    expect(wider.prompts.get('moons')!.meta.v).toBe(bank.prompts.get('moons')!.meta.v);
  });

  it('will not publish a question whose id cannot be a file’s name, nor a file it cannot read', () => {
    const bank = bankOf(texts({ 'a.json': { prompts: [q('Bones'), q('../up'), q('a b'), q('x'.repeat(61)), q('fine-1'), q('-dash')] }, 'broken.json': '{ "prompts": [' }));
    expect([...bank.prompts.keys()]).toEqual(['fine-1']);
    expect(bank.errors).toHaveLength(6);
    expect(bank.errors[0]).toContain('"Bones"');
    expect(bank.errors.at(-1)).toContain('broken.json is not valid JSON');
  });
});

describe('the build’s plugin for the daily bank', () => {
  const fail = (m: string) => {
    throw new Error(m);
  };
  const emitted = (plugin: ReturnType<typeof dailyBank>) => {
    const files = new Map<string, string>();
    call(plugin.generateBundle, { emitFile: (f: { fileName: string; source: string }) => files.set(f.fileName, f.source), error: fail });
    return files;
  };
  const loaded = (plugin: ReturnType<typeof dailyBank>) => {
    const watched: string[] = [];
    const id = call(plugin.resolveId, {}, BANK_MODULE) as string;
    expect(call(plugin.resolveId, {}, './somewhere-else')).toBeNull();
    expect(call(plugin.load, {}, 'another-module')).toBeNull();
    const code = call(plugin.load, { addWatchFile: (f: string) => watched.push(f), error: fail }, id) as string;
    return { module: moduleOf(code), watched };
  };

  it('hands the script the list without answers and publishes each question as a file of its own', async () => {
    const plugin = dailyBank({ dir: '/somewhere/data', texts: () => texts(FILES) });
    const { module, watched } = loaded(plugin);
    // A change to any of the files rebuilds the list.
    expect(watched.map((f) => f.replace(/\\/g, '/'))).toEqual(['a.json', 'b.json', 'list.json', 'riddles.json', 'theme.json'].map((f) => `/somewhere/data/${f}`));
    expect(module.bundled).toBeNull();
    expect((module.prompts as { id: string }[]).map((p) => p.id)).toEqual(['bones', 'moons', 'rivers', 'from-riddles']);
    expect(JSON.stringify(module.prompts)).not.toContain('answers');
    const files = emitted(plugin);
    expect([...files.keys()]).toEqual(['bank/bones.json', 'bank/moons.json', 'bank/rivers.json', 'bank/from-riddles.json']);

    // The game, given that list and those files, has every question exactly as it would from the files whole.
    const bank = makeBank({ index: module.prompts as unknown[], days: module.days as unknown[], bundled: null, fetchJson: async (id) => JSON.parse(files.get(`bank/${id}.json`)!) });
    const old = collectBank([FILES['a.json'], FILES['b.json'], FILES['riddles.json']]);
    expect(bank.prompts.map((p) => p.id)).toEqual(old.prompts.map((p) => p.id));
    expect(await bank.whole(old.prompts.map((p) => p.id))).toEqual(old.prompts);
    expect(bank.days).toEqual(old.days);
    for (const p of old.prompts) expect(bank.prompts.find((m) => m.id === p.id)).toEqual({ id: p.id, text: p.text, category: p.category, flavor: p.flavor, rules: p.rules });
  });

  it('puts every question whole into the script instead when asked to bundle, and publishes nothing', () => {
    const plugin = dailyBank({ texts: () => texts(FILES), bundled: true });
    const { module } = loaded(plugin);
    expect(Object.keys(module.bundled as object)).toEqual(['bones', 'moons', 'rivers', 'from-riddles']);
    expect((module.bundled as Record<string, unknown>).rivers).toEqual(FILES['b.json'].prompts[1]);
    expect(emitted(plugin).size).toBe(0);
  });

  it('stops the build over a question it cannot publish', () => {
    const plugin = dailyBank({ texts: () => texts({ 'a.json': { prompts: [q('Bad Id')] } }) });
    expect(() => loaded(plugin)).toThrow('the id "Bad Id" cannot be a file');
    expect(() => emitted(plugin)).toThrow('the id "Bad Id" cannot be a file');
  });
});

// The files of data/ whole, as the game read them before questions were fetched one at a time.
const DATA = import.meta.glob('/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

describe('the daily bank in the repo, as the build publishes it', () => {
  const bank = readBank();
  const entries = Object.entries(DATA).sort(([a], [b]) => (a < b ? -1 : 1));
  const before = bankFrom(
    entries.filter(([path]) => !path.endsWith('/theme.json')).map(([, v]) => v),
    placeholder,
  );

  it('can all be published: every id is a file’s name', () => {
    expect(bank.errors).toEqual([]);
    expect(bank.files.map((f) => `/data/${f}`)).toEqual(entries.map(([path]) => path));
  });

  it('asks the questions it always did, in the same order, so no day’s dive changes', async () => {
    if (before.source === 'placeholder') return;
    expect([...bank.prompts.keys()]).toEqual(before.prompts.map((p) => p.id));
    // Fetched a question at a time from the published files, the bank is the one read whole from data/.
    const game = makeBank({ index: [...bank.prompts.values()].map((p) => p.meta), days: bank.days, fallback: placeholder, fetchJson: async (id) => JSON.parse(bank.prompts.get(id)!.source) });
    expect(game.source).toBe('data');
    expect(game.days).toEqual(before.days);
    expect(game.prompts).toEqual(before.prompts.map((p) => ({ id: p.id, text: p.text, category: p.category, flavor: p.flavor, rules: p.rules })));
    expect(await game.whole(before.prompts.map((p) => p.id))).toEqual(before.prompts);
  });

  it('is the bank the tests play, bundled whole', () => {
    // Under test the build puts every question into the script (see vite.config.ts).
    const game = loadBank();
    if (game.source === 'placeholder') return;
    expect(game.prompts.map((p) => p.id)).toEqual([...bank.prompts.keys()]);
    for (const [id, p] of bank.prompts) expect(game.byId.get(id), id).toEqual(cleanPrompt(JSON.parse(p.source)));
  });

  it('keeps the script’s share of the bank small', () => {
    const list = JSON.stringify([...bank.prompts.values()].map((p) => p.meta));
    const all = [...bank.prompts.values()].reduce((n, p) => n + p.source.length, 0);
    // Words and topics only: a few hundred characters a question, whatever its list grows to.
    expect(list.length / Math.max(1, bank.prompts.size)).toBeLessThan(600);
    if (bank.prompts.size >= 7) expect(list.length).toBeLessThan(all / 10);
  });
});
