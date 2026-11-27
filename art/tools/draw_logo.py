"""Draws the Cthulhoo wordmark, the porthole-eye mark, the app icon and the favicon.

    python3 art/tools/draw_logo.py

Letters are IM Fell English SC outlines (SIL OFL), converted to paths so the logo
needs no font. The double O is drawn by hand: two riveted bathysphere portholes
whose glass is an eye with a cuttlefish's W-shaped pupil.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from svgkit import f, pt, poly, smooth, circle_path, ring_path, polar, svg, write, rng

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
FONT = os.path.join(ROOT, 'fonts', 'im-fell-english-sc-400.woff2')
OUT = os.path.join(ROOT, 'logo')

font = TTFont(FONT)
GS = font.getGlyphSet()
CMAP = font.getBestCmap()
CAP = font['OS/2'].sCapHeight          # 1417 units
ASC = 1500                              # our own top line for the layout


def glyph_path(ch, x, baseline, scale=1.0):
    """Outline of one character, placed at x with its baseline at `baseline` (SVG y-down)."""
    name = CMAP[ord(ch)]
    pen = SVGPathPen(GS, ntos=lambda v: f(v))
    tpen = TransformPen(pen, (scale, 0, 0, -scale, x, baseline))
    GS[name].draw(tpen)
    return pen.getCommands(), GS[name].width * scale


def text_paths(s, x, baseline, scale=1.0, tracking=0.0):
    out = []
    for ch in s:
        if ch == ' ':
            x += 500 * scale + tracking
            continue
        d, adv = glyph_path(ch, x, baseline, scale)
        out.append(d)
        x += adv + tracking
    return ' '.join(out), x


def w_pupil(cx, cy, L, A, T, rot=0.0, n=48):
    """Cuttlefish pupil: a band shaped like a W, pointed at both ends."""
    top, bot = [], []
    for i in range(n + 1):
        u = -1 + 2 * i / n
        yc = -A * math.cos(math.tau * u)          # ends and centre up, two valleys: a W
        t = T * (max(0.0, 1 - u * u) ** 0.55) * (1 + 0.35 * (1 + math.cos(math.tau * u + math.pi)) / 2)
        top.append((u * L, yc - t))
        bot.append((u * L, yc + t))
    pts = top + bot[::-1][1:-1]
    c, s = math.cos(rot), math.sin(rot)
    pts = [(cx + x * c - y * s, cy + x * s + y * c) for x, y in pts]
    return smooth(pts, close=True)


def porthole_eye(cx, cy, R, seed=1, rot=0.0, rivets=8, detail=1.0):
    """One O: riveted frame, engraved iris, W pupil, a glint on the glass. Returns filled path data."""
    r = rng(seed)
    parts = []
    # Frame with rivets punched through (evenodd).
    frame = ring_path(cx, cy, R, R * 0.79)
    for k in range(rivets):
        a = math.tau * (k + 0.5) / rivets
        x, y = polar(cx, cy, R * 0.895, a)
        frame += ' ' + circle_path(x, y, R * 0.052, ccw=True)
    parts.append(('frame', frame))
    # Iris: tapered burin strokes radiating from the pupil.
    strokes = []
    n = int(34 * detail)
    r1, r2 = R * 0.29, R * 0.585
    for k in range(n):
        a = math.tau * k / n + r.uniform(-0.04, 0.04)
        rr1 = r1 * r.uniform(0.95, 1.12)
        rr2 = r2 * r.uniform(0.9, 1.0)
        w1, w2 = 0.010, 0.043 * r.uniform(0.8, 1.15)
        strokes.append(poly([polar(cx, cy, rr1, a - w1), polar(cx, cy, rr2, a - w2),
                             polar(cx, cy, rr2 * 1.01, a), polar(cx, cy, rr2, a + w2),
                             polar(cx, cy, rr1, a + w1)]))
    parts.append(('iris', ' '.join(strokes)))
    parts.append(('limbus', ring_path(cx, cy, R * 0.635, R * 0.6)))
    # Glint: a thin crescent of reflected light on the glass, upper left.
    g = []
    for i in range(13):
        a = math.radians(200 + i * 4.2)
        g.append(polar(cx, cy, R * 0.735, a))
    for i in range(13):
        a = math.radians(250.4 - i * 4.2)
        g.append(polar(cx, cy, R * (0.705 + 0.012 * math.sin(math.pi * i / 12)), a))
    parts.append(('glint', smooth(g, close=True)))
    parts.append(('pupil', w_pupil(cx, cy + R * 0.01, R * 0.41, R * 0.085, R * 0.078, rot)))
    return parts


def wordmark(tracking=95, with_tagline=False):
    baseline = ASC
    letters, x = text_paths('CTHULH', 0, baseline, tracking=tracking)
    R = CAP * 0.545
    cy = baseline - CAP / 2
    cx1 = x + R * 0.98
    cx2 = cx1 + 2 * R + R * 0.14
    eyes = porthole_eye(cx1, cy, R, seed=3) + porthole_eye(cx2, cy, R, seed=5, rot=math.radians(-7))
    width = cx2 + R + 60
    body = [f'<path d="{letters}"/>']
    for name, d in eyes:
        body.append(f'<path data-part="{name}" fill-rule="evenodd" d="{d}"/>')
    top = cy - R - 40
    height = baseline + 60
    if with_tagline:
        s = 0.34
        tag, tx = text_paths('A DAILY DESCENT', 0, 0, scale=s, tracking=210)
        tw = tx - 210
        ox = (width - tw) / 2
        ty = baseline + 860
        body.append(f'<path transform="translate({f(ox)} {f(ty)})" d="{tag}"/>')
        # Engraved rules either side of the tagline.
        ry = ty - CAP * s / 2
        body.append(f'<path d="{poly([(40, ry - 6), (ox - 160, ry - 6), (ox - 160, ry + 6), (40, ry + 6)])}"/>')
        body.append(f'<path d="{poly([(ox + tw + 160, ry - 6), (width - 40, ry - 6), (width - 40, ry + 6), (ox + tw + 160, ry + 6)])}"/>')
        # a small diamond at each inner end
        for xx in (ox - 110, ox + tw + 110):
            body.append(f'<path d="{poly([(xx, ry - 26), (xx + 26, ry), (xx, ry + 26), (xx - 26, ry)])}"/>')
        height = ty + 120
    vb = f"{f(-40)} {f(top)} {f(width + 40)} {f(height - top)}"
    return '<g fill="currentColor">' + ''.join(body) + '</g>', vb, (width + 40) / 10, (height - top) / 10


def main():
    os.makedirs(OUT, exist_ok=True)
    g, vb, w, h = wordmark()
    write(os.path.join(OUT, 'wordmark.svg'), svg(w, h, g, viewbox=vb, title='Cthulhoo',
          desc='Wordmark: IM Fell English SC capitals, the double O drawn as riveted portholes with W-pupilled eyes. Uses currentColor.'))
    g, vb, w, h = wordmark(with_tagline=True)
    write(os.path.join(OUT, 'lockup.svg'), svg(w, h, g, viewbox=vb, title='Cthulhoo: a daily descent',
          desc='Wordmark with tagline. Uses currentColor.'))

    # The mark: just the two portholes.
    R = 100
    parts = porthole_eye(R + 6, R + 6, R, seed=3) + porthole_eye(3 * R + 20, R + 6, R, seed=5, rot=math.radians(-7))
    body = '<g fill="currentColor">' + ''.join(f'<path data-part="{n}" fill-rule="evenodd" d="{d}"/>' for n, d in parts) + '</g>'
    write(os.path.join(OUT, 'mark.svg'), svg(4 * R + 26, 2 * R + 12, body, title='Cthulhoo mark',
          desc='The double O: two porthole eyes. Uses currentColor.'))

    # App icon, 512 x 512, full bleed (the platform rounds the corners).
    S = 512
    R = 98
    cy = 262
    lines = ''.join(
        f'<path d="M0 {f(y)} C 128 {f(y - 5 + 4 * math.sin(y))} 256 {f(y + 5)} 384 {f(y - 3)} S 512 {f(y + 2)} 512 {f(y + 2)}"/>'
        for y in [i * 9 + 4 for i in range(57)])
    eye1 = porthole_eye(S / 2 - R - 9, cy, R, seed=3)
    eye2 = porthole_eye(S / 2 + R + 9, cy, R, seed=5, rot=math.radians(-7))

    def draw(parts, colours):
        return ''.join(f'<path fill="{colours[n]}" fill-rule="evenodd" d="{d}"/>' for n, d in parts)

    col = {'frame': '#22323a', 'iris': '#7fe6f5', 'limbus': '#58d3ea', 'glint': '#dcf4f5', 'pupil': '#010406'}
    snow = rng(11)
    motes = ''.join(f'<circle cx="{f(snow.uniform(0, S))}" cy="{f(snow.uniform(0, S))}" r="{f(snow.uniform(0.8, 2.2))}" fill="#9fe9f5" opacity="{f(snow.uniform(0.15, 0.55))}"/>' for _ in range(60))
    icon = (
        '<defs>'
        '<radialGradient id="sea" cx="50%" cy="38%" r="75%">'
        '<stop offset="0" stop-color="#0d2a3a"/><stop offset="0.55" stop-color="#061420"/><stop offset="1" stop-color="#020509"/>'
        '</radialGradient>'
        '<radialGradient id="halo" cx="50%" cy="50%" r="50%">'
        '<stop offset="0" stop-color="#58d3ea" stop-opacity="0.55"/><stop offset="0.6" stop-color="#58d3ea" stop-opacity="0.12"/><stop offset="1" stop-color="#58d3ea" stop-opacity="0"/>'
        '</radialGradient>'
        '<radialGradient id="iris" cx="50%" cy="50%" r="50%">'
        '<stop offset="0.35" stop-color="#58d3ea" stop-opacity="0.9"/><stop offset="1" stop-color="#0b3a46" stop-opacity="0.2"/>'
        '</radialGradient>'
        '<radialGradient id="glass" cx="50%" cy="50%" r="50%">'
        '<stop offset="0" stop-color="#0b3a46"/><stop offset="1" stop-color="#041018"/>'
        '</radialGradient>'
        '</defs>'
        f'<rect width="{S}" height="{S}" fill="url(#sea)"/>'
        f'<g fill="none" stroke="#58d3ea" stroke-opacity="0.09" stroke-width="1.6">{lines}</g>'
        f'{motes}'
        f'<ellipse cx="{f(S / 2)}" cy="{f(cy)}" rx="250" ry="170" fill="url(#halo)"/>'
        f'<circle cx="{f(S / 2 - R - 9)}" cy="{f(cy)}" r="{f(R * 0.8)}" fill="url(#glass)"/>'
        f'<circle cx="{f(S / 2 + R + 9)}" cy="{f(cy)}" r="{f(R * 0.8)}" fill="url(#glass)"/>'
        f'<circle cx="{f(S / 2 - R - 9)}" cy="{f(cy)}" r="{f(R * 0.6)}" fill="url(#iris)"/>'
        f'<circle cx="{f(S / 2 + R + 9)}" cy="{f(cy)}" r="{f(R * 0.6)}" fill="url(#iris)"/>'
        + draw(eye1, col) + draw(eye2, col)
        + f'<g fill="none" stroke="#58d3ea" stroke-opacity="0.45" stroke-width="2">'
          f'<circle cx="{f(S / 2 - R - 9)}" cy="{f(cy)}" r="{f(R - 1)}"/><circle cx="{f(S / 2 + R + 9)}" cy="{f(cy)}" r="{f(R - 1)}"/></g>'
    )
    write(os.path.join(OUT, 'app-icon.svg'), svg(S, S, icon, title='Cthulhoo app icon',
          desc='Two porthole eyes glowing in the Stygian Dark. Full bleed; the platform applies its own corner mask.'))

    # Favicon: one porthole eye, bold.
    R = 30
    parts = porthole_eye(32, 32, R, seed=3, rivets=6, detail=0.6)
    col = {'frame': '#9fb3b8', 'iris': '#7fe6f5', 'limbus': '#58d3ea', 'glint': '#dcf4f5', 'pupil': '#010406'}
    fav = (f'<rect width="64" height="64" rx="12" fill="#061420"/>'
           f'<circle cx="32" cy="32" r="{f(R * 0.8)}" fill="#0b3a46"/>' + draw(parts, col))
    write(os.path.join(OUT, 'favicon.svg'), svg(64, 64, fav, title='Cthulhoo'))
    print('logo assets written to', OUT)


if __name__ == '__main__':
    main()
