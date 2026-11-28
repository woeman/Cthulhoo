// Writes suggestions/: one readable file per question listing every answer the game accepts
// and every input it refuses on purpose, plus the next days' questions. Helpers (people or
// AI assistants) read these to suggest answers the bank is missing; see suggestions/README.md.
//
//   node scripts/export-answer-lists.mjs                    # from today (UTC), 9 days
//   node scripts/export-answer-lists.mjs 2026-11-29 --days 7
//
// Run it again whenever data/ changes, so the lists stay true. Needs Node 22.18 or later,
// which runs the game's TypeScript directly.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dateForDay, dayNumberForKey, promptsForDay } from "../src/game/daily.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const args = process.argv.slice(2);
const daysAt = args.indexOf("--days");
const count = daysAt >= 0 ? Number(args[daysAt + 1]) : 9;
const fromKey = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? new Date().toISOString().slice(0, 10);
const from = dayNumberForKey(fromKey);
if (from === null || !(count > 0)) {
  console.error("usage: node scripts/export-answer-lists.mjs [YYYY-MM-DD] [--days N]");
  process.exit(1);
}

// The bank as the game reads it: every prompt (first id wins) and every fixed day.
const prompts = [];
const fixed = [];
const fileOf = new Map();
for (const name of readdirSync(`${root}data`).filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(readFileSync(`${root}data/${name}`, "utf8"));
  for (const p of Array.isArray(data.prompts) ? data.prompts : []) {
    if (p && typeof p.id === "string" && !fileOf.has(p.id)) {
      fileOf.set(p.id, `data/${name}`);
      prompts.push(p);
    }
  }
  for (const d of Array.isArray(data.days) ? data.days : []) {
    // Only the daily plan's fixed days (riddle days live in their own file and shape).
    if (d && typeof d.date === "string" && Array.isArray(d.prompts)) fixed.push({ date: d.date, prompts: d.prompts });
  }
}
const byId = new Map(prompts.map((p) => [p.id, p]));

const TIER = {
  1: "Tier 1: what most people say",
  2: "Tier 2: common",
  3: "Tier 3: known to fans",
  4: "Tier 4: obscure",
  5: "Tier 5: expert",
  6: "Tier 6: rare jackpots",
};
const FORGIVEN =
  "The game already forgives capitals, accents, punctuation, a leading \"the\", simple plurals, " +
  "\"St\" for \"Saint\", number words, a title in front (King, Sir, Dr and the like), the question's own words " +
  "at the end (\"Cheddar cheese\"), a year at the end, and small typos (one wrong letter in a short name, more in a long one), " +
  "so there is no need to suggest those variants.";

function questionFile(p) {
  const out = [`# ${p.text}`, ""];
  out.push(`Question id: \`${p.id}\` · category: ${p.category} · source: \`${fileOf.get(p.id)}\``, "");
  if (p.rules) out.push(`Rules: ${p.rules}`, "");
  if (p.exact) out.push("Spelling counts on this question: answers must match exactly.", "");
  else out.push(FORGIVEN, "");
  out.push(`## Accepted now (${p.answers.length} answers)`, "");
  out.push("Each answer is followed by the other spellings the game takes for it, separated by \" | \".", "");
  for (const t of [1, 2, 3, 4, 5, 6]) {
    const group = p.answers.filter((a) => a.tier === t);
    if (!group.length) continue;
    out.push(`### ${TIER[t]} (${group.length})`, "");
    for (const a of group) out.push(`- ${a.answer}${a.aliases?.length ? ` — ${a.aliases.join(" | ")}` : ""}`);
    out.push("");
  }
  const traps = p.traps ?? [];
  const decoys = p.decoys ?? [];
  if (traps.length || decoys.length) {
    out.push(`## Refused on purpose (${traps.length + decoys.length})`, "");
    out.push("These are refused with the reason shown. If one of them is in fact a right answer, say so.", "");
    for (const t of traps) out.push(`- ${[t.answer, ...(t.aliases ?? [])].join(" | ")} — "${t.reason}"`);
    if (decoys.length) out.push(`- Refused without a reason (near misses of real answers): ${decoys.join(" | ")}`);
    out.push("");
  }
  return out.join("\n");
}

const dir = `${root}suggestions/questions`;
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const p of prompts) writeFileSync(`${dir}/${p.id}.md`, questionFile(p));

const fmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const up = ["# Upcoming daily questions", ""];
up.push("Each day's dive has seven questions, the same for every player on that local date. Soonest first.", "");
for (let day = from; day < from + count; day++) {
  if (day < 1) continue;
  const date = dateForDay(day);
  const key = date.toISOString().slice(0, 10);
  up.push(`## ${fmt.format(date)}`, "");
  promptsForDay(prompts, day, fixed, key).forEach((id, i) => {
    const p = byId.get(id);
    up.push(`${i + 1}. [${p.text}](questions/${id}.md) (\`${id}\`, ${p.answers.length} answers so far)`);
  });
  up.push("");
}
writeFileSync(`${root}suggestions/upcoming.md`, up.join("\n"));
console.log(`wrote suggestions/questions/ (${prompts.length} questions) and suggestions/upcoming.md (${count} days from ${fromKey})`);
