// "The deep is wrong": a refused answer the player can dispute, on the reveal and in
// the log of the dive. Disputes are kept for the surveyors who tend the question bank.

import { addDispute, disputeKey, makeDispute } from '../game/disputes';
import { loadDisputes, saveDisputes } from '../game/storage';
import type { PromptDef } from '../game/types';
import { icon } from './art';
import { h } from './dom';
import '../styles/disputes.css';

export interface DisputeOpts {
  /** Called once an answer is disputed (or found to be accepted after all). */
  onDispute?: (input: string, kept: boolean) => void;
  /** Show the note that says where a dispute goes. */
  note?: boolean;
}

/** The refused answers of one question, each with a button to dispute it. */
export function disputeBlock(prompt: PromptDef | undefined, inputs: string[], day: number, opts: DisputeOpts = {}): HTMLElement | null {
  const seen = new Set<string>();
  const refused = inputs.filter((t) => {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (!refused.length) return null;
  const known = new Set(loadDisputes().map(disputeKey));
  const list = h('ul', { class: 'disputes' });
  for (const input of refused) {
    const li = h('li', {}, h('span', { class: 'said' }, `“${input}”`));
    if (prompt) {
      const already = known.has(disputeKey({ promptId: prompt.id, input }));
      const btn = h('button', { class: `btn ghost dispute-btn${already ? ' done' : ''}`, type: 'button', 'aria-label': `The deep is wrong to refuse ${input}` }) as HTMLButtonElement;
      const label = (done: boolean) => {
        btn.innerHTML = done ? `${icon('check')}<span>Disputed</span>` : '<span>The deep is wrong</span>';
        if (done) {
          btn.setAttribute('aria-disabled', 'true');
          btn.setAttribute('aria-label', `Disputed: ${input}`);
        }
      };
      label(already);
      btn.addEventListener('click', () => {
        if (btn.classList.contains('done')) return;
        const d = makeDispute(prompt, input, day);
        if (d) saveDisputes(addDispute(loadDisputes(), d));
        btn.classList.add('done');
        label(true);
        opts.onDispute?.(input, !!d);
      });
      li.append(btn);
    }
    list.append(li);
  }
  return h(
    'div',
    { class: 'dispute-block' },
    h('p', { class: 'dispute-k' }, refused.length === 1 ? 'The deep refused' : 'The deep refused these'),
    list,
    opts.note === false ? null : h('p', { class: 'dispute-note' }, 'Sure it was right? Say so, and the surveyors will teach the deep the answers it should know.'),
  );
}
