// Freezes the daily dives up to a date, so that growing the bank doesn't move them.
//
// The daily plan is a pure function of the bank's prompt ids and categories, so adding
// prompts re-plans every day that isn't fixed, past days and today included (see
// promptsForDay in src/game/daily.ts). Run this before new prompts go live: it plans each
// day from the bank that players have now (the data at a git ref, origin/main by default)
// and writes those days to data/days.json as fixed days. Fixed days already in the bank
// are kept, and so is any fixed day after the chosen date.
//
//   node scripts/freeze-days.mjs 2026-12-06              # day 1 (27 Nov 2026) to 6 Dec
//   node scripts/freeze-days.mjs 2026-12-06 --ref main   # plan from another git ref
//
// Freeze at least the day after the new prompts go live: some players are a day ahead.
// Needs Node 22.18 or later, which runs the game's TypeScript directly.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dateKeyForDay, dayNumberForKey, freezeDays } from "../src/game/daily.ts";

const args = process.argv.slice(2);
const refAt = args.indexOf("--ref");
const ref = refAt >= 0 ? args[refAt + 1] : "origin/main";
const through = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const last = through ? dayNumberForKey(through) : null;
if (!ref || last === null || last < 1) {
  console.error("usage: node scripts/freeze-days.mjs YYYY-MM-DD [--ref <git ref>]");
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const git = (...a) => execFileSync("git", a, { cwd: root, encoding: "utf8", maxBuffer: 1 << 28 });

// The bank as the game reads it at that ref: every prompt (first id wins) and every fixed day.
const prompts = [];
const seen = new Set();
const fixed = [];
for (const file of git("ls-tree", "--name-only", ref, "data/").split("\n").filter((f) => f.endsWith(".json")).sort()) {
  const data = JSON.parse(git("show", `${ref}:${file}`));
  for (const p of Array.isArray(data.prompts) ? data.prompts : []) {
    if (p && typeof p.id === "string" && !seen.has(p.id)) {
      seen.add(p.id);
      prompts.push({ id: p.id, category: p.category });
    }
  }
  for (const d of Array.isArray(data.days) ? data.days : []) {
    if (d && typeof d.date === "string" && Array.isArray(d.prompts)) fixed.push({ date: d.date, prompts: d.prompts });
  }
}
if (!prompts.length) {
  console.error(`no prompts in data/ at ${ref}`);
  process.exit(1);
}

const frozen = freezeDays(prompts, fixed, 1, last);
const later = fixed.filter((d) => (dayNumberForKey(d.date) ?? 0) > last);
const days = [...frozen, ...later];
const line = (d) => `    { "date": ${JSON.stringify(d.date)}, "prompts": ${JSON.stringify(d.prompts).replaceAll('","', '", "')} }`;
writeFileSync(`${root}data/days.json`, `{\n  "days": [\n${days.map(line).join(",\n")}\n  ]\n}\n`);
console.log(`froze ${frozen.length} days (${dateKeyForDay(1)} to ${dateKeyForDay(last)}) from the ${prompts.length} prompts at ${ref}` +
  (later.length ? `, and kept ${later.length} later fixed days` : "") + "; wrote data/days.json");
