# Cthulhoo

A daily descent into the abyss. Each day seven questions rise from the deep,
each with many true answers. Common answers keep you in the shallows; the rarer
your answer, the deeper you sink, down through five zones of the sea toward the
drowned city at 7,000 metres.

Website first, built to install on a phone's home screen and to be wrapped as a
native app later.

## Play it locally

You need [Node.js](https://nodejs.org) 22 or newer.

```sh
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173). Add `?fresh`
to the address to play without saving progress, which is handy for testing.

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the game with live reload |
| `npm test` | Runs the rules tests (matching, daily questions, scoring, share card) |
| `npm run build` | Type-checks and builds the site into `dist/` |
| `npm run preview` | Serves the built site |

`dev/abyss.html` (at http://localhost:5173/dev/abyss.html) is a playground for
the engraved sea with sliders for depth, madness and the Eye.

## How the game works

- Seven questions a day, the same for everyone, picked from the bank by date.
  Day 1 is 27 November 2026; a new dive starts at local midnight.
- Each question has many accepted answers sorted into six tiers of rarity:
  Commonplace 100 m, Curious 250 m, Obscure 400 m, Arcane 600 m, Forbidden 800 m,
  Unspeakable 1,000 m. 25 seconds per question; wrong answers only cost time.
- A daily omen bends one rule for everyone (double depth on one question, more
  or less time, a whispered hint).
- Sanity drains as you sink and when you are refused. It never changes the
  score; it changes how the world looks and sounds.
- Typos are forgiven by edit distance, but a real wrong answer (an ocean when
  the question asks for a sea) is never "corrected" into a right one.

## Where things live

| Folder | What is in it | Owned by |
| --- | --- | --- |
| `src/game/` | Rules: matching, daily selection, omens, scoring, saves, share text and card | game |
| `src/render/` | The WebGL engraving of the sea, from moonlit surface to the Eye | game |
| `src/audio/` | Generated ambient sound (no audio files) | game |
| `src/app.ts`, `src/ui/`, `src/styles/` | Screens and layout | game |
| `art/` | Colours, depth palette, fonts and the house style ("Ink & Phosphor") | art |
| `data/` | The question bank and the game's copy (`theme.json`) | questions |
| `public/` | App icon and home-screen manifest | game |

Until `data/` arrives, the game plays from a small placeholder bank in
`src/content/`.

## Publishing

`.github/workflows/pages.yml` checks every pull request and publishes `main` to
GitHub Pages. It needs a one-time switch in the repository settings:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
