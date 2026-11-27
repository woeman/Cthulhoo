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
    for (const key of keysOf(form, exactMode)) entries.push({ key, form, kind, ref });
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
  return { prompt, entries, exact };
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
  const keys = keysOf(input);

  // 1. Exact match on the plain key, then on the folded key, each with its
  //    singular/plural variants.
  for (const key of keys) {
    for (const variant of keyVariants(key)) {
      const hit = compiled.exact.get(variant);
      if (hit) return verdict(hit, 0);
    }
  }

  // 2. Typo-tolerant match. A spelling's distance is the smallest between any
  //    of the input's keys and that entry's key. Traps and decoys compete on
  //    equal terms, so a real-but-wrong answer can never be "corrected" into
  //    a valid one.
  let best = Infinity;
  let hits = [];
  for (const entry of compiled.entries) {
    let d = Infinity;
    for (const key of keys) {
      const limit = allowedEdits(Math.min(key.length, entry.key.length));
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
