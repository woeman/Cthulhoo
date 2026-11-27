import type { DayRecord, ThemeCopy } from './types';
import { landmarkFor, tierDef, zoneFor } from './theme';
import { totalDepth } from './scoring';
import { omenById } from './omens';
import { paletteAt } from '../../art/js/depth.js';

// The share text (an emoji sounding line) and a portrait share card drawn on a
// canvas in the house style: a sounding chart from bone paper to black water.

const fmt = (m: number) => Math.round(m).toLocaleString('en-GB');

export function emojiRow(theme: ThemeCopy, rec: DayRecord): string {
  return rec.answers
    .map((a) => (a.tier === 0 ? theme.share.missEmoji : a.openSecret ? theme.openSecret.emoji : tierDef(theme, a.tier)?.emoji ?? '·'))
    .join('');
}

export function shareUrl(): string {
  try {
    const u = new URL(location.href);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return `${u.origin}${u.pathname}`;
  } catch {
    return '';
  }
}

export function shareText(theme: ThemeCopy, rec: DayRecord): string {
  const depth = totalDepth(rec);
  const landmark = landmarkFor(theme, depth)?.name ?? zoneFor(theme, depth).name;
  const omen = omenById(rec.omen);
  const fill = (s: string) =>
    s
      .replace(/\{day\}/g, rec.practice ? 'practice' : String(rec.day))
      .replace(/\{depth\}/g, fmt(depth))
      .replace(/\{emoji\}/g, emojiRow(theme, rec))
      .replace(/\{landmark\}/g, landmark)
      .replace(/\{zone\}/g, zoneFor(theme, depth).name)
      .replace(/\{sanity\}/g, `${rec.sanity}%`)
      .replace(/\{omen\}/g, omen.name)
      .replace(/\{url\}/g, shareUrl());
  let text = fill(theme.share.template);
  if (omen.id !== 'still' && !theme.share.template.includes('{omen}')) text += `\nOmen: ${omen.name} ${omen.glyph}`;
  const url = shareUrl();
  if (url && !text.includes(url)) text += `\n${url}`;
  return text;
}

const css = (rgb: number[], a = 1) => `rgb(${rgb.map((v) => Math.round(v * 255)).join(' ')} / ${a})`;
const PAPER = [0.906, 0.867, 0.776];
const INK = [0.114, 0.094, 0.075];
const mixRgb = (a: number[], b: number[], t: number) => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Spread labels on one side of the line so none overlap, keeping each as close to its sounding as it can. */
export function spreadLabels(ys: number[], gap: number, min: number, max: number): number[] {
  const out = ys.map((y) => Math.max(min, y));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  const over = out.length ? out[out.length - 1] - max : 0;
  if (over > 0) {
    out[out.length - 1] -= over;
    for (let i = out.length - 2; i >= 0; i--) out[i] = Math.min(out[i], out[i + 1] - gap);
  }
  return out;
}

export async function renderCard(theme: ThemeCopy, rec: DayRecord): Promise<Blob | null> {
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  if (!g) return null;
  try {
    await Promise.all([
      document.fonts.load('80px "IM Fell English SC"'),
      document.fonts.load('italic 40px "IM Fell English"'),
      document.fonts.load('60px "Special Elite"'),
      document.fonts.load('36px "EB Garamond"'),
    ]);
  } catch {
    /* fall back to whatever is available */
  }

  const depth = totalDepth(rec);
  const end = paletteAt(Math.min(Math.max(depth, 1), 7000));
  const surfaceY = 330;
  const chartBottom = 1010;
  // A square-root scale, like a well-used chart: the shallows get room to breathe.
  const yFor = (m: number) => surfaceY + Math.sqrt(Math.max(0, Math.min(m, 7000)) / 7000) * (chartBottom - surfaceY);
  // The ink-wash front, where the game turns from ink on paper to light on black.
  const washTop = yFor(110);
  const washBottom = yFor(340);
  const inversionAt = (y: number) => smooth(washTop, washBottom, y);
  const depthAtY = (y: number) => (y <= surfaceY ? 0 : Math.pow((y - surfaceY) / (chartBottom - surfaceY), 2) * 7000);

  // ground: paper above, then the water column through the zone colours to black
  for (let y = 0; y < H; y += 2) {
    const m = depthAtY(y);
    const water = paletteAt(Math.min(Math.max(m, 1), 7000)).rgb.water.map((v: number) => v * 0.62);
    const below = y > chartBottom ? smooth(chartBottom, H, y) : 0;
    const col = mixRgb(mixRgb(PAPER, water, inversionAt(y)), [0.012, 0.012, 0.02], below * 0.8);
    g.fillStyle = css(col);
    g.fillRect(0, y, W, 2);
  }

  // engraved line work: ink lines on the paper, faint glowing lines in the deep
  for (let y = 6; y < H; y += 9) {
    const inv = inversionAt(y);
    const m = depthAtY(y);
    const glow = paletteAt(Math.min(Math.max(m, 1), 7000)).rgb.glow;
    const above = y < surfaceY;
    g.strokeStyle = inv < 0.5 ? css(INK, (above ? 0.16 : 0.24) * (1 - inv * 2)) : css(glow, 0.13 * (inv - 0.5) * 2);
    g.lineWidth = inv < 0.5 ? 1.5 : 1.2;
    g.beginPath();
    for (let x = 0; x <= W; x += 24) {
      const amp = above ? 0.8 : 2.4;
      const yy = y + Math.sin(x * 0.011 + y * 0.05) * amp;
      if (x === 0) g.moveTo(x, yy);
      else g.lineTo(x, yy);
    }
    g.stroke();
  }

  // the waterline, cut a little deeper
  g.strokeStyle = css(INK, 0.85);
  g.lineWidth = 3;
  g.beginPath();
  for (let x = 40; x <= W - 40; x += 8) {
    const yy = surfaceY + Math.sin(x * 0.03) * 3 + Math.sin(x * 0.071) * 1.5;
    if (x === 40) g.moveTo(x, yy);
    else g.lineTo(x, yy);
  }
  g.stroke();

  // zone ticks and names down the left margin
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = '28px "IM Fell English SC", Georgia, serif';
  for (const z of theme.zones) {
    if (!Number.isFinite(z.from) || z.from > 7000) continue;
    const y = z.key === 'surface' ? surfaceY + 30 : yFor(z.from);
    const inv = inversionAt(y);
    const p = paletteAt(Math.max(z.from, 1));
    const colour = inv < 0.5 ? css(INK, 0.8) : css(p.rgb.glow, 0.85);
    g.fillStyle = colour;
    if (z.key !== 'surface') g.fillRect(70, y - 1, 46, 2);
    g.fillText(z.name.toLowerCase(), z.key === 'surface' ? 70 : 130, y);
  }

  // the plumb line, from a buoy on the surface down to where you came to rest
  const x0 = 780;
  const restY = yFor(depth);
  g.lineWidth = 3;
  const lineGrad = g.createLinearGradient(0, surfaceY - 60, 0, restY);
  lineGrad.addColorStop(0, css(INK, 0.9));
  lineGrad.addColorStop(Math.min(1, Math.max(0, (washTop - surfaceY + 60) / Math.max(1, restY - surfaceY + 60))), css(INK, 0.9));
  lineGrad.addColorStop(1, css(end.rgb.glow, 0.95));
  g.strokeStyle = lineGrad;
  g.beginPath();
  g.moveTo(x0, surfaceY - 60);
  g.lineTo(x0, restY);
  g.stroke();
  // buoy
  g.fillStyle = css(INK);
  g.beginPath();
  g.ellipse(x0, surfaceY - 66, 16, 10, 0, 0, Math.PI * 2);
  g.fill();
  g.fillRect(x0 - 2, surfaceY - 96, 4, 30);

  // the seven soundings, labelled with their glyphs, alternating sides
  const marks: Array<{ y: number; emoji: string; side: number }> = [];
  let m = 0;
  rec.answers.forEach((a, i) => {
    m += a.depth;
    const emoji = a.tier === 0 ? theme.share.missEmoji : a.openSecret ? theme.openSecret.emoji : tierDef(theme, a.tier)?.emoji ?? '·';
    marks.push({ y: yFor(m), emoji, side: i % 2 === 0 ? -1 : 1 });
  });
  g.font = '46px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.textAlign = 'center';
  for (const side of [-1, 1]) {
    const group = marks.filter((k) => k.side === side);
    const ys = spreadLabels(group.map((k) => k.y), 58, surfaceY + 30, chartBottom + 40);
    group.forEach((k, j) => {
      const ly = ys[j];
      const inv = inversionAt(k.y);
      const tick = inv < 0.5 ? css(INK, 0.9) : css(end.rgb.glow, 0.85);
      g.strokeStyle = tick;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x0, k.y);
      g.lineTo(x0 + side * 22, k.y);
      g.lineTo(x0 + side * 46, ly);
      g.lineTo(x0 + side * 58, ly);
      g.stroke();
      g.fillText(k.emoji, x0 + side * 92, ly + 2);
    });
  }
  // the lead, resting
  g.beginPath();
  g.arc(x0, restY, 15, 0, Math.PI * 2);
  g.fillStyle = inversionAt(restY) < 0.5 ? css(INK) : '#05060a';
  g.fill();
  g.strokeStyle = inversionAt(restY) < 0.5 ? css(PAPER) : css(end.rgb.glow);
  g.lineWidth = 3;
  g.stroke();

  // masthead, printed on the paper above the water
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.fillStyle = css(INK);
  g.font = '124px "IM Fell English SC", Georgia, serif';
  g.fillText('Cthulhoo', W / 2, 168);
  g.font = 'italic 36px "IM Fell English", Georgia, serif';
  g.fillStyle = '#5b5143';
  const omen = omenById(rec.omen);
  const subtitle = rec.practice ? 'a practice dive' : `Dive No. ${rec.day}${omen.id !== 'still' ? ` · ${omen.name}` : ''}`;
  g.fillText(subtitle, W / 2, 228);
  g.fillStyle = css(INK, 0.55);
  g.fillRect(W / 2 - 120, 256, 240, 1.5);

  // the result, in the dark at the bottom of the plate
  const landmark = landmarkFor(theme, depth)?.name ?? zoneFor(theme, depth).name;
  g.fillStyle = css(end.rgb.glow);
  g.shadowColor = css(end.rgb.glow, 0.6);
  g.shadowBlur = 26;
  g.font = '150px "Special Elite", "Courier New", monospace';
  g.fillText(`${fmt(depth)} m`, W / 2, 1150);
  g.shadowBlur = 0;
  g.fillStyle = '#efe6d2';
  g.font = '56px "IM Fell English", Georgia, serif';
  g.fillText(landmark, W / 2, 1228);
  g.font = '30px "Special Elite", "Courier New", monospace';
  g.fillStyle = 'rgb(239 230 210 / 0.72)';
  g.fillText(`sanity ${rec.sanity}%   ·   ${emojiRow(theme, rec)}`, W / 2, 1288);

  // burnt plate edge and a double rule
  const v = g.createRadialGradient(W / 2, H / 2, H * 0.38, W / 2, H / 2, H * 0.8);
  v.addColorStop(0, 'rgb(0 0 0 / 0)');
  v.addColorStop(1, 'rgb(0 0 0 / 0.4)');
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgb(122 104 80 / 0.7)';
  g.lineWidth = 2;
  g.strokeRect(28, 28, W - 56, H - 56);
  g.strokeRect(38, 38, W - 76, H - 76);

  return new Promise((res) => c.toBlob((b) => res(b), 'image/png'));
}

export type ShareOutcome = 'shared' | 'copied' | 'failed' | 'cancelled' | { card: Blob };

/**
 * Share through the phone's share sheet where there is one. Otherwise the text
 * goes to the clipboard, and the card comes back so the game can show it.
 */
export async function shareDive(theme: ThemeCopy, rec: DayRecord, withImage: boolean): Promise<ShareOutcome> {
  const text = shareText(theme, rec);
  const blob = withImage ? await renderCard(theme, rec) : null;
  const file = blob ? new File([blob], `cthulhoo-${rec.practice ? 'practice' : rec.day}.png`, { type: 'image/png' }) : null;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (file && nav.share && nav.canShare?.({ files: [file] })) {
      await nav.share({ files: [file], text });
      return 'shared';
    }
    if (!file && nav.share && matchMedia('(pointer: coarse)').matches) {
      await nav.share({ text });
      return 'shared';
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return 'cancelled';
  }
  if (blob) return { card: blob };
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
