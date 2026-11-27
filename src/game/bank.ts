import placeholderBank from '../content/placeholder-bank.json';
import { PROMPTS_PER_DAY } from './daily';
import { PLACEHOLDER_THEME, buildTheme } from './theme';
import type { AnswerDef, BankDay, PromptDef, ThemeCopy, TrapDef } from './types';

// Every JSON file in data/ at the repo root is read at build time. Files with a
// "prompts" or "days" array join the bank; data/theme.json supplies the copy.
// Until the question-bank thread's files are merged, the placeholders in
// src/content are used.

const dataFiles = import.meta.glob('/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export interface Bank {
  prompts: PromptDef[];
  byId: Map<string, PromptDef>;
  days: BankDay[];
  theme: ThemeCopy;
  source: 'data' | 'placeholder';
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined);

/**
 * A list of spellings. A bare string is one spelling: spread as a list it would
 * become single letters, each of them then accepted. Numbers count as text, as
 * they do in the reference matcher.
 */
const forms = (v: unknown): string[] =>
  (typeof v === 'string' ? [v] : Array.isArray(v) ? v : [])
    .map((x) => (typeof x === 'number' && Number.isFinite(x) ? String(x) : x))
    .filter((x): x is string => !!text(x));

function cleanAnswer(a: unknown): AnswerDef | null {
  if (!isObj(a) || !text(a.answer) || typeof a.tier !== 'number' || !Number.isFinite(a.tier)) return null;
  return { ...(a as unknown as AnswerDef), aliases: forms(a.aliases), lore: text(a.lore), tier: Math.max(1, Math.min(6, Math.round(a.tier))) };
}

/** Traps keep their reason; one without a reason to show is still wrong, so it is refused as a decoy. */
function cleanTraps(list: unknown): { traps: TrapDef[]; decoys: string[] } {
  const traps: TrapDef[] = [];
  const decoys: string[] = [];
  for (const t of Array.isArray(list) ? list : []) {
    if (!isObj(t) || !text(t.answer)) continue;
    const answer = t.answer as string;
    const aliases = forms(t.aliases);
    const reason = text(t.reason);
    if (reason) traps.push({ ...(t as unknown as TrapDef), answer, aliases, reason });
    else decoys.push(answer, ...aliases);
  }
  return { traps, decoys };
}

export function cleanPrompt(p: unknown): PromptDef | null {
  if (!isObj(p) || !text(p.id) || !text(p.text) || !Array.isArray(p.answers)) return null;
  const answers = p.answers.map(cleanAnswer).filter((a): a is AnswerDef => !!a);
  if (!answers.length) return null;
  const { traps, decoys } = cleanTraps(p.traps);
  return {
    id: p.id as string,
    text: p.text as string,
    category: text(p.category) ?? 'misc',
    flavor: text(p.flavor),
    rules: text(p.rules),
    answers,
    traps: Array.isArray(p.traps) ? traps : undefined,
    decoys: p.decoys !== undefined || decoys.length ? [...forms(p.decoys), ...decoys] : undefined,
  };
}

/** Prompts (first file to use an id wins) and fixed days from a list of bank files. */
export function collectBank(files: unknown[]): { prompts: PromptDef[]; days: BankDay[] } {
  const byId = new Map<string, PromptDef>();
  const days: BankDay[] = [];
  for (const f of files) {
    if (!isObj(f)) continue;
    for (const raw of Array.isArray(f.prompts) ? f.prompts : []) {
      const p = cleanPrompt(raw);
      if (p && !byId.has(p.id)) byId.set(p.id, p);
    }
    for (const d of Array.isArray(f.days) ? f.days : []) {
      if (isObj(d) && typeof d.date === 'string' && Array.isArray(d.prompts)) {
        days.push({ date: d.date, prompts: d.prompts.filter((id): id is string => typeof id === 'string') });
      }
    }
  }
  return { prompts: [...byId.values()], days };
}

/**
 * The prompts and fixed days to play from. When the data cannot fill a day,
 * the placeholders make up the numbers, listed after the data so the data's
 * own version of a prompt both share wins.
 */
export function bankFrom(files: unknown[], fallback: unknown): Pick<Bank, 'prompts' | 'days' | 'source'> {
  const data = collectBank(files);
  if (data.prompts.length >= PROMPTS_PER_DAY) return { ...data, source: 'data' };
  return { ...collectBank([...files, fallback]), source: 'placeholder' };
}

export function loadBank(): Bank {
  const entries = Object.entries(dataFiles).sort(([a], [b]) => (a < b ? -1 : 1));
  const themeRaw = entries.find(([path]) => path.endsWith('/theme.json'))?.[1];
  const files = entries.filter(([path]) => !path.endsWith('/theme.json')).map(([, v]) => v);
  const { prompts, days, source } = bankFrom(files, placeholderBank);
  const theme = themeRaw ? buildTheme(themeRaw) : PLACEHOLDER_THEME;
  return { prompts, byId: new Map(prompts.map((p) => [p.id, p])), days, theme, source };
}
