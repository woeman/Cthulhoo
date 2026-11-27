import { describe, expect, it } from 'vitest';
import { spreadLabels } from '../src/game/share';

describe('share card label layout', () => {
  it('keeps labels apart and in order', () => {
    const ys = spreadLabels([400, 405, 410, 900], 58, 360, 1050);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(58);
    expect(ys[0]).toBe(400);
    expect(ys[3]).toBe(900);
  });

  it('pushes a crowded bottom back up inside the chart', () => {
    const ys = spreadLabels([1000, 1010, 1020], 58, 360, 1050);
    expect(ys[2]).toBeLessThanOrEqual(1050);
    expect(ys[1]).toBeLessThanOrEqual(ys[2] - 58);
  });
});
