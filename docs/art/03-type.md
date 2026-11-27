# 3. Type

[Back to the style bible](README.md)

Three typefaces, each with one job. All three are free to use in a commercial game and
app, and they are stored in the repository ([`art/fonts/`](../../art/fonts/)) so the game
works offline and never depends on a font service.

## The three voices

| Voice | Typeface | Licence | Used for |
|---|---|---|---|
| **The tome** | IM Fell English, IM Fell English SC (small capitals) | SIL Open Font License 1.1 | the logo's letters, zone names, titles, depths in headings, seal labels |
| **The record** | EB Garamond (variable, weights 400 to 800, with italics) | SIL Open Font License 1.1 | questions, answers, body text, buttons' running text |
| **The log** | Special Elite | Apache License 2.0 | the answer field, readings (depth, pressure, temperature), plate labels, telegrams, timestamps |

**IM Fell** is Igino Marini's digital revival of the types that Bishop John Fell
collected in the 1670s and left to Oxford University. Its letters are slightly rough and uneven, as if printed from worn
metal. That roughness is the first hint that this book is old and not quite right.

**EB Garamond** is a calm, very readable book face. The question must always be easy to
read, so it is always set in Garamond, never in the rougher Fell.

**Special Elite** imitates a worn typewriter. It is the voice of the expedition's
instruments and its log: everything typed, measured or transmitted.

## CSS

Load [`art/css/fonts.css`](../../art/css/fonts.css) once, then use the tokens:

```css
font-family: var(--font-display);       /* IM Fell English */
font-family: var(--font-display-caps);  /* IM Fell English SC */
font-family: var(--font-text);          /* EB Garamond */
font-family: var(--font-log);           /* Special Elite */
```

Each stack ends in a safe fallback (Georgia, Times, Courier) in case a font fails to load.
The font files use `font-display: swap`, so text is never invisible while fonts load.

## The scale

Sizes grow smoothly with the screen width between a phone and a desktop.

| Token | Phone → desktop | Typical use |
|---|---|---|
| `--step-6` | 61 → 128 px | zone names on chapter cards |
| `--step-5` | 48 → 83 px | the floor, the logo line, results headline |
| `--step-4` | 37 → 56 px | section titles |
| `--step-3` | 29 → 40 px | the daily question on large screens |
| `--step-2` | 23 → 29.6 px | the daily question on phones, zone names in lists |
| `--step-1` | 19 → 22 px | lead paragraphs, specimen names |
| `--step-0` | 16 → 17.6 px | body text (never smaller for reading) |
| `--step--1` | 13.4 → 14.7 px | notes, the log, captions |
| `--step--2` | 11.5 → 12.5 px | plate labels and readings, always in capitals with tracking |

Line height: `--leading-tight` 1.05 for huge display text, `--leading-display` 1.15 for
headings, `--leading-text` 1.5 for reading, `--leading-log` 1.6 for typewriter lines.

Letter spacing: `--tracking-caps` 0.12em for small capitals, `--tracking-caps-wide`
0.28em for seal labels and the tagline, `--tracking-log` 0.02em for the typewriter.

## Numbers

- In running text, numbers are **old-style** (they rise and fall like lowercase letters),
  which [`base.css`](../../art/css/base.css) turns on for the whole page.
- Measurements that the instruments report (depth, pressure, temperature, the timer) are
  set in the log face with **tabular** figures, so they do not jump about as they change.
  Use the class `.cth-figures`.
- Depths are written with a thin non-breaking space before the unit, and a comma for
  thousands: `4,312 m`. `formatDepth(m)` in `depth.js` does this for you.

## Rules

- The question is always EB Garamond, at least `--step-2`, in `--color-ink`.
- Never use IM Fell below 16 px: its roughness turns into noise.
- Never fake bold or italic. Fell has a real italic; Garamond has real weights; Special
  Elite has neither and should only ever be used at its regular weight.
- Capitals are always small capitals from IM Fell English SC or tracked-out Special Elite,
  never shouted EB Garamond capitals.
- Headings balance their lines (`text-wrap: balance`); body text avoids single-word last lines
  (`text-wrap: pretty`). Both are set in `base.css`.

## Languages

**Guess:** the game launches in English. The bundled files are the Latin subsets, which
cover English and most Western European languages. All three families have wider
character sets available from the same sources if the game is translated later:
[`@fontsource/im-fell-english`](https://fontsource.org/fonts/im-fell-english),
[`@fontsource-variable/eb-garamond`](https://fontsource.org/fonts/eb-garamond),
[`@fontsource/special-elite`](https://fontsource.org/fonts/special-elite).
EB Garamond also covers Greek and Cyrillic; IM Fell and Special Elite do not.
