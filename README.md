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
- The bank is fetched a question at a time. The game's script carries only each
  question's words and topic; the build publishes its answers as a file of its
  own (`bank/<id>.json`, made from `data/` as it is by `build/daily-bank.mjs`).
  The title fetches the day's seven and then tomorrow's, a séance or a practice
  dive fetches what it will ask, and the browser keeps what it fetched, so a
  dive can be made with no line to the surface. The bank can grow without the
  first load growing with it. A question's id is its file's name: lower-case
  letters, digits and hyphens, 60 at most (the build stops on any other).
- Topics: a practice dive (Charted Waters) or a séance can be held on ticked
  topics only. The ten daily categories are topics, and so is each class pack in
  `packs/` (finance, economics and so on). Several ticked topics are dealt
  evenly. Class packs are never part of the daily dive: the build publishes
  each as its own file (`packs/<id>.json`) and the game fetches a pack when it
  is ticked.
- Revision dives: from Charted Waters, one class pack studied alone before an
  exam. A question at a time, name every answer you can: each sinks you its
  tier's depth towards the floor at 7,000 m (or the depth of the whole list,
  when the list is too short to reach it), and the page sinks with you. Then the
  deep shows what was missed, the commonest tier first, and what was named in
  an earlier sitting but not today. The deepest reached on each question is kept
  on the device, so the next dive begins with what is known least. A candle of
  one or two minutes is optional. A link ending `?revise=finance` opens a pack.
  A question that is in today's dive is held back until the dive is made. The
  rules are `src/game/revision.ts`; the screen is `src/screens/revision.ts`.
- The Convocation (a class): one screen at the front of the room hosts and never
  answers. Up to 300 divers join on their own phones in a browser, with a sign
  like DAGON-247, a link, or the square code the big screen shows. Nothing to
  download and no account. The host asks one question at a time, from the ticked
  topics. Classic: one answer each. Blitz: every right answer you can before the
  candle is out. Rarer answers sink deeper, and a lone voice half as deep again.
  With tables (two to eight), each table also wins its few deepest different
  answers. Last diver standing: the tables (or, with no tables, up to twelve
  divers) take turns naming an answer nobody has named yet. One already named,
  or a turn that runs out, puts out one of the side's lanterns, and the last
  side with a lantern lit wins the bout and 1,000 m. Only the side on turn is
  heard, and the relay tells every device of every turn at once. The rules are
  `src/party/classroom.ts`, run by the relay's
  `Classroom` room (`worker/src/classroom.ts`), which matches the answers so a
  phone never holds the answer list; the screens are `src/screens/classroom/`.
  `node dev/class-load.mjs 300` plays a pretend class of 300 against a local
  relay (`cd worker && npx wrangler dev --port 8787`).
- The results of a class, for whoever held it: when a question's answers
  surface, the relay hands the host (and only the host) who gave what, with
  what each diver was refused. The host's device keeps it, in the browser's own
  storage: the last thirty classes, and nothing is sent anywhere. "See the
  class results" on the end screen, or "Past classes" in the Convocation, shows
  every diver's answers and depths, then each question with its answers rarest
  first, who gave them, who was only refused and who gave nothing. It downloads
  as two spreadsheets (`.csv`: a row for each diver, or a row for everything
  anyone typed) and prints in black on white, or saves as a PDF. The record is
  `src/party/class-log.ts`; the screen is `src/screens/classroom/results.ts`.
- Your own question sets: whoever holds a class can write questions of their
  own under "Your question sets" in the Convocation, and tick them in the lobby
  beside the topics. A set is plain text. An empty line parts the questions;
  the first line is the question and each line under it an answer, with other
  spellings after a `|` stroke. Answers are written commonest first: the further
  down its question an answer stands, the deeper it sinks, and `[1]` to `[6]` at
  the end of a line sets the tier by hand. `Note:` says what counts, and `Not:`
  names a wrong answer to expect, with why after `--`. The page shows what the
  deep reads as you type, any line it cannot use, and lets you try an answer as
  a diver would type it. Sets are kept on the device, download as `.txt` files
  and load from them; a class is asked a set in the order written. On the
  results of a class, a refused answer to one of your own questions can be
  written into its set with "Count it next time". The format and the storage
  are `src/game/ownsets.ts`; the pages are `src/screens/classroom/sets.ts`.
- Music: eight recorded ambient tracks (made for the game on Suno) lie under the
  generated sound, two for each of the surface, the mid-depths, the abyss and
  the séance. A dive hears the bed of its depth; the two tracks of a place take
  turns, each coming in under the other's tail, from a random point. They
  stream from `music/` when first needed and are never part of the script
  (`src/audio/music.ts`). Settings has a Music switch beside the sound switch.

## Where things live

| Folder | What is in it | Owned by |
| --- | --- | --- |
| `src/game/` | Rules: matching, daily selection, omens, scoring, saves, share text and card | game |
| `src/render/` | The WebGL engraving of the sea, from moonlit surface to the Eye | game |
| `src/audio/` | Generated ambient sound, and the player for the music beds | game |
| `src/app.ts`, `src/ui/`, `src/styles/` | Screens and layout | game |
| `art/` | Colours, depth palette, fonts and the house style ("Ink & Phosphor") | art |
| `data/` | The question bank and the game's copy (`theme.json`) | questions |
| `packs/` | Class packs: question sets by subject, fetched when ticked (`packs/README.md`) | class packs |
| `build/` | Build steps: publishing the daily bank a question at a time, and the class packs, beside the game | game |
| `public/` | App icon, home-screen manifest and the music beds (`public/music/`, from `/mnt/project-files/music/`) | game |

Until `data/` arrives, the game plays from a small placeholder bank in
`src/content/`.

## Publishing

`.github/workflows/pages.yml` checks every pull request and publishes `main` to
GitHub Pages. It needs a one-time switch in the repository settings:
**Settings → Pages → Build and deployment → Source: GitHub Actions**.
