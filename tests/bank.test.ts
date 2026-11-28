import { afterEach, describe, expect, it, vi } from 'vitest';
import placeholder from '../src/content/placeholder-bank.json';
import { BANK_FETCH_MS, adoptPrompts, bankFetcher, bankFrom, cleanPrompt, collectBank, loadBank, makeBank, metaOf, wholeBank } from '../src/game/bank';
import { matchAnswer } from '../src/game/matcher';
import type { PromptDef } from '../src/game/types';

const raw = (placeholder as { prompts: PromptDef[] }).prompts;
const prompt = (extra: Record<string, unknown> = {}) => ({ id: 'q', text: 'Name a thing', category: 'misc', answers: [{ answer: 'Thing', tier: 2 }], ...extra });
const ids = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => prompt({ id: `${prefix}${i}` }));
/** What the player sees from a guess. */
function verdict(p: PromptDef, input: string): unknown[] {
  const r = matchAnswer(p, input);
  if (r.kind === 'accept') return [r.kind, r.answer.answer, r.answer.tier, r.fuzzy];
  if (r.kind === 'trap') return [r.kind, r.trap.answer, r.trap.reason];
  if (r.kind === 'decoy') return [r.kind, r.decoy];
  if (r.kind === 'ambiguous') return [r.kind, r.options];
  return [r.kind];
}

describe('cleaning prompts', () => {
  it('drops prompts it cannot play', () => {
    const broken: unknown[] = [
      null,
      'q',
      [],
      prompt({ id: 7 }),
      prompt({ id: '  ' }),
      prompt({ text: '' }),
      prompt({ answers: 'Thing' }),
      prompt({ answers: [] }),
      prompt({ answers: [{ answer: '', tier: 1 }, { answer: 'X', tier: '3' }, { answer: 'Y', tier: NaN }, { answer: 'Z', tier: Infinity }, null] }),
    ];
    for (const p of broken) expect(cleanPrompt(p), JSON.stringify(p)).toBeNull();
    expect(cleanPrompt(prompt())?.id).toBe('q');
  });

  it('clamps and rounds tiers into 1..6, and drops only the answers that are broken', () => {
    const p = cleanPrompt(prompt({ answers: [{ answer: 'A', tier: 0 }, { answer: 'B', tier: 9 }, { answer: 'C', tier: 2.6 }, { answer: 'D', tier: -4 }, { answer: '', tier: 3 }] }))!;
    expect(p.answers.map((a) => [a.answer, a.tier])).toEqual([['A', 1], ['B', 6], ['C', 3], ['D', 1]]);
  });

  it('never turns a bare alias string into single-letter answers', () => {
    const p = cleanPrompt(prompt({ answers: [{ answer: 'United States', tier: 1, aliases: 'USA' }, { answer: 'Nineteen Eighty-Four', tier: 4, aliases: [1984, null, ' '] }] }))!;
    expect(p.answers[0].aliases).toEqual(['USA']);
    expect(matchAnswer(p, 'U').kind).toBe('reject');
    expect(matchAnswer(p, 'usa').kind).toBe('accept');
    expect(p.answers[1].aliases).toEqual(['1984']);
    expect(matchAnswer(p, '1984').kind).toBe('accept');
  });

  it('refuses a trap with no reason as a decoy, never with an empty reason', () => {
    const p = cleanPrompt(prompt({ traps: [{ answer: 'Sun', reason: 'A star.' }, { answer: 'Moon', aliases: ['Luna'] }, { reason: 'no answer' }], decoys: ['Comet', 3, ''] }))!;
    expect(p.traps!.map((t) => t.answer)).toEqual(['Sun']);
    expect(p.decoys).toEqual(['Comet', '3', 'Moon', 'Luna']);
    expect(matchAnswer(p, 'Luna')).toEqual({ kind: 'decoy', decoy: 'Luna' });
    const sun = matchAnswer(p, 'the sun');
    expect(sun.kind === 'trap' && sun.trap.reason).toBe('A star.');
  });

  it('keeps the exact-match flag for word play only when it is true', () => {
    expect(cleanPrompt(prompt({ exact: true }))!.exact).toBe(true);
    expect(cleanPrompt(prompt({ exact: 'yes' }))!.exact).toBeUndefined();
    expect(cleanPrompt(prompt())!.exact).toBeUndefined();
  });

  it('keeps optional text only when it is text', () => {
    const p = cleanPrompt(prompt({ flavor: 42, rules: { only: 'UN members' }, category: '' }))!;
    expect(p).toMatchObject({ flavor: undefined, rules: undefined, category: 'misc' });
  });

  it('leaves a well-formed bank exactly as playable as it was', () => {
    for (const before of raw) {
      const after = cleanPrompt(before)!;
      expect(after.answers.map((a) => [a.answer, a.tier, a.aliases ?? [], a.lore, !!a.openSecret])).toEqual(
        before.answers.map((a) => [a.answer, a.tier, a.aliases ?? [], a.lore, !!a.openSecret]),
      );
      const forms = [
        ...before.answers.flatMap((a) => [a.answer, ...(a.aliases ?? [])]),
        ...(before.traps ?? []).flatMap((t) => [t.answer, ...(t.aliases ?? [])]),
        ...(before.decoys ?? []),
      ];
      for (const f of forms) {
        for (const input of [f, `${f}x`, f.slice(1), f.toUpperCase()]) expect(verdict(after, input), `${before.id}: ${input}`).toEqual(verdict(before, input));
      }
    }
  });
});

describe('collecting the bank', () => {
  it('keeps the first file to use an id', () => {
    const { prompts } = collectBank([{ prompts: [prompt({ text: 'first' })] }, { prompts: [prompt({ text: 'second' })] }]);
    expect(prompts.map((p) => p.text)).toEqual(['first']);
  });

  it('reads fixed days from any file, including one with no prompts', () => {
    const { days } = collectBank([
      { prompts: ids(3, 'a') },
      { days: [{ date: '2026-12-25', prompts: ['a0', 4, 'a1'] }, { date: 20261225, prompts: ['a0'] }, { date: '2026-12-26' }, null] },
      { notes: 'not a bank file' },
      'nonsense',
    ]);
    expect(days).toEqual([{ date: '2026-12-25', prompts: ['a0', 'a1'] }]);
  });

  it('plays the data once it can fill a day', () => {
    const bank = bankFrom([{ prompts: ids(7, 'd') }], placeholder);
    expect(bank.source).toBe('data');
    expect(bank.prompts.map((p) => p.id)).toEqual(['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6']);
  });

  it('makes up a short bank from the placeholders, letting the data win a shared id', () => {
    const shared = { ...raw[0], text: 'The newer wording from data/' };
    const bank = bankFrom([{ prompts: [shared, ...ids(2, 'd')], days: [{ date: '2026-12-25', prompts: ['d0'] }] }], placeholder);
    expect(bank.source).toBe('placeholder');
    expect(bank.prompts).toHaveLength(raw.length + 2);
    expect(bank.prompts.find((p) => p.id === raw[0].id)?.text).toBe('The newer wording from data/');
    expect(bank.days).toEqual([{ date: '2026-12-25', prompts: ['d0'] }]);
  });

  // Passes before and after the question bank lands in data/.
  it('loads data/ when it holds a day of questions, and the placeholder bank otherwise', () => {
    const bank = loadBank();
    if (bank.source === 'placeholder') {
      expect(bank.prompts).toHaveLength(raw.length);
      expect([...bank.byId.keys()]).toEqual(raw.map((p) => p.id));
    } else {
      expect(bank.prompts.length).toBeGreaterThanOrEqual(7);
    }
    expect(bank.byId.size).toBe(bank.prompts.length);
  });
});

describe('a bank fetched a question at a time', () => {
  // What the build hands the script: every question without its lists, each with a stamp of its file.
  const whole = ids(9, 'q').map((p, i) => ({ ...p, text: `Name thing ${i}`, category: i < 5 ? 'science' : 'myth', ...(i === 0 ? { flavor: 'A flavour.' } : {}) })) as PromptDef[];
  const index = whole.map((p, i) => ({ id: p.id, text: p.text, category: p.category, flavor: p.flavor, v: `v${i}` }));
  const line = (files: Record<string, unknown> = Object.fromEntries(whole.map((p) => [p.id, p])), down: () => boolean = () => false) => {
    const calls: string[] = [];
    const fetchJson = async (id: string, v: string) => {
      calls.push(`${id}?${v}`);
      if (down() || !(id in files)) throw new Error('down');
      return files[id];
    };
    return { calls, fetchJson };
  };

  it('knows every question’s words and topic at once, and none of its answers', () => {
    const { calls, fetchJson } = line();
    const bank = makeBank({ index, fetchJson });
    expect(bank.source).toBe('data');
    expect(bank.prompts.map((p) => p.id)).toEqual(whole.map((p) => p.id));
    expect(bank.prompts[0]).toEqual({ id: 'q0', text: 'Name thing 0', category: 'science', flavor: 'A flavour.', rules: undefined });
    expect(bank.prompts.some((p) => 'answers' in p || 'v' in p)).toBe(false);
    expect(bank.byId.size).toBe(0);
    expect(bank.has('q3')).toBe(true);
    expect(bank.has('nope')).toBe(false);
    expect(bank.about('q3')).toBe(bank.prompts[3]);
    expect(bank.about('nope')).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('reads a line of the list as it reads a whole question, and skips what is not one', () => {
    const bank = makeBank({ index: [...index, { id: 'q0', text: 'Again' }, { id: 'bare', text: 'No topic', category: ' ' }, { id: '', text: 'No id' }, { id: 'wordless' }, 'nonsense', null] });
    expect(bank.prompts.map((p) => p.id)).toEqual([...whole.map((p) => p.id), 'bare']);
    expect(bank.about('q0')?.text).toBe('Name thing 0');
    expect(bank.about('bare')?.category).toBe('misc');
  });

  it('fetches a question’s answers when they are asked for, each file once, by its stamp', async () => {
    const { calls, fetchJson } = line();
    const bank = makeBank({ index, fetchJson });
    const got = await bank.whole(['q4', 'q1', 'q4', 'nope']);
    expect(got.map((p) => p.id)).toEqual(['q4', 'q1']);
    expect(got[0]).toEqual(cleanPrompt(whole[4]));
    expect(calls).toEqual(['q4?v4', 'q1?v1']);
    expect([...bank.byId.keys()].sort()).toEqual(['q1', 'q4']);
    expect(bank.about('q4')).toBe(got[0]);
    // Here now: asked for again, nothing more is fetched but what is new.
    expect((await bank.whole(['q1', 'q4', 'q2'])).map((p) => p.id)).toEqual(['q1', 'q4', 'q2']);
    expect(calls).toEqual(['q4?v4', 'q1?v1', 'q2?v2']);
    // The list of the day's plan never changes for it.
    expect(bank.prompts).toHaveLength(9);
    expect(bank.prompts.some((p) => 'answers' in p)).toBe(false);
  });

  it('asks once for a question two things want at the same moment', async () => {
    const { calls, fetchJson } = line();
    const bank = makeBank({ index, fetchJson });
    const [a, b] = await Promise.all([bank.whole(['q1', 'q2']), bank.whole(['q2', 'q3'])]);
    expect([...calls].sort()).toEqual(['q1?v1', 'q2?v2', 'q3?v3']);
    expect(a[1]).toBe(b[0]);
  });

  it('leaves out what the line would not give, never rejects, and asks afresh the next time', async () => {
    let down = true;
    const { calls, fetchJson } = line(undefined, () => down);
    const bank = makeBank({ index, fetchJson });
    expect(await bank.whole(['q1', 'q2'])).toEqual([]);
    expect(bank.byId.size).toBe(0);
    down = false;
    expect((await bank.whole(['q1', 'q2'])).map((p) => p.id)).toEqual(['q1', 'q2']);
    expect(calls).toHaveLength(4);
  });

  it('gives what it can when only some of a day’s questions arrive', async () => {
    const { fetchJson } = line({ q1: whole[1], q3: whole[3] });
    const bank = makeBank({ index, fetchJson });
    expect((await bank.whole(['q1', 'q2', 'q3'])).map((p) => p.id)).toEqual(['q1', 'q3']);
  });

  it('refuses a file that holds another question, or nothing it can play', async () => {
    const { fetchJson } = line({ q1: whole[2], q2: { id: 'q2', text: 'No answers' }, q3: 'nonsense', q4: whole[4] });
    const bank = makeBank({ index, fetchJson });
    expect((await bank.whole(['q1', 'q2', 'q3', 'q4'])).map((p) => p.id)).toEqual(['q4']);
    expect([...bank.byId.keys()]).toEqual(['q4']);
  });

  it('has only what is here when there is no line at all', async () => {
    const bank = makeBank({ index });
    expect(await bank.whole(['q1'])).toEqual([]);
    expect(bank.has('q1')).toBe(true);
  });

  it('holds every question whole from the start when the build bundled them, and fetches nothing', async () => {
    const { calls, fetchJson } = line();
    const bundled = Object.fromEntries(whole.map((p) => [p.id, p]));
    const bank = makeBank({ index, bundled, fetchJson });
    expect(bank.byId.size).toBe(9);
    expect((await bank.whole(['q8', 'q0'])).map((p) => p.id)).toEqual(['q8', 'q0']);
    expect(calls).toEqual([]);
    // A question the bundle cannot give whole is not asked at all.
    const short = makeBank({ index, bundled: { ...bundled, q0: { id: 'q0', text: 'Broken' }, q1: whole[2] } });
    expect(short.prompts.map((p) => p.id)).toEqual(whole.slice(2).map((p) => p.id));
    expect(short.has('q0')).toBe(false);
    expect(short.byId.size).toBe(7);
  });

  it('makes up a short list from the placeholders, which are here whole, letting the data win a shared id', async () => {
    const newer = { ...raw[0], text: 'The newer wording from data/' };
    const { calls, fetchJson } = line({ [raw[0].id]: newer });
    const days = [{ date: '2026-12-25', prompts: ['q0'] }, { date: '2026-12-26', riddle: 'a riddle’s day' }];
    const bank = makeBank({ index: [{ id: newer.id, text: newer.text, v: 'x' }, ...index.slice(0, 2)], fallback: placeholder, fetchJson, days });
    expect(bank.source).toBe('placeholder');
    expect(bank.prompts).toHaveLength(raw.length + 2);
    expect(bank.prompts.find((p) => p.id === raw[0].id)?.text).toBe('The newer wording from data/');
    expect(bank.days).toEqual([{ date: '2026-12-25', prompts: ['q0'] }]);
    // The placeholders need no fetching; the data's own questions still do.
    expect(bank.byId.size).toBe(raw.length - 1);
    expect((await bank.whole([raw[1].id])).map((p) => p.id)).toEqual([raw[1].id]);
    expect(calls).toEqual([]);
    expect((await bank.whole([raw[0].id]))[0].text).toBe('The newer wording from data/');
    expect(calls).toEqual([`${raw[0].id}?x`]);
  });

  it('keeps its own question when a class pack uses the same id, fetched or not', async () => {
    const { fetchJson } = line();
    const bank = makeBank({ index, fetchJson });
    adoptPrompts(bank, [{ ...whole[1], text: 'A pack’s wording' }, cleanPrompt(prompt({ id: 'pack-own' }))!]);
    expect([...bank.byId.keys()]).toEqual(['pack-own']);
    expect(bank.has('pack-own')).toBe(false);
    expect(bank.about('pack-own')?.text).toBe('Name a thing');
    expect((await bank.whole(['q1', 'pack-own'])).map((p) => p.text)).toEqual(['Name thing 1', 'Name a thing']);
    expect(bank.prompts).toHaveLength(9);
  });

  it('strips a question to its words, and a bank of whole questions fetches nothing', async () => {
    const p = cleanPrompt(prompt({ flavor: 'F', rules: 'R', exact: true, traps: [{ answer: 'Trap', reason: 'Why' }], decoys: ['Decoy'] }))!;
    expect(metaOf(p)).toEqual({ id: 'q', text: 'Name a thing', category: 'misc', flavor: 'F', rules: 'R', topic: undefined, section: undefined, asOf: undefined, source: undefined });
    const bank = wholeBank([p]);
    expect(await bank.whole(['q', 'nope', 'q'])).toEqual([p]);
    expect(bank.has('q') && !bank.has('nope')).toBe(true);
    expect(bank.about('q')).toBe(p);
  });
});

describe('fetching a question from beside the game', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const answer = (body: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

  it('asks for bank/<id>.json beside the page, with the stamp of its list', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: URL) => (seen.push(String(url)), answer({ id: 'bones' })));
    const get = bankFetcher('https://example.test/Cthulhoo/?revise=finance#top');
    expect(await get('bones', 'aB3_-x9Z')).toEqual({ id: 'bones' });
    await get('bones', '');
    expect(seen).toEqual(['https://example.test/Cthulhoo/bank/bones.json?v=aB3_-x9Z', 'https://example.test/Cthulhoo/bank/bones.json']);
  });

  it('takes any copy the browser kept when the line is down, and rejects when there is none', async () => {
    const seen: RequestInit[] = [];
    let kept = true;
    vi.stubGlobal('fetch', async (_url: URL, init: RequestInit = {}) => {
      seen.push(init);
      if (init.cache !== 'only-if-cached' || !kept) throw new TypeError('Failed to fetch');
      return answer({ id: 'bones' });
    });
    const get = bankFetcher('https://example.test/');
    expect(await get('bones', 'v')).toEqual({ id: 'bones' });
    expect(seen[1]).toEqual({ cache: 'only-if-cached', mode: 'same-origin' });
    kept = false;
    await expect(get('bones', 'v')).rejects.toThrow();
  });

  it('asks again, once the service worker has the page, for what was fetched before it did', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (url: URL) => (seen.push(String(url)), answer({})));
    let taken: (() => void) | undefined;
    const worker = { controller: null as object | null, addEventListener: (_: string, fn: () => void) => (taken = fn) };
    vi.stubGlobal('navigator', { serviceWorker: worker });
    const get = bankFetcher('https://example.test/');
    await get('bones', 'v1');
    await get('rivers', 'v2');
    expect(seen).toHaveLength(2);
    // A first visit: the worker installs, then takes the page.
    worker.controller = {};
    taken?.();
    expect(seen.slice(2)).toEqual(['https://example.test/bank/bones.json?v=v1', 'https://example.test/bank/rivers.json?v=v2']);
    // From then on it sees every fetch itself: nothing more is asked for twice.
    await get('moons', 'v3');
    taken?.();
    expect(seen).toHaveLength(5);
  });

  it('rejects when the file is not there', async () => {
    vi.stubGlobal('fetch', async () => answer('Not found', 404));
    await expect(bankFetcher('https://example.test/')('gone', 'v')).rejects.toThrow('404');
  });

  it('gives up on a line too slow, even one that stalls halfway through a list', async () => {
    vi.useFakeTimers();
    const aborted: boolean[] = [];
    vi.stubGlobal('fetch', (_url: URL, init: RequestInit = {}) => {
      if (init.cache === 'only-if-cached') return Promise.reject(new TypeError('Not kept'));
      // The first bytes come at once; the rest never does, until the wait is given up.
      const json = () => new Promise((_, reject) => init.signal?.addEventListener('abort', () => (aborted.push(true), reject(new DOMException('Aborted', 'AbortError')))));
      return Promise.resolve({ ok: true, status: 200, json } as unknown as Response);
    });
    const tried = bankFetcher('https://example.test/')('slow', 'v').then(
      () => 'had',
      () => 'given up',
    );
    await vi.advanceTimersByTimeAsync(BANK_FETCH_MS - 1);
    expect(aborted).toEqual([]);
    await vi.advanceTimersByTimeAsync(2);
    expect(await tried).toBe('given up');
    expect(aborted).toEqual([true]);
  });
});
