// The daily bank (data/*.json at the repo root), made ready for the game.
//
// The game's script is given only what it needs of every question at once: its
// words, its topic and a stamp of its list. Each question's answers are
// published beside the game as a file of their own (bank/<id>.json) and fetched
// when a dive, a séance or a log asks for them, so the bank can grow without the
// game's first load growing with it. The dev server serves the same addresses
// straight from the folder.
//
// The script reads it all from the module "virtual:daily-bank":
//   prompts      every question without its answers: { id, text, category, flavor?, rules?, v }
//   days         the fixed days found in the files, as written
//   theme        data/theme.json as written, or null
//   riddleFiles  every file with a "riddles" list, as written (less any questions)
//   bundled      null, or every question whole by id when the build asks for that
//                (the one-file preview and the tests, which can fetch nothing)

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../data', import.meta.url));
export const BANK_MODULE = 'virtual:daily-bank';
const RESOLVED = `\0${BANK_MODULE}`;
/** A question's id is also its file's name. */
const ID = /^[a-z0-9][a-z0-9-]{0,59}$/;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v.trim() ? v : undefined);
/** As the game takes an answer: a spelling and a tier. */
const isAnswer = (a) => isObj(a) && !!str(a.answer) && typeof a.tier === 'number' && Number.isFinite(a.tier);
/** As the game takes a question: an id, its words and at least one answer. */
const isPrompt = (p) => isObj(p) && !!str(p.id) && !!str(p.text) && Array.isArray(p.answers) && p.answers.some(isAnswer);

/** The JSON files of a folder as text, [name, text] pairs. None when there is no such folder. */
export function bankTexts(dir = DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
}

/**
 * Everything in the daily bank's files ([name, text] pairs, as bankTexts reads
 * them), taken in name order as the game has always read them: the questions
 * (the first file to use an id wins), each with its published text and a stamp
 * of it; the fixed days; the theme; and the riddle files. `errors` says what
 * cannot be published.
 * @param {Array<[string, string]>} texts
 */
export function bankOf(texts) {
  /** @type {Map<string, { meta: Record<string, unknown>, raw: unknown, source: string }>} */
  const prompts = new Map();
  const days = [];
  const riddleFiles = [];
  const errors = [];
  let theme = null;
  const files = texts.filter(([f]) => f.endsWith('.json')).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [f, text] of files) {
    let j;
    try {
      j = JSON.parse(text);
    } catch (e) {
      errors.push(`data/${f} is not valid JSON: ${e instanceof Error ? e.message : e}`);
      continue;
    }
    if (f === 'theme.json') {
      theme = j;
      continue;
    }
    if (!isObj(j)) continue;
    if (Array.isArray(j.riddles)) {
      const { prompts: _questions, ...rest } = j;
      riddleFiles.push(rest);
    }
    for (const p of Array.isArray(j.prompts) ? j.prompts : []) {
      if (!isPrompt(p) || prompts.has(p.id)) continue;
      if (!ID.test(p.id)) {
        errors.push(`data/${f}: the id "${p.id}" cannot be a file's name (lower-case letters, digits and hyphens, 60 at most).`);
        continue;
      }
      const source = JSON.stringify(p);
      const meta = { id: p.id, text: p.text, v: createHash('sha256').update(source).digest('base64url').slice(0, 8) };
      for (const k of ['category', 'flavor', 'rules']) if (str(p[k])) meta[k] = p[k];
      prompts.set(p.id, { meta, raw: p, source });
    }
    // A riddle file's days name riddles: the game tells the two kinds apart.
    for (const d of Array.isArray(j.days) ? j.days : []) days.push(d);
  }
  return { files: files.map(([f]) => f), prompts, days, theme, riddleFiles, errors };
}

/** Everything in data/ (see bankOf). */
export const readBank = (dir = DIR) => bankOf(bankTexts(dir));

/**
 * @param {{ dir?: string, bundled?: boolean, texts?: () => Array<[string, string]> }} [opts]
 *   `bundled` puts every question whole into the script and publishes no files.
 *   `texts` reads the files; by default those of `dir`, the repo's data/.
 * @returns {import('vite').Plugin}
 */
export function dailyBank({ dir = DIR, bundled = false, texts = () => bankTexts(dir) } = {}) {
  const read = () => bankOf(texts());
  return {
    name: 'cthulhoo-daily-bank',
    resolveId(id) {
      return id === BANK_MODULE ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      const bank = read();
      for (const f of bank.files) this.addWatchFile(join(dir, f));
      if (bank.errors.length) this.error(bank.errors.join('\n'));
      const metas = [...bank.prompts.values()].map((p) => p.meta);
      const whole = bundled ? Object.fromEntries([...bank.prompts].map(([key, p]) => [key, p.raw])) : null;
      return [
        `export const prompts = ${JSON.stringify(metas)};`,
        `export const days = ${JSON.stringify(bank.days)};`,
        `export const theme = ${JSON.stringify(bank.theme)};`,
        `export const riddleFiles = ${JSON.stringify(bank.riddleFiles)};`,
        `export const bundled = ${JSON.stringify(whole)};`,
      ].join('\n');
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/bank\/([^/?#]+)\.json(?:[?#].*)?$/.exec(req.url ?? '');
        if (!m) return next();
        const found = ID.test(m[1]) ? read().prompts.get(m[1]) : undefined;
        if (!found) {
          res.statusCode = 404;
          res.end('No such question.');
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(found.source);
      });
    },
    generateBundle() {
      if (bundled) return;
      const bank = read();
      if (bank.errors.length) this.error(bank.errors.join('\n'));
      for (const [id, p] of bank.prompts) this.emitFile({ type: 'asset', fileName: `bank/${id}.json`, source: p.source });
    },
  };
}
