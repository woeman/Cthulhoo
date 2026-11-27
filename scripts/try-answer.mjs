#!/usr/bin/env node
// Try answers against one prompt, or one riddle, with the reference matcher.
//
//   node scripts/try-answer.mjs landlocked-countries "Lichtenstein" "Australia" "Swaziland"
//   node scripts/try-answer.mjs fog "Mist" "Cloud"

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePrompt, matchAnswer } from "./lib/matcher.mjs";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const [id, ...inputs] = process.argv.slice(2);
if (!id || inputs.length === 0) {
  console.log('usage: node scripts/try-answer.mjs <prompt-id> "answer" ["answer" ...]');
  process.exit(1);
}
const theme = JSON.parse(readFileSync(join(dataDir, "theme.json"), "utf8"));
let prompt = null;
let riddle = null;
for (const file of readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "theme.json")) {
  const data = JSON.parse(readFileSync(join(dataDir, file), "utf8"));
  prompt ??= data.prompts?.find((p) => p.id === id) ?? null;
  riddle ??= data.riddles?.find((r) => r.id === id) ?? null;
}
if (!prompt && riddle) {
  // Every answer to a riddle is equally right, so it is judged as tier 1.
  prompt = { ...riddle, text: riddle.verse.join(" / "), answers: riddle.answers.map((a) => ({ ...a, tier: 1 })) };
}
if (!prompt) {
  console.log(`no prompt or riddle with id "${id}"`);
  process.exit(1);
}
const compiled = compilePrompt(prompt);
console.log(prompt.text);
for (const input of inputs) {
  const r = matchAnswer(compiled, input);
  let detail = "";
  if (r.status === "accepted") {
    const tier = theme.tiers[r.answer.tier - 1];
    detail = riddle && prompt.id === riddle.id
      ? r.answer.answer
      : `${r.answer.answer}, tier ${r.answer.tier} ${tier.name}, ${tier.depth} m${r.answer.openSecret ? ", Open Secret" : ""}`;
  } else if (r.status === "trap") detail = r.trap.reason;
  else if (r.status === "ambiguous") detail = r.candidates.join(" or ");
  else if (r.status === "decoy") detail = `looks like ${r.matched}`;
  console.log(`  ${JSON.stringify(input).padEnd(28)} ${r.status.padEnd(10)} ${detail}`);
}
