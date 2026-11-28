// The daily bank as the build hands it to the script: see build/daily-bank.mjs.
// Everything here is as written in data/, so the game checks it on the way in.
declare module 'virtual:daily-bank' {
  /** Every question without its answers: { id, text, category?, flavor?, rules?, v }. */
  export const prompts: unknown[];
  /** The fixed days found in the files. */
  export const days: unknown[];
  /** data/theme.json, or null when there is none. */
  export const theme: unknown;
  /** Every file with a "riddles" list. */
  export const riddleFiles: unknown[];
  /** Every question whole, by id, when the build could publish no files; null otherwise. */
  export const bundled: Record<string, unknown> | null;
}
