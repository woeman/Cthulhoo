# 2. Colour

[Back to the style bible](README.md)

Colour in Cthulhoo is not a theme you pick. It is a reading of the water at your depth.

There are two layers of colour, and both come from one file,
[`art/tokens/tokens.json`](../../art/tokens/tokens.json):

1. **The sea**: four colours (water, fog, glow, accent) that change smoothly with every
   metre, for the background, particles and shader. Read them with `paletteAt(metres)`.
2. **The interface**: one fixed theme per zone (ground, plate, ink and so on) for text,
   panels and buttons. Switch it with `data-zone="..."` on any element, or let
   `applyDepth(element, metres)` do it.

## The two schemes

- **Paper** (The Shallows only): warm bone paper, iron-gall ink, a madder-red accent.
  It is the only light theme.
- **Water** (everything below 200 m): near-black water, pale ink, and a glow colour that
  belongs to the zone.

## Interface themes per zone

Set with `data-zone` on `<html>` or on any element; components inside read these as
`var(--color-…)`.

| Token | `surface` The Shallows | `twilight` The Gloaming | `midnight` The Stygian Dark | `abyss` The Cyclopean Abyss | `hadal` The Dreaming Deep |
|---|---|---|---|---|---|
| `--color-ground` page | `#e7ddc6` | `#0f2530` | `#061420` | `#050b12` | `#07040d` |
| `--color-plate` panels | `#efe7d4` | `#143241` | `#0b2030` | `#0b1420` | `#130a1e` |
| `--color-ink` text | `#1d1813` | `#e3ece8` | `#dcf4f5` | `#e6f2dc` | `#f6e9f6` |
| `--color-ink-muted` | `#5b5143` | `#9db5b4` | `#86aab0` | `#9aab93` | `#b9a0bf` |
| `--color-rule` lines | `#3b3227` | `#4f7477` | `#2d5a66` | `#364a3c` | `#553a64` |
| `--color-glow` the zone's light | `#7a5810` | `#f0b562` | `#58d3ea` | `#b6ec66` | `#ff69d3` |
| `--color-accent` the other light | `#9e2f22` | `#8fd0e8` | `#ff5a4c` | `#ff5470` | `#ffc95c` |
| `--color-action` main button | `#8e2b1d` | `#f0b562` | `#58d3ea` | `#b6ec66` | `#ff69d3` |
| `--color-on-action` its label | `#f7efdc` | `#22160a` | `#04212a` | `#142204` | `#2a0620` |
| `--color-refused` | `#a2321f` | `#ff8a6e` | `#ff6a5c` | `#ff6b80` | `#ff8080` |
| `--color-focus` focus ring | `#8e2b1d` | `#f0b562` | `#58d3ea` | `#b6ec66` | `#ffc95c` |

Each zone's accent is the light of a *different* creature: in the Gloaming, cold blue
against the amber lamp; in the Stygian Dark, the red of a dragonfish's searchlight (a
real fish that sees in red); in the Abyss, a warning pink; in the Dreaming Deep, gold,
the colour of the Eye.

Derived tokens, worked out automatically on every theme: `--color-ink-faint`,
`--color-rule-soft`, `--color-plate-veil`, `--color-glow-soft` (34 % glow),
`--color-glow-faint` (14 %), `--color-accent-soft`, `--shadow-plate`, `--glow-line`.

### Contrast

Every text colour passes WCAG AA (4.5 : 1) on both the ground and the plate of its own
zone. The lowest pair is the surface glow on the surface ground, at 4.8 : 1. Body ink is
13 : 1 or better everywhere. If you change a colour, re-check it; the numbers above were
measured with the standard WCAG formula.

## The sea at any depth

`paletteAt(m)` in [`art/js/depth.js`](../../art/js/depth.js) blends between these stops:

| Depth | Water | Fog | Glow | Accent | What is happening |
|---|---|---|---|---|---|
| 0 m | `#9aaea9` | `#e3dccb` | `#fff2cc` | `#9e2f22` | sunlit fog on paper |
| 200 m | `#2c5360` | `#7a9799` | `#f0b562` | `#8fd0e8` | the lamp is lit |
| 850 m | `#102b3a` | `#23404d` | `#e9a955` | `#8fd0e8` | the lamp is the last warm light |
| 1,000 m | `#0a2231` | `#1a3947` | `#58d3ea` | `#ff5a4c` | living light takes over |
| 3,400 m | `#061420` | `#10263a` | `#4fd0e6` | `#ff5a4c` | |
| 4,000 m | `#050c15` | `#112032` | `#b6ec66` | `#ff5470` | the stone glows green |
| 5,300 m | `#05080f` | `#131a30` | `#aee862` | `#ff5470` | |
| 5,700 m | `#05060f` | `#171634` | `#9c7cff` | `#ff8a5c` | the green turns violet |
| 6,000 m | `#06040d` | `#1f1034` | `#ff69d3` | `#ffc95c` | the colour out of space |
| 6,750 m | `#050309` | `#2a0f38` | `#ff70d6` | `#ffc95c` | |
| 7,000 m | `#030107` | `#3a1650` | `#ffe1f5` | `#ffe08a` | the floor: the fog itself is lit |

How the blend works, for the builder:

- Colours are blended in **OKLCH** (a colour space where equal steps look equal to the eye),
  taking the **shorter way round** the hue circle.
- Each step is eased with **smoothstep**, so changes start and end gently.
- **The light dies before the next light appears.** Halfway between two stops, the
  chroma (colourfulness) of the glow dips by up to 50 % and the accent by up to 40 %,
  scaled by how far the hue travels (a full dip at 60° or more). So amber does not slide
  through a muddy green on its way to cyan; it fades, and cyan comes up out of the dark.

```js
import { paletteAt, applyDepth } from './art/js/depth.js';
const p = paletteAt(4312);
// p.zone.key === 'abyss'; p.water, p.fog, p.glow, p.accent are hex strings;
// p.rgb and p.lin hold 0..1 arrays (sRGB and linear) for WebGL uniforms.
applyDepth(document.documentElement, 4312);
// sets data-zone="abyss", --depth (0..1), --depth-m, --zone-progress,
// and --live-water / --live-fog / --live-glow / --live-accent for CSS.
```

When `data-zone` changes, the interface colours cross-fade over 1.2 s (`--dur-ink`),
because they are registered CSS properties. With reduced motion the change is instant.

## The inversion

Between about 110 m and 340 m, an ink wash rises from the bottom of the screen with a
ragged, wet edge, and everything below it inverts: paper becomes water, ink becomes
light. The interface switches from the paper theme to the Gloaming theme at 200 m, in the
middle of that wash. This is the single most important moment in the game's look; it
should happen on every first dive of the day, and it should be slow.

## Rarity colours

**A tier shines with the glow of its zone.** On dark water:

| Tier | On water | On paper | Note |
|---|---|---|---|
| 1 Commonplace | `#e9e1cf` | `#665e51` | plain ink: no light at all |
| 2 Curious | `#f0b562` | `#8a5810` | the Gloaming's amber |
| 3 Obscure | `#58d3ea` | `#17687a` | the Stygian cyan |
| 4 Arcane | `#b6ec66` | `#436816` | the Abyss green |
| 5 Forbidden | `#ff69d3` | `#992a7a` | the Dreaming magenta |
| 6 Unspeakable | `#f1e2ff` + pearl | `#5d3f94` | iridescent: see below |
| Refused | `--color-refused` | | struck through, never glowing |

Use `--color-tier-1` … `--color-tier-6` in CSS; they switch to the paper versions inside
`data-zone="surface"` automatically. In JavaScript, `tierColor(n, 'dark' | 'paper')`.

**Unspeakable** is the only colour that moves. It shimmers through pearl tones (pale
pink, lilac, sea-glass, the Abyss green, old gold) like the inside of a shell. In CSS the
specimen tag and the seal ring do this already; in a shader use `pearlAt(time, phase)`.
Never use the pearl for anything except tier 6.

## Rules

- Never put two glows of different zones side by side, except in a list of tiers, where
  the difference is the information.
- Glow is for living things, the lamp, the Eye and the player's best answers. Do not use
  it for decoration.
- Red is not "error". A refused answer uses `--color-refused` with a strike-through and a
  closed-eye seal; the colour alone never carries the meaning.
- Keep big areas dark below 200 m. Bright fills are only ever small: a button, a seal, a lure.
