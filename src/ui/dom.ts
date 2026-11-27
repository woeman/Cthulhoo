// Tiny DOM helpers. User text is only ever set through textContent.

type Child = Node | string | number | false | null | undefined;
type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style') el.setAttribute('style', String(v));
    else if (k === 'html') el.innerHTML = String(v); // trusted, static markup only (icons)
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: Child[]): void {
  for (const c of children) {
    if (c === undefined || c === null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function fmtMetres(m: number): string {
  return Math.round(m).toLocaleString('en-GB');
}

/** Split text into word spans for the rising-from-the-deep reveal. */
export function risingWords(text: string): HTMLElement {
  const wrap = h('span');
  text.split(/(\s+)/).forEach((part, i) => {
    if (/^\s+$/.test(part)) wrap.append(part);
    else wrap.append(h('span', { class: 'w', style: `--i:${Math.floor(i / 2)}` }, part));
  });
  return wrap;
}
