# The question bank

This is the guide to Cthulhoo's questions: what is in the bank, how a typed
answer is judged, how deep each answer sinks you, and how to write new
questions without breaking anything. It is written for anyone adding
questions, and for the game code, which has to judge answers exactly the way
this guide describes.

**The one rule above all the others: never refuse an answer that is actually
correct.** Refusing a right answer is the most frustrating thing a game like
this can do. So the bank lists every spelling, nickname and old name we can
think of, the matcher forgives typos, and anything doubtful leans towards
"accepted".

## How a day works

Cthulhoo follows Krillion's idea. Each day everyone gets the same seven
questions ("prompts"), such as *Name a dog breed.* Each prompt has many right
answers. You have 25 seconds per prompt. A wrong guess costs nothing but time,
so you can keep trying until the clock runs out. The first right answer locks
in.

Common answers keep you near the surface. Rare ones sink you deeper:

| Tier | Name        | Depth   | Meaning                                       |
| ---- | ----------- | ------- | --------------------------------------------- |
| 1    | Commonplace | 100 m   | What most people say first.                   |
| 2    | Curious     | 250 m   | A step off the beaten shore.                  |
| 3    | Obscure     | 400 m   | Few minds wander this far.                    |
| 4    | Arcane      | 600 m   | Old knowledge, rarely spoken.                 |
| 5    | Forbidden   | 800 m   | You should not know that.                     |
| 6    | Unspeakable | 1,000 m | The rarest true answer the deep will accept.  |

Seven prompts at 1,000 m each makes 7,000 m, the Drowned City at the bottom.

Two more labels:

- **Open Secret.** A tier 1 or 2 answer that people *think* is clever but
  everyone gives (say, "Tug of war" for Olympic sports). It scores its normal
  depth; the game just teases you about it.
- **Refused.** Anything that isn't accepted. The game says why: it didn't
  recognise the answer, it's a known wrong answer (a *trap* or *decoy*, see
  below), it could mean two different answers, or time ran out.

## What's in the bank

Ten categories, which are also the topics for the Logbook's Sigils:

| Key         | Shown as     | Title in the game           | Prompts |
| ----------- | ------------ | --------------------------- | ------- |
| `geography` | Geography    | Charts of the Drowned World | 8       |
| `science`   | Science      | The Alchemist's Ledger      | 7       |
| `nature`    | Nature       | The Bestiary                | 8       |
| `culture`   | Culture      | The Library Below           | 8       |
| `history`   | History      | The Sunken Archive          | 7       |
| `myth`      | Myth         | Old Gods and Older Things   | 6       |
| `food`      | Food & Drink | The Sea-Cook's Pantry       | 8       |
| `language`  | Language     | The Lexicon of Whispers     | 8       |
| `sport`     | Sport        | The Drowned Games           | 6       |
| `misc`      | Miscellany   | Flotsam and Jetsam          | 7       |

That is 73 prompts with about 7,500 accepted answers, not counting the
thousands of extra spellings. Run `node scripts/validate-content.mjs --stats`
for the exact numbers.

The questions themselves are ordinary general knowledge. Only the
presentation is horror: the flavour lines, the trap messages and the lore.

## Where things live

| Path                                | What it is                                                        |
| ----------------------------------- | ----------------------------------------------------------------- |
| `data/<category>.json`              | The prompts, one file per category, shaped `{ "prompts": [ ... ] }` |
| `data/theme.json`                   | The words around the questions: tier names, refusals, zones, landmarks, share text |
| `data/riddles.json`                 | The riddles for The Whispering Deep (see "Riddles" below)          |
| `scripts/lib/matcher.mjs`           | The reference matcher. The game's matcher must behave the same    |
| `scripts/validate-content.mjs`      | Checks every file and explains anything wrong                     |
| `scripts/try-answer.mjs`            | Type answers at a prompt and see what the game would do           |
| `scripts/matcher-cases.json`        | Test cases both matchers must pass, run by `scripts/check-matcher.mjs` |
| `scripts/lexicons/*.json`           | Lists of real countries and cities, used to catch near-misses      |

The game reads every JSON file in `data/` when it is built, so a new category
file is picked up without any code change.

## A prompt, field by field

```json
{
  "id": "landlocked-countries",
  "text": "Name a landlocked country.",
  "category": "geography",
  "flavor": "Nations the sea has never touched. They sleep soundly. For now.",
  "rules": "Any sovereign state with no coastline on an ocean or sea. Shores on the Caspian, which is a lake, don't count.",
  "answers": [
    { "answer": "Switzerland", "aliases": ["Swiss Confederation", "Schweiz", "Suisse"], "tier": 1 },
    { "answer": "Bolivia", "tier": 1, "lore": "Lost its coast to Chile in the War of the Pacific (1879 to 1884), and still keeps a navy." }
  ],
  "traps": [
    { "answer": "Eritrea", "reason": "Eritrea took Ethiopia's coastline with it when it became independent in 1993." }
  ],
  "decoys": ["Australia", "Gambia", "Nigeria"]
}
```

**Prompt fields**

| Field      | Required | What it does |
| ---------- | -------- | ------------ |
| `id`       | yes | A unique name in lower case with dashes, like `dog-breeds`. Never change it once players have seen it: their history refers to it. |
| `text`     | yes | The question. Starts with "Name" or "Give" and ends with a full stop or question mark. |
| `category` | yes | One of the ten keys above. Must match the file it's in. |
| `flavor`   | no  | One eerie line shown with the question. 110 characters at most. |
| `rules`    | no  | One plain sentence that settles arguments: what counts and what doesn't. Shown under the question. |
| `exact`    | no  | `true` only for word-play prompts (palindromes, rhymes, words with no vowels). See "Exact prompts" below. |
| `answers`  | yes | The accepted answers. |
| `traps`    | no  | Known wrong answers, each with a reason the game shows. |
| `decoys`   | no  | Known wrong answers with no reason needed. They stop a near-miss from being typo-corrected into a right answer. |

**Answer fields**

| Field        | Required | What it does |
| ------------ | -------- | ------------ |
| `answer`     | yes | The name the game shows. |
| `aliases`    | no  | Every other way of writing it: other spellings, old names, local names, abbreviations, nicknames, surname-only forms. All score the same. |
| `tier`       | yes | 1 to 6, from the table above. |
| `lore`       | no  | A true, odd fact shown when someone gives this answer. 170 characters at most. Every tier 6 answer has one. |
| `openSecret` | no  | `true` marks a tier 1 or 2 answer as an Open Secret. |

**Trap fields**: `answer`, optional `aliases`, and `reason` (one short line the
player sees, such as "A model, not a make of car.").

A list field may also be a single string; it is read as a list of one. The
game never splits a string into letters.

## How a typed answer is judged

This is the exact recipe. `scripts/lib/matcher.mjs` is the reference; the
game's own matcher must give the same result for every input.

### 1. Tidy the input

- Lower case.
- Special letters become plain ones: ß to ss, æ to ae, œ to oe, ø to o, ł to l,
  đ and ð to d, þ to th, ı to i. Accents are removed (é to e, ü to u).
- Apostrophes are removed, so "Noah's" is "noahs".
- `&` becomes "and", `+` becomes "plus", `#` becomes "sharp", so C, C++ and C#
  stay different.
- Any other punctuation becomes a space.
- A leading "the", "a" or "an" is dropped.

The **key** is the tidied text with the spaces removed. So "New Zealand",
"new-zealand" and "NewZealand" all have the key `newzealand`.

### 2. Fold numbers and abbreviations (a second key)

Each input and each listed spelling also gets a **folded key**. It is only
ever an extra way to match; the plain key is always kept, so a typo in a
spelled-out number is still forgiven.

| Rule | Example |
| ---- | ------- |
| `st`, `mt`, `ft`, `dr` become saint, mount, fort, doctor, but only when another word follows | "St Lucia" meets "Saint Lucia", "Dr No" meets "Doctor No", while a lone "St" stays "st" |
| A number with st, nd, rd or th loses the ending | "Henry 8th" becomes "henry 8" |
| After the first word, an ordinal becomes the number, with or without "the" before it | "Henry the Eighth", "Henry Eighth", "Henry the 8th" and "Henry the VIII" all become "henry 8" |
| A tens word and an ordinal together become the number, anywhere | "Twenty-first Century" becomes "21 century", "John the Twenty-Third" becomes "john 23" |
| After the first word, a Roman numeral from i to xxxix becomes its number | "Henry VIII" becomes "henry 8", "Ramesses II" becomes "ramesses 2" |
| Number words become digits | "Nineteen Eighty-Four" becomes "19 84" (key `1984`), "one hundred and one" becomes "101", "Catch Twenty-Two" becomes "catch 22" |

Ordinals are first to twentieth and thirtieth, plus the common misspellings
"eigth", "nineth", "twelth", "twelveth" and "forth", so "Henry the Eigth"
still finds Henry VIII. The first-word limit keeps real words safe: "I, Robot",
"Second" and "Third Man" are left alone. Only Roman numerals up to xxxix
count, so words like "Mix" and "Civil" are never read as numbers. "And" is
skipped only between a scale word (hundred, thousand, million) and a
following number.

### 3. Look for an exact match

The input's keys are looked up directly, along with simple singular and plural
forms: an "s" added or removed, "es" removed, "ies" turned into "y". So
"Beagles" finds Beagle and "Cherries" finds Cherry.

### 4. Forgive typos

If nothing matched exactly, the closest spelling within the allowance wins.
Distance is counted in single-letter changes: a letter added, removed or
replaced, or two neighbouring letters swapped. The allowance depends on the
shorter of the two keys:

| Key length | Typos forgiven |
| ---------- | -------------- |
| 1 to 3 letters | none (must be exact) |
| 4 to 7 | 1 |
| 8 to 11 | 2 |
| 12 or more | 3 |

Both the plain and folded keys are tried, and the smaller distance counts.

**A typo never changes a number.** Two keys are only compared when they hold
the same digits in the same order, so "Apollo 12" is never a slip for Apollo
13, and "Fahrenheit 415" is never Fahrenheit 451. Roman numerals are only a
letter apart ("Elizabeth III" and "Elizabeth II"), so a spelling with one is
typo-matched by its folded key alone, where the numeral has become digits. A
lone "i" is the exception: in a title it is usually the word I ("If I Fell"),
so that spelling keeps its plain key too. Typos in the name are still forgiven
("Elizabth II"), and so are typos in spelled-out numbers ("Ninteen
Eighty-Four"). A number that never existed, such as Henry IX, is refused
unless a trap names it.

### 5. Break ties

- If a trap or decoy is at least as close as any right answer, the wrong
  answer wins. This is why traps and decoys exist: a real-but-wrong name must
  never be "corrected" into a right one. "Gambia" is one letter from Zambia,
  but Gambia has a coast, so on the landlocked-countries prompt it is a decoy
  and is refused.
- If two different right answers are equally close, the result is
  **ambiguous** and the player is asked to be more precise.

### 6. Exact prompts

Prompts marked `"exact": true` are about spelling itself, so only the listed
spellings count: no folding, no plurals and no typo forgiveness. Tidying
(case, accents, spaces, punctuation) still applies. Every acceptable spelling
must therefore be listed, plurals included, where the rule allows them.

### 7. Edge cases

- Nothing typed but spaces: **empty**, which the game ignores.
- Something typed that tidies away to nothing (another alphabet, only
  symbols): **unknown**, a normal refusal.

### What the matcher returns

`accepted` (with the answer), `trap` (with the reason to show), `decoy`,
`ambiguous` (with the tied answers), `unknown` or `empty`.

### Keeping the two matchers in step

`scripts/matcher-cases.json` holds small test prompts and about a hundred typed
inputs with the result each must give, covering every rule above.
`node scripts/check-matcher.mjs` runs them against the reference matcher, and
the game's tests run the same file against the game's matcher. If the rules
change, change the cases first, then both matchers.

## Tiers and depth

The tiers in the bank are **seeded by hand**: our best guess at how often
players will give each answer. A rough guide:

- **Tier 1**: what most people say first. Every prompt has some.
- **Tier 2**: well known, but a step past the obvious.
- **Tier 3 and 4**: real knowledge. Most of each list lives here.
- **Tier 5**: deep cuts for specialists.
- **Tier 6**: one to three hand-picked jackpots per prompt, each with true
  lore. A jackpot must not be one or two typos away from a common answer, or
  a slip of the finger would win 1,000 m.

### Recalibrating with real players

Once people are playing, each answer's tier should come from how often it is
actually given, blended with the seed so that a handful of players can't swing
it. For each prompt, between days (never during one, so everyone playing on
the same day is scored the same way):

1. Let **N** be the number of players who gave an accepted answer, and **s**
   the share of them who gave this answer.
2. Read off the observed tier, where each step is about three times rarer than
   the one above:

   | Share of players | Observed tier |
   | ---------------- | ------------- |
   | 10% or more      | 1 |
   | 3% to 10%        | 2 |
   | 1% to 3%         | 3 |
   | 0.3% to 1%       | 4 |
   | under 0.3%       | 5 |

3. Blend with the seed: **tier = round(w × observed + (1 − w) × seed)**, where
   **w = N / (N + 250)**. With 50 players the seed still dominates (w = 0.17);
   at 250 players the two count equally; by 2,500 the data does (w = 0.91).
4. Tier 6 stays hand-picked. A jackpot keeps tier 6 while fewer than 0.1% of
   players give it; if it turns out to be common, it is blended down like any
   other answer and a new jackpot is chosen.

Disputes feed in too: when players press "The Deep disagrees" on a refusal,
the disputed answers are reviewed, and the right ones become new answers or
aliases.

## theme.json

`data/theme.json` holds the words around the questions, so the voice can be
changed without touching code.

| Section | What it holds |
| ------- | ------------- |
| `maxDepth`, `promptsPerDay`, `secondsPerPrompt` | 7,000 m, 7 prompts, 25 seconds. The validator checks that the depths add up. |
| `tiers` | The six tiers: `tier`, `key`, `name`, `depth`, `emoji`, `blurb`, and at least two `lines` the game picks from when you land one. |
| `openSecret` | The Open Secret label: `name`, `emoji`, `blurb`, `lines`. |
| `refused` | The refusal label, with `lines` for `unknown`, `decoy`, `ambiguous` and `timeout`. Traps show their own reason. |
| `zones` | The depth bands, from The Shallows (0 to 200 m) to The Drowned City (7,000 m). They must cover every metre with no gaps. |
| `landmarks` | Named places within the zones (Still in the Boat, The Whale Fall, The Wrong Angles and so on), each with lines. A day's final depth lands you at one. |
| `categories` | The `name` and in-game `title` for each category key. |
| `share` | The share text. `template` must contain `{day}`, `{depth}`, `{emoji}` and `{landmark}`; `missEmoji` marks a prompt with no answer. |
| `howToPlay` | The short rules shown to new players. |

The game also reads an optional `career` section for the Logbook and bestiary
wording. Until one is added here, the game uses its own placeholder copy.

## Writing a new prompt

1. **Pick a list with depth.** A good prompt has a few answers everyone knows
   and a long tail that rewards real knowledge. Most prompts here have 60 to
   300 answers. Short closed lists, like the 24 Greek letters or the 22 cards
   of the Major Arcana, work too, because their rarest members are still rare.
2. **Write the rules line first.** One plain sentence that settles the
   arguments before they happen: "Any sovereign state...", "Model names, like
   the Mustang, don't count."
3. **List answers generously.** When in doubt, accept. If a reasonable person
   could defend it under the rules, it belongs in the list at a fair tier.
4. **Add every spelling as an alias**: British and American spellings, old
   and new names (Burma and Myanmar), local names (Deutschland), short forms
   (VW, PS5), nicknames (Barça, Chevy), surname-only forms where only one
   answer has that surname. You don't need aliases for case, accents,
   punctuation, plurals, small typos, St/Saint or number words: the matcher
   handles those.
5. **Turn ambiguity into a question.** If a short form fits several answers
   ("Hill" for two F1 champions, "Roosevelt" for two presidents), add a trap
   with a reason like "Which Hill? There were two." rather than refusing in
   silence.
6. **Add traps for tempting wrong answers**, with a short, friendly reason:
   "It has a coast on the Red Sea." Add decoys for real-but-wrong names that
   are close in spelling to a right answer.
7. **Spread the tiers** (see above) and pick one to three tier 6 jackpots,
   each with lore.
8. **Write lore that is true.** Check it. If it's a legend, say so: "legend
   says", "is said to", "reportedly". 170 characters at most.
9. **Don't give answers away.** Players can keep guessing, so the flavour line,
   rules line and trap reasons must not name any answer of tier 3 or above.
   The validator catches this.
10. **Keep it kind.** If the obvious name for something is a slur, add it as a
    trap whose reason gives the respectful name ("That name is a slur. Try
    conical hat.").
11. **Avoid slang that's only one region's**, unless the aliases cover the
    others too.

Then run the validator and try a few answers yourself.

## Riddles: The Whispering Deep

Riddles mode has one riddle a day, the same for everyone, with no timer. The
player has five wrong guesses ("five breaths") and can ask for up to three
hints. Solving it with no hints is worth 1,000 m, then 700, 450 and 250 m as
hints are used. Solving it adds the riddle's page to the player's copy of The
Drowned Codex. The riddles live in `data/riddles.json`:

```json
{
  "riddles": [
    {
      "id": "lighthouse",
      "verse": ["I stand alone where the rocks are hungry.", "All night I turn one burning eye", "..."],
      "answers": [{ "answer": "Lighthouse", "aliases": ["Beacon", "Pharos"] }],
      "hints": ["Ships that see me steer away.", "A keeper once lived inside me.", "I am a tall tower on the coast..."],
      "traps": [{ "answer": "Lightship", "reason": "A ship that does my work. I stand on the rock itself." }],
      "page": { "title": "Of the Tower That Says No", "text": "60 to 120 words..." }
    }
  ],
  "days": [{ "date": "2026-12-25", "riddle": "snowflake" }]
}
```

| Field | What it does |
| ----- | ------------ |
| `id` | Unique, lower case with dashes. |
| `verse` | The riddle: 2 to 6 short lines, 60 characters at most each so they fit a phone. |
| `answers` | Every right answer, each with aliases. All count equally. |
| `hints` | Exactly three, each plainer than the last. The third should nearly give it away. |
| `traps` | Near-misses, each with a reason, exactly as for prompts. |
| `page` | The page of The Drowned Codex the player earns: a `title` ("Of the ...") and 60 to 120 words of `text`. |
| `exact` | `true` only if the spelling itself is the answer. |
| `days` | Optional fixed dates, such as the snowflake on Christmas Day. |

Answers are judged by the same matcher as the daily prompts. Writing rules:

- **Write your own riddles.** No famous riddle, lightly reworded.
- **Accept every fair answer.** If "Mist" fits as well as "Fog", list both. If
  a player names a famous example ("Vesuvius" for a volcano), accept it. A
  wrong guess costs a breath, so a refused right answer hurts even more here.
- **Never say the answer.** The verse, the hints and the trap reasons must not
  contain any answer or alias, or its plural. The validator checks this.
- **Make the page true.** It is a short, exact piece about the real thing,
  with a fact worth keeping. Hedge legends ("is said to").
- **Keep the house voice**: calm, exact, British spelling, no exclamation
  marks, no gore. The horror is in what is left unsaid.

`node scripts/try-answer.mjs fog "Mist" "Cloud"` works for riddles too.

## Checking your work

You need [Node.js](https://nodejs.org/) 18 or newer. From the repository
folder:

```sh
node scripts/validate-content.mjs           # errors and warnings
node scripts/validate-content.mjs --stats   # plus answers per tier for every prompt
node scripts/try-answer.mjs dog-breeds "Sausage dog" "Alsation" "Labradoodle"
node scripts/check-matcher.mjs              # only needed after changing the matcher
```

`try-answer` shows exactly what the game would do with each input, which tier
it lands, and which listed spelling it matched.

The validator stops with an **error** when something would break the game or
misjudge answers:

- a file isn't valid JSON, or a required field is missing or the wrong type;
- two prompts share an id;
- an answer has no valid tier (1 to 6);
- two answers, or an answer and a trap, share a spelling once tidied or folded
  (the game couldn't tell them apart);
- a listed spelling doesn't match back to its own answer;
- a real-but-wrong country or city from the lexicons would be typo-corrected
  into a right answer (add it as a decoy or trap);
- theme.json's tiers, zones or landmarks don't add up.

It gives a **warning** for things worth a look: flavour or lore that's too
long, a question that doesn't start with "Name" or "Give", a giveaway in the
copy, a spelling repeated within one answer, an Open Secret above tier 2, no
tier 1 answers, no tier 6 jackpot, or too many jackpots. For riddles it also
warns about long lines, a page outside 60 to 120 words, and any verse, hint
or trap reason that says the answer.

The bank should always pass with no errors and no warnings.

## Keeping it fresh

Some answers change with the calendar. Check these each year:

| Prompt | When to check | What changes |
| ------ | ------------- | ------------ |
| `f1-champions` | After the last race (December) | Add the new champion. |
| `champions-league-winners` | After the final (late May or June) | Add a first-time winner, and update lore and traps that mention recent finals. |
| `world-cup-hosts` | After each World Cup, and when FIFA awards one | Future hosts are traps until their tournament starts. |
| `olympic-sports`, `olympic-host-cities` | After each Games, and when hosts or sports are announced | Sports added for LA 2028 (flag football, squash and others) become answers once the Games begin. |
| `video-game-consoles` | When a new console launches | Move it from trap to answer. |
| `pixar-films`, `disney-animated`, `bond-films` | When a new film is released | Add it. |
| `us-presidents`, `english-monarchs` | When there's a new one | Add them. |
| `moons`, `dinosaurs`, `dog-breeds`, `cat-breeds` | Once a year | New discoveries and newly recognised breeds. |

Seven prompts a day gets through 73 prompts in about ten days, so the bank
needs to keep growing for a long-running game.
