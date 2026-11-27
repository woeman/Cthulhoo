# Cthulhoo style bible: Ink & Phosphor

This folder describes how Cthulhoo looks, moves and sounds. It is written for two
readers: Will, who decides what the game should feel like, and whoever builds the
game, who needs exact colours, sizes and timings. Every asset it mentions is in
[`art/`](../../art/README.md), ready to use.

**See it first.** [`showcase/index.html`](showcase/index.html) is one long page that
sinks from the surface to the floor as you scroll, and shows every piece of the style
in place. It needs to be opened through a small local web server, because browsers
will not load its scripts straight from disk:

```sh
# from the top folder of the repository
python3 -m http.server 8000
# then open http://localhost:8000/docs/art/showcase/
```

## The idea in one paragraph

Cthulhoo looks like a page from an old natural-history book, a copperplate engraving
printed in dark ink on bone-coloured paper. As you sink, the page slowly goes mad.
Around 200 m an ink wash rises up the screen and the page inverts: the same engraved
lines now glow in the light of whatever lives at that depth, amber, then cyan, then a
sickly green, then a colour that should not exist. At 7,000 m the lines draw an Eye,
and it opens. We call the style **Ink & Phosphor**: ink at the top, living light below.

## Chapters

1. [Concept](01-concept.md): the idea, the five rules, the Rule of Seven, and how we stay original.
2. [Colour](02-colour.md): the palette for every depth, the five zone themes, rarity colours, contrast.
3. [Type](03-type.md): three free typefaces, three voices, the type scale.
4. [Line and texture](04-line-and-texture.md): engraving, paper, grain, hatching, and the background shader.
5. [Creatures and glyphs](05-creatures-and-glyphs.md): silhouettes, rarity seals, the Drowned Script, logo and icons.
6. [Interface](06-interface.md): every component, the main screens, accessibility.
7. [Motion and sound](07-motion-and-sound.md): how things move, how the madness works, and the full audio brief.
8. [Voice](08-voice.md): how the game talks, names for things, sample copy.

## The descent at a glance

| Depth | Zone | Science name | Glow | Subtitle |
|---|---|---|---|---|
| 0–200 m | The Shallows | Epipelagic | ink on paper | Fog on the water, the last of the sun. |
| 200–1,000 m | The Gloaming | Mesopelagic | lamp amber `#f0b562` | Where the light gives up. |
| 1,000–4,000 m | The Stygian Dark | Bathypelagic | biolume cyan `#58d3ea` | Lights that are not ours. |
| 4,000–6,000 m | The Cyclopean Abyss | Abyssopelagic | eldritch green `#b6ec66` | Stones cut by no human hand. |
| 6,000–7,000 m | The Dreaming Deep | Hadopelagic | a colour out of space `#ff69d3` | It knows you are coming. |
| 7,000 m | The Drowned City | the floor | the Eye opens | Its true name is written only in glyphs. |

The zone depths follow the real layers of the ocean. Rarer answers send you deeper,
so the zones double as a rarity scale: **a rarity tier shines with the glow of its zone.**

| Tier | Name | Seal | Blurb |
|---|---|---|---|
| 1 | Commonplace | a ring and a dot | Everyone says it. |
| 2 | Curious | three spines | A little further from shore. |
| 3 | Obscure | five spines | Known to lanternfish and few others. |
| 4 | Arcane | seven barbed spines | Carved, not written. |
| 5 | Forbidden | a seven-pointed star with an eye | You should not know this. |
| 6 | Unspeakable | a crowned star, a cuttlefish eye, pearl light | The deep repeats it back to you. |
| — | Refused | a broken ring, a closed eye | The deep does not accept this. |

## Guesses and open questions

These are choices I made without being told. Each is easy to change.

- **Guess:** the zone boundaries (200, 1,000, 4,000, 6,000 m) are also where the game's
  rarity tiers change. The build thread owns the real scoring; if its tiers map to other
  depths, only the token file changes.
- **Guess:** the game is dark-only below the surface. There is no "light mode" for the
  deep, because the dark is the point. The surface is the light theme.
- **Guess:** English only for now. The fonts are Latin subsets; other languages would
  need other subsets of the same families (see [Type](03-type.md)).
- **Guess:** the sound is synthesised in the browser (Web Audio) rather than recorded.
  The brief in [Motion and sound](07-motion-and-sound.md) works either way.
- **Guess:** the five rarity tiers plus "Refused" match the game's answer outcomes. If the
  game adds outcomes (for example "already given"), they need a seal and a colour.
- **Open:** whether the madness effect should ever touch the question itself on the real
  game screen. It is beautiful on headings, but a player must always be able to read the
  question. My default is: headings and decorative text only, never the question text,
  inputs, buttons or numbers.

## Originality

Cthulhoo shares a mechanic with other daily trivia games (rarer answers score more). It
shares nothing else. The name, every drawing, every glyph, the palette, the layout and the
text were made for this game. The visual references are old and public: 19th-century
natural-history engraving, early deep-sea expedition reports, the first bathysphere dives
of the 1930s, and the cosmic-horror idea of a vast, indifferent deep. We use the idea of
cosmic horror, not Lovecraft's characters or his prejudices (see [Voice](08-voice.md)).
