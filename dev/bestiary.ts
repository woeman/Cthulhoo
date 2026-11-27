// The bestiary bench: the Sightings sheet and the reveal's sighting card, with
// the specimen plates, for tuning by eye.
//
// dev/bestiary.html?zone=midnight   the zone on <html>, as if the water stood there
//   &seen=some|all|none             which creatures have been sighted (default some)
//   &view=sheet|cards               the Sightings sheet, or a sighting card per zone
import '../art/tokens/tokens.css';
import '../art/css/fonts.css';
import '../art/css/components.css';
import '../src/styles/app.css';
import type { Sighting } from '../src/game/bestiary';
import { PLACEHOLDER_THEME } from '../src/game/theme';
import { installArt } from '../src/ui/art';
import { bestiaryBody, sightingCard } from '../src/ui/bestiary';
import { h } from '../src/ui/dom';

const q = new URLSearchParams(location.search);
document.documentElement.dataset.zone = q.get('zone') ?? 'surface';
installArt();

const theme = PLACEHOLDER_THEME;
const creatures = theme.bestiary;
const which = q.get('seen') ?? 'some';
const SOME = ['lions-mane', 'sunfish', 'barreleye', 'vampire-squid', 'black-seadevil', 'colossal-squid', 'dumbo-octopus', 'snailfish', 'shoggoth'];
const sightings: Record<string, Sighting> = {};
creatures.forEach((c, i) => {
  if (which === 'all' || (which === 'some' && SOME.includes(c.id)))
    sightings[c.id] = { id: c.id, day: 3 + i, depth: 120 + i * 290, at: 1_000_000 + i * 1000, promptId: `p${i}` };
});

const app = document.getElementById('app')!;
document.body.style.cssText = 'margin:0;min-height:100dvh;background:var(--color-ground);color:var(--color-ink);font-family:var(--font-text)';
if (q.get('view') === 'cards') {
  const wrap = h('div', { style: 'max-width:36rem;margin:0 auto;padding:16px;display:grid;gap:8px' });
  for (const id of ['sunfish', 'vampire-squid', 'black-seadevil', 'xenophyophore', 'deep-one', 'dreamer']) {
    const c = creatures.find((x) => x.id === id)!;
    wrap.append(sightingCard(c, { id, day: 12, depth: 3140, at: 0, promptId: 'p' }, 7, creatures.length));
  }
  app.append(wrap);
} else {
  const panel = h(
    'div',
    { class: 'sheet-panel', style: 'margin:0 auto;max-height:none;animation:none' },
    h('div', { class: 'sheet-head' }, h('h2', {}, 'Sightings')),
    h('div', { class: 'sheet-body', style: 'overflow:visible' }, ...bestiaryBody(theme, creatures, sightings)),
  );
  app.append(h('div', { class: 'sheet', style: 'position:static;display:block;background:none;animation:none' }, panel));
}
