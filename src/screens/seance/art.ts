// The Séance's drawings, from the art thread's séance sprite (art/seance/,
// docs/art/06-interface.md "The Séance"): the table seen from above, twelve
// hands laid round a porthole with the twelve marks round its edge; the candle
// that is each question's clock; one hand; the porthole. The sitters' marks
// come from the Drowned Script sprite the app already installs.
//
// The symbols bring their own viewBox, so each outer <svg> is sized in CSS and,
// except the table's, given none. Everything is coloured through custom
// properties that pass into the <use>: --seance-hand-N and --seance-seat-N per
// chair, --seance-burn and --seance-lit on a candle, --seance-glass for the porthole.

import seanceSprite from '../../../art/seance/seance-sprite.svg?raw';
import { glyphId } from './model';

const HOLDER = 'cth-seance-sprite';

/** Put the séance sprite into the page once. seanceScreen() calls it; a bench may too. */
export function installSeanceArt(doc: Document = document): void {
  if (doc.getElementById(HOLDER)) return;
  const el = doc.createElement('div');
  el.id = HOLDER;
  el.hidden = true;
  el.setAttribute('aria-hidden', 'true');
  // Titles inside symbols would turn into hover tooltips; the screens name everything themselves.
  el.innerHTML = seanceSprite.replace(/<title>[\s\S]*?<\/title>/g, '');
  doc.body.prepend(el);
}

const use = (id: string, cls: string, viewBox = '') =>
  `<svg class="${cls}"${viewBox ? ` viewBox="${viewBox}"` : ''} aria-hidden="true" focusable="false"><use href="#${id}"/></svg>`;

/** The séance table, 240 × 240. */
export const tableSvg = (cls = 'sc-table-svg'): string => use('seance', cls, '0 0 240 240');

/** One candle in its chamberstick (22 × 37): it burns down as --seance-burn goes from 0 to 1. */
export const candleSvg = (cls = 'sc-cdl-svg'): string => use('seance-candle', cls);

/** One hand, fingers up, with its lace cuff (33 × 60). */
export const handSvg = (cls = 'sc-hand-svg'): string => use('seance-hand', cls);

/** A sitter's mark: their Drowned Script glyph, hanging from its waterline (20 × 32). */
export const glyphSvg = (mark: number, cls = 'sc-glyph'): string => use(glyphId(mark), cls, '0 0 20 32');
