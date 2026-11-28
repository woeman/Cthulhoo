#!/usr/bin/env node
// Checks every question-bank file in data/ and the copy in data/theme.json.
//
//   node scripts/validate-content.mjs          errors and warnings
//   node scripts/validate-content.mjs --stats  plus answers per tier, per prompt
//
// It also checks riddles for The Whispering Deep: any file with a "riddles"
// list, such as data/riddles.json.
//
// Exits with code 1 if anything is an error. See docs/content.md for the rules.

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compilePrompt, fold, keysOf, matchAnswer, normalize } from "./lib/matcher.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(root, "data");
const lexiconDir = join(root, "scripts", "lexicons");
const showStats = process.argv.includes("--stats");

const errors = [];
const warnings = [];
const error = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const PROMPT_FIELDS = new Set(["id", "text", "category", "flavor", "rules", "exact", "answers", "traps", "decoys"]);
// Class packs may also label a prompt (see packs/README.md).
const PACK_PROMPT_FIELDS = new Set(["section", "asOf", "source"]);
const ANSWER_FIELDS = new Set(["answer", "aliases", "tier", "lore", "openSecret"]);
const TRAP_FIELDS = new Set(["answer", "aliases", "reason"]);
const RIDDLE_FIELDS = new Set(["id", "verse", "answers", "hints", "traps", "page", "exact"]);
const RIDDLE_ANSWER_FIELDS = new Set(["answer", "aliases"]);
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DAILY_ID = 60;

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    error(path.replace(root + "/", ""), `cannot parse JSON (${e.message})`);
    return null;
  }
}

const isText = (v) => typeof v === "string" && v.trim().length > 0;
const isTextList = (v) => Array.isArray(v) && v.every(isText);

// ---------------------------------------------------------------- theme ----

function checkRanges(where, list, label) {
  let expected = 0;
  for (const item of list) {
    if (!Number.isInteger(item.from) || !Number.isInteger(item.to) || item.to <= item.from) {
      error(where, `${label} "${item.name}" needs whole-number from < to`);
      return;
    }
    if (item.from !== expected) {
      error(where, `${label} "${item.name}" starts at ${item.from}, expected ${expected} (gap or overlap)`);
    }
    expected = item.to;
  }
  if (expected !== 7001) error(where, `${label}s must end at 7001 so 7,000 m is covered, ended at ${expected}`);
}

function checkTheme(theme) {
  const where = "data/theme.json";
  if (!theme) return null;
  const tiers = theme.tiers ?? [];
  if (tiers.length !== 6) error(where, `expected 6 tiers, found ${tiers.length}`);
  tiers.forEach((t, i) => {
    if (t.tier !== i + 1) error(where, `tier at position ${i} should be tier ${i + 1}`);
    if (!isText(t.name) || !isText(t.emoji) || !isText(t.key)) error(where, `tier ${t.tier} needs key, name and emoji`);
    if (!Number.isInteger(t.depth)) error(where, `tier ${t.tier} needs a whole-number depth`);
    if (i > 0 && t.depth <= tiers[i - 1].depth) error(where, `tier ${t.tier} must be deeper than tier ${i}`);
    if (!isTextList(t.lines) || t.lines.length < 2) error(where, `tier ${t.tier} needs at least 2 lines`);
  });
  const top = tiers[5]?.depth ?? 0;
  if (theme.maxDepth !== top * theme.promptsPerDay) {
    error(where, `maxDepth ${theme.maxDepth} should be promptsPerDay x tier-6 depth (${top * theme.promptsPerDay})`);
  }
  const os = theme.openSecret;
  if (!os || !isText(os.name) || !isText(os.emoji) || !isTextList(os.lines)) error(where, "openSecret needs name, emoji and lines");
  for (const kind of ["unknown", "decoy", "ambiguous", "timeout"]) {
    if (!isTextList(theme.refused?.lines?.[kind]) || theme.refused.lines[kind].length === 0) {
      error(where, `refused.lines.${kind} needs at least one line`);
    }
  }
  const zones = theme.zones ?? [];
  checkRanges(where, zones, "zone");
  const zoneByKey = new Map(zones.map((z) => [z.key, z]));
  const landmarks = theme.landmarks ?? [];
  checkRanges(where, landmarks, "landmark");
  for (const lm of landmarks) {
    const zone = zoneByKey.get(lm.zone);
    if (!zone) error(where, `landmark "${lm.name}" names unknown zone "${lm.zone}"`);
    else if (lm.from < zone.from || lm.to > zone.to) error(where, `landmark "${lm.name}" spills outside zone "${lm.zone}"`);
    if (!isTextList(lm.lines) || lm.lines.length === 0) error(where, `landmark "${lm.name}" needs lines`);
  }
  for (const [key, c] of Object.entries(theme.categories ?? {})) {
    if (!isText(c.name) || !isText(c.title)) error(where, `category "${key}" needs name and title`);
  }
  for (const token of ["{day}", "{depth}", "{emoji}"]) {
    if (!theme.share?.template?.includes(token)) error(where, `share.template is missing ${token}`);
  }
  return theme;
}

// -------------------------------------------------------------- lexicons ---

function loadLexicons() {
  let files = [];
  try {
    files = readdirSync(lexiconDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  return files
    .map((f) => ({ file: f, data: readJson(join(lexiconDir, f)) }))
    .filter((l) => l.data)
    .map((l) => ({ name: l.data.name ?? l.file, guards: new Set(l.data.guards ?? []), entries: l.data.entries ?? [] }));
}

// --------------------------------------------------------------- prompts ---

function checkPrompt(prompt, where, theme, seenIds, lexicons) {
  const label = `${where} › ${prompt?.id ?? "(no id)"}`;
  if (!prompt || typeof prompt !== "object") {
    error(where, "prompt is not an object");
    return null;
  }
  for (const field of Object.keys(prompt)) {
    if (!PROMPT_FIELDS.has(field) && !(where.startsWith("packs/") && PACK_PROMPT_FIELDS.has(field))) warn(label, `unknown field "${field}"`);
  }
  if (!isText(prompt.id) || !ID_PATTERN.test(prompt.id)) error(label, "id must be kebab-case, e.g. landlocked-countries");
  else if (seenIds.has(prompt.id)) error(label, `id also used in ${seenIds.get(prompt.id)}`);
  else seenIds.set(prompt.id, where);
  // A daily question is published as bank/<id>.json (build/daily-bank.mjs), so its id is a file's name.
  if (isText(prompt.id) && where.startsWith("data/") && prompt.id.length > MAX_DAILY_ID) error(label, `id is over ${MAX_DAILY_ID} characters, and a daily question's id is also the name of its published file`);

  if (!isText(prompt.text)) error(label, "text is required");
  else {
    if (!/^(Name|Give)\b/.test(prompt.text)) warn(label, 'text should start with "Name" or "Give"');
    if (!/[.?]$/.test(prompt.text)) warn(label, "text should end with a full stop or question mark");
  }
  if (!theme?.categories?.[prompt.category]) error(label, `category "${prompt.category}" is not in theme.json`);
  const fileCategory = where.replace(/^data\//, "").replace(/\.json$/, "");
  if (theme?.categories?.[fileCategory] && prompt.category !== fileCategory) {
    warn(label, `category "${prompt.category}" differs from its file (${fileCategory}.json)`);
  }
  if (prompt.flavor !== undefined && !isText(prompt.flavor)) error(label, "flavor must be text");
  if (isText(prompt.flavor) && prompt.flavor.length > 110) warn(label, `flavor is long (${prompt.flavor.length} chars)`);
  if (prompt.rules !== undefined && !isText(prompt.rules)) error(label, "rules must be text");
  if (prompt.exact !== undefined && prompt.exact !== true) error(label, "exact should be true or left out");

  const answers = Array.isArray(prompt.answers) ? prompt.answers : [];
  if (answers.length === 0) error(label, "needs at least one answer");
  const tierCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const a of answers) {
    const al = `${label} › ${a?.answer ?? "?"}`;
    for (const field of Object.keys(a ?? {})) {
      if (!ANSWER_FIELDS.has(field)) warn(al, `unknown field "${field}"`);
    }
    if (!isText(a?.answer)) error(al, "answer text is required");
    if (!Number.isInteger(a?.tier) || a.tier < 1 || a.tier > 6) error(al, "tier must be a whole number 1 to 6");
    else tierCounts[a.tier]++;
    if (a?.aliases !== undefined && !isTextList(a.aliases)) error(al, "aliases must be a list of text");
    if (a?.lore !== undefined && !isText(a.lore)) error(al, "lore must be text");
    if (isText(a?.lore) && a.lore.length > 170) warn(al, `lore is long (${a.lore.length} chars)`);
    if (a?.openSecret !== undefined && a.openSecret !== true) error(al, "openSecret should be true or left out");
    if (a?.openSecret && a.tier > 2) warn(al, "an open secret is a common answer, so tier 1 or 2 is expected");
  }
  const traps = Array.isArray(prompt.traps) ? prompt.traps : [];
  if (prompt.traps !== undefined && !Array.isArray(prompt.traps)) error(label, "traps must be a list");
  for (const t of traps) {
    const tl = `${label} › trap ${t?.answer ?? "?"}`;
    for (const field of Object.keys(t ?? {})) {
      if (!TRAP_FIELDS.has(field)) warn(tl, `unknown field "${field}"`);
    }
    if (!isText(t?.answer) || !isText(t?.reason)) error(tl, "a trap needs answer and reason");
    if (t?.aliases !== undefined && !isTextList(t.aliases)) error(tl, "aliases must be a list of text");
  }
  if (prompt.decoys !== undefined && !isTextList(prompt.decoys)) error(label, "decoys must be a list of text");

  // Every spelling must belong to exactly one thing. A spelling is known by
  // its plain key and, unless the prompt is exact, its folded key too (see
  // fold() in the matcher), so both are claimed.
  const exactMode = prompt.exact === true;
  const owners = new Map();
  const claim = (form, owner, kind) => {
    const keys = keysOf(form, exactMode);
    if (keys.length === 0) {
      error(label, `"${form}" normalises to nothing`);
      return;
    }
    keys.forEach((key, i) => {
      const folded = i > 0;
      const prev = owners.get(key);
      const shown = folded ? `"${form}" (folded to "${key}")` : `"${form}"`;
      if (!prev) owners.set(key, { owner, kind, form, folded });
      else if (prev.owner === owner) {
        // Folding often lands on a spelling the same answer already lists.
        if (!folded && !prev.folded) warn(label, `"${form}" repeats "${prev.form}" (same key "${key}")`);
      } else if (prev.kind === "answer" && kind === "answer") error(label, `${shown} (${owner}) collides with "${prev.form}" (${prev.owner})`);
      else if (prev.kind === "answer" || kind === "answer") error(label, `${shown} is both a valid answer and a ${prev.kind === "answer" ? kind : prev.kind} ("${prev.form}")`);
      else warn(label, `${shown} is listed as both ${prev.kind} and ${kind} ("${prev.form}")`);
    });
  };
  // Owners are numbered, so the same answer listed twice is caught as a
  // collision (the matcher would treat the two copies as rival answers).
  const listed = (v) => (isTextList(v) ? v : []);
  answers.forEach((a, i) => {
    if (!isText(a?.answer)) return;
    const owner = `${a.answer} (answer #${i + 1})`;
    claim(a.answer, owner, "answer");
    for (const alias of listed(a.aliases)) claim(alias, owner, "answer");
  });
  traps.forEach((t, i) => {
    if (!isText(t?.answer)) return;
    const owner = `trap:${t.answer} (#${i + 1})`;
    claim(t.answer, owner, "trap");
    for (const alias of listed(t.aliases)) claim(alias, owner, "trap");
  });
  for (const d of listed(prompt.decoys)) claim(d, `decoy:${d}`, "decoy");

  const compiled = compilePrompt(prompt);

  // Each spelling must match back to its owner through the real matcher.
  for (const a of answers) {
    if (!isText(a?.answer)) continue;
    for (const form of [a.answer, ...listed(a.aliases)]) {
      const r = matchAnswer(compiled, form);
      if (r.status !== "accepted" || r.answer !== a) {
        error(label, `typing "${form}" gives ${r.status}${r.answer ? ` (${r.answer.answer})` : ""}, expected ${a.answer}`);
      }
    }
  }

  // Real-but-wrong names from the lexicons must never be typo-corrected
  // into a valid answer.
  for (const lex of lexicons) {
    if (!lex.guards.has(prompt.id)) continue;
    for (const entry of lex.entries) {
      if (keysOf(entry, exactMode).some((k) => compiled.exact.has(k))) continue;
      const r = matchAnswer(compiled, entry);
      if (r.status === "accepted") {
        error(label, `"${entry}" (${lex.name} lexicon, not a valid answer) would be typo-matched to "${r.answer.answer}"; add it to decoys or traps`);
      }
    }
  }

  // Players can retry until the clock runs out, so the copy shown on screen
  // (flavor, rules, trap reasons) must not spell out a rare answer for them.
  const rare = [];
  for (const a of answers) {
    if (!(a?.tier >= 3)) continue;
    for (const form of [a.answer, ...listed(a.aliases)]) {
      const n = normalize(form);
      if (n.replace(/ /g, "").length >= 4) rare.push({ n, f: fold(n), form, a });
    }
  }
  const giveaway = (text, what) => {
    if (!isText(text)) return;
    const hay = ` ${normalize(text)} `;
    const foldedHay = ` ${fold(normalize(text))} `;
    for (const r of rare) {
      if (hay.includes(` ${r.n} `) || (!exactMode && foldedHay.includes(` ${r.f} `))) {
        warn(label, `${what} names "${r.form}", a tier ${r.a.tier} answer; players could just type it`);
        return;
      }
    }
  };
  giveaway(prompt.flavor, "flavor");
  giveaway(prompt.rules, "rules");
  for (const t of traps) giveaway(t?.reason, `trap "${t?.answer}" reason`);

  // Tier spread.
  if (answers.length > 0) {
    if (tierCounts[1] === 0) warn(label, "no tier 1 answers (what most people say first)");
    if (tierCounts[6] === 0) warn(label, "no tier 6 answer, so 1,000 m is out of reach on this prompt");
    const cap = Math.max(3, Math.ceil(answers.length * 0.05));
    if (tierCounts[6] > cap) warn(label, `${tierCounts[6]} tier 6 answers; keep the jackpot rare (at most ${cap})`);
  }
  return { id: prompt.id, category: prompt.category, total: answers.length, tierCounts, traps: traps.length, decoys: (prompt.decoys ?? []).length };
}

// ------------------------------------------------------------------ main ---

const theme = checkTheme(readJson(join(dataDir, "theme.json")));
const lexicons = loadLexicons();
const seenIds = new Map();
const riddleIds = new Map();
const riddleDays = [];
const promptDays = [];
const PROMPTS_PER_DAY = 7; // as in src/game/daily.ts
const rows = [];
let riddleCount = 0;
const files = readdirSync(dataDir).filter((f) => f.endsWith(".json") && f !== "theme.json").sort().map((f) => `data/${f}`);
// Class packs (packs/<topic>.json, built by scripts/build-packs.mjs) hold
// prompts in the same format and are checked the same way. They are never
// part of the daily dive.
const packsDir = join(root, "packs");
let packFiles = [];
try {
  packFiles = readdirSync(packsDir).filter((f) => f.endsWith(".json") && f !== "index.json").sort().map((f) => `packs/${f}`);
} catch {
  // no packs yet
}

const packsSeen = [];
const dailyById = new Map();
for (const where of [...files, ...packFiles]) {
  const isPack = where.startsWith("packs/");
  const data = readJson(join(root, where));
  if (!data) continue;
  if (isPack) {
    packsSeen.push({ where, pack: data.pack, prompts: data.prompts ?? [] });
    const id = where.replace(/^packs\//, "").replace(/\.json$/, "");
    if (data.pack?.id !== id || !isText(data.pack?.name)) error(where, `"pack" needs id "${id}" and a name`);
    for (const p of data.prompts ?? []) {
      if (isText(p?.id) && !p.id.startsWith(`${id}-`)) error(where, `prompt id "${p.id}" must start with "${id}-"`);
      // A daily question reused under a pack id must accept all the daily one does.
      const live = isText(p?.id) ? dailyById.get(p.id.slice(id.length + 1)) : undefined;
      if (live) {
        const same = (k) => JSON.stringify(p[k] ?? null) === JSON.stringify(live[k] ?? null);
        if (!["answers", "traps", "decoys", "text", "exact"].every(same)) {
          error(`${where} › ${p.id}`, `differs from the daily question "${live.id}"; run node scripts/build-packs.mjs`);
        }
      }
    }
  } else {
    for (const p of Array.isArray(data.prompts) ? data.prompts : []) if (isText(p?.id)) dailyById.set(p.id, p);
  }
  // Fixed daily dives ({ "days": [ ... ] }) belong to the daily bank in data/, never to a pack.
  const fixedDays = !isPack && Array.isArray(data.days);
  if (!Array.isArray(data.prompts) && !Array.isArray(data.riddles) && !fixedDays) {
    error(where, isPack ? 'expected { "prompts": [ ... ] } or { "riddles": [ ... ] }' : 'expected { "prompts": [ ... ] }, { "riddles": [ ... ] } or { "days": [ ... ] }');
    continue;
  }
  for (const key of Object.keys(data)) {
    if (!["prompts", "riddles", "days"].includes(key) && !(isPack && key === "pack")) warn(where, `unknown top-level field "${key}"`);
  }
  for (const prompt of data.prompts ?? []) {
    const row = checkPrompt(prompt, where, theme, seenIds, lexicons);
    if (row) rows.push(row);
  }
  for (const riddle of data.riddles ?? []) {
    if (checkRiddle(riddle, where, riddleIds)) riddleCount++;
  }
  if (Array.isArray(data.riddles) && data.days !== undefined) riddleDays.push({ where, days: data.days });
  else if (data.days !== undefined && !isPack) promptDays.push({ where, days: data.days });
}

// Fixed daily dives (written by scripts/freeze-days.mjs) must name real prompts, at most a day's
// worth and each once, and each date may be fixed only once across the bank.
const promptDates = new Map();
for (const { where, days } of promptDays) {
  if (!Array.isArray(days)) {
    error(where, "days must be a list");
    continue;
  }
  for (const d of days) {
    const date = d?.date;
    if (!isText(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) error(where, `day ${JSON.stringify(d).slice(0, 60)} needs a date like 2026-12-25`);
    else if (promptDates.has(date)) error(where, `${date} is fixed twice (also in ${promptDates.get(date)})`);
    else promptDates.set(date, where);
    if (!isTextList(d?.prompts) || d.prompts.length === 0) {
      error(where, `day ${date} needs a list of prompt ids`);
      continue;
    }
    if (d.prompts.length > PROMPTS_PER_DAY) error(where, `day ${date} lists ${d.prompts.length} prompts; a day holds ${PROMPTS_PER_DAY}`);
    if (new Set(d.prompts).size !== d.prompts.length) error(where, `day ${date} lists a prompt twice`);
    for (const id of d.prompts) {
      // A day holds daily prompts only: a class pack's prompt is known to this script but not to the daily dive.
      if (!seenIds.has(id)) error(where, `day ${date} names unknown prompt "${id}"`);
      else if (!seenIds.get(id).startsWith("data/")) error(where, `day ${date} names "${id}", which is a class pack's prompt (${seenIds.get(id)}), not a daily one`);
    }
  }
}

// packs/index.json is what the game's topic tick-boxes read, so it must agree
// with the pack files. node scripts/build-packs.mjs rewrites it.
if (packsSeen.length > 0) {
  const where = "packs/index.json";
  const index = readJson(join(packsDir, "index.json"));
  const listed = new Map((index?.packs ?? []).map((p) => [p.id, p]));
  if (listed.size !== packsSeen.length) error(where, `lists ${listed.size} packs, found ${packsSeen.length} pack files; run node scripts/build-packs.mjs`);
  for (const { where: file, pack, prompts } of packsSeen) {
    const row = listed.get(pack?.id);
    const answers = prompts.reduce((n, p) => n + (Array.isArray(p?.answers) ? p.answers.length : 0), 0);
    if (!row) error(where, `${file} is missing; run node scripts/build-packs.mjs`);
    else if (row.file !== file.replace("packs/", "") || row.prompts !== prompts.length || row.answers !== answers || row.name !== pack.name || row.blurb !== pack.blurb || row.group !== pack.group || row.order !== pack.order || row.asOf !== pack.asOf) {
      error(where, `out of date for ${file}; run node scripts/build-packs.mjs`);
    }
    if (isText(pack?.name) && pack.name.length > 18) error(file, `pack name "${pack.name}" is over 18 characters`);
    if (!isText(pack?.group)) error(file, "pack needs a group, such as Business or Science");
    for (const p of prompts) {
      if (isText(p?.section) && p.section.length > 30) error(file, `${p.id}: section is over 30 characters`);
      const size = JSON.stringify(p).length;
      if (size > 400_000) warn(file, `${p.id} is ${Math.round(size / 1000)} KB of JSON (the game expects 400 KB at most)`);
      if ((p?.answers ?? []).length < 15) warn(file, `${p.id} has under 15 answers, too few for blitz and last diver standing`);
    }
  }
}

// Fixed riddle dates must name real riddles, once per date.
for (const { where, days } of riddleDays) {
  if (!Array.isArray(days)) {
    error(where, "days must be a list");
    continue;
  }
  const dates = new Set();
  for (const d of days) {
    if (!isText(d?.date) || !/^\d{4}-\d{2}-\d{2}$/.test(d.date)) error(where, `day ${JSON.stringify(d)} needs a date like 2026-12-25`);
    else if (dates.has(d.date)) error(where, `${d.date} is listed twice`);
    else dates.add(d.date);
    if (!riddleIds.has(d?.riddle)) error(where, `day ${d?.date} names unknown riddle "${d?.riddle}"`);
  }
}

const totalAnswers = rows.reduce((n, r) => n + r.total, 0);
const byCategory = {};
for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

if (showStats) {
  console.log("prompt".padEnd(30), "answers", "  t1  t2  t3  t4  t5  t6", " traps decoys");
  for (const r of rows) {
    const tiers = r.tierCounts.slice(1).map((n) => String(n).padStart(4)).join("");
    console.log(r.id.padEnd(30), String(r.total).padStart(7), tiers, String(r.traps).padStart(6), String(r.decoys).padStart(6));
  }
  console.log("");
}

console.log(`${rows.length} prompts, ${totalAnswers} answers, ${Object.keys(byCategory).length} categories`);
console.log(Object.entries(byCategory).map(([c, n]) => `${c} ${n}`).join(", "));
if (riddleCount > 0) console.log(`${riddleCount} riddles`);
for (const w of warnings) console.log(`warning  ${w}`);
for (const e of errors) console.log(`ERROR    ${e}`);
console.log(`${errors.length} errors, ${warnings.length} warnings`);
process.exit(errors.length > 0 ? 1 : 0);


// --------------------------------------------------------------- riddles ---

/** Words of a text, normalised, for spotting an answer hidden in plain sight. */
function wordsOf(text) {
  return normalize(text).split(" ").filter(Boolean);
}

function checkRiddle(riddle, where, seen) {
  const label = `${where} › riddle ${riddle?.id ?? "(no id)"}`;
  if (!riddle || typeof riddle !== "object" || Array.isArray(riddle)) {
    error(where, "riddle is not an object");
    return false;
  }
  for (const field of Object.keys(riddle)) {
    if (!RIDDLE_FIELDS.has(field)) warn(label, `unknown field "${field}"`);
  }
  if (!isText(riddle.id) || !ID_PATTERN.test(riddle.id)) error(label, "id must be kebab-case, e.g. the-drowned-bell");
  else if (seen.has(riddle.id)) error(label, `id also used in ${seen.get(riddle.id)}`);
  else seen.set(riddle.id, where);

  if (!isTextList(riddle.verse) || riddle.verse.length < 2 || riddle.verse.length > 6) error(label, "verse needs 2 to 6 lines of text");
  else for (const line of riddle.verse) if (line.length > 60) warn(label, `verse line is long (${line.length} chars): "${line}"`);
  if (!isTextList(riddle.hints) || riddle.hints.length !== 3) error(label, "needs exactly 3 hints");
  else for (const h of riddle.hints) if (h.length > 120) warn(label, `hint is long (${h.length} chars): "${h}"`);
  if (riddle.exact !== undefined && riddle.exact !== true) error(label, "exact should be true or left out");

  const answers = Array.isArray(riddle.answers) ? riddle.answers : [];
  if (answers.length === 0) error(label, "needs at least one answer");
  answers.forEach((a, i) => {
    const al = `${label} › answer #${i + 1}`;
    for (const field of Object.keys(a ?? {})) if (!RIDDLE_ANSWER_FIELDS.has(field)) warn(al, `unknown field "${field}"`);
    if (!isText(a?.answer)) error(al, "answer text is required");
    if (a?.aliases !== undefined && !isTextList(a.aliases)) error(al, "aliases must be a list of text");
  });
  const traps = Array.isArray(riddle.traps) ? riddle.traps : [];
  if (riddle.traps !== undefined && !Array.isArray(riddle.traps)) error(label, "traps must be a list");
  traps.forEach((t, i) => {
    const tl = `${label} › trap #${i + 1}`;
    for (const field of Object.keys(t ?? {})) if (!TRAP_FIELDS.has(field)) warn(tl, `unknown field "${field}"`);
    if (!isText(t?.answer) || !isText(t?.reason)) error(tl, "a trap needs answer and reason");
    if (t?.aliases !== undefined && !isTextList(t.aliases)) error(tl, "aliases must be a list of text");
  });

  if (!isText(riddle.page?.title) || !isText(riddle.page?.text)) error(label, "page needs title and text");
  else {
    const n = riddle.page.text.trim().split(/\s+/).length;
    if (n < 60 || n > 120) warn(label, `page text is ${n} words; aim for 60 to 120`);
  }

  // A riddle is judged like a prompt whose answers are all equally right.
  const exactMode = riddle.exact === true;
  const asPrompt = {
    id: riddle.id,
    exact: riddle.exact,
    answers: answers.filter((a) => isText(a?.answer)).map((a) => ({ ...a, tier: 1 })),
    traps: traps.filter((t) => isText(t?.answer)),
  };
  const owners = new Map();
  const claim = (form, owner, kind) => {
    const keys = keysOf(form, exactMode);
    if (keys.length === 0) error(label, `"${form}" normalises to nothing`);
    for (const key of keys) {
      const prev = owners.get(key);
      if (!prev) owners.set(key, { owner, kind, form });
      else if (prev.owner !== owner && (prev.kind === "trap") !== (kind === "trap")) {
        error(label, `"${form}" is both an answer and a trap ("${prev.form}")`);
      }
    }
  };
  asPrompt.answers.forEach((a, i) => [a.answer, ...(isTextList(a.aliases) ? a.aliases : [])].forEach((f) => claim(f, `answer ${i}`, "answer")));
  asPrompt.traps.forEach((t, i) => [t.answer, ...(isTextList(t.aliases) ? t.aliases : [])].forEach((f) => claim(f, `trap ${i}`, "trap")));

  const compiled = compilePrompt(asPrompt);
  for (const a of asPrompt.answers) {
    for (const form of [a.answer, ...(isTextList(a.aliases) ? a.aliases : [])]) {
      const r = matchAnswer(compiled, form);
      if (r.status !== "accepted") error(label, `typing "${form}" gives ${r.status}, expected an accepted answer`);
    }
  }

  // The verse and hints must not say the answer, or its plural.
  const forms = [];
  for (const a of asPrompt.answers) {
    for (const form of [a.answer, ...(isTextList(a.aliases) ? a.aliases : [])]) {
      const w = wordsOf(form);
      if (w.join("").length >= 3) forms.push({ form, words: w });
    }
  }
  const says = (text) => {
    const hay = wordsOf(text);
    for (const { form, words } of forms) {
      for (let i = 0; i + words.length <= hay.length; i++) {
        const span = hay.slice(i, i + words.length);
        const last = span[span.length - 1];
        const head = span.slice(0, -1).join(" ");
        const want = words.slice(0, -1).join(" ");
        const stem = words[words.length - 1];
        if (head === want && [stem, `${stem}s`, `${stem}es`, stem.replace(/y$/, "ies")].includes(last)) return form;
      }
    }
    return null;
  };
  for (const line of isTextList(riddle.verse) ? riddle.verse : []) {
    const hit = says(line);
    if (hit) warn(label, `the verse says "${hit}": "${line}"`);
  }
  for (const h of isTextList(riddle.hints) ? riddle.hints : []) {
    const hit = says(h);
    if (hit) warn(label, `a hint says "${hit}": "${h}"`);
  }
  for (const t of traps) {
    const hit = isText(t?.reason) ? says(t.reason) : null;
    if (hit) warn(label, `trap "${t.answer}" reason says "${hit}"`);
  }
  return true;
}
