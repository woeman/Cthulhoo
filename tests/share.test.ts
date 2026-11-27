import { afterEach, describe, expect, it, vi } from 'vitest';
import { emojiRow, shareText, spreadLabels } from '../src/game/share';
import { PLACEHOLDER_THEME, buildTheme, landmarkFor } from '../src/game/theme';
import type { DayRecord, ThemeCopy, Tier } from '../src/game/types';

const DEPTH = [0, 100, 250, 400, 600, 800, 1000];

function dive(tiers: number[], extra: Partial<DayRecord> = {}): DayRecord {
  return {
    day: 12,
    date: '2026-12-08',
    omen: 'still',
    promptIds: tiers.map((_, i) => `p${i}`),
    answers: tiers.map((t, i) => ({ promptId: `p${i}`, input: t ? 'x' : null, answer: t ? 'x' : null, tier: t as Tier, depth: DEPTH[t], rejects: [], timeMs: 1 })),
    sanity: 61,
    finished: true,
    ...extra,
  };
}
const withTemplate = (template: string, theme: ThemeCopy = PLACEHOLDER_THEME): ThemeCopy => ({ ...theme, share: { ...theme.share, template } });
const at = (href: string) => vi.stubGlobal('location', { href });

afterEach(() => vi.unstubAllGlobals());

describe('emoji row', () => {
  it('gives each answer its tier glyph, a bubble for no air, and the open secret its own', () => {
    const rec = dive([1, 6, 0, 3]);
    rec.answers[3].openSecret = true;
    expect(emojiRow(PLACEHOLDER_THEME, rec)).toBe('🌊🐙🫧🤫');
    expect(emojiRow(PLACEHOLDER_THEME, dive([]))).toBe('');
  });
});

describe('share text', () => {
  it('fills every placeholder in the template', () => {
    const rec = dive([1, 2, 3, 4, 5, 6, 0]);
    const landmark = landmarkFor(PLACEHOLDER_THEME, 3150)!.name;
    expect(shareText(PLACEHOLDER_THEME, rec)).toBe(`Cthulhoo #12 · 3,150 m\n🌊🐟🪼🦑👁️🐙🫧\n${landmark}`);
    const all = withTemplate('{day}|{depth}|{emoji}|{landmark}|{zone}|{sanity}|{omen}|{unknown}');
    expect(shareText(all, dive([6, 6], { omen: 'blood' }))).toBe(`12|2,000|🐙🐙|${landmarkFor(all, 2000)!.name}|The Stygian Dark|61%|Blood Tide|{unknown}`);
  });

  it('appends the address once, without the query or hash', () => {
    at('https://example.test/Cthulhoo/?fresh#top');
    const text = shareText(PLACEHOLDER_THEME, dive([1]));
    expect(text.endsWith('\nhttps://example.test/Cthulhoo/')).toBe(true);
    expect(text.split('https://').length).toBe(2);
    const own = shareText(withTemplate('Cthulhoo #{day}\n{url}\n{emoji}'), dive([1]));
    expect(own).toBe('Cthulhoo #12\nhttps://example.test/Cthulhoo/\n🌊');
  });

  it('leaves no address, and no empty line, off the web', () => {
    at('file:///Users/someone/cthulhoo/index.html');
    expect(shareText(PLACEHOLDER_THEME, dive([1]))).not.toMatch(/file:|\n$/);
    expect(shareText(withTemplate('Cthulhoo #{day}\n{url}\n{emoji}'), dive([1]))).toBe('Cthulhoo #12\n🌊');
    expect(shareText(withTemplate('A\n\nB {url}'), dive([1]))).toBe('A\n\nB ');
  });

  it('calls a practice dive a practice dive, with no number and no omen', () => {
    const text = shareText(PLACEHOLDER_THEME, dive([6], { practice: true, omen: 'still' }));
    expect(text.split('\n')[0]).toBe('Cthulhoo practice dive · 1,000 m');
    expect(text).not.toMatch(/#|Omen/);
  });

  it("adds the omen line unless the template places the omen itself", () => {
    expect(shareText(PLACEHOLDER_THEME, dive([2], { omen: 'blood' })).split('\n').pop()).toBe('Omen: Blood Tide ◉');
    expect(shareText(PLACEHOLDER_THEME, dive([2], { omen: 'still' }))).not.toMatch(/Omen/);
    expect(shareText(PLACEHOLDER_THEME, dive([2], { omen: 'gone-from-the-code' }))).not.toMatch(/Omen/);
    const placed = shareText(withTemplate('#{day} under {omen}'), dive([2], { omen: 'bell' }));
    expect(placed).toBe('#12 under The Drowned Bell');
  });

  it('copies names exactly, even with "$" or braces in them', () => {
    const odd = buildTheme({
      landmarks: [{ zone: 'surface', from: 0, to: 7001, name: 'The $& Shoal of {zone}', lines: [] }],
      share: { template: '{landmark} · {depth} m' },
    });
    expect(shareText(odd, dive([1]))).toBe('The $& Shoal of {zone} · 100 m');
  });
});

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
