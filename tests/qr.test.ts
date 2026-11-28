import { describe, expect, it } from 'vitest';
import { QR_MAX_VERSION, qrCapacity, qrCode, qrPath, qrSvg } from '../src/ui/qr';

const rows = (m: boolean[][]) => m.map((r) => r.map((d) => (d ? '1' : '0')).join(''));
const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
};

describe('the join code', () => {
  it('holds what the standard says a code of each size holds', () => {
    const caps = Array.from({ length: QR_MAX_VERSION }, (_, i) => qrCapacity(i + 1));
    expect(caps).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213, 251, 287]);
  });

  it('is the code a real reader read', () => {
    // These were made by this code and read back by a QR reader (jsQR) on 2026-11-28, at every
    // size this maker knows. If one changes, read the new code with a phone before trusting it.
    expect(rows(qrCode('DAGON-417'))).toEqual([
      '111111101110101111111',
      '100000100110101000001',
      '101110100010001011101',
      '101110101101001011101',
      '101110101000101011101',
      '100000101011001000001',
      '111111101010101111111',
      '000000001001100000000',
      '100010111101011111001',
      '110100010101111110111',
      '111111110111010110010',
      '000110011100000110000',
      '011001110000100100101',
      '000000001010101111111',
      '111111101100111110110',
      '100000100111100010010',
      '101110101001011110110',
      '101110100101100011011',
      '101110100011001110100',
      '100000100110011100000',
      '111111101000111110101',
    ]);
    const link = qrCode('https://woeman.github.io/Cthulhoo/?class=DAGON-417');
    expect(link).toHaveLength(33);
    expect(fnv(rows(link).join('\n'))).toBe('39d4dd23');
    // Several blocks of error correction, dealt out in turn.
    const long = qrCode(`https://example.test/${'ab1-'.repeat(30)}`);
    expect(long).toHaveLength(49);
    expect(fnv(rows(long).join('\n'))).toBe('d12bcf24');
  });

  it('grows with the text, and says when a text is too long', () => {
    expect(qrCode('A')).toHaveLength(21);
    expect(qrCode('x'.repeat(14))).toHaveLength(21);
    expect(qrCode('x'.repeat(15))).toHaveLength(25);
    expect(qrCode('x'.repeat(287))).toHaveLength(65);
    expect(() => qrCode('x'.repeat(288))).toThrow();
    // Bytes are counted, not letters.
    expect(qrCode('é'.repeat(7))).toHaveLength(21);
    expect(qrCode('é'.repeat(8))).toHaveLength(25);
  });

  it('always carries the three finders and the timing lines', () => {
    for (const text of ['A', 'https://woeman.github.io/Cthulhoo/?class=DAGON-417', 'x'.repeat(250)]) {
      const m = qrCode(text);
      const n = m.length;
      const finder = (x0: number, y0: number) => {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 7; x++) {
            const ring = Math.max(Math.abs(x - 3), Math.abs(y - 3));
            expect(m[y0 + y][x0 + x], `${text.slice(0, 8)} finder at ${x0},${y0}`).toBe(ring !== 2);
          }
        }
      };
      finder(0, 0);
      finder(n - 7, 0);
      finder(0, n - 7);
      for (let i = 8; i < n - 8; i++) {
        expect(m[6][i]).toBe(i % 2 === 0);
        expect(m[i][6]).toBe(i % 2 === 0);
      }
      // The module beside the bottom-left finder that is always dark.
      expect(m[n - 8][8]).toBe(true);
    }
  });

  it('draws as one path with a quiet border, dark on light', () => {
    const m = qrCode('DAGON-417');
    const { d, size } = qrPath(m);
    expect(size).toBe(21 + 8);
    // Every dark module is covered once: the runs' lengths add up to the dark count.
    const dark = m.flat().filter(Boolean).length;
    const covered = [...d.matchAll(/h(\d+)v1/g)].reduce((n, x) => n + Number(x[1]), 0);
    expect(covered).toBe(dark);
    const svg = qrSvg('DAGON-417', { label: 'Join with your camera' });
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain('aria-label="Join with your camera"');
    expect(svg).toContain('fill="#fff"');
  });
});
