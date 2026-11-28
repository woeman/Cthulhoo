// The signs a séance, a cult or a convocation is found by: a word from the deep
// and a number, like DAGON-7. Short enough to say across a room, forgiving when typed.

import { osaDistance } from '../game/matcher';

/** Plain words of four to seven letters. No two are one slip apart, so a slip can be mended. */
export const SIGN_WORDS = [
  'ABYSS', 'ALTAR', 'ANCHOR', 'ASHEN', 'BRINE', 'BUOY', 'CAIRN', 'CHANT', 'CANDLE', 'CONCH', 'CORAL',
  'DAGON', 'DREDGE', 'DROWN', 'EMBER', 'FATHOM', 'GLOOM', 'GROTTO', 'HOLLOW', 'HYDRA', 'KELP', 'KRAKEN', 'LANTERN',
  'LURE', 'MANTLE', 'MOTH', 'MURK', 'OMEN', 'ORACLE', 'OYSTER', 'PEARL', 'PYRE', 'RAVEN', 'REEF', 'RUNE',
  'SELKIE', 'SHOAL', 'SIGIL', 'SIREN', 'SKERRY', 'SPIRE', 'SQUID', 'TALLOW', 'TIDE', 'TOME', 'TRENCH', 'URCHIN', 'VESPER',
  'WHELK', 'WRACK', 'WRAITH', 'ZEPHYR',
] as const;

export type SignKind = 'seance' | 'cult' | 'class';

/**
 * Séance signs take one digit (2 to 9, so no 0 or 1 to mistake for O or I); cult
 * signs two; a convocation's three, each 2 to 9, so a whole school can hold class at once.
 */
export function makeSign(kind: SignKind, rand: () => number = Math.random): string {
  const word = SIGN_WORDS[Math.floor(rand() * SIGN_WORDS.length) % SIGN_WORDS.length];
  const digit = () => 2 + (Math.floor(rand() * 8) % 8);
  const n = kind === 'seance' ? digit() : kind === 'class' ? `${digit()}${digit()}${digit()}` : 10 + (Math.floor(rand() * 90) % 90);
  return `${word}-${n}`;
}

const numberFits = (digits: string, kind: SignKind): boolean =>
  kind === 'seance' ? /^[2-9]$/.test(digits) : kind === 'class' ? /^[2-9]{3}$/.test(digits) : digits.length === 2 && Number(digits) >= 10;

/**
 * Reads a sign however it was typed ("dagon 7", "Dagon7", "DAGON-7") and mends a
 * slip in the word ("DAGNO-7"). Returns null when it is not a sign of that kind.
 */
export function parseSign(input: string, kind: SignKind): string | null {
  const s = String(input ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  const m = /^([A-Z]{3,8})(\d{1,3})$/.exec(s);
  if (!m || !numberFits(m[2], kind)) return null;
  const n = Number(m[2]);
  let word: string | null = (SIGN_WORDS as readonly string[]).includes(m[1]) ? m[1] : null;
  if (!word) {
    let best = 2;
    let hits: string[] = [];
    for (const w of SIGN_WORDS) {
      const d = osaDistance(m[1], w, 1);
      if (d < best) {
        best = d;
        hits = [w];
      } else if (d === best) hits.push(w);
    }
    word = best <= 1 && hits.length === 1 ? hits[0] : null;
  }
  return word ? `${word}-${n}` : null;
}

/** Which kind of sign this is, however it was typed: a class's sign typed at a séance's door can be shown the way. */
export function signKind(input: string): SignKind | null {
  for (const kind of ['seance', 'cult', 'class'] as const) if (parseSign(input, kind)) return kind;
  return null;
}

/** The sign as it is spoken: "Dagon seven". */
export function signSpoken(sign: string): string {
  const [word, n] = sign.split('-');
  const ones = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
  const digits = String(n ?? '')
    .split('')
    .map((d) => ones[Number(d)] ?? d)
    .join(' ');
  return `${word.charAt(0)}${word.slice(1).toLowerCase()} ${digits}`;
}
