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
