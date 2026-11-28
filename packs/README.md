# Class packs

Topic question sets for classrooms and parties (finance, economics, business
ethics and more). A host ticks which packs a dive or a party draws from. Packs
are **never** part of the daily dive: they live here, not in `data/`.

| File | What it is |
| ---- | ---------- |
| `packs/<topic>.json` | One pack: `{ "pack": { id, name, title, blurb, group, order, asOf }, "prompts": [ ... ] }`. Built, do not edit by hand. |
| `packs/index.json` | The list of packs the game's tick-boxes read. Built. |
| `packs/src/<topic>/pack.json` | The pack's name, blurb, group and order. |
| `packs/src/<topic>/NN-name.txt` | One question, in the plain-text format below. |
| `packs/src/listings/*.csv` | Snapshots of exchange listings, for the listed-company questions. |

Prompts are in exactly the daily format (see `docs/content.md`), so the same
matcher judges them. Three extra optional fields: `section` (a syllabus label,
30 characters at most), `asOf` and `source` (for lists that date).

Rules: every prompt id starts with its pack id and a dash; `category` stays one
of the ten daily keys; never rename an id or an answer's shown name once a pack
is live; most prompts should have 15 or more answers.

## Writing a question

```
id: finance-stock-exchanges
text: Name a stock exchange.
flavor: One eerie line, 110 characters at most.
rules: One plain sentence on what counts.
section: Markets
---
1 ASX | Australian Securities Exchange | Sydney
6 Vancouver Stock Exchange | VSE :: True lore, 170 characters at most.
2* Tug of war | Tug-of-war
x Dow Jones | S&P 500 :: The reason shown for this wrong answer.
- Decoy one | Decoy two
```

A line is a tier (1 to 6), the name shown, then other spellings after ` | `,
then lore after ` :: `. `2*` marks an Open Secret, `x` a trap with its reason,
`-` decoys. Lines starting with `#` are ignored.

Listed-company questions add `listing: nasdaq-listed.csv` (every company in the
snapshot is accepted at tier 5) and `curated: us-companies.inc` (hand-picked
companies with tiers, written `tier TICKER | shown name | spellings`). To
refresh a listing, replace the CSV with a newer snapshot, rebuild, and update
`asOf` and the `source` line.

## Building and checking

```
node scripts/build-packs.mjs        # writes packs/*.json and packs/index.json
node scripts/validate-content.mjs   # checks data/ and packs/; fails if the index is stale
```

## Questions reused from the daily game

A source file `packs/src/<pack>/NN-<daily id>.json` is a daily question used in
a pack under the id `<pack>-<daily id>`. While that daily question is in
`data/`, `node scripts/build-packs.mjs` takes its wording, answers, refusals
and decoys from there (the pack keeps its own section and dates), so after any
change to a daily question, run the builder again. `node
scripts/validate-content.mjs` fails when a reused question has fallen behind.
