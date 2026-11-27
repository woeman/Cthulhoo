import placeholderBank from '../content/placeholder-bank.json';
import { PLACEHOLDER_THEME, buildTheme } from './theme';
import type { AnswerDef, BankDay, BankFile, PromptDef, ThemeCopy } from './types';

// Every JSON file in data/ at the repo root is read at build time. Files with a
// "prompts" array join the bank; data/theme.json supplies the copy. Until the
// question-bank thread's files are merged, the placeholders in src/content are used.

const dataFiles = import.meta.glob('/data/*.json', { eager: true, import: 'default' }) as Record<string, unknown>;

export interface Bank {
  prompts: PromptDef[];
  byId: Map<string, PromptDef>;
  days: BankDay[];
  theme: ThemeCopy;
  source: 'data' | 'placeholder';
}

function cleanPrompt(p: unknown): PromptDef | null {
  if (!p || typeof p !== 'object') return null;
  const q = p as Partial<PromptDef>;
  if (typeof q.id !== 'string' || typeof q.text !== 'string' || !Array.isArray(q.answers)) return null;
  const answers: AnswerDef[] = q.answers
    .filter((a): a is AnswerDef => !!a && typeof a.answer === 'string' && typeof a.tier === 'number')
    .map((a) => ({ ...a, tier: Math.max(1, Math.min(6, Math.round(a.tier))) }));
  if (!answers.length) return null;
  return {
    id: q.id,
    text: q.text,
    category: typeof q.category === 'string' ? q.category : 'misc',
    flavor: q.flavor,
    rules: q.rules,
    answers,
    traps: Array.isArray(q.traps) ? q.traps.filter((t) => t && typeof t.answer === 'string') : undefined,
    decoys: Array.isArray(q.decoys) ? q.decoys.filter((d) => typeof d === 'string') : undefined,
  };
}

function collect(files: BankFile[]): { prompts: PromptDef[]; days: BankDay[] } {
  const byId = new Map<string, PromptDef>();
  const days: BankDay[] = [];
  for (const f of files) {
    for (const raw of f.prompts ?? []) {
      const p = cleanPrompt(raw);
      if (p && !byId.has(p.id)) byId.set(p.id, p);
    }
    if (Array.isArray(f.days)) days.push(...f.days.filter((d) => d && typeof d.date === 'string' && Array.isArray(d.prompts)));
  }
  return { prompts: [...byId.values()], days };
}

export function loadBank(): Bank {
  const entries = Object.entries(dataFiles).sort(([a], [b]) => (a < b ? -1 : 1));
  const themeRaw = entries.find(([path]) => path.endsWith('/theme.json'))?.[1];
  const bankFiles = entries
    .filter(([path, v]) => !path.endsWith('/theme.json') && v && typeof v === 'object' && Array.isArray((v as BankFile).prompts))
    .map(([, v]) => v as BankFile);

  let { prompts, days } = collect(bankFiles);
  let source: Bank['source'] = 'data';
  if (prompts.length < 7) {
    ({ prompts, days } = collect([placeholderBank as BankFile, ...bankFiles]));
    source = 'placeholder';
  }
  const theme = themeRaw ? buildTheme(themeRaw) : PLACEHOLDER_THEME;
  return { prompts, byId: new Map(prompts.map((p) => [p.id, p])), days, theme, source };
}
