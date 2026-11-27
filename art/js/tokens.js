/** Cthulhoo design tokens (ES module)
 * GENERATED from art/tokens/tokens.json by art/tools/build-tokens.mjs. Do not edit by hand.
 * Style: Ink & Phosphor · v0.1.0
 */

export const META = {
  "name": "Cthulhoo design tokens",
  "style": "Ink & Phosphor",
  "version": "0.1.0",
  "note": "Single source of truth. Run `node art/tools/build-tokens.mjs` to regenerate tokens.css. Colours are sRGB hex; interpolation happens in OKLCH."
};
export const ZONES = [
  {
    "key": "surface",
    "name": "The Shallows",
    "short": "Shallows",
    "science": "Epipelagic",
    "subtitle": "Fog on the water, the last of the sun.",
    "from": 0,
    "to": 200,
    "scheme": "paper",
    "ui": {
      "ground": "#e7ddc6",
      "plate": "#efe7d4",
      "ink": "#1d1813",
      "inkMuted": "#5b5143",
      "rule": "#3b3227",
      "glow": "#7a5810",
      "accent": "#9e2f22",
      "action": "#8e2b1d",
      "onAction": "#f7efdc",
      "refused": "#a2321f",
      "focus": "#8e2b1d"
    }
  },
  {
    "key": "twilight",
    "name": "The Gloaming",
    "short": "Gloaming",
    "science": "Mesopelagic",
    "subtitle": "Where the light gives up.",
    "from": 200,
    "to": 1000,
    "scheme": "water",
    "ui": {
      "ground": "#0f2530",
      "plate": "#143241",
      "ink": "#e3ece8",
      "inkMuted": "#9db5b4",
      "rule": "#4f7477",
      "glow": "#f0b562",
      "accent": "#8fd0e8",
      "action": "#f0b562",
      "onAction": "#22160a",
      "refused": "#ff8a6e",
      "focus": "#f0b562"
    }
  },
  {
    "key": "midnight",
    "name": "The Stygian Dark",
    "short": "Stygian",
    "science": "Bathypelagic",
    "subtitle": "Lights that are not ours.",
    "from": 1000,
    "to": 4000,
    "scheme": "void",
    "ui": {
      "ground": "#061420",
      "plate": "#0b2030",
      "ink": "#dcf4f5",
      "inkMuted": "#86aab0",
      "rule": "#2d5a66",
      "glow": "#58d3ea",
      "accent": "#ff5a4c",
      "action": "#58d3ea",
      "onAction": "#04212a",
      "refused": "#ff6a5c",
      "focus": "#58d3ea"
    }
  },
  {
    "key": "abyss",
    "name": "The Cyclopean Abyss",
    "short": "Cyclopean",
    "science": "Abyssopelagic",
    "subtitle": "Stones cut by no human hand.",
    "from": 4000,
    "to": 6000,
    "scheme": "void",
    "ui": {
      "ground": "#050b12",
      "plate": "#0b1420",
      "ink": "#e6f2dc",
      "inkMuted": "#9aab93",
      "rule": "#364a3c",
      "glow": "#b6ec66",
      "accent": "#ff5470",
      "action": "#b6ec66",
      "onAction": "#142204",
      "refused": "#ff6b80",
      "focus": "#b6ec66"
    }
  },
  {
    "key": "hadal",
    "name": "The Dreaming Deep",
    "short": "Dreaming",
    "science": "Hadopelagic",
    "subtitle": "It knows you are coming.",
    "from": 6000,
    "to": 7000,
    "scheme": "void",
    "ui": {
      "ground": "#07040d",
      "plate": "#130a1e",
      "ink": "#f6e9f6",
      "inkMuted": "#b9a0bf",
      "rule": "#553a64",
      "glow": "#ff69d3",
      "accent": "#ffc95c",
      "action": "#ff69d3",
      "onAction": "#2a0620",
      "refused": "#ff8080",
      "focus": "#ffc95c"
    }
  }
];
export const FLOOR = {
  "depth": 7000,
  "name": "The Drowned City",
  "subtitle": "Its true name is only ever written in glyphs.",
  "glyphName": [
    "g-eye",
    "g-coil",
    "g-gate",
    "g-sleeper"
  ]
};
export const DEPTH_STOPS = [
  {
    "depth": 0,
    "water": "#9aaea9",
    "fog": "#e3dccb",
    "glow": "#fff2cc",
    "accent": "#9e2f22",
    "note": "Fog, bone paper, sealing-wax red"
  },
  {
    "depth": 200,
    "water": "#2c5360",
    "fog": "#7a9799",
    "glow": "#f0b562",
    "accent": "#8fd0e8",
    "note": "Your lamp is the only warm light; eyes shine back"
  },
  {
    "depth": 850,
    "water": "#102b3a",
    "fog": "#23404d",
    "glow": "#e9a955",
    "accent": "#8fd0e8",
    "note": "Hold the Gloaming"
  },
  {
    "depth": 1000,
    "water": "#0a2231",
    "fog": "#1a3947",
    "glow": "#58d3ea",
    "accent": "#ff5a4c",
    "note": "Bioluminescent cyan; red lures"
  },
  {
    "depth": 3400,
    "water": "#061420",
    "fog": "#10263a",
    "glow": "#4fd0e6",
    "accent": "#ff5a4c",
    "note": "Hold the Stygian Dark"
  },
  {
    "depth": 4000,
    "water": "#050c15",
    "fog": "#112032",
    "glow": "#b6ec66",
    "accent": "#ff5470",
    "note": "Eldritch green on cut stone"
  },
  {
    "depth": 5300,
    "water": "#05080f",
    "fog": "#131a30",
    "glow": "#aee862",
    "accent": "#ff5470",
    "note": "Hold the Cyclopean Abyss"
  },
  {
    "depth": 5700,
    "water": "#05060f",
    "fog": "#171634",
    "glow": "#9c7cff",
    "accent": "#ff8a5c",
    "note": "The colours begin to go wrong"
  },
  {
    "depth": 6000,
    "water": "#06040d",
    "fog": "#1f1034",
    "glow": "#ff69d3",
    "accent": "#ffc95c",
    "note": "A colour out of space; the gold of the Eye"
  },
  {
    "depth": 6750,
    "water": "#050309",
    "fog": "#2a0f38",
    "glow": "#ff70d6",
    "accent": "#ffc95c",
    "note": "Hold the Dreaming Deep"
  },
  {
    "depth": 7000,
    "water": "#030107",
    "fog": "#3a1650",
    "glow": "#ffe1f5",
    "accent": "#ffe08a",
    "note": "The Drowned City: pearl light, the Eye fully open"
  }
];
export const INTERPOLATION = {
  "space": "oklch",
  "hue": "shorter",
  "ease": "smoothstep",
  "chromaDip": {
    "water": 0,
    "fog": 0,
    "glow": 0.5,
    "accent": 0.4
  },
  "chromaDipNote": "Between zones the light dies before the next light appears: chroma dips at the midpoint of a transition, scaled by how far the hue travels (full dip at 60 degrees or more)."
};
export const TIERS = [
  {
    "n": 1,
    "key": "commonplace",
    "name": "Commonplace",
    "blurb": "Everyone says it.",
    "onDark": "#e9e1cf",
    "onPaper": "#665e51"
  },
  {
    "n": 2,
    "key": "curious",
    "name": "Curious",
    "blurb": "A little further from shore.",
    "onDark": "#f0b562",
    "onPaper": "#8a5810"
  },
  {
    "n": 3,
    "key": "obscure",
    "name": "Obscure",
    "blurb": "Known to lanternfish and few others.",
    "onDark": "#58d3ea",
    "onPaper": "#17687a"
  },
  {
    "n": 4,
    "key": "arcane",
    "name": "Arcane",
    "blurb": "Carved, not written.",
    "onDark": "#b6ec66",
    "onPaper": "#436816"
  },
  {
    "n": 5,
    "key": "forbidden",
    "name": "Forbidden",
    "blurb": "You should not know this.",
    "onDark": "#ff69d3",
    "onPaper": "#992a7a"
  },
  {
    "n": 6,
    "key": "unspeakable",
    "name": "Unspeakable",
    "blurb": "The deep repeats it back to you.",
    "onDark": "#f1e2ff",
    "onPaper": "#5d3f94",
    "iridescent": true
  }
];
export const REFUSED = {
  "key": "refused",
  "name": "Refused",
  "blurb": "The deep does not accept this."
};
export const TYPE = {
  "families": {
    "display": "\"IM Fell English\", \"EB Garamond\", Georgia, serif",
    "displayCaps": "\"IM Fell English SC\", \"IM Fell English\", Georgia, serif",
    "text": "\"EB Garamond\", Georgia, \"Times New Roman\", serif",
    "log": "\"Special Elite\", \"Courier Prime\", \"Courier New\", monospace"
  },
  "packages": {
    "display": "@fontsource/im-fell-english",
    "displayCaps": "@fontsource/im-fell-english-sc",
    "text": "@fontsource-variable/eb-garamond",
    "log": "@fontsource/special-elite"
  },
  "scale": {
    "0": "clamp(1.00rem, 0.96rem + 0.20vw, 1.10rem)",
    "1": "clamp(1.20rem, 1.12rem + 0.40vw, 1.40rem)",
    "2": "clamp(1.45rem, 1.30rem + 0.75vw, 1.85rem)",
    "3": "clamp(1.80rem, 1.55rem + 1.25vw, 2.50rem)",
    "4": "clamp(2.30rem, 1.85rem + 2.25vw, 3.50rem)",
    "5": "clamp(3.00rem, 2.20rem + 4.00vw, 5.20rem)",
    "6": "clamp(3.80rem, 2.40rem + 7.00vw, 8.00rem)",
    "-2": "clamp(0.72rem, 0.70rem + 0.10vw, 0.78rem)",
    "-1": "clamp(0.84rem, 0.81rem + 0.15vw, 0.92rem)"
  },
  "leading": {
    "tight": 1.05,
    "display": 1.15,
    "text": 1.5,
    "log": 1.6
  },
  "tracking": {
    "caps": "0.12em",
    "capsWide": "0.28em",
    "log": "0.02em"
  }
};
export const MOTION = {
  "ease": {
    "surface": "cubic-bezier(0.16, 1, 0.3, 1)",
    "sink": "cubic-bezier(0.7, 0, 0.84, 0)",
    "descent": "cubic-bezier(0.65, 0, 0.35, 1)",
    "drift": "cubic-bezier(0.37, 0, 0.63, 1)"
  },
  "duration": {
    "quick": "160ms",
    "ui": "280ms",
    "reveal": "700ms",
    "ink": "1200ms",
    "descent": "2400ms",
    "breath": "7000ms"
  }
};
export default { META, ZONES, FLOOR, DEPTH_STOPS, INTERPOLATION, TIERS, REFUSED, TYPE, MOTION };
