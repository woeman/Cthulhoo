// Renders the share card for a made-up dive, for tuning the card by eye.
// dev/card.html?tiers=3,6,1,0,5,2,4&omen=bell&sanity=53&practice
import '../art/css/fonts.css';
import { renderCard } from '../src/game/share';
import { PLACEHOLDER_THEME } from '../src/game/theme';
import { baseDepth } from '../src/game/scoring';
import type { DayRecord, Tier } from '../src/game/types';

const q = new URLSearchParams(location.search);
const tiers = (q.get('tiers') || '3,6,1,0,5,2,4').split(',').map((t) => Math.max(0, Math.min(6, Number(t) || 0)) as Tier);
const rec: DayRecord = {
  day: Number(q.get('day') || 1),
  date: '2026-11-27',
  omen: q.get('omen') || 'still',
  promptIds: tiers.map((_, i) => `p${i}`),
  answers: tiers.map((tier, i) => ({
    promptId: `p${i}`,
    input: tier ? 'x' : null,
    answer: tier ? 'x' : null,
    tier,
    depth: tier ? baseDepth(PLACEHOLDER_THEME, tier) : 0,
    rejects: [],
    timeMs: 9000,
  })),
  sanity: Number(q.get('sanity') || 53),
  finished: true,
  practice: q.has('practice'),
};
// ?title=… adds the diver's career line under the masthead.
const title = q.get('title');
const career = title ? { title, depth: Number(q.get('career') || 12450), lantern: Number(q.get('lantern') || 9) } : null;
renderCard(PLACEHOLDER_THEME, rec, career).then((blob) => {
  const img = document.getElementById('card') as HTMLImageElement;
  if (blob) img.src = URL.createObjectURL(blob);
  document.body.dataset.ready = blob ? 'yes' : 'failed';
});
