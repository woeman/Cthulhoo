// Reference answer matcher for Cthulhoo's question bank.
//
// The game has its own matcher; this file is the reference the validator uses
// to prove the bank is safe to typo-match. The rules are written up in
// docs/content.md ("Matching answers"). Zero dependencies, runs in Node or a
// browser.

const APOSTROPHES = /['‘’ʻʼ`´]/g;
const SPECIAL_LETTERS = {
  "ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "ł": "l",
  "đ": "d", "ð": "d", "þ": "th", "ı": "i",
};

/** Lower-case, strip accents and apostrophes, spell out "&", "+" and "#"
 * (so C, C++ and C# stay different), turn other punctuation into spaces, and
 * drop a leading "the", "a" or "an". */
export function normalize(input) {
  let s = String(input ?? "").toLowerCase();
  s = s.replace(/[ßæœøłđðþı]/g, (c) => SPECIAL_LETTERS[c]);
  s = s.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  s = s.replace(APOSTROPHES, "");
  s = s.replace(/&/g, " and ").replace(/\+/g, " plus ").replace(/#/g, " sharp ");
  s = s.replace(/[^a-z0-9]+/g, " ").trim();
  s = s.replace(/^(the|a|an) (?=\S)/, "");
  return s;
}

/** The comparison key: the normalised form with spaces removed, so
 * "New Zealand" and "Newzealand" are the same answer. */
export function toKey(input) {
  return normalize(input).replace(/ /g, "");
}

// ---------------------------------------------------------------- folding
// Folding gives every spelling a second, more forgiving key, so that
// "St Lucia" meets "Saint Lucia", "Henry 8" and "Henry the Eighth" meet
// "Henry VIII", and "Nineteen Eighty-Four" meets "1984". It only ever adds
// matches: the plain key is always kept, so typo tolerance on spelled-out
// numbers is not lost. Prompts marked "exact" never fold.

const ABBREVIATIONS = new Map([["st", "saint"], ["mt", "mount"], ["ft", "fort"], ["dr", "doctor"]]);
const SMALL_NUMBERS = new Map(Object.entries({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
}));
const TENS = new Map(Object.entries({
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}));
const SCALES = new Map(Object.entries({ hundred: 100, thousand: 1000, million: 1000000 }));
const ORDINALS = new Map(Object.entries({
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9,
  tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13, fourteenth: 14, fifteenth: 15, sixteenth: 16,
  seventeenth: 17, eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
  // Common misspellings, so "Henry the Eigth" still meets Henry VIII.
  eigth: 8, nineth: 9, twelth: 12, twelveth: 12, forth: 4,
}));
const ROMAN = new Map();
for (let n = 1; n <= 39; n++) {
  const ones = ["", "i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix"][n % 10];
  ROMAN.set("x".repeat(Math.floor(n / 10)) + ones, n);
}

/** The number an ordinal word names, as [value, words used], or null:
 * "eighth" or "twenty third". */
function ordinalWordAt(words, i) {
  const w = words[i];
  if (w === undefined) return null;
  if (ORDINALS.has(w)) return [ORDINALS.get(w), 1];
  if (TENS.has(w) && (ORDINALS.get(words[i + 1]) ?? 10) < 10) return [TENS.get(w) + ORDINALS.get(words[i + 1]), 2];
  return null;
}

/** The number a regnal ordinal names, as [value, words used], or null:
 * "eighth", "twenty third", "8" or "viii". */
function ordinalAt(words, i) {
  const w = words[i];
  if (w === undefined) return null;
  const word = ordinalWordAt(words, i);
  if (word) return word;
  if (/^\d+$/.test(w)) return [Number(w), 1];
  if (ROMAN.has(w)) return [ROMAN.get(w), 1];
  return null;
}

/** Turn runs of number words into digits: "nineteen eighty four" -> "19 84",
 * "one hundred and one" -> "101", "two thousand and six" -> "2006". */
function foldNumberWords(words) {
  const out = [];
  let i = 0;
  while (i < words.length) {
    const isNumber = (w) => SMALL_NUMBERS.has(w) || TENS.has(w) || SCALES.has(w);
    if (!isNumber(words[i])) {
      out.push(words[i++]);
      continue;
    }
    let total = 0;
    let current = 0;
    let last = null; // "small", "tens" or "scale"
    const emit = () => {
      out.push(String(total + current));
      total = 0;
      current = 0;
      last = null;
    };
    while (i < words.length) {
      const w = words[i];
      const next = words[i + 1];
      if (w === "and" && last === "scale" && (SMALL_NUMBERS.has(next) || TENS.has(next))) {
        i++;
        continue;
      }
      if (SMALL_NUMBERS.has(w)) {
        const v = SMALL_NUMBERS.get(w);
        if (last === "small" || (last === "tens" && v >= 10)) emit();
        current += v;
        last = "small";
      } else if (TENS.has(w)) {
        if (last === "small" || last === "tens") emit();
        current += TENS.get(w);
        last = "tens";
      } else if (SCALES.has(w)) {
        const scale = SCALES.get(w);
        if (scale === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * scale;
          current = 0;
        }
        last = "scale";
      } else break;
      i++;
    }
    emit();
  }
  return out;
}

/** The folded form of an already normalised string:
 *  - "st", "mt", "ft", "dr" before another word become saint, mount, fort, doctor;
 *  - "8th" becomes "8";
 *  - "twenty third" becomes "23" anywhere;
 *  - after the first word, "the eighth", "the 8" and "the viii" become "8",
 *    and so do a bare "eighth" and a Roman numeral from i to xxxix;
 *  - runs of number words become digits. */
export function fold(normalized) {
  let words = normalized.split(" ").filter(Boolean);
  words = words.map((w, i) => {
    if (ABBREVIATIONS.has(w) && i + 1 < words.length) return ABBREVIATIONS.get(w);
    return w.replace(/^(\d+)(?:st|nd|rd|th)$/, "$1");
  });
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    // "twenty third" is one ordinal wherever it stands: "21st Century" meets
    // "Twenty-first Century".
    if (TENS.has(w) && (ORDINALS.get(words[i + 1]) ?? 10) < 10) {
      out.push(String(TENS.get(w) + ORDINALS.get(words[i + 1])));
      i += 1;
      continue;
    }
    if (out.length > 0) {
      if (w === "the") {
        const ord = ordinalAt(words, i + 1);
        if (ord) {
          out.push(String(ord[0]));
          i += ord[1];
          continue;
        }
      }
      const word = ordinalWordAt(words, i);
      if (word) {
        out.push(String(word[0]));
        i += word[1] - 1;
        continue;
      }
      if (ROMAN.has(w)) {
        out.push(String(ROMAN.get(w)));
        continue;
      }
    }
    out.push(w);
  }
  return foldNumberWords(out).join(" ");
}

/** The folded comparison key. */
export function foldKey(input) {
  return fold(normalize(input)).replace(/ /g, "");
}

/** The keys a spelling is known by: its plain key, then its folded key if
 * that differs. Prompts marked "exact" use the plain key alone. */
export function keysOf(input, exact = false) {
  const plain = toKey(input);
  if (!plain || exact) return plain ? [plain] : [];
  const folded = foldKey(input);
  return folded && folded !== plain ? [plain, folded] : [plain];
}

/** True when folding reads a Roman numeral of two or more letters, or a lone
 * v or x: a word after the first, as in "Henry VIII". A lone "i" is left out,
 * because it is far more often the word I, as in "If I Fell", and a typo there
 * is just a typo. */
function readsRomanNumeral(normalized) {
  return normalized.split(" ").some((w, i) => i > 0 && w !== "i" && ROMAN.has(w));
}

/** The keys a spelling is typo-matched by. A Roman numeral is one wrong letter
 * away from another number ("Elizabeth III" and "Elizabeth II"), so a spelling
 * that has one is typo-matched by its folded key alone, where the number is in
 * digits, and digits never change (see matchAnswer). */
export function typoKeysOf(input) {
  const keys = keysOf(input);
  return keys.length > 1 && readsRomanNumeral(normalize(input)) ? keys.slice(1) : keys;
}

/** The digits in a key, in order. */
function digitsOf(key) {
  return key.replace(/[^0-9]/g, "");
}

/** How many typos to forgive, based on the shorter of the two keys. */
export function allowedEdits(length) {
  if (length <= 3) return 0;
  if (length <= 7) return 1;
  if (length <= 11) return 2;
  return 3;
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps),
 * giving up early once the distance must exceed `max`. */
export function editDistance(a, b, max = Infinity) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prevPrev = null;
  let prev = Array.from({ length: cols }, (_, j) => j);
  let prevRowMin = 0;
  for (let i = 1; i < rows; i++) {
    const cur = new Array(cols);
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prevPrev && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prevPrev[j - 2] + 1);
      }
      cur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    // A transposition can skip one row, so stop only once two rows in a row
    // are already over the limit.
    if (rowMin > max && prevRowMin > max) return max + 1;
    prevRowMin = rowMin;
    prevPrev = prev;
    prev = cur;
  }
  return prev[cols - 1];
}

/** A list field as a list of strings. A bare string counts as a list of one,
 * so a slip in the data can never explode into single letters, and a number
 * counts as its digits. */
function listOf(value) {
  const text = (v) => (typeof v === "number" && Number.isFinite(v) ? String(v) : v);
  const list = Array.isArray(value) ? value : [value];
  return list.map(text).filter((v) => typeof v === "string");
}

/** Build the lookup tables for one prompt. */
export function compilePrompt(prompt) {
  const exactMode = prompt?.exact === true;
  const entries = [];
  const add = (form, kind, ref) => {
    const typoKeys = exactMode ? [] : typoKeysOf(form);
    for (const key of keysOf(form, exactMode)) {
      entries.push({ key, form, kind, ref, typo: typoKeys.includes(key), digits: digitsOf(key) });
    }
  };
  for (const answer of objectsOf(prompt.answers)) {
    for (const form of [answer.answer, ...listOf(answer.aliases)]) add(form, "answer", answer);
  }
  for (const trap of objectsOf(prompt.traps)) {
    for (const form of [trap.answer, ...listOf(trap.aliases)]) add(form, "trap", trap);
  }
  for (const decoy of listOf(prompt.decoys)) add(decoy, "decoy", decoy);
  const exact = new Map();
  for (const entry of entries) {
    if (!exact.has(entry.key)) exact.set(entry.key, entry);
  }
  // A riddle's text is its verse, which says nothing about what kind of answer it wants.
  const generic = prompt?.category === "riddle" ? new Set() : genericWords(prompt?.text);
  return { prompt, entries, exact, generic };
}

// ---------------------------------------------------------------- second chances
// A refused input often holds a right answer among words the bank leaves out:
// a title before a name ("Sir Isaac Newton", "King Henry VIII"), the kind of
// thing the question asks for ("Cheddar cheese", "Barbie the
// Musical", "Goddess Freya"), a year ("Toy Story 1995"), or "teh" for "the".
// When the whole input has no exact match, it is tried without them, and what
// is left must match a spelling exactly (plurals and folding allowed, typos
// not: a bare name like "Galba" or "Lear" is too close to too many answers).
// This comes before typos are forgiven on the whole input, whose extra words
// would otherwise stretch the typo allowance: "Mojito cocktail" is three edits
// from the trap "Molotov cocktail". Prompts marked "exact" never get a second
// chance. The game's matcher does the same.

/** Words that can stand before a name without being part of it. */
const TITLES = new Set([
  "sir", "dame", "lord", "lady", "king", "queen", "prince", "princess", "emperor", "empress", "tsar", "czar",
  "pharaoh", "pope", "president", "general", "admiral", "captain", "dr", "doctor",
  "professor", "mr", "mrs", "ms", "miss", "mister",
]);

/** Words of a question too common to say what kind of answer it wants. */
const COMMON = new Set([
  "name", "the", "and", "any", "are", "can", "cannot", "did", "does", "for", "from", "has", "have", "had", "its",
  "isnt", "not", "one", "our", "that", "their", "there", "this", "was", "were", "what", "which", "who", "whose",
  "with", "been", "ever", "still", "famous", "something", "someone",
]);

/** Small words that may sit between an answer and the generic words after it ("Barbie the Musical"). */
const JOINERS = new Set(["the", "a", "an", "of"]);

const YEAR = /^(1\d{3}|20\d{2})$/;

/** A word's singular, roughly: enough to read "sharks" as "shark". */
function singular(w) {
  if (w.length > 4 && w.endsWith("ies")) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
  return w;
}

/** The words of a question that a player may add after an answer:
 * "Name a kind of shark." gives kind, shark. */
export function genericWords(text) {
  const out = new Set();
  for (const w of normalize(typeof text === "string" ? text : "").split(" ")) {
    if (w.length >= 3 && !COMMON.has(w) && !/\d/.test(w)) out.add(singular(w));
  }
  return out;
}

/** Where the question's own words begin at the end of an input: generic
 * words, and the joiners before them ("the" in "Barbie the Musical"). One
 * word always stays. */
function genericTailAt(w, generic) {
  let end = w.length;
  let at = w.length;
  while (end > 1) {
    const last = w[end - 1];
    if (generic.has(singular(last))) at = end - 1;
    else if (at === w.length || !JOINERS.has(last)) break;
    end--;
  }
  return at < w.length ? end : w.length;
}

/** The question's own words at the end of a normalised input, as keys,
 * plain then folded. */
function genericTails(normalized, generic) {
  const words = normalized.split(" ").filter(Boolean);
  const tail = words.slice(genericTailAt(words, generic));
  if (!tail.length) return [];
  const plain = tail.join("");
  const folded = fold(tail.join(" ")).replace(/ /g, "");
  return folded && folded !== plain ? [plain, folded] : [plain];
}

/** The reading of an input whose typos get a second chance: without the
 * question's own words, a year or "teh", never without a title. */
export function typoReading(normalized, generic) {
  let w = normalized.split(" ").filter(Boolean);
  if (w.length > 1 && w[0] === "teh") w = w.slice(1);
  if (w.length > 1 && YEAR.test(w[w.length - 1])) w = w.slice(0, -1);
  w = w.slice(0, genericTailAt(w, generic));
  const s = w.join(" ");
  return s && s !== normalized ? s : null;
}

/** Shorter readings of a refused, normalised input, in the order they are tried. */
export function secondChances(normalized, generic) {
  const words = normalized.split(" ").filter(Boolean);
  const tehless = (w) => (w.length > 1 && w[0] === "teh" ? w.slice(1) : w);
  // From the start: titles and generic words, but not one before a joiner
  // ("Sea of Japan"). One word always stays.
  const untitled = (w) => {
    let i = 0;
    while (i < w.length - 1 && (TITLES.has(w[i]) || generic.has(singular(w[i]))) && !JOINERS.has(w[i + 1])) i++;
    return w.slice(i);
  };
  const ungeneric = (w) => w.slice(0, genericTailAt(w, generic));
  const unyeared = (w) => (w.length > 1 && YEAR.test(w[w.length - 1]) ? w.slice(0, -1) : w);
  const out = [];
  const add = (w) => {
    const s = w.join(" ");
    if (s && s !== normalized && !out.includes(s)) out.push(s);
  };
  add(tehless(words));
  add(untitled(words));
  add(ungeneric(words));
  add(unyeared(words));
  add(ungeneric(unyeared(untitled(tehless(words)))));
  return out;
}

/** A list of objects (answers or traps), skipping anything malformed. */
function objectsOf(value) {
  return Array.isArray(value) ? value.filter((v) => v && typeof v === "object" && typeof v.answer === "string") : [];
}

/** Singular and plural forms to try for an exact match. */
function keyVariants(key) {
  const out = [key];
  if (key.length > 4 && key.endsWith("ies")) out.push(key.slice(0, -3) + "y");
  if (key.length > 4 && key.endsWith("es")) out.push(key.slice(0, -2));
  if (key.length > 3 && key.endsWith("s")) out.push(key.slice(0, -1));
  out.push(key + "s");
  return out;
}

function verdict(entry, distance) {
  if (entry.kind === "answer") {
    return { status: "accepted", answer: entry.ref, matched: entry.form, distance };
  }
  if (entry.kind === "trap") {
    return { status: "trap", trap: entry.ref, matched: entry.form, distance };
  }
  return { status: "decoy", matched: entry.form, distance };
}

/**
 * Match a player's input against a compiled prompt.
 * Returns { status } where status is one of:
 *   accepted  (with answer, the answer object from the bank)
 *   trap      (with trap, whose reason the game shows)
 *   decoy     (a plausible wrong answer)
 *   ambiguous (with candidates, two or more answers tied as nearest)
 *   unknown   (nothing close enough, or nothing left once folded, such as
 *             text in another alphabet)
 *   empty     (nothing typed but spaces)
 * A result found by a second chance also carries `via`, the shorter reading
 * that matched.
 */
export function matchAnswer(compiled, input) {
  const plain = toKey(input);
  if (!plain) return { status: String(input ?? "").trim() ? "unknown" : "empty" };

  // Prompts marked "exact" are about spelling itself (palindromes, rhymes,
  // words with no vowels), so only the listed spellings count: no folding,
  // no plurals and no forgiven typos.
  if (compiled.prompt.exact === true) {
    const hit = compiled.exact.get(plain);
    return hit ? verdict(hit, 0) : { status: "unknown" };
  }
  // 1. Exact match on the whole input.
  const whole = exactMatch(compiled, input);
  if (whole) return whole;

  // 2. Second chances: an exact match without the words the bank leaves out
  //    (see secondChances).
  for (const shorter of secondChances(normalize(input), compiled.generic ?? new Set())) {
    const hit = exactMatch(compiled, shorter);
    if (hit) return { ...hit, via: shorter };
  }

  // 3. Typos forgiven on the whole input.
  const typo = typoMatch(compiled, input);
  if (typo.status !== "unknown") return typo;

  // 4. Typos forgiven without the question's own words, a year or "teh"
  //    ("Mojto cocktail").
  const rest = typoReading(normalize(input), compiled.generic ?? new Set());
  if (!rest) return typo;
  const late = typoMatch(compiled, rest);
  return late.status === "unknown" ? late : { ...late, via: rest };
}

/** Exact match on the plain key, then on the folded key, each with its
 * singular/plural variants. */
function exactMatch(compiled, input) {
  for (const key of keysOf(input)) {
    for (const variant of keyVariants(key)) {
      const hit = compiled.exact.get(variant);
      if (hit) return verdict(hit, 0);
    }
  }
  return null;
}

function typoMatch(compiled, input) {
  // Typo-tolerant match. A spelling's distance is the smallest between any
  //    of the input's keys and that entry's key. Traps and decoys compete on
  //    equal terms, so a real-but-wrong answer can never be "corrected" into
  //    a valid one. A typo never changes a number: the two keys must hold the
  //    same digits in the same order, so "Apollo 12" is not a slip for
  //    "Apollo 11", and with Roman numerals typo-matched only as digits,
  //    "Elizabeth III" is not a slip for "Elizabeth II".
  //    The question's own words at the end of both keys would stretch the
  //    allowance ("Mojto cocktail" is three edits from "Molotov cocktail"),
  //    so then the rest is judged alone, by the longer of the two.
  const typoKeys = typoKeysOf(input);
  const tails = genericTails(normalize(input), compiled.generic ?? new Set());
  let best = Infinity;
  let hits = [];
  for (const entry of compiled.entries) {
    if (!entry.typo) continue;
    let d = Infinity;
    for (const key of typoKeys) {
      if (digitsOf(key) !== entry.digits) continue;
      let limit = allowedEdits(Math.min(key.length, entry.key.length));
      const tail = tails.find((t) => key.length > t.length && entry.key.length > t.length && key.endsWith(t) && entry.key.endsWith(t));
      if (tail) limit = Math.min(limit, allowedEdits(Math.max(key.length, entry.key.length) - tail.length));
      if (limit === 0) continue;
      const dk = editDistance(key, entry.key, limit);
      if (dk <= limit && dk < d) d = dk;
    }
    if (d === Infinity) continue;
    if (d < best) {
      best = d;
      hits = [entry];
    } else if (d === best) {
      hits.push(entry);
    }
  }
  if (hits.length === 0) return { status: "unknown" };

  const wrong = hits.filter((h) => h.kind !== "answer");
  if (wrong.length > 0) {
    const trap = wrong.find((h) => h.kind === "trap");
    return verdict(trap ?? wrong[0], best);
  }
  const answers = [...new Set(hits.map((h) => h.ref))];
  if (answers.length > 1) {
    return { status: "ambiguous", candidates: answers.map((a) => a.answer), distance: best };
  }
  return verdict(hits[0], best);
}
