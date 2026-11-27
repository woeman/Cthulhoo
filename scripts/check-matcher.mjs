#!/usr/bin/env node
// Runs the shared matcher test cases in scripts/matcher-cases.json against the
// reference matcher. The game runs the same cases against its own matcher, so
// the two always judge answers the same way.
//
//   node scripts/check-matcher.mjs

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePrompt, matchAnswer } from "./lib/matcher.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const { prompts, cases } = JSON.parse(readFileSync(join(here, "matcher-cases.json"), "utf8"));
const compiled = Object.fromEntries(Object.entries(prompts).map(([name, p]) => [name, compilePrompt(p)]));

function describe(r) {
  if (r.status === "accepted") return `accepted (${r.answer.answer})`;
  if (r.status === "trap") return `trap (${r.trap.answer})`;
  if (r.status === "ambiguous") return `ambiguous (${r.candidates.join(", ")})`;
  return r.status;
}

const failures = [];
for (const c of cases) {
  const prompt = compiled[c.prompt];
  if (!prompt) {
    failures.push(`${JSON.stringify(c.input)}: no test prompt named "${c.prompt}"`);
    continue;
  }
  const r = matchAnswer(prompt, c.input);
  const ok =
    r.status === c.expect &&
    (c.answer === undefined || r.answer?.answer === c.answer) &&
    (c.trap === undefined || r.trap?.answer === c.trap) &&
    (c.candidates === undefined || JSON.stringify([...r.candidates].sort()) === JSON.stringify([...c.candidates].sort()));
  if (!ok) {
    const wanted = c.expect + (c.answer ? ` (${c.answer})` : c.trap ? ` (${c.trap})` : c.candidates ? ` (${c.candidates.join(", ")})` : "");
    failures.push(`${c.prompt}: ${JSON.stringify(c.input)} gave ${describe(r)}, expected ${wanted}`);
  }
}

for (const f of failures) console.log(`FAIL ${f}`);
console.log(`${cases.length - failures.length} of ${cases.length} matcher cases pass`);
process.exit(failures.length ? 1 : 0);
