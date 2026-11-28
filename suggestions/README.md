# Suggesting answers for Cthulhoo

Cthulhoo is a daily trivia game. Each question accepts many right answers, and the rarer the
right answer, the deeper the player dives. The owner's first rule: **never refuse an answer a
player knows to be correct.** This folder lets helpers, people or AI assistants, suggest the
answers the game is still missing.

## What to do

1. Open [upcoming.md](upcoming.md) for the next days' questions, soonest first.
2. For each question, open its file in [questions/](questions/). It lists every answer the game
   accepts now, with the other spellings it takes, and what it refuses on purpose and why.
3. List every correct answer that is missing, from common to very obscure, and other spellings
   people really type for answers already there: other languages' names, old names, short
   forms, nicknames, common misspellings. Leave out anything you aren't sure is right.
4. Put your list, in the format below, in one new file:
   `suggestions/incoming/YYYY-MM-DD-<your name>.md`. Open a pull request with only that file.
   Please don't edit `data/` or anything else: the content maintainer checks every suggestion
   and adds the good ones to the game.

If you can't open a pull request, give the owner the same list in a reply, and they'll pass it on.

## Format

    ## <question id>
    + <missing answer>
    + <missing answer> = <other spelling> | <other spelling>
    ~ <answer already accepted> = <new spelling> | <new spelling>
    ! <answer refused on purpose> -- <why it is in fact right>

- One suggestion per line, under the question's id (shown at the top of its file).
- `+` is a right answer the game doesn't accept at all; other spellings may follow `=`,
  separated by ` | ` (names can contain commas).
- `~` is a new spelling for an answer the game already accepts: name that answer first.
- `!` is something under "Refused on purpose" that is in fact a right answer.
- A short note may follow ` -- `. A tier guess may end the line in brackets, like `[4]`
  (1 is what most people say, 5 is for experts).
- No need to suggest variants the game already forgives: capitals, accents, punctuation, a
  leading "the", simple plurals, small typos, a title in front ("King", "Sir", "Dr"), the
  question's own words at the end ("Cheddar cheese") and a year at the end ("Toy Story 1995").

An example of the format (check the current lists before suggesting anything):

    ## mythical-creatures
    + Squonk -- the weeping creature of Pennsylvania lumberjack tales [4]
    + Ahool -- a giant bat said to live in the forests of Java [5]
    ~ Kitsune = Kitsune fox
    ! Orc -- older than Tolkien: in Ariosto's Orlando Furioso the orc is a sea monster

## What happens next

Each suggestion is checked against the game's matching, so that a new spelling never takes
over another answer's typos, given a tier, and published in the next update of the game.
Wrong, doubtful or duplicate suggestions are left out. A merged pull request means it was read.

The lists in `questions/` and `upcoming.md` are written by `scripts/export-answer-lists.mjs`
from `data/`, and refreshed whenever the answers change.
