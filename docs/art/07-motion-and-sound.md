# 7. Motion and sound

[Back to the style bible](README.md)

This chapter is the brief for everything that moves or makes a noise. The game thread
builds the production renderer and the audio engine; this is what they should feel like.

## Motion

### The principle: heavy water

Nothing bounces. Everything moves as if it were deep under water: it starts slowly,
glides, and settles without overshoot. Idle things breathe once every seven seconds.

### Eases

| Token | Curve | Feels like | Use for |
|---|---|---|---|
| `--ease-surface` | `cubic-bezier(0.16, 1, 0.3, 1)` | rising, then settling for a long time | things arriving: blooms, telegrams, panels |
| `--ease-sink` | `cubic-bezier(0.7, 0, 0.84, 0)` | slow, then pulled under | things leaving: they sink, accelerating |
| `--ease-descent` | `cubic-bezier(0.65, 0, 0.35, 1)` | a cable paying out | depth changes, the gauge, the readout |
| `--ease-drift` | `cubic-bezier(0.37, 0, 0.63, 1)` | a slow swell | idle loops: breathing, swaying |

There is no spring and no back-ease in the system, on purpose.

### Durations

| Token | Time | Use for |
|---|---|---|
| `--dur-quick` | 160 ms | press, hover |
| `--dur-ui` | 280 ms | small state changes |
| `--dur-reveal` | 700 ms | a telegram lowering, a panel opening, something sinking away |
| `--dur-ink` | 1.2 s | ink bloom (a new specimen, a heading), the zone theme cross-fade |
| `--dur-descent` | 2.4 s | one answer's descent |
| `--dur-breath` | 7 s | the idle cycle: seals breathe, the lure pulses, the telegram sways |

### The named movements

- **Breathe.** Brightness rises and falls over 7 s, ±10 %. Never faster, never in step with
  another breathing thing (offset each by a random phase).
- **Ink bloom.** New things arrive like ink dropped in water: blurred and spread out, then
  drawing together and sharpening over 1.2 s, ease `surface`.
- **Shudder.** A refused answer shudders once and stops, like a hull under pressure: a few
  pixels side to side, damped to nothing in 520 ms.
- **Sink.** Things leave downward, accelerating, fading as they go: 700 ms, ease `sink`.
- **Lowered.** The telegram comes down from above on its string and then sways on the 7 s cycle.
- **Descent.** Depth eases over 2.4 s in and out. The world moves; the question plate does not.

### The choreography of one answer

| Time | What happens |
|---|---|
| typing | each key clacks (see Sound); the letters appear with no animation at all, like a typewriter |
| 0 ms | the player presses Descend or Enter: the button presses in (160 ms) |
| 160–600 ms | a held breath: the field's text stays, the ambience dips slightly, nothing moves |
| 600 ms | **accepted:** the specimen tag ink-blooms in under the field; its seal starts to breathe |
| 600 ms–3.0 s | the world descends by the answer's metres: background, gauge bob and readout ease together (2.4 s, `descent`); marine snow streams upward in proportion to the speed |
| on crossing a zone | the zone title blooms in at the moment of crossing, holds about 2.5 s, fades over 700 ms; the interface colours cross-fade over 1.2 s |
| 600 ms | **refused:** the field shudders, a struck-through Refused tag blooms in; no descent; in deep zones, the madness pulses once |

The first time each day that the player passes 200 m, the ink wash rises up the whole
screen. Never skip it, never speed it up.

### Particles

- **Marine snow.** Pale specks of drifting matter. None at the surface; it fades in from 200 m
  and is at full density by about 1,250 m. It always drifts **upward**, slowly when you are still
  (a few pixels per second) and fast when you descend, so the player feels the sinking. Flakes
  are 1 to 3 px; when you sink fast they stretch a little in the direction of travel. Keep it
  under about 150 flakes on a phone.
- **Motes.** Living lights, from 350 m down, in the zone's glow. Each blinks slowly on its own
  phase of the 7 s cycle. When the player gives a rare answer (tier 4 or higher), the motes near
  the plate brighten together for one breath, as if the deep noticed.
- **Never** confetti, sparkles, stars, coins or bursts. Success is celebrated with light, not
  with things flying about.

### The madness

As you go deeper the text starts to go wrong. [`art/js/madness.js`](../../art/js/madness.js)
does this to any short piece of text:

| Level | What happens |
|---|---|
| above 0.15 | now and then a letter is briefly the wrong letter, a look-alike from another alphabet |
| above 0.35 | colours split at the edges of the text (a faint chromatic fringe) |
| above 0.5 | letters twitch; marks crawl onto them like barnacles |
| above 0.7 | a letter becomes a glyph of the Drowned Script for a moment |
| above 0.85 | a whole word is replaced by something the deep is whispering: *below*, *deeper*, *we wait*, *come down*… |

`madnessForDepth(m)` gives the level: 0 until 2,500 m, rising to 0.55 at 6,000 m, and to 1
at 7,000 m. Episodes come every 6 s or so near the threshold and every half second at the floor.

```js
import { createMadness, madnessForDepth } from './art/js/madness.js';
const mad = createMadness(document.querySelector('.cth-zone-title__name'));
mad.set(madnessForDepth(5200));
mad.pulse();      // one sharp episode, for example on a Refused answer
mad.destroy();    // puts the original text back
```

Rules: headings, zone titles, flavour text and the log only. **Never** the question, the
answer field, buttons or numbers. Screen readers always get the clean text. With reduced
motion the text never changes; only a faint fixed fringe shows.

### Reduced motion

When the player's device asks for reduced motion: every animation becomes a 200 ms fade,
depth changes are instant, the background stops drifting and the madness stops rewriting
text. The CSS, `depth.js`, `madness.js` and the concept shader already do this.

## Sound

### The principle: dread is a held note

The deep is not loud. It is enormous and patient. Cthulhoo's sound is a slow, quiet bed that
changes with depth, with very few events on top. **No jump scares, no stingers louder than the
bed, no buzzers.** Good headphones should reward the player; a phone speaker should still
carry the mood.

All sound must be original: synthesised in the browser, or recorded for this game. No stock
library sounds unless their licence is checked and recorded.

**Guess:** I assume Web Audio synthesis, because it is small, endless and can follow depth
smoothly. Recorded sounds would fit the same brief.

### The key

Everything is built on **D**. One drone on D never stops, from the surface to the floor. The
harmony above it darkens interval by interval as you sink. The interface sounds stay in
perfect tune; below 4,000 m the ambient bed slowly sinks out of tune with them (down to a
quarter-tone flat by the floor), so the world and the instruments stop agreeing.

### Zone by zone

| Zone | What you hear | Harmony | Pacing |
|---|---|---|---|
| **The Shallows** | wind in rigging, gulls far off, water slapping the hull, a bell buoy | open fifth: D and A | the bell buoy rings on the 7 s cycle, not every time |
| **The Gloaming** | the hull creaks as the pressure builds; the wind is gone; a sonar ping, unanswered | the minor third enters: D, F, A | a ping every two cycles (14 s) with a long echo |
| **The Stygian Dark** | a sub-bass drone, a low choir pitched an octave down singing "oo", the faint clicks of living things all around | the tritone enters: D and A-flat under the third | clicks are random and sparse; the choir swells over several cycles |
| **The Cyclopean Abyss** | stone resonance: deep slow thuds like masonry settling far away; bowed metal gliding; the choir is further off | clusters a semitone apart: D with E-flat, A with B-flat | one stone thud every few cycles; long silences |
| **The Dreaming Deep** | breathing, on the 7 s cycle; a heartbeat that is not yours; the choir is very close | a chord that never resolves (D, F, A-flat, C), drifting a few cents | the heartbeat is about 48 per minute and never lines up with the breath |
| **The floor, 7,000 m** | everything stops for two seconds. Then the heartbeat. As the Eye opens, the filter opens fully for the first time since the surface and the choir blooms into a vast chord (D, F-sharp, A, B-flat) | the first consonance since the surface, with one wrong note in it | it should sound like an answer. It should not. |

### Depth controls

These change continuously with depth (interpolate between the points, exponentially for
frequencies):

| Depth | 0 m | 200 m | 1,000 m | 4,000 m | 6,500 m | 7,000 m |
|---|---|---|---|---|---|---|
| low-pass on the bed | 12 kHz | 4 kHz | 1.2 kHz | 600 Hz | 350 Hz | fully open |
| reverb decay | 1.5 s | 2.5 s | 4 s | 7 s | 9 s | 9 s |
| reverb pre-delay | 20 ms | 35 ms | 60 ms | 100 ms | 120 ms | 120 ms |
| drone level | −30 dB | −26 dB | −20 dB | −14 dB | −14 dB | −12 dB |
| bed detune | 0 | 0 | 0 | 0 | −35 cents | −50 cents |

Each zone's own layer crossfades in over 200 m around its boundary, so a fast descent
smears through layers and a slow one lets each settle. **Guess:** all values are starting
points for tuning by ear.

### Instruments

1. **The drone.** A sine at D2 (73 Hz) plus a soft saw at D3 through a low-pass, with the filter
   breathing on a 7 s cycle. Always add a quiet harmonic an octave up so phones can hear it.
2. **Bell buoy.** An FM bell with slightly wrong partials, on A, far away.
3. **Hull creaks.** Filtered noise through a sweeping resonant band-pass; triggered when the
   depth changes quickly, more often deeper.
4. **Sonar ping.** A pure tone on A5 with a small downward bend and a very long echo.
5. **The choir.** Sawtooth pads through formant filters (vowels "oo" to "ah"), voiced low.
6. **Bowed metal.** A resonant filter on noise, gliding slowly, like a waterphone.
7. **Stone.** Low impulses with a long, dark reverb.
8. **Clicks.** Very short noise bursts, panned randomly, like shrimp and things that hunt.
9. **Breath.** Pink noise through a band-pass that opens and closes over 7 s.
10. **The heartbeat.** Two low thumps, lub-dub, felt more than heard.

### Interface sounds

| Event | Sound | Level |
|---|---|---|
| a key typed | a typewriter key, picked from 4 to 6 variants, pitch ±3 % | very quiet |
| space / backspace | a heavier thunk / a dry click | very quiet |
| Descend pressed | the typewriter's carriage bell, in D, and the carriage return | quiet |
| every 100 m of descent | a brass dial tick, slowing as the descent eases; a deeper clunk at each 1,000 m | quiet |
| accepted, tier 1 | a single wooden knock on the hull | quiet |
| tier 2 | a soft bell on A | |
| tier 3 | the bell and a choir "oo" (D and A) | |
| tier 4 | adds the minor third and a shimmer | |
| tier 5 | adds the tritone and a low swell | |
| tier 6 | a full choir chord with a slow glide that never lands, and a breath; optionally the deep whispers the answer back | the loudest event in the game, still under the bed's peak |
| refused | a muffled low cluster (D, E-flat, E at the bottom of a felted piano) and a groan from the hull. Never a buzzer. | quiet |
| crossing into a zone | one deep stroke on a bowed gong, with the new layer fading in | |
| a telegram | a short burst of telegraph ticking and a paper rustle | quiet |
| the streak lantern lights | a match strike | quiet |
| share | a cork pulled and a bottle sloshing | quiet |

Rarer answers do not get louder so much as **stranger**: each tier adds one interval from the
zone that tier belongs to.

### Mixing and delivery

- **Sound is off until the first tap**, as browsers require. The first tap fades the bed in over
  3 s. The bell icon is one master mute, remembered on the device.
- **Guess:** aim for about −20 LUFS for the ambient bed on the web, peaks under −3 dBFS, and
  interface sounds 4 to 6 dB above the bed. Tune by ear on a phone speaker and on headphones.
- Phone speakers play almost nothing below 150 Hz: every low element needs a quieter copy an
  octave or two up.
- Pause the bed when the tab is hidden, and fade it back in over 1 s on return.
- **Guess (phone app):** haptics as a soft tick per 100 m of descent, a long low pulse on Refused,
  and the heartbeat pattern at the floor. Respect the phone's silent switch.

### A Web Audio sketch

```
oscillators / noise / samples
  → per-zone layer gains (crossfade by depth)
  → bed bus → low-pass (cutoff by depth) → detune by depth
  → convolver reverb (decay by depth) → master
UI sounds → UI bus (no depth filter, always in tune) → master
master → compressor (gentle) → destination
```

The build thread's `src/audio` owns the real implementation.
