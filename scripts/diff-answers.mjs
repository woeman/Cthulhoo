#!/usr/bin/env node
// Show what your edits to the bank change for players, typos included.
//
//   node scripts/diff-answers.mjs                     everything changed since the last commit
//   node scripts/diff-answers.mjs sport misc          only these files
//   node scripts/diff-answers.mjs --base origin/main  against another branch or commit
//   node scripts/diff-answers.mjs --prompt dog-breeds only this prompt
//
// For each changed prompt it replays every spelling from the old version, plus every
// typo with one letter missing or two letters swapped, against both the old
// and the new data, and lists the inputs that now land differently. Inputs the
// old data refused are skipped, since accepting more is the point. It also
// lists new spellings that don't land on their own answer or trap.
//
// A brand-new prompt has nothing to compare with, so its own spellings and
// their typos are checked instead: it lists typos that land on a different
// answer, on a trap or decoy, or on "which one?", commonest answers first.
//
// Changes can be intended (a trap became an answer, say). The ones to look for
// are typos of common answers that turn ambiguous or fall into a new trap.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePrompt, matchAnswer } from "./lib/matcher.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
let base = "HEAD";
let only = null;
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--base") base = args[++i];
  else if (args[i].startsWith("--base=")) base = args[i].slice(7);
  else if (args[i] === "--prompt") only = args[++i];
  else if (args[i].startsWith("--prompt=")) only = args[i].slice(9);
  else files.push(args[i].replace(/\.json$/, ""));
}
if (!base || only === undefined) {
  console.log("usage: node scripts/diff-answers.mjs [--base <git ref>] [--prompt <id>] [file ...]");
  process.exit(1);
}
if (files.length === 0) {
  for (const f of readdirSync(join(repo, "data")).sort()) {
    if (f.endsWith(".json") && f !== "theme.json") files.push(f.slice(0, -5));
  }
}

// Every answer to a riddle is equally right, so it is judged as tier 1.
const prompts = (data) => [
  ...(data.prompts ?? []),
  ...(data.riddles ?? []).map((r) => ({ ...r, answers: r.answers.map((a) => ({ ...a, tier: 1 })) })),
];
const describe = (r) =>
  r.status === "accepted" ? `accepted ${r.answer.answer} (tier ${r.answer.tier})`
  : r.status === "trap" ? `trap ${r.trap.answer}`
  : r.status === "ambiguous" ? `ambiguous ${r.candidates.join(" | ")}`
  : r.status;
const spellings = (item) => [item.answer, ...(item.aliases ?? [])];
const withTypos = (forms, word) => {
  forms.add(word);
  if (word.length < 4) return;
  for (let i = 0; i < word.length; i++) {
    forms.add(word.slice(0, i) + word.slice(i + 1));
    if (i < word.length - 1) forms.add(word.slice(0, i) + word[i + 1] + word[i] + word.slice(i + 2));
  }
};

let inputs = 0;
let changes = 0;
const lands = (kind, item, r) =>
  kind === "answer" ? r.status === "accepted" && r.answer === item : r.status === "trap" && r.trap === item;
const print = (id, groups) => {
  if (!groups.size) return;
  console.log(`\n${id}`);
  for (const [label, list] of groups) {
    const eg = list.slice(0, 3).map((x) => JSON.stringify(x)).join(", ");
    console.log(`  ${String(list.length).padStart(3)} x  ${label}   e.g. ${eg}`);
  }
};

// A new prompt: every listed spelling should land on its own answer or trap,
// and a typo of one should land there too, or nowhere.
function checkNew(np) {
  const after = compilePrompt(np);
  const found = [];
  const items = [...np.answers.map((a) => ["answer", a]), ...(np.traps ?? []).map((t) => ["trap", t])];
  for (const [kind, item] of items) {
    const name = kind === "answer" ? `${item.answer} (tier ${item.tier})` : `trap ${item.answer}`;
    const rank = kind === "answer" ? item.tier : 7;
    for (const f of spellings(item)) {
      inputs++;
      const r = matchAnswer(after, f);
      if (!lands(kind, item, r)) found.push([0, `spelling of ${name} lands on: ${describe(r)}`, f]);
      const typos = new Set();
      withTypos(typos, f);
      typos.delete(f);
      for (const t of typos) {
        inputs++;
        const rt = matchAnswer(after, t);
        if (rt.status === "unknown" || rt.distance === 0 || lands(kind, item, rt)) continue;
        found.push([rank, `typo of ${name} lands on: ${describe(rt)}`, t]);
      }
    }
  }
  found.sort((a, b) => a[0] - b[0]);
  const groups = new Map();
  for (const [, label, input] of found) {
    changes++;
    groups.set(label, [...(groups.get(label) ?? []), input]);
  }
  print(`${np.id} (new)`, groups);
}
for (const file of files) {
  let oldText = null;
  try {
    oldText = execFileSync("git", ["-C", repo, "show", `${base}:data/${file}.json`], {
      maxBuffer: 1e8,
      stdio: ["ignore", "pipe", "ignore"],
    }).toString();
  } catch {
    // The whole file is new since the base, so every prompt in it is checked as new.
  }
  const newText = readFileSync(join(repo, "data", `${file}.json`), "utf8");
  if (newText === oldText) continue;
  const oldPrompts = oldText === null ? [] : prompts(JSON.parse(oldText));
  const newPrompts = prompts(JSON.parse(newText));
  for (const p of newPrompts) {
    if (only && p.id !== only) continue;
    if (!oldPrompts.some((o) => o.id === p.id)) checkNew(p);
  }
  for (const op of oldPrompts) {
    if (only && op.id !== only) continue;
    const np = newPrompts.find((p) => p.id === op.id);
    if (!np) {
      console.log(`${op.id}: removed`);
      continue;
    }
    if (JSON.stringify(op) === JSON.stringify(np)) continue;
    const before = compilePrompt(op);
    const after = compilePrompt(np);
    const forms = new Set();
    for (const item of [...op.answers, ...(op.traps ?? [])]) for (const f of spellings(item)) withTypos(forms, f);
    for (const d of op.decoys ?? []) forms.add(d);

    const groups = new Map();
    const note = (label, input) => {
      changes++;
      groups.set(label, [...(groups.get(label) ?? []), input]);
    };
    for (const input of forms) {
      inputs++;
      const was = matchAnswer(before, input);
      const now = matchAnswer(after, input);
      if (was.status === "unknown") continue;
      const a = describe(was);
      const b = describe(now);
      if (a === b) continue;
      // A renamed answer is still the same answer if it keeps the old name as a spelling.
      if (was.status === "accepted" && now.status === "accepted") {
        const names = spellings(now.answer).map((x) => x.toLowerCase());
        if (names.includes(was.answer.answer.toLowerCase()) && was.answer.tier === now.answer.tier) continue;
      }
      note(`${a}  ->  ${b}`, input);
    }
    const oldForms = new Set([...op.answers, ...(op.traps ?? [])].flatMap(spellings).map((x) => x.toLowerCase()));
    for (const [kind, item] of [...np.answers.map((a) => ["answer", a]), ...(np.traps ?? []).map((t) => ["trap", t])]) {
      for (const f of spellings(item)) {
        if (oldForms.has(f.toLowerCase())) continue;
        const r = matchAnswer(after, f);
        const own = kind === "answer"
          ? r.status === "accepted" && r.answer.answer === item.answer
          : r.status === "trap" && r.trap.answer === item.answer;
        if (!own) note(`new spelling of ${kind} ${item.answer} lands on: ${describe(r)}`, f);
      }
    }
    print(op.id, groups);
  }
}
console.log(`\nReplayed ${inputs} inputs against ${base}. ${changes} listed above.`);
