// Specimen plates from the art kit (art/bestiary, docs/art/05, "The bestiary"):
// an engraving for each creature once it is sighted, and its silhouette until
// then. They load a file at a time, so a plate costs nothing until a creature
// passes the porthole or the bestiary is opened. Lines are currentColor; the
// ground and the living lights come from --beast-body, --beast-glow,
// --beast-glow-filter and --beast-pupil.

export type PlateKind = 'plate' | 'silhouette';

const FILES: Record<PlateKind, Record<string, () => Promise<string>>> = {
  plate: import.meta.glob<string>('/art/bestiary/plates/*.svg', { query: '?raw', import: 'default' }),
  silhouette: import.meta.glob<string>('/art/bestiary/silhouettes/*.svg', { query: '?raw', import: 'default' }),
};
const DIR: Record<PlateKind, string> = { plate: 'plates', silhouette: 'silhouettes' };

const ready = new Map<string, string>();
const pending = new Map<string, Promise<string | null>>();

/**
 * The plate as inline markup: decorative (the name is always written beside it),
 * with its <title> and <desc> taken out, since a silhouette's title would give
 * away the name of a creature not yet met.
 */
function clean(svg: string, kind: PlateKind): string {
  return svg
    .replace(/<title>[\s\S]*?<\/title>/g, '')
    .replace(/<desc>[\s\S]*?<\/desc>/g, '')
    .replace(/<svg\b[^>]*>/, `<svg class="beast beast--${kind}" viewBox="0 0 240 240" aria-hidden="true" focusable="false">`);
}

export function hasPlate(id: string, kind: PlateKind = 'plate'): boolean {
  return `/art/bestiary/${DIR[kind]}/${id}.svg` in FILES[kind];
}

/** Fetch a creature's plate or silhouette (once); null when the art has none for it. */
export function loadPlate(id: string, kind: PlateKind = 'plate'): Promise<string | null> {
  const key = `${kind}:${id}`;
  const have = ready.get(key);
  if (have) return Promise.resolve(have);
  let p = pending.get(key);
  if (!p) {
    const load = FILES[kind][`/art/bestiary/${DIR[kind]}/${id}.svg`];
    p = load
      ? load().then(
          (raw) => {
            const svg = clean(raw, kind);
            ready.set(key, svg);
            return svg;
          },
          () => {
            pending.delete(key); // a dropped connection may do better next time
            return null;
          },
        )
      : Promise.resolve(null);
    pending.set(key, p);
  }
  return p;
}

/**
 * Put a creature's plate into `frame`: at once if it is already loaded, else when
 * it arrives (drawn in with the ink bloom if `bloom`). `fallback` is markup for
 * a creature the art has no plate for.
 */
export function plateInto(frame: HTMLElement, id: string, kind: PlateKind, opts: { bloom?: boolean; fallback?: string } = {}): void {
  const key = `${kind}:${id}`;
  const have = ready.get(key);
  frame.dataset.plate = key;
  frame.classList.remove('bloom');
  if (have) {
    frame.innerHTML = have;
    if (opts.bloom) bloomIn(frame);
    return;
  }
  frame.replaceChildren();
  frame.dataset.loading = '';
  void loadPlate(id, kind).then((svg) => {
    if (frame.dataset.plate !== key) return; // the frame has since been given another creature
    delete frame.dataset.loading;
    if (svg) frame.innerHTML = svg;
    else if (opts.fallback) frame.innerHTML = opts.fallback;
    if (opts.bloom) bloomIn(frame);
  });
}

/** Restart the ink bloom on a frame (it may already have bloomed once). */
function bloomIn(frame: HTMLElement): void {
  frame.classList.remove('bloom');
  void frame.offsetWidth;
  frame.classList.add('bloom');
}
