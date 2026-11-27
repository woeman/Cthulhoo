# 5. Creatures and glyphs

[Back to the style bible](README.md)

## Creatures: show less

The deep is full of things, and you never see one whole. These rules apply to every
creature in the game, in the background, in illustrations and in marketing:

1. **At most a third of a big creature is on screen.** Let the frame cut it.
2. **Seen against light, not in it.** A creature is a dark shape in front of fog, the lamp or
   the glow of something else, with at most a thin rim of light at its edge.
3. **Half-hidden by murk.** Fog covers its roots, its far end, its true size.
4. **Scale through small things.** Marine snow drifting past a limb tells you how big it is.
5. **Eyes are rare.** Eyes appear in only four places: the logo's portholes, the Hint icon,
   the two highest rarity seals, and the Eye at the floor. That is what makes them land.
6. **Real animals first.** Above 4,000 m the creatures are real deep-sea animals (anglerfish,
   siphonophores, jellyfish, squid), drawn accurately. Only deeper do shapes stop making sense.

### The silhouettes

All in [`art/textures/silhouettes/`](../../art/textures/silhouettes/), as SVG filled with
`currentColor` (so CSS can colour them), and as **white-on-transparent PNG masks** in
`png/` for the WebGL renderer.

| File | Size | Use | Zone |
|---|---|---|---|
| `leviathan.svg` | 2200 × 800 | something passing, a vast squid-like shape with trailing arms; its eye is a hole, so the light behind looks back | Stygian Dark, Abyss |
| `tentacles-rising.svg` | 1600 × 1000 | three arms rising from below the frame; put the roots in fog | Stygian Dark and below |
| `tentacle-crossing.svg` | 1700 × 900 | one arm crossing the far water, entering from the left | Stygian Dark |
| `anglerfish.svg` | 900 × 640 | the lure is a separate `#lure` shape: light it in the accent colour, or set `--lure` | Gloaming, Stygian Dark |
| `jellyfish.svg` | 600 × 1000 | a medusa with trailing tentacles | Gloaming |
| `siphonophore.svg` | 400 × 1400 | a colony animal, long and strange; one animal made of many | Stygian Dark |
| `bathysphere.svg` | 240 × 300 | the player's vessel, line art; the portholes take `--porthole` | everywhere |
| `drowned-city.svg` | 2400 × 700 | the skyline: two layers, `#far` and `#near`, for parallax; tiles sideways | Abyss, Dreaming Deep |
| `great-eye.svg` | 1400 × 800 | the Eye, in layers `#lid`, `#folds`, `#iris`, `#pupil`, `#glint`, each with a colour variable | the floor |

The Drowned City is built from **colossal slabs that lean against each other at angles that
do not agree**: trilithon gates with tilted lintels, stairs that stop in the air, joints
cut across the stone at the wrong slope, and one door with a lens-shaped opening, so the
city looks back. No domes, no windows, nothing a person would build.

PNG masks: `png/<name>.png` at the sizes above; the city also as `drowned-city-far.png` and
`drowned-city-near.png`, and the Eye as `great-eye-lid.png`, `-folds`, `-iris`, `-pupil`,
`-glint`. Regenerate with `node art/tools/render-pngs.cjs`.

## Rarity seals

Each answer gets a seal, drawn like a **radiolarian**: the glass skeleton of a tiny deep-sea
plankton, the kind Haeckel drew. They grow stranger as the answer gets rarer: more spines,
then a star, then an eye. Odd numbers only.

| Tier | Seal | Built from |
|---|---|---|
| 1 Commonplace | a ring and a dot | the simplest cell |
| 2 Curious | three spines | the first symmetry |
| 3 Obscure | five spines and a pentagon | |
| 4 Arcane | seven barbed spines and a heptagon | the Rule of Seven arrives |
| 5 Forbidden | a seven-pointed star {7/3} with an almond eye | the first eye |
| 6 Unspeakable | a ring, a seven-pointed star {7/2}, fine rays, and a cuttlefish W eye | the Eye itself, small |
| Refused | a broken ring and a closed eye with lashes | the deep looks away |

Files: [`art/glyphs/tier-1.svg`](../../art/glyphs/) … `tier-6.svg`, `refused.svg`, and one
sprite, `tiers-sprite.svg`, with symbols `#tier-1` … `#tier-6` and `#refused`. All are drawn
on a 32-unit grid with a 1.75 stroke in `currentColor`, so they take the tier colour.

```html
<svg class="cth-specimen__seal"><use href="art/glyphs/tiers-sprite.svg#tier-4"/></svg>
```

## Marks

Four more signs on the seals' 32-unit grid, with the same 1.75 stroke in `currentColor`: one
file each in [`art/glyphs/`](../../art/glyphs/) and one sprite, `marks-sprite.svg`, with symbols
`#ward`, `#ward-spent`, `#milestone` and `#diver`.

| Mark | Means | Drawn as |
|---|---|---|
| `ward` | a ward you hold: it protects one missed day | a **hag stone**: a sea-worn pebble with a hole worn right through it, hung on a cord. Fishermen kept them in their boats against drowning and ill luck. It is our own sign, not the Elder Sign or anyone else's. |
| `ward-spent` | a ward that has been used | the same stone split through its hole, and the cord parted |
| `milestone` | a depth you can never drift back above | a surveyor's **benchmark**: the datum bar with the broad arrow beneath it, the mark surveyors cut into stone to fix a height for good |
| `diver` | one player in the Séance's shared view | a bathysphere on its cable, filled so that a player's colour reads at any size, with the porthole punched through |

## The Drowned Script

An invented alphabet of sixteen glyphs. Its letters **hang from a waterline**, the way weed
and chain hang from a hull, and glyphs written side by side share that line, so words look
like something strung under a boat. It decorates borders, loading states and seals, and it
is what the madness effect reaches for when a letter goes wrong.

| Glyph | Meaning | | Glyph | Meaning |
|---|---|---|---|---|
| eye | to see; the city | | maw | to speak; to devour |
| coil | to sleep; patience | | root | old; before men |
| gate | a door; to enter | | veil | the sea; to hide |
| sleeper | the one who dreams | | spire | a tower that was not built |
| tide | to rise; to return | | knot | a bargain |
| fang | hunger | | hand | to reach |
| anchor | to hold; to drown | | sounding | depth; to measure |
| talon | to seize | | void | nothing; the space between stars |

**The city's true name** is four glyphs: *eye, coil, gate, sleeper* ("the city where the
sleeper waits behind the door"). It is never written in Latin letters anywhere in the game.
File: `art/glyphs/drowned-city-name.svg`.

Files: one SVG per glyph in `art/glyphs/script/`, and the sprite `script-sprite.svg` with
symbols `#g-eye`, `#g-coil` and so on. The grid is 20 × 32, the waterline is at y = 3, the
stroke is 2.

Rules:

- The script is never a cipher for English. Players should not be able to "decode" it into
  letters; it carries meaning only as whole words (a later puzzle could change that, but
  that is a game-design choice).
- Never mix it into English words, except when the madness effect swaps a letter for a
  moment.
- Always hang it from a line. A glyph without its waterline looks like clip art.

## The logo

Files in [`art/logo/`](../../art/logo/):

| File | What | Colour |
|---|---|---|
| `wordmark.svg` | CTHULHOO in IM Fell English SC capitals | `currentColor` |
| `lockup.svg` | the wordmark with the tagline "A DAILY DESCENT" between two rules | `currentColor` |
| `mark.svg` | just the double O: two porthole eyes | `currentColor` |
| `app-icon.svg` | the two portholes glowing cyan in the Stygian Dark, full bleed 512 × 512 | full colour |
| `app-icon-maskable.svg` | the same picture with the portholes inside the central safe circle, for Android and installed web apps | full colour |
| `app-icon-monochrome.svg` | the two portholes alone, bolder, inside the same safe circle, for Android's themed icons | white on transparent |
| `favicon.svg` | a simplified mark at 64 × 64 | full colour |
| `png/app-icon-{1024,512,192,180,48}.png` | the icon for stores, home screens and browsers | full colour |
| `png/app-icon-maskable-{512,192}.png` | the maskable icon, for the web app manifest | full colour |
| `png/app-icon-monochrome-512.png` | the themed icon, for the web app manifest | white on transparent |

**The idea.** The double O of the name is a pair of riveted bathysphere portholes, and each
one is an eye with a **cuttlefish's W-shaped pupil**. The name looks back at you. The iris is
drawn as fine engraved strokes; each frame has eight rivets (six on the favicon). The
second eye is turned 7° from the first: the wrong angle, quietly.

Use it like this:

- Clear space around the wordmark: at least the height of one porthole on every side.
- Smallest sizes: wordmark 96 px wide; mark 24 px wide. Below 24 px use the favicon.
- On paper, the logo is ink (`--color-ink`). On water, it is ink or glow, never both.
- The app icon is full bleed; iOS cuts its own rounded corners. Android launchers cut
  circles, squircles and other shapes, so Android and installed web apps use the **maskable**
  version: the same sea to every edge, with the portholes inside the middle circle (80 % of
  the width) that every launcher shape keeps. When someone turns on Android's themed icons, the
  **monochrome** version takes over: only its shape counts, and the system paints it in that
  person's colours, so it has fewer, bolder iris strokes. Never add a border, a shadow or text
  to any of them.
- Never stretch it, outline it, set it in another typeface, or draw the O's as plain circles.

## Interface icons

Twenty-four icons in [`art/icons/`](../../art/icons/), on a 24-unit grid, 1.5 stroke, round
caps and joins, in `currentColor`; plus `sprite.svg` with symbols `#i-<name>`. Where the
game's world offers its own object, the icon uses it:

| Icon | Means | Drawn as |
|---|---|---|
| `descend` | submit, go deeper | an arrow down to the water |
| `hint` | hint | an eye opening |
| `share` | share your result | a message in a bottle |
| `streak` | your streak | a lantern |
| `daily` | today's descent | the moon |
| `stats` | your soundings (statistics) | a depth chart |
| `leaderboard` | the Roll of the Drowned | a cairn of stones |
| `timer` | time left | an hourglass |
| `depth` | depth | a sounding line and lead |
| `sound-on`, `sound-off` | sound | a ship's bell |
| `settings` | settings | a valve wheel |
| `info` | about | an open book |
| `help` | how to play | a question mark in a ring |
| `menu`, `back`, `close`, `check` | the usual | the menu is three wavy lines, like water |
| `career` | the Logbook, your whole career | a logbook with a stepped descent on its cover and a lead weight on its bookmark |
| `drift` | drifting up after a missed day | an arrow rising to the surface, with bubbles |
| `ward` | your wards | the hag stone on its cord |
| `riddle` | the Whispering Deep (riddles) | a water-damaged page with a question for its initial |
| `seance` | the Séance (party mode) | a planchette, with a porthole for its lens |
| `cult` | the Cult (this week's friends board) | three hooded figures |

```html
<svg width="24" height="24" aria-hidden="true"><use href="art/icons/sprite.svg#i-share"/></svg>
```
