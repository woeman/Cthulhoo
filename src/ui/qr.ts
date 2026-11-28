// A small QR code maker, so a class can join from the big screen by pointing a
// phone at it. Bytes only (a link), error correction level M (about 15% of the
// code may be hidden or smudged, which a projector asks for), versions 1 to 12
// (a link of up to 287 characters). The method is ISO/IEC 18004's; the code is
// ours, and tests/qr.test.ts holds codes that a real reader has read.

/** The code as rows of modules, true for dark. No quiet zone. */
export type QrModules = boolean[][];

/** Blocks and error-correction bytes per block at level M, by version. */
const BLOCKS: ReadonlyArray<readonly [blocks: number, ecc: number]> = [
  [0, 0],
  [1, 10],
  [1, 16],
  [1, 26],
  [2, 18],
  [2, 24],
  [4, 16],
  [4, 18],
  [4, 22],
  [5, 22],
  [5, 26],
  [5, 30],
  [8, 22],
];
export const QR_MAX_VERSION = BLOCKS.length - 1;

const sizeOf = (version: number) => 17 + 4 * version;

/** Modules left for data and error correction once the fixed patterns are drawn. */
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

/** Bytes of data a version holds at level M. */
export function qrCapacity(version: number): number {
  const [blocks, ecc] = BLOCKS[version];
  const data = Math.floor(rawModules(version) / 8) - blocks * ecc;
  // Less the mode (4 bits) and the count (8 bits, 16 from version 10).
  return data - (version < 10 ? 2 : 3);
}

function alignmentCentres(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = sizeOf(version) - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

// ---------------------------------------------------------------- Reed-Solomon over GF(256)

function mul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function divisor(degree: number): number[] {
  const out = new Array<number>(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = mul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = mul(root, 2);
  }
  return out;
}

function remainder(data: number[], div: number[]): number[] {
  const out = div.map(() => 0);
  for (const b of data) {
    const factor = b ^ (out.shift() as number);
    out.push(0);
    div.forEach((coef, i) => (out[i] ^= mul(coef, factor)));
  }
  return out;
}

// ---------------------------------------------------------------- the codewords

function utf8(text: string): number[] {
  return Array.from(new TextEncoder().encode(text));
}

/** The data bytes for a version: mode, count, the text, a terminator, then padding. */
function dataCodewords(bytes: number[], version: number): number[] {
  const [blocks, ecc] = BLOCKS[version];
  const capacity = Math.floor(rawModules(version) / 8) - blocks * ecc;
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  push(0, Math.min(4, capacity * 8 - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  for (let pad = 0xec; bits.length < capacity * 8; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out: number[] = [];
  for (let i = 0; i < bits.length; i += 8) out.push(bits.slice(i, i + 8).reduce((n, b) => (n << 1) | b, 0));
  return out;
}

/** Data split into blocks, each with its error correction, then dealt out a byte at a time. */
function interleave(data: number[], version: number): number[] {
  const [blocks, ecc] = BLOCKS[version];
  const raw = Math.floor(rawModules(version) / 8);
  const short = blocks - (raw % blocks);
  const shortLen = Math.floor(raw / blocks);
  const div = divisor(ecc);
  const parts: number[][] = [];
  for (let i = 0, k = 0; i < blocks; i++) {
    const dat = data.slice(k, k + shortLen - ecc + (i < short ? 0 : 1));
    k += dat.length;
    const check = remainder(dat, div);
    if (i < short) dat.push(0);
    parts.push(dat.concat(check));
  }
  const out: number[] = [];
  for (let i = 0; i < parts[0].length; i++) {
    parts.forEach((part, j) => {
      // The short blocks' padding byte is not part of the code.
      if (i !== shortLen - ecc || j >= short) out.push(part[i]);
    });
  }
  return out;
}

// ---------------------------------------------------------------- the grid

interface Grid {
  size: number;
  dark: boolean[][];
  /** Finder, timing, alignment and format modules: never masked, never data. */
  fixed: boolean[][];
}

function emptyGrid(version: number): Grid {
  const size = sizeOf(version);
  const make = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, dark: make(), fixed: make() };
}

function setFixed(g: Grid, x: number, y: number, dark: boolean) {
  g.dark[y][x] = dark;
  g.fixed[y][x] = true;
}

function drawFixed(g: Grid, version: number) {
  const { size } = g;
  for (let i = 0; i < size; i++) {
    setFixed(g, 6, i, i % 2 === 0);
    setFixed(g, i, 6, i % 2 === 0);
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && x < size && y >= 0 && y < size) setFixed(g, x, y, dist !== 2 && dist !== 4);
      }
    }
  };
  finder(3, 3);
  finder(size - 4, 3);
  finder(3, size - 4);
  const centres = alignmentCentres(version);
  const last = centres.length - 1;
  centres.forEach((cx, i) => {
    centres.forEach((cy, j) => {
      // Not where the three finders sit.
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) setFixed(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    });
  });
  drawFormat(g, 0);
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFixed(g, a, b, dark);
      setFixed(g, b, a, dark);
    }
  }
}

/** The format modules: level M and the mask, each written twice. */
function drawFormat(g: Grid, mask: number) {
  const { size } = g;
  // Level M is 00, so the five data bits are the mask alone.
  const data = mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) setFixed(g, 8, i, bit(i));
  setFixed(g, 8, 7, bit(6));
  setFixed(g, 8, 8, bit(7));
  setFixed(g, 7, 8, bit(8));
  for (let i = 9; i < 15; i++) setFixed(g, 14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) setFixed(g, size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) setFixed(g, 8, size - 15 + i, bit(i));
  setFixed(g, 8, size - 8, true);
}

/** The codewords, laid in the two-wide column that winds up and down from the bottom right. */
function drawData(g: Grid, codewords: number[]) {
  const { size } = g;
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (!g.fixed[y][x] && i < codewords.length * 8) {
          g.dark[y][x] = ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
          i++;
        }
      }
    }
  }
}

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** Masking is its own undoing: apply it twice and the grid is as it was. */
function applyMask(g: Grid, mask: number) {
  const fn = MASKS[mask];
  for (let y = 0; y < g.size; y++) for (let x = 0; x < g.size; x++) if (!g.fixed[y][x] && fn(x, y)) g.dark[y][x] = !g.dark[y][x];
}

/** How hard a grid is to read: long runs, blocks, shapes like a finder, and an uneven share of dark. */
function penalty(g: Grid): number {
  const { size, dark } = g;
  let score = 0;
  const line = (get: (i: number) => boolean) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && get(i) === get(i - 1)) run++;
      else {
        if (run >= 5) score += run - 2;
        run = 1;
      }
    }
    // 1:1:3:1:1 dark with four light on one side reads as a finder.
    for (let i = 0; i + 10 < size; i++) {
      const p = (k: number) => get(i + k);
      const core = (o: number) => p(o) && !p(o + 1) && p(o + 2) && p(o + 3) && p(o + 4) && !p(o + 5) && p(o + 6);
      if (core(0) && !p(7) && !p(8) && !p(9) && !p(10)) score += 40;
      if (!p(0) && !p(1) && !p(2) && !p(3) && core(4)) score += 40;
    }
  };
  for (let y = 0; y < size; y++) line((x) => dark[y][x]);
  for (let x = 0; x < size; x++) line((y) => dark[y][x]);
  let total = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (dark[y][x]) total++;
      if (x + 1 < size && y + 1 < size && dark[y][x] === dark[y][x + 1] && dark[y][x] === dark[y + 1][x] && dark[y][x] === dark[y + 1][x + 1]) score += 3;
    }
  }
  score += Math.floor(Math.abs((total * 20) / (size * size) - 10)) * 10;
  return score;
}

/**
 * The QR code for a text (a link). Throws when it is too long for the versions
 * this maker knows (see QR_MAX_VERSION and qrCapacity).
 */
export function qrCode(text: string): QrModules {
  const bytes = utf8(text);
  let version = 1;
  while (version <= QR_MAX_VERSION && qrCapacity(version) < bytes.length) version++;
  if (version > QR_MAX_VERSION) throw new Error('That is too long for a code.');
  const g = emptyGrid(version);
  drawFixed(g, version);
  drawData(g, interleave(dataCodewords(bytes, version), version));
  let best = 0;
  let least = Infinity;
  for (let mask = 0; mask < MASKS.length; mask++) {
    applyMask(g, mask);
    drawFormat(g, mask);
    const p = penalty(g);
    if (p < least) {
      least = p;
      best = mask;
    }
    applyMask(g, mask);
  }
  applyMask(g, best);
  drawFormat(g, best);
  return g.dark;
}

/**
 * The code as one SVG path of unit squares, with the quiet border a reader
 * needs. Draw it dark on light: `size` is the side of its viewBox.
 */
export function qrPath(modules: QrModules, quiet = 4): { d: string; size: number } {
  let d = '';
  modules.forEach((row, y) => {
    // One stroke for each run of dark modules in a row.
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      let end = x;
      while (end + 1 < row.length && row[end + 1]) end++;
      d += `M${x + quiet} ${y + quiet}h${end - x + 1}v1h-${end - x + 1}z`;
      x = end;
    }
  });
  return { d, size: modules.length + quiet * 2 };
}

/** The code as SVG markup: dark modules in `ink` on a `paper` square. */
export function qrSvg(text: string, opts: { ink?: string; paper?: string; cls?: string; label?: string } = {}): string {
  const { d, size } = qrPath(qrCode(text));
  const label = opts.label ? ` role="img" aria-label="${opts.label.replace(/[&<>"]/g, '')}"` : ' aria-hidden="true"';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" class="${opts.cls ?? 'qr'}" shape-rendering="crispEdges"${label}><rect width="${size}" height="${size}" fill="${opts.paper ?? '#fff'}"/><path d="${d}" fill="${opts.ink ?? '#000'}"/></svg>`;
}
