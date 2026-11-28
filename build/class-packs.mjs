// Publishes the class packs in packs/ (repo root) beside the game, as files of
// their own: packs/index.json and one file per pack. They are never bundled, so
// a pack can be fixed without rebuilding the game's script, and a copy of the
// game that is already installed fetches the fix. The dev server serves the
// same addresses straight from the folder. Only the top-level .json files are
// published: packs/src holds their sources.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../packs', import.meta.url));
const NAME = /^[a-z0-9][a-z0-9._-]{0,79}\.json$/i;

/** The pack files there are, by name. */
export const packFiles = (dir = DIR) => (existsSync(dir) ? readdirSync(dir).filter((f) => NAME.test(f)).sort() : []);

/** @returns {import('vite').Plugin} */
export function classPacks(dir = DIR) {
  return {
    name: 'cthulhoo-class-packs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /^\/packs\/([^/?#]+)(?:[?#].*)?$/.exec(req.url ?? '');
        if (!m) return next();
        const file = NAME.test(m[1]) ? join(dir, m[1]) : '';
        if (!file || !existsSync(file)) {
          res.statusCode = 404;
          res.end('No such pack.');
          return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const f of packFiles(dir)) {
        const raw = readFileSync(join(dir, f), 'utf8');
        let source = raw;
        try {
          source = JSON.stringify(JSON.parse(raw));
        } catch (e) {
          this.error(`packs/${f} is not valid JSON: ${e instanceof Error ? e.message : e}`);
        }
        this.emitFile({ type: 'asset', fileName: `packs/${f}`, source });
      }
    },
  };
}
