#!/usr/bin/env node
// Builds the class packs in packs/*.json from the plain-text sources in
// packs/src/<pack>/. See packs/README.md for the source format.
//
//   node scripts/build-packs.mjs            build every pack
//   node scripts/build-packs.mjs --quiet    without the dropped-spelling notes
//
// Then run node scripts/validate-content.mjs, which checks packs/ too.

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { keysOf } from "./lib/matcher.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = join(root, "packs", "src");
const outDir = join(root, "packs");
const quiet = process.argv.includes("--quiet");
const notes = [];
const note = (m) => notes.push(m);

// ------------------------------------------------------------ listings ----

function readCsv(path) {
  const rows = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells.map((c) => c.trim()));
  }
  return rows;
}

// Securities that are not a company's ordinary shares.
const NOT_A_COMPANY = /\b(ETF|ETN|ETNs|Fund|Trust|Units?|Warrants?|Rights?|Notes?|Debentures?|Preferred|Preference|Depositary Shares? (each )?[Rr]epresenting (a |an )?(\d+\/\d+|1\/|[Ii]nterest)|% |Portfolio|Index|Acquisition|SPAC|Merger|Bond|Treasury|Subordinated|Senior|Perpetual|Series [A-Z] |Tracking|Closed.End|Municipal|Income Shares|Term Shares|Strategy Shares|Contingent)\b/;
const KEEP_ANYWAY = /\b(Northern Trust|Truist|Trustmark|TrustCo|Trustpilot|Fundamental Global|Rights Management)\b/i;

// "Arhaus, Inc. - Class A Common Stock" -> "Arhaus, Inc."
function companyName(security) {
  let s = security.replace(/\s+/g, " ").trim();
  s = s.split(" - ")[0];
  s = s.replace(/\s*\(.*?\)\s*/g, " ");
  s = s.replace(/,? (each )?(representing|Each Representing|each representing).*$/i, "");
  const tail = /[, ]+(Class [A-Z]\d?|Series [A-Z]|Common Stock|Common Shares?|Ordinary Shares?|Ordinary Share|American Depositary Shares?|American Depository Shares?|American Depositary Receipts?|ADS|ADR|Depositary Shares?|Subordinate Voting Shares?|Voting|Non-Voting|Restricted|Limited Voting|Shares of Beneficial Interest|Shares|Stock|Capital Stock|New|Sponsored|Registered|Registry|Variable|Multiple|Subordinate|\(.*\)|No Par Value|par value.*|\$[\d.]+ [Pp]ar.*|of Beneficial Interest|Common|Ordinary|Beneficial Interest|When Issued|Each|one|Units)\.?$/i;
  s = s.trim();
  for (let i = 0; i < 12 && tail.test(s); i++) s = s.replace(tail, "").trim();
  return s.replace(/[ ,]+$/, "").trim();
}

// "Arhaus, Inc." -> "Arhaus"
function shortName(name) {
  let s = name.replace(/^The /i, "");
  const tail = /[, ]+(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|plc|PLC|N\.?V|S\.?A|S\.?E|AG|A\/S|AB|ASA|L\.?P|LLC|L\.L\.C|Holdings?|Group|Holding|& Co|and Company|Worldwide|International|Global|Enterprises|Technologies|Technology|Industries|Brands|Companies|S\.A\.B\. de C\.V|de C\.V|\(.*\))\.?$/i;
  for (let i = 0; i < 4; i++) {
    const next = s.replace(tail, "").replace(/[ ,.&]+$/, "");
    if (next === s || next.replace(/[^A-Za-z0-9]/g, "").length < 3) break;
    s = next;
  }
  return s.trim();
}

function loadListing(file) {
  const seen = new Map();
  for (const [symbol, security] of readCsv(join(srcDir, "listings", file))) {
    if (!symbol || !security || !/^[A-Z]+(\.[A-Z])?$/.test(symbol)) continue; // preferred issues, test issues
    if (NOT_A_COMPANY.test(security) && !KEEP_ANYWAY.test(security)) continue;
    const name = companyName(security);
    if (name.replace(/[^A-Za-z0-9]/g, "").length < 2) continue;
    const key = keysOf(shortName(name), false)[0];
    if (!key) continue;
    const prev = seen.get(key);
    if (prev) prev.symbols.push(symbol); // a second share class of the same company
    else seen.set(key, { name, short: shortName(name), symbols: [symbol] });
  }
  return [...seen.values()];
}

// --------------------------------------------------------------- source ----

function parseSource(path, packId) {
  const text = readFileSync(path, "utf8");
  const [head, ...rest] = text.split(/^---\s*$/m);
  const body = rest.join("---");
  const prompt = {};
  const meta = {};
  for (const line of head.split("\n")) {
    const m = line.match(/^([a-zA-Z]+):\s*(.*)$/);
    if (!m) continue;
    const [, k, v] = m;
    if (k === "exact") prompt.exact = true;
    else if (["listing", "mode", "tail", "curated"].includes(k)) meta[k] = v.trim();
    else prompt[k] = v.trim();
  }
  if (packId && !prompt.id?.startsWith(`${packId}-`)) throw new Error(`${path}: id must start with "${packId}-"`);
  prompt.category ??= "misc";
  const answers = [];
  const traps = [];
  const decoys = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([1-6]|[x!-])(\*?)\s+(.*)$/);
    if (!m) throw new Error(`${path}: cannot read line "${line}"`);
    const [, kind, star, restOfLine] = m;
    const [namesPart, extra] = restOfLine.split(/\s+::\s+/);
    const names = namesPart.split(/\s+\|\s+/).map((s) => s.trim()).filter(Boolean);
    if (kind === "-") decoys.push(...names);
    else if (kind === "x" || kind === "!") {
      if (!extra) throw new Error(`${path}: trap "${names[0]}" needs a reason after ::`);
      const t = { answer: names[0] };
      if (names.length > 1) t.aliases = names.slice(1);
      t.reason = extra.trim();
      traps.push(t);
    } else {
      const a = { answer: names[0] };
      if (names.length > 1) a.aliases = names.slice(1);
      a.tier = Number(kind);
      if (extra) a.lore = extra.trim();
      if (star) a.openSecret = true;
      answers.push(a);
    }
  }
  return { prompt, meta, answers, traps, decoys };
}

// Drops any spelling whose key something earlier already owns, so a long
// generated list can never trip the validator's duplicate check.
function settle(id, answers, traps, decoys, exact) {
  const owners = new Map();
  const forms = (x) => [x.answer, ...(x.aliases ?? [])];
  const claimAll = (list, kind) => {
    const kept = [];
    for (const item of list) {
      const mine = new Set();
      const ok = [];
      for (const form of forms(item)) {
        const keys = keysOf(form, exact);
        const clash = keys.find((k) => owners.has(k) && owners.get(k) !== item);
        const repeat = keys.length > 0 && keys[0] && mine.has(keys[0]);
        if (keys.length === 0 || clash || repeat) {
          if (clash && kind !== "tail") note(`${id}: dropped "${form}" (${item.answer}); "${owners.get(clash).answer}" has it`);
          continue;
        }
        keys.forEach((k) => { owners.set(k, item); mine.add(k); });
        ok.push(form);
      }
      if (ok.length === 0) continue;
      if (ok[0] !== item.answer && kind !== "tail") note(`${id}: "${item.answer}" is now shown as "${ok[0]}"`);
      item.answer = ok[0];
      if (ok.length > 1) item.aliases = ok.slice(1);
      else delete item.aliases;
      kept.push(item);
    }
    return kept;
  };
  // Plurals count as the same spelling in the game, so a form may not be
  // another answer's form plus "s".
  return { claimAll, owners };
}

function buildPrompt(path, packId) {
  const parsed = parseSource(path, packId);
  const { prompt, meta, traps, decoys } = parsed;
  let answers = parsed.answers;
  if (meta.curated) {
    // Reuse another prompt's hand-picked lines; this file's own lines win.
    const mine = new Map(answers.map((a) => [a.answer, a]));
    const theirs = parseSource(join(dirname(path), meta.curated), null).answers.filter((a) => !mine.has(a.answer));
    answers = [...answers, ...theirs.map((a) => ({ ...a, tier: Math.min(a.tier, 5), lore: undefined }))].sort((a, b) => a.tier - b.tier);
  }
  const exact = prompt.exact === true;
  let all = answers;
  let tail = [];
  if (meta.listing) {
    const listing = loadListing(meta.listing);
    const bySymbol = new Map();
    for (const row of listing) for (const s of row.symbols) bySymbol.set(s, row);
    const used = new Set();
    all = [];
    for (const a of answers) {
      // A curated line starts with the ticker: "1 AAPL | Apple | iPhone maker"
      // A leading "+NYSE:" or "+NASDAQ:" adds a company the snapshot lacks.
      const forced = a.answer.match(/^\+([A-Z]+):(.+)$/);
      if (forced && !meta.listing.startsWith(forced[1].toLowerCase())) continue;
      const symbol = forced ? forced[2] : a.answer;
      const names = a.aliases ?? [];
      const row = bySymbol.get(symbol) ?? (forced ? { name: names[0], short: names[0], symbols: [symbol] } : null);
      if (!row) continue; // listed on the other exchange, or gone
      used.add(row);
      if (meta.mode === "tickers") {
        all.push({ answer: symbol, aliases: row.symbols.filter((s) => s !== symbol), tier: a.tier, lore: a.lore ?? `${names[0] ?? row.short}.` });
      } else {
        const out = { answer: names[0] ?? row.short, aliases: [...names.slice(1), row.short, row.name, ...row.symbols], tier: a.tier };
        if (a.lore) out.lore = a.lore;
        all.push(out);
      }
    }
    const tailTier = Number(meta.tail ?? 5);
    for (const row of listing) {
      if (used.has(row)) continue;
      if (meta.mode === "tickers") tail.push({ answer: row.symbols[0], aliases: row.symbols.slice(1), tier: tailTier, lore: `${row.short}.` });
      else tail.push({ answer: row.short, aliases: [row.name], tier: tailTier });
    }
    for (const a of [...all, ...tail]) if (a.aliases && a.aliases.length === 0) delete a.aliases;
  }
  const s = settle(prompt.id, all, traps, decoys, exact);
  const outAnswers = s.claimAll(all, "answer");
  const outTraps = s.claimAll(traps, "trap");
  const decoyItems = s.claimAll(decoys.map((d) => ({ answer: d })), "decoy");
  const outTail = s.claimAll(tail, "tail");
  const out = { id: prompt.id, text: prompt.text, category: prompt.category };
  if (prompt.flavor) out.flavor = prompt.flavor;
  if (prompt.rules) out.rules = prompt.rules;
  if (exact) out.exact = true;
  for (const k of ["section", "asOf", "source"]) if (prompt[k]) out[k] = prompt[k];
  out.answers = [...outAnswers, ...outTail];
  if (outTraps.length) out.traps = outTraps;
  if (decoyItems.length) out.decoys = decoyItems.map((d) => d.answer);
  return out;
}

// ----------------------------------------------------------------- main ----

const index = [];
for (const packId of readdirSync(srcDir).sort()) {
  const dir = join(srcDir, packId);
  const metaPath = join(dir, "pack.json");
  if (!existsSync(metaPath)) continue;
  const pack = JSON.parse(readFileSync(metaPath, "utf8"));
  if (pack.id !== packId) throw new Error(`${metaPath}: id should be "${packId}"`);
  // A .txt file is a hand-written source. A .json file is a whole prompt
  // copied from the daily bank under a pack id, used as it stands.
  const prompts = readdirSync(dir).filter((f) => /^\d.*\.(txt|json)$/.test(f)).sort().map((f) => {
    if (f.endsWith(".txt")) return buildPrompt(join(dir, f), packId);
    const copied = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!copied.id?.startsWith(`${packId}-`)) throw new Error(`${f}: id must start with "${packId}-"`);
    return copied;
  });
  if (prompts.length === 0) continue; // a pack with no questions yet is not published
  writeFileSync(join(outDir, `${packId}.json`), JSON.stringify({ pack, prompts }) + "\n");
  const answers = prompts.reduce((n, p) => n + p.answers.length, 0);
  index.push({ ...pack, file: `${packId}.json`, prompts: prompts.length, answers });
  console.log(`${packId}: ${prompts.length} prompts, ${answers} answers`);
}
index.sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
writeFileSync(join(outDir, "index.json"), JSON.stringify({ packs: index }, null, 1) + "\n");
if (!quiet) for (const n of notes) console.log(`note  ${n}`);
