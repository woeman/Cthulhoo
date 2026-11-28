// The topic tick-boxes: what a dive or a party is asked about. "Everything" is
// the whole daily deep, as the game always was; ticking a topic narrows it, and
// several ticked topics make a mixed session, dealt evenly between them.

import '../styles/topics.css';
import { h } from './dom';
import { DAILY_GROUP, OWN_GROUP, choiceCount, cleanChoice, topicsPhrase, type Topic } from '../game/topics';

export interface TopicPicker {
  el: HTMLElement;
  /** The ticked topic ids. Empty means everything in the daily deep. */
  choice(): string[];
  /** The topics there are, once more arrive (the class packs): what was ticked stays ticked. */
  setTopics(topics: Topic[]): void;
}

export interface TopicPickerOpts {
  topics: Topic[];
  /** The choice to start from: may name topics that have not arrived yet. */
  choice: string[];
  legend?: string;
  /** Called with the new choice after every tick. */
  onChange?(choice: string[]): void;
  /** A sound for each tick. */
  onTick?(): void;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/** The choice in a line: what will be asked, and from how many questions. */
export function choiceLine(choice: string[], topics: Topic[]): string {
  const picked = topics.filter((t) => choice.includes(t.id));
  const n = choiceCount(choice, topics);
  if (!picked.length) return `Anything in the daily deep · ${plural(n, 'question')}`;
  const names = topicsPhrase(picked.map((t) => t.name));
  return picked.length > 1 ? `${names} · ${plural(n, 'question')}, dealt evenly between them` : `${names} · ${plural(n, 'question')}`;
}

export function topicPicker(opts: TopicPickerOpts): TopicPicker {
  let topics = opts.topics;
  // What was asked for, before the class packs are known; then what is ticked.
  let wanted = [...opts.choice];
  let ticked = new Set(cleanChoice(wanted, topics));
  const uid = Math.random().toString(36).slice(2, 7);
  const groups = h('div', { class: 'tp-groups' });
  const note = h('p', { class: 'tp-note', 'aria-live': 'polite' });
  const every = h('input', { type: 'checkbox', class: 'visually-hidden', id: `tp-all-${uid}` }) as HTMLInputElement;
  const everyN = h('span', { class: 'tp-n' });
  const boxes = new Map<string, HTMLInputElement>();

  const current = () => topics.filter((t) => ticked.has(t.id)).map((t) => t.id);

  const sync = () => {
    const choice = current();
    every.checked = !choice.length;
    for (const [id, box] of boxes) box.checked = ticked.has(id);
    everyN.textContent = String(topics.filter((t) => t.group === DAILY_GROUP).reduce((n, t) => n + t.count, 0));
    note.textContent = choiceLine(choice, topics);
    for (const btn of groups.querySelectorAll<HTMLButtonElement>('.tp-group-all')) {
      const ids = topics.filter((t) => t.group === btn.dataset.group).map((t) => t.id);
      const all = ids.length > 0 && ids.every((id) => ticked.has(id));
      btn.textContent = all ? 'None' : 'All';
      btn.setAttribute('aria-label', `${all ? 'Untick' : 'Tick'} every topic under ${btn.dataset.group}`);
    }
  };

  const changed = () => {
    wanted = current();
    sync();
    opts.onTick?.();
    opts.onChange?.(wanted);
  };

  every.addEventListener('change', () => {
    // Unticking "everything" with nothing else ticked would leave nothing to ask: it stays.
    ticked = new Set();
    changed();
  });

  const draw = () => {
    groups.textContent = '';
    boxes.clear();
    const names = [...new Set(topics.map((t) => t.group))];
    for (const group of names) {
      const chips = h('div', { class: 'tp-chips' });
      for (const t of topics.filter((x) => x.group === group)) {
        const box = h('input', { type: 'checkbox', class: 'visually-hidden' }) as HTMLInputElement;
        box.addEventListener('change', () => {
          if (box.checked) ticked.add(t.id);
          else ticked.delete(t.id);
          changed();
        });
        boxes.set(t.id, box);
        chips.append(h('label', { class: 'tp-chip', title: t.blurb }, box, h('span', { class: 'tp-name' }, t.name), h('span', { class: 'tp-n', 'aria-label': `${t.count} questions` }, String(t.count))));
      }
      const all = h('button', { class: 'tp-group-all', type: 'button', 'data-group': group }, 'All') as HTMLButtonElement;
      all.addEventListener('click', () => {
        const ids = topics.filter((t) => t.group === group).map((t) => t.id);
        if (ids.every((id) => ticked.has(id))) ids.forEach((id) => ticked.delete(id));
        else ids.forEach((id) => ticked.add(id));
        changed();
      });
      groups.append(h('div', { class: 'tp-group', role: 'group', 'aria-label': group }, h('div', { class: 'tp-group-head' }, h('span', { class: 'tp-group-k' }, group === DAILY_GROUP || group === OWN_GROUP ? group : `${group} · class packs`), all), chips));
    }
    sync();
  };

  const el = h(
    'fieldset',
    { class: 'tp' },
    h('legend', { class: 'tp-k' }, opts.legend ?? 'Topics'),
    h('label', { class: 'tp-chip tp-every', for: every.id }, every, h('span', { class: 'tp-name' }, 'Everything in the daily deep'), everyN),
    groups,
    note,
  );
  draw();

  return {
    el,
    choice: current,
    setTopics(next) {
      topics = next;
      ticked = new Set(cleanChoice(wanted, topics));
      draw();
    },
  };
}
