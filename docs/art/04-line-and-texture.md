# 4. Line and texture

[Back to the style bible](README.md)

## The engraving

Everything in Cthulhoo is drawn as if it were engraved: cut into a copper plate with a
burin and printed. In an engraving there is no grey. Darkness is made by **lines**: more
lines, thicker lines, lines crossing other lines. That gives the game a texture no other
daily game has, and it costs almost nothing to draw.

The signature technique, which the background shader uses and anything else should copy:

1. **First work out the light**, as a plain greyscale image: sun rays, caustics near the
   surface, fog, glowing motes, and creatures as shapes that block the light.
2. **Then engrave it.** Turn that greyscale into lines:
   - wavy horizontal "engraved sea" lines everywhere, 5 to 6 CSS pixels apart, which
     wander gently like water;
   - a second set at **30°**, only where it is darker;
   - a third set at **−55°**, only where it is darker still (true cross-hatching);
   - line **width swells with darkness**, like a burin cutting deeper;
   - with madness, a fourth set appears, nearly vertical and about **6° off true**: an angle
     no engraver would choose.
3. **Then invert with depth** (see [Colour](02-colour.md#the-inversion)): near the surface the
   lines are ink on paper; below the wash they are light on black water, in the zone's glow.

Lines are always spaced in CSS pixels, not device pixels, so they look the same on every
screen. On a high-density phone they become finer and crisper, never denser.

## The background shader (concept)

[`docs/art/showcase/etching-concept.js`](showcase/etching-concept.js) is a working
reference of the background: one full-screen WebGL 1 pass, no extensions, about 400 lines.
It is a **concept**, not the production renderer; the game's own renderer (`src/render`,
built by the game thread) should match its look and may be structured differently.

```js
import { createEtchingBackground } from './etching-concept.js';
const bg = createEtchingBackground(canvas, { maxScale: 1.5 });
bg.setDepth(4312);              // eases there like a cable paying out
bg.setDepth(0, { instant: true });
bg.setMadness(0.6);             // 0..1, extra wobble and the wrong hatch angle
```

Options: `static` (draw one frame, for screenshots), `preserve`, `depth`, `time`,
`forceEye`, `paper` and `ink` (override the surface colours), `maxScale` (caps the device
pixel ratio, default 1.5, for speed). It reads its colours from `paletteAt()`, so it always
agrees with the interface. It honours reduced motion (no drift, no animation; depth jumps).

What appears at which depth, in the concept:

| Depth | Element | Notes |
|---|---|---|
| 0–900 m | sun rays | fade out by about 900 m |
| 0–350 m | caustics | the bright net of light on the water's surface |
| 110–340 m | the ink wash | inversion front with a wet, ragged edge |
| 200 m and below | marine snow | grows to full density by about 1,250 m; drifts **up** as you sink |
| 350 m and below | glowing motes | living lights, in the zone glow, pulsing |
| 1,000–4,200 m | a vast sucker-lined arm | crosses the far water, seen as an absence of light with a faint rim |
| 3,900 m and below | the Drowned City | leaning slabs in two depths, masonry joined by glowing cracks; grows taller towards the floor |
| 6,650–7,000 m | the Eye | lids open slowly; a gold iris of fine radial lines; a cuttlefish W-shaped pupil |

Performance notes for the builder: cap the pixel ratio (1.5 is plenty for lines this
size), pause when the tab is hidden, and redraw only when depth or time changes if the
device is weak. The shader never needs a texture; everything is generated.

## Paper, grain and murk

All in [`art/textures/`](../../art/textures/). Every tile repeats without a visible seam.

| File | What it is | How to use it |
|---|---|---|
| `paper-grain.png` (512 px, grey) | fibres, mottling and plate tone | **multiply** over the paper colour; surface only. `base.css` does this for the page. |
| `foxing.png` (1024 px, transparent) | rust-brown age spots and a tide mark | on top of surface plates, at low opacity, rotated per plate so it never repeats obviously |
| `film-grain.png` (256 px, transparent) | neutral grain for dark water | **overlay** at 20 to 40 %; jump its position every few frames to animate it |
| `murk.png` (512 px, grey) | soft drifting fog noise | **screen** over deep water, scrolled slowly; or as a mask for fog banks |

## Hatching tiles

Small SVG tiles for CSS masks and backgrounds, drawn in black so they work as masks:

| File | Tile | Use |
|---|---|---|
| `hatch-sea.svg` | 48 × 12, wavy lines 6 px apart | engraved water behind panels, in skeleton loading states |
| `hatch-30.svg` | 12 × 6.93, lines at 30° | shading on one side of a plate, pressed buttons |
| `hatch-cross.svg` | 8 × 8, cross-hatch | the darkest shade: disabled states, shadows under seals |
| `stipple.svg` | 16 × 16, dots | stippled shading for small shapes |

```css
.shaded {
  background: var(--color-ink);
  -webkit-mask: url(art/textures/hatch-30.svg) 0 0 / 12px 6.93px;
          mask: url(art/textures/hatch-30.svg) 0 0 / 12px 6.93px;
}
```

## Plates

Every panel in the interface is a **plate**: a printed rectangle with a double rule round
it, small diamond corners, and a label in a tab cut into the top rule, like the caption
of a museum drawing ("Plate IV", "Descent No. 214"). At the surface the plate shows paper
grain; in the deep it is a darker pane of water with a faint glow along the rule. See
`.cth-plate` in [Interface](06-interface.md).

## Rules

- Never use a flat grey for shadow on the surface. Use hatching or the multiply grain.
- Never use soft drop shadows on paper. On water, shadows are allowed only as darkness
  (the plate's `--shadow-plate`), never as coloured glows behind text.
- Textures are quiet. If you notice the grain before the content, halve its opacity.
- Burnt plate edges: the surface engraving darkens towards the corners, like an old print.
