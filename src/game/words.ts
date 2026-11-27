// Numbers in words, the way a telegram spells them: British, with "and" after the
// hundreds and no punctuation ("three hundred and thirty three metres").

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: Array<[number, string]> = [
  [1e9, 'billion'],
  [1e6, 'million'],
  [1e3, 'thousand'],
];

const under100 = (n: number) => (n < 20 ? ONES[n] : n % 10 ? `${TENS[Math.floor(n / 10)]} ${ONES[n % 10]}` : TENS[n / 10]);

function under1000(n: number): string {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (!hundreds) return under100(rest);
  return rest ? `${ONES[hundreds]} hundred and ${under100(rest)}` : `${ONES[hundreds]} hundred`;
}

/** A whole number in words: 333 is "three hundred and thirty three", 1,050 "one thousand and fifty". */
export function numberWords(value: number): string {
  if (!Number.isFinite(value)) return '';
  let n = Math.round(Math.abs(value));
  if (n === 0) return 'zero';
  const parts: string[] = [];
  for (const [size, name] of SCALES) {
    if (n >= size) {
      parts.push(`${under1000(Math.floor(n / size) % 1000)} ${name}`);
      n %= size;
    }
  }
  if (n) parts.push(parts.length && n < 100 ? `and ${under100(n)}` : under1000(n));
  return (value < 0 ? 'minus ' : '') + parts.join(' ');
}

/** A count and its noun in words: "one day", "two days", "one metre". */
export const countWords = (n: number, noun: string): string => `${numberWords(n)} ${noun}${Math.round(Math.abs(n)) === 1 ? '' : 's'}`;

/** A multiplier in words: 1.1 is "one point one times", 2 is "two times". */
export function multiplierWords(m: number): string {
  const tenths = Math.round(m * 10);
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return `${numberWords(whole)}${frac ? ` point ${ONES[frac]}` : ''} times`;
}
