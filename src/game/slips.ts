import { hashString } from './daily';

// Remarks for an answer the deep took despite a spelling slip ("Chedar" for
// Cheddar). Each one shows the answer's right spelling where {answer} stands, and
// none may suggest that the answer itself was wrong: the depth is the player's in
// full. data/theme.json can give its own under "slips": { "lines": [...] }; a line
// there without {answer} is left out, so the right spelling is always shown.

export const SLIP_LINES: string[] = [
  'Spelling is a surface custom. The deep writes it {answer}.',
  'Your letters drifted in the current. The deep gathered them: {answer}.',
  'Even the Necronomicon has typos. Entered in the ledger as {answer}.',
  'A drowned scribe sighs and inks it properly: {answer}.',
  'Your hand shook. Understandable, at this depth. Recorded as {answer}.',
  'The salt got into the ink. The deep still read {answer}.',
  'Something with too many fingers has tidied that up: {answer}.',
  'Orthographically damned, factually sound: {answer}.',
  'In R’lyeh, spelling is non-Euclidean. On paper, it is {answer}.',
  'The deep reads minds, not letters. It heard {answer}.',
  'The old ones spell it {answer}. They knew what you meant.',
  'A letter slipped beneath the waves. The deep fished it out: {answer}.',
  'The pressure bends letters down here. The meaning held: {answer}.',
  'Typed in haste, heard in full. The deep writes {answer}.',
  'The cultists will amend the hymnal to read {answer}.',
  'What sleeps below cannot spell either. Filed under {answer}.',
  'The sea keeps no dictionary, only a long memory. {answer}, then.',
  'The glyphs squirmed, but the deep made out {answer}.',
  'Your keyboard may be haunted. The deep knew you meant {answer}.',
  'Spelling counts for nothing down here. {answer} counts in full.',
  'Not how the drowned spell it, but the drowned are generous: {answer}.',
  'What the hand misspells, the abyss remembers rightly: {answer}.',
  'The deep’s proofreaders have tentacles, and patience. {answer}.',
  'Mortal spelling amuses the deep. It takes {answer} all the same.',
  'Eldritch dictation, faithfully transcribed: {answer}.',
  'A typo is a small madness. The deep forgives it: {answer}.',
  'The letters rearranged themselves, as things do down here. {answer}.',
  'The deep has read worse on the walls of sunken temples. {answer}.',
  'The deep grades meaning, not spelling. Full marks for {answer}.',
];

const SLOT = '{answer}';

/** The lines that show the right spelling, or the game's own when none do. */
export function usableSlips(lines: unknown): string[] {
  const ok = Array.isArray(lines) ? lines.filter((l): l is string => typeof l === 'string' && l.includes(SLOT) && !!l.trim()) : [];
  return ok.length ? ok : SLIP_LINES;
}

export interface SlipRemark {
  /** The words before and after the answer's right spelling. */
  before: string;
  answer: string;
  after: string;
  /** The whole remark, for screen readers. */
  text: string;
}

/**
 * The remark for an answer taken despite a spelling slip, split around the
 * answer's right spelling so it can be set apart. The same keys (a question's id
 * and what was typed) always give the same line.
 */
export function slipRemark(lines: string[], answer: string, ...keys: Array<string | number>): SlipRemark {
  const pool = usableSlips(lines);
  const line = pool[hashString(keys.join('|').toLowerCase()) % pool.length];
  const at = line.indexOf(SLOT);
  const before = line.slice(0, at);
  let after = line.slice(at + SLOT.length).split(SLOT).join(answer);
  // "Recorded as Washington, D.C." needs no second full stop, nor "Oklahoma!" one at all.
  if (/[.!?…]$/.test(answer) && after.startsWith('.')) after = after.slice(1);
  return { before, answer, after, text: `${before}${answer}${after}` };
}
