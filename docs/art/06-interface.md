# 6. Interface

[Back to the style bible](README.md)

The interface is the expedition's equipment: printed plates, a typewriter, a brass depth
gauge, telegrams from the ship above. Every component lives in
[`art/css/components.css`](../../art/css/components.css), prefixed `cth-` so it never
collides with the app's own styles, and takes every colour from the tokens, so it
re-themes itself when `data-zone` changes. The showcase page shows each one working.

Load order:

```html
<link rel="stylesheet" href="art/css/fonts.css">
<link rel="stylesheet" href="art/tokens/tokens.css">
<link rel="stylesheet" href="art/css/base.css">        <!-- optional page defaults -->
<link rel="stylesheet" href="art/css/components.css">
```

## Components

### Plate: `.cth-plate`

A framed engraving: double rule, diamond corners, a label in a tab cut into the top rule.
Use it for every card, panel and dialog.

```html
<article class="cth-plate">
  <span class="cth-plate__label">Descent No. 214 · Today</span>
  …
</article>
```

On paper it shows grain; on water it is a darker pane with a faint glow along the rule.

### The question: `.cth-question`

`__meta` (date and category, in the log face), `__text` (the question, EB Garamond,
centred, `--step-3`), `__hint` (one line under it, italic). Emphasis inside the question
(`<em>`) glows in the zone colour; use it for the one phrase that matters.

### The answer field: `.cth-field`

A typewriter on a ledger line: `__label` in small capitals, `__input` in Special Elite with a
double rule under it that glows when focused, and `__note` for "Three answers left". Set
`data-state="refused"` on the field to make it shudder once when an answer is refused.

### Buttons: `.cth-btn`

All buttons are at least 48 px tall, with an engraved inner line.

- `.cth-btn--lure`: the main action (Descend). Filled with `--color-action`; it breathes on the
  7 s cycle like an anglerfish lure. **Only one per screen.**
- `.cth-btn--ghost`: secondary actions. Just the rule line; a faint glow on hover.
- `.cth-btn--icon`: a square 48 × 48 button for an icon; always give it an `aria-label`.
- Disabled: `disabled` or `aria-disabled="true"` fades it to 45 %.

### Specimens: `.cth-specimens` and `.cth-specimen`

Each answer is tagged like a museum specimen: a luggage-tag shape with an eyelet, the seal,
the name in italic, the tier in small capitals, and the depth it earned. Set
`data-tier="1"` … `"6"`, or `"refused"` (struck through, shudders once). Tier 6 text shimmers
in pearl in the deep.

```html
<li class="cth-specimen" data-tier="3">
  <svg class="cth-specimen__seal"><use href="art/glyphs/tiers-sprite.svg#tier-3"/></svg>
  <span class="cth-specimen__name">Vampire squid</span>
  <span class="cth-specimen__tier">Obscure</span>
  <span class="cth-specimen__depth">+400 m</span>
</li>
```

### Seal: `.cth-seal`

A large rarity medallion for the result screen: a disc that breathes, the tier glyph in it,
the tier name under it. `data-tier` as above; size with `--size` (default 132 px). Tier 6 gets
a slowly turning pearl ring.

### The sounding line: `.cth-gauge`

The depth gauge, drawn as a weighted line paid out from the ship: zone bands, a mark every
500 m, a cable that glows as far as you have sunk, a bob, and a typewritten readout. It reads
`--depth` (0 to 1), which `applyDepth()` writes on the root, so it moves by itself.

```html
<div class="cth-gauge">
  <div class="cth-gauge__line"></div>
  <ol class="cth-gauge__marks"><li style="--at: .14286">1,000</li> …</ol>
  <div class="cth-gauge__bob"></div>
  <output class="cth-gauge__readout">4,312 m</output>
</div>
```

Tip from the showcase: the first zone band is thin, so put the 0 m label above the line and
the 200 m label below its mark, or they collide.

### Telegram: `.cth-telegram`

The toast. A slip of telegraph paper lowered from the surface on a string; it sways on the
7 s cycle. It is **always surface paper**, whatever the depth, because it comes from the ship.
Write it in telegram style with `<b>stop</b>` between phrases (see [Voice](08-voice.md)).
Use `role="status"` so screen readers announce it.

### Log: `.cth-log`

Typewritten expedition lines, each with a `<time>` and text; `<mark>` makes a number glow.
Use it for the history of today's dive and for loading messages.

### Zone title: `.cth-zone-title`

The chapter card shown when you cross into a new zone: `__range` ("1,000–4,000 m"), `__name`
(spreads in like ink dropped in water), `__subtitle` (in the zone's glow).

### Rule: `.cth-rule`

A double engraved divider with an ornament in the middle (a seal or a Drowned Script glyph).

### Milestone: `.cth-milestone`

A depth you can never drift back above, carved where you passed it: the benchmark on the
chart's line, and a stone plaque beside it with the name in small capitals and the depth in the
log face. `data-state="ahead"` shows one you have not reached yet: cut faintly, not yet inked.
`data-new` makes the name bloom in like ink on the day it is carved.

```html
<div class="cth-milestone">
  <svg class="cth-milestone__mark" viewBox="0 0 32 32"><use href="art/glyphs/marks-sprite.svg#milestone"/></svg>
  <div class="cth-milestone__plaque">
    <span class="cth-milestone__name">The Roofs of the Drowned City</span>
    <span class="cth-milestone__depth">6,800 m</span>
  </div>
</div>
```

### Ward: `.cth-ward`

A ward slot. `data-state="held"` is the hag stone, glowing and breathing on the 7 s cycle;
`"spent"` is the split stone (use `#ward-spent`), muted; `"empty"` is a faint stone for a ward
not yet earned. You can hold at most two, so show two slots.

```html
<svg class="cth-ward" data-state="held" viewBox="0 0 32 32"><use href="art/glyphs/marks-sprite.svg#ward"/></svg>
```

### Sigil: `.cth-sigil`

One for each question topic on the Logbook: a Drowned Script word hung inside a porthole,
brightening with the player's strength in that topic. `data-level` runs from 0 to 3:

- **0, unlit:** cut into the plate, with a dashed ring. Dim, but it still reads.
- **1, kindled:** inked, with a solid ring.
- **2, burning:** lit in the zone's glow.
- **3, blazing:** seven rays come out around the ring, and it breathes on the 7 s cycle.

On paper there is no glow, so burning is heavy ink and blazing is the accent red, like a
rubric in an old book.

| Topic | Sigil (script word) | Meaning |
|---|---|---|
| geography | sounding | depth; to measure |
| science | void | the space between stars |
| nature | coil | patience; the spiral of a shell |
| culture | spire | a tower that was not built |
| history | root | old; before men |
| myth | sleeper | the one who dreams |
| food | fang | hunger |
| language | maw | to speak |
| sport | talon | to seize |
| misc | knot | a bargain; loose ends tied together |

```html
<figure class="cth-sigil" data-level="2">
  <svg class="cth-sigil__glyph" aria-hidden="true"><use href="art/glyphs/sigils-sprite.svg#sigil-history"/></svg>
  <figcaption>History <span>burning</span></figcaption>
</figure>
```

The sprite is `art/glyphs/sigils-sprite.svg` (`#sigil-geography` and so on), with one file each
in `art/glyphs/sigils/`. The ring, its dashes and the rays inside each symbol are driven by CSS
variables (`--sigil-ring`, `--sigil-dash`, `--sigil-rays`). Variables pass into `<use>`, so one
symbol shows every level. Size it with `--size` (56 px by default; it reads down to 32 px).

## The main screens

**Guess:** the game thread owns the real screens; these are the art direction for them.

1. **Today's question.** Full-screen abyss background at your current depth. One plate in the
   middle: the date and "Descent No." label, the question, the answer field, the Descend lure.
   The sounding line on the right edge (on phones, a thin line at the edge with the readout at
   the top). Answers you have already given hang below as specimen tags.
2. **The descent.** After each answer, the plate stays put and the world sinks: the background
   eases to the new depth over 2.4 s, the readout counts, marine snow streams upward. Crossing
   a zone boundary shows its zone title for about 3 s. A new specimen tag blooms in.
3. **Results.** The deepest answer's seal, large, in the middle; your final depth in `--step-5`;
   all specimens; the Share bottle. At 7,000 m, the Eye is open behind it.
4. **Share card.** **Guess:** an image, 1080 × 1350, showing the engraving at your final depth,
   your seals in a row, the depth, and the wordmark. No answers, so it never spoils the puzzle.
5. **Menu and settings.** Surface paper plates (the ship's cabin), whatever the current depth.

## The Logbook

The career page reads like an expedition's survey chart: one long printed sheet that starts on
paper at the top and runs down into black water. The showcase has a working sketch of it.

**From the top of the page:**

1. **The title**, set like the cartouche on an old chart: the poetic title in IM Fell English
   at `--step-4` (for example "Drowned Cartographer of the Third Trench"), and the synopsis
   under it in italic EB Garamond, one or two lines. The title may take the madness effect
   below 2,500 m. The synopsis never does.
2. **The Sigils**, one row of ten, each with its topic and level. On a phone, two rows of five
   at `--size: 40px`, with the captions at `--step--2` so "Geography" fits its column.
3. **The lantern and the wards**: the streak, then two ward slots.
4. **The chart.**

The head of the page (title to wards) sits in the water of the player's career depth, like every
other screen. Only the chart runs the whole way from paper to the floor.

**The chart:**

- **Depth runs down the page and days run left to right**, so a whole career fits the width
  and the page grows taller as you sink. Use a **square-root depth scale**, so the shallow
  zones, where every player starts, get room while 7,000 m still fits; label the axis in true
  metres. **Guess:** the game build owns the scale. If career depth runs past 7,000 m,
  continue in the Dreaming Deep's colours below the floor and let milestones mark the way.
- **The water is the background.** Paint each height with `paletteAt(depth)`: a CSS
  `linear-gradient` with a stop at every zone boundary does it. Paper (with the paper grain)
  above 200 m, the ink wash from about 110 to 340 m with a ragged wet edge (an SVG turbulence
  displacement on that boundary, or the murk texture as a mask), then black water.
- **The line is the sounding cable**: one continuous 2 px stroke. Ink on paper. Below the wash
  it glows in each zone's colour (a vertical gradient on the stroke with stops at the zone
  boundaries, and a copy behind it blurred by 4 px). Days are small ticks across the cable,
  never dots.
- **Drift**, after missed days, is the same cable rising, drawn thinner (1.25 px) and dashed
  2 / 3 in `--color-ink-muted`. Never red, and nothing alarming: drifting is the sea being
  patient, not a punishment.
- **Wards**: where a ward saved a day, the cable stays level and the spent hag stone
  (`#ward-spent`) hangs from it on that day.
- **Milestones**: a hairline survey line right across the chart at the milestone's depth,
  dashed 1 / 4 in `--color-rule`; the benchmark (`#milestone`) where the cable crosses it; and
  the plaque (`.cth-milestone`) beside it, on whichever side has room (let the name wrap when
  neither side has enough). Show only the next milestone ahead, as `data-state="ahead"`, with its
  benchmark under today's lead weight.
- **Today** is the lead weight at the end of the cable, with a typewritten readout, as on the
  sounding line.
- **Labels**: depth marks on the left edge at each zone boundary and every 1,000 m, in Special
  Elite at `--step--2`; zone names in small capitals at the top right of each band; and a few
  dates along the top edge in the log face ("27 NOV"). Milestones often fall on zone boundaries,
  so keep the zone names clear of the plaques: step a name down below a plaque, and leave it
  out where there is no room, because the plaque already says where you are.
- **Motion**: the page opens scrolled so that today's lead weight is in view. The cable pays
  itself out over 2.4 s the first time the page opens each day (a clip that widens from left to
  right, so the descent and the drift draw together), and never on scroll. Reduced motion shows
  it drawn.
- **Long careers**: every day keeps its place across the width. Past about 60 days, keep one
  tick a week instead of one a day, and fewer dates along the top.
- **Build it as** one SVG for the cable (one path for the descent, one for the drift) over the
  gradient, with HTML for the plaques and labels, positioned absolutely, so the text stays sharp
  and screen readers can read it. Give the chart a text alternative, such as "Career depth
  5,580 m over 41 days, with two drifts and one ward. Three milestones passed; next, The Roofs
  of the Drowned City at 6,800 m."

## Accessibility

- Text contrast passes WCAG AA in every zone (see [Colour](02-colour.md#contrast)).
- Focus is always visible: a 2 px ring in `--color-focus`, offset 3 px.
- Touch targets are at least 48 × 48 px.
- **Reduced motion:** every animation becomes a short fade; depth changes are instant; the
  madness effect stops rewriting text; the background stops drifting. All of this is already in
  the CSS and scripts through `prefers-reduced-motion`.
- The madness effect keeps the real text in the page for screen readers and only disturbs a
  hidden visual copy. Never apply it to the question, inputs, buttons or numbers.
- Colour never carries meaning alone: tiers have names and different seals; Refused is struck
  through and has its own closed-eye seal.
- The game must be playable with sound off, and sound starts only after the first tap.
