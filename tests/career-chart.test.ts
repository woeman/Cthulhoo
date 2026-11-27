import { describe, expect, it } from 'vitest';
import {
  DAILY_TICKS,
  FLOOR,
  beyondFloor,
  bottomDepth,
  chartSummary,
  cleanBeyond,
  dateLabel,
  dateTicks,
  dayAtX,
  dayScale,
  dayX,
  depthAtY,
  depthMarks,
  depthY,
  driftCount,
  segmentMeetsBox,
  sheetLayout,
  soundingsBelow,
  tickDays,
  waterStops,
  type DepthScale,
} from '../src/ui/career-chart';
import { computeCareer, type CareerPoint } from '../src/game/career';
import type { DayRecord, MilestoneDef } from '../src/game/types';

const S: DepthScale = { top: 34, floorH: 560, band: 124, beyond: [15000, 30000, 60000] };
const M = (depth: number): MilestoneDef => ({ depth, name: `M${depth}`, place: `m${depth}`, line: '' });

/** Depths from the surface to a few million metres, closer together near the surface. */
const ladder = (): number[] => {
  const out = [0];
  for (let m = 1; m < 3_000_000; m *= 1.07) out.push(m);
  return out.concat([FLOOR - 1e-6, FLOOR, FLOOR + 1e-6, 15000, 30000, 60000]).sort((a, b) => a - b);
};

describe('the depth scale', () => {
  it('runs on a square root from the surface to the floor', () => {
    expect(depthY(S, 0)).toBe(34);
    expect(depthY(S, 1750)).toBeCloseTo(34 + 280, 9); // a quarter of the depth is half the height
    expect(depthY(S, 700)).toBeCloseTo(34 + 560 * Math.sqrt(0.1), 9);
    expect(depthY(S, FLOOR)).toBe(34 + 560);
  });

  it('gives each band below the floor the same room', () => {
    const floor = depthY(S, FLOOR);
    expect(depthY(S, 15000) - floor).toBeCloseTo(124, 9);
    expect(depthY(S, 30000) - depthY(S, 15000)).toBeCloseTo(124, 9);
    expect(depthY(S, 60000) - depthY(S, 30000)).toBeCloseTo(124, 9);
    // linear inside a band
    expect(depthY(S, 11000)).toBeCloseTo(floor + 62, 9);
    expect(depthY(S, 45000)).toBeCloseTo(floor + 124 * 2.5, 9);
  });

  it('carries on past the last band at that band’s rate', () => {
    const last = depthY(S, 60000);
    expect(depthY(S, 90000)).toBeCloseTo(last + 124, 9);
    expect(depthY(S, 120000)).toBeCloseTo(last + 248, 9);
  });

  it('gives a band to every 7,000 m when nothing lies below the floor', () => {
    const none = { ...S, beyond: [] };
    expect(depthY(none, 14000)).toBeCloseTo(34 + 560 + 124, 9);
    expect(depthY(none, 21000)).toBeCloseTo(34 + 560 + 248, 9);
  });

  it('is continuous at the floor and at every band', () => {
    for (const m of [FLOOR, 15000, 30000, 60000]) expect(depthY(S, m + 1e-6) - depthY(S, m - 1e-6)).toBeLessThan(1e-3);
  });

  it('is one monotone function of depth, however deep', () => {
    for (const s of [S, { ...S, beyond: [] }, { top: 0, floorH: 640, band: 148, beyond: [7500, 1_000_000, 2_000_000] }]) {
      const ys = ladder().map((m) => depthY(s, m));
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
      expect(ys[ys.length - 1]).toBeGreaterThan(ys[0]);
    }
  });

  it('cleans its bands: in order, below the floor, once each', () => {
    const messy = { ...S, beyond: [NaN, 60000, 5000, 15000, 30000, 15000, Infinity, -2] };
    expect(cleanBeyond(messy.beyond)).toEqual([15000, 30000, 60000]);
    for (const m of [0, 3000, 9000, 20000, 50000, 80000]) expect(depthY(messy, m)).toBeCloseTo(depthY(S, m), 9);
  });

  it('reads the surface for a depth it cannot use', () => {
    expect(depthY(S, -50)).toBe(34);
    expect(depthY(S, NaN)).toBe(34);
  });

  it('can be read backwards: depthAtY undoes depthY', () => {
    for (const m of [0, 1, 150, 200, 1000, 4000, 6999, FLOOR, 9000, 15000, 22000, 60000, 75000, 1_000_000]) {
      const back = depthAtY(S, depthY(S, m));
      expect(Math.abs(back - m)).toBeLessThan(Math.max(1e-6, m * 1e-9));
    }
    expect(depthAtY(S, 0)).toBe(0);
  });
});

describe('the bands below the floor', () => {
  const marks = [M(1000), M(7000), M(15000), M(30000), M(60000)];
  const passed = (n: number) => Array.from({ length: n }, (_, index) => ({ index, day: index + 1 }));

  it('are the milestones passed down there and the next one ahead', () => {
    expect(beyondFloor({ passed: passed(3), next: 3, best: 20000, depth: 20000 }, marks)).toEqual([15000, 30000]);
    expect(beyondFloor({ passed: passed(1), next: 1, best: 3000, depth: 3000 }, marks)).toEqual([]);
  });

  it('carry on in round soundings past the last milestone', () => {
    expect(beyondFloor({ passed: passed(5), next: -1, best: 130000, depth: 128000 }, marks)).toEqual([15000, 30000, 60000, 100000, 200000]);
    // the placeholder's two milestones, and a year of diving
    expect(beyondFloor({ passed: passed(2), next: -1, best: 1_200_000, depth: 1_200_000 }, [M(1000), M(7000)])).toEqual([
      10000, 20000, 50000, 100000, 200000, 500000, 1_000_000, 2_000_000,
    ]);
  });

  it('always end in water the cable has not reached', () => {
    for (const depth of [7001, 9000, 50000, 777_777, 1_999_999, 5_000_000]) {
      const beyond = beyondFloor({ passed: passed(2), next: -1, best: depth, depth }, [M(1000), M(7000)]);
      expect(bottomDepth(beyond)).toBeGreaterThan(depth);
    }
    expect(bottomDepth([])).toBe(FLOOR);
  });

  it('keep the soundings clear of the milestone above them', () => {
    expect(soundingsBelow(7000, 8000)).toEqual([10000]);
    expect(soundingsBelow(1_000_000, 1_100_000)).toEqual([2_000_000]);
    expect(soundingsBelow(7000, 1_200_000)).toEqual([10000, 20000, 50000, 100000, 200000, 500000, 1_000_000, 2_000_000]);
  });

  it('are marked on the left edge with every zone boundary and thousand', () => {
    expect(depthMarks([15000, 30000])).toEqual([0, 200, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 15000, 30000]);
  });
});

describe('the water', () => {
  it('takes a colour at every zone boundary, through the same scale', () => {
    const stops = waterStops([]);
    for (const m of [200, 1000, 4000, 6000, FLOOR]) expect(stops.some((s) => s.depth === m)).toBe(true);
    expect(stops.every((s) => /^#[0-9a-f]{6}$/.test(s.color))).toBe(true);
  });

  it('runs downwards only, so the gradient never folds back', () => {
    const beyond = [15000, 30000, 60000];
    const ys = waterStops(beyond).map((s) => depthY({ ...S, beyond }, s.depth));
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1]);
  });

  it('gives each band below the floor a room of its own: lit at the top, dark at the foot', () => {
    const stops = waterStops([15000, 30000]);
    const below = stops.filter((s) => s.depth >= FLOOR);
    // the floor's own stop, then a lit edge; each band ends dark and the next begins lit
    expect(below.map((s) => [s.depth, !!s.edge])).toEqual([
      [7000, false],
      [7000, true],
      [15000, false],
      [15000, true],
      [30000, false],
    ]);
  });
});

describe('the days', () => {
  const s = dayScale(10, 40, 50, 350);

  it('run from the surface the day before the first dive to today at the right', () => {
    expect(s.from).toBe(9);
    expect(dayX(s, 9)).toBe(50);
    expect(dayX(s, 40)).toBe(350);
    expect(dayX(s, 24.5)).toBeCloseTo(200, 9);
  });

  it('put a career with no dives at the surface on today', () => {
    const none = dayScale(null, 12, 50, 350);
    expect(none.from).toBe(11);
    expect(dayX(none, 12)).toBe(350);
  });

  it('can be read backwards, within the career', () => {
    for (let d = 10; d <= 40; d++) expect(dayAtX(s, dayX(s, d))).toBe(d);
    expect(dayAtX(s, -100)).toBe(10);
    expect(dayAtX(s, 9999)).toBe(40);
  });
});

describe('the ticks across the cable', () => {
  const points = (n: number, miss: number[] = []): CareerPoint[] =>
    Array.from({ length: n }, (_, i) => ({ day: i + 1, depth: i * 100, kind: miss.includes(i + 1) ? 'drift' : 'dive' }));

  it('mark every dive in a short career', () => {
    expect(tickDays(points(20, [5, 6]))).toEqual(points(20, [5, 6]).filter((p) => p.kind === 'dive').map((p) => p.day));
  });

  it('mark one dive a week past about sixty days, counted back from today', () => {
    const pts = points(200, [200]);
    const ticks = tickDays(pts);
    expect(pts.length).toBeGreaterThan(DAILY_TICKS);
    expect(ticks[ticks.length - 1]).toBe(199); // today was missed: the last dive of the last week
    // a week apart, counted back from today (the last week ends on day 199, not 200)
    for (let i = 1; i < ticks.length - 1; i++) expect(ticks[i] - ticks[i - 1]).toBe(7);
    expect(ticks[ticks.length - 1] - ticks[ticks.length - 2]).toBe(6);
    expect(ticks.length).toBe(Math.ceil(200 / 7));
  });

  it('thin out further when even a week would be under 3 px', () => {
    const ticks = tickDays(points(400), 0.15); // a week is 1 px: one tick a month (28 days)
    for (let i = 1; i < ticks.length; i++) expect(ticks[i] - ticks[i - 1]).toBe(28);
  });
});

describe('the dates along the top', () => {
  it('are written as the log writes them', () => {
    expect(dateLabel(1)).toBe('27 NOV');
    expect(dateLabel(6)).toBe('2 DEC');
    expect(dateLabel(36)).toBe('1 JAN');
  });

  it('come every week from the first dive in a short career, never crowded', () => {
    const s = dayScale(7, 20, 52, 300); // 14 days across 248 px
    const ticks = dateTicks(s, 64);
    expect(ticks[0]).toEqual({ day: 7, label: '3 DEC' });
    for (let i = 1; i < ticks.length; i++) expect(dayX(s, ticks[i].day) - dayX(s, ticks[i - 1].day)).toBeGreaterThanOrEqual(64);
  });

  it('fall on the first of the month in a long career, with the year where it turns', () => {
    const s = dayScale(21, 320, 52, 300); // 17 Dec 2026 to 12 Oct 2027
    const ticks = dateTicks(s, 64);
    expect(ticks.map((t) => t.label)).toEqual(['JAN 2027', 'APR', 'JUL', 'OCT']);
    expect(ticks.map((t) => dateLabel(t.day))).toEqual(['1 JAN', '1 APR', '1 JUL', '1 OCT']);
    for (let i = 1; i < ticks.length; i++) expect(dayX(s, ticks[i].day) - dayX(s, ticks[i - 1].day)).toBeGreaterThanOrEqual(64);
  });

  it('are left out before the first dive', () => {
    expect(dateTicks({ from: 5, to: 5, x0: 0, x1: 100 })).toEqual([]);
  });
});

describe('the text alternative', () => {
  const dive = (day: number, depth: number): DayRecord => ({
    day,
    date: '',
    omen: 'still',
    promptIds: ['p'],
    answers: [{ promptId: 'p', input: 'x', answer: 'x', tier: 3, depth, rejects: [], timeMs: 5000 }],
    sanity: 80,
    finished: true,
  });
  const marks = [M(1000), M(3000), M(7000)];

  it('tells the whole career in a sentence or two', () => {
    // A week, a ward spent on day 8, two more dives, then two days adrift; today is day 13.
    const days = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 9, 10].map((d) => [d, dive(d, 500)]));
    const career = computeCareer(days, 13, marks);
    expect(driftCount(career.points)).toBe(1);
    const text = chartSummary(career, marks, 13);
    expect(text).toMatch(/^Career depth [\d,]+ m over 13 days, nine dives, with one drift and one ward\./);
    expect(text).toContain('Two milestones passed; next, M7000 at 7,000 m.');
    expect(text).toContain('The deepest it has been is');
  });

  it('is kind when there is nothing yet', () => {
    const career = computeCareer({}, 4, marks);
    expect(chartSummary(career, marks, 4)).toBe('No dives yet: the cable waits at the surface. The first milestone, M1000, is at 1,000 m.');
  });
});

describe('the sheet', () => {
  it('keeps the floor and the bands in proportion on a phone and a wide screen', () => {
    const phone = sheetLayout(320);
    const wide = sheetLayout(700);
    expect(phone.narrow).toBe(true);
    expect(wide.narrow).toBe(false);
    for (const l of [phone, wide]) expect(l.band).toBeLessThan(l.floorH / 3);
  });

  it('knows when a box touches the cable', () => {
    const box = { l: 10, r: 20, t: 10, b: 20 };
    expect(segmentMeetsBox({ x: 0, y: 0 }, { x: 30, y: 30 }, box)).toBe(true); // straight through
    expect(segmentMeetsBox({ x: 12, y: 12 }, { x: 14, y: 14 }, box)).toBe(true); // inside
    expect(segmentMeetsBox({ x: 0, y: 0 }, { x: 30, y: 0 }, box)).toBe(false); // above it
    expect(segmentMeetsBox({ x: 0, y: 30 }, { x: 30, y: 25 }, box)).toBe(false); // below it
    expect(segmentMeetsBox({ x: 25, y: 0 }, { x: 25, y: 30 }, box)).toBe(false); // beside it
  });
});
