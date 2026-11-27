"""Draws the rarity seals (tiers 1–6 and Refused) and the Drowned Script.

    python3 art/tools/draw_glyphs.py

Everything is stroked in currentColor so it takes the colour of the text around it.

Rarity seals are radiolarians, the glass skeletons of deep-sea plankton, growing
stranger with each tier: more spines, then a star, then an eye. Odd numbers only
(1, 3, 5, 7): nothing down here is quite symmetrical.

The Drowned Script is an invented alphabet that HANGS from a waterline, the way
weed and chains hang from a hull. Glyphs join along that top line into words.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from svgkit import f, pt, poly, smooth, polar, svg, write, circle_path

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'glyphs')
SW = 1.75  # stroke width on the 32 grid (1.3 px at 24 px)


def stroke_group(inner, sw=SW, extra=''):
    return (f'<g fill="none" stroke="currentColor" stroke-width="{f(sw)}" stroke-linecap="round" '
            f'stroke-linejoin="round"{extra}>{inner}</g>')


def P(d, **kw):
    attrs = ''.join(f' {k.replace("_", "-")}="{v}"' for k, v in kw.items())
    return f'<path d="{d}"{attrs}/>'


def C(cx, cy, r, **kw):
    attrs = ''.join(f' {k.replace("_", "-")}="{v}"' for k, v in kw.items())
    return f'<circle cx="{f(cx)}" cy="{f(cy)}" r="{f(r)}"{attrs}/>'


def spines(cx, cy, r0, r1, n, start=-90, barb=0.0):
    out = []
    for k in range(n):
        a = math.radians(start + 360 * k / n)
        p0, p1 = polar(cx, cy, r0, a), polar(cx, cy, r1, a)
        out.append(P(f"M{pt(p0)} L{pt(p1)}"))
        if barb:
            for s in (-1, 1):
                pb = polar(cx, cy, r1 - barb, a + s * 0.22)
                out.append(P(f"M{pt(p1)} L{pt(pb)}"))
    return ''.join(out)


def ngon(cx, cy, r, n, start=-90, step=1):
    pts = [polar(cx, cy, r, math.radians(start + 360 * (k * step % n) / n)) for k in range(n)]
    return P(poly(pts))


def almond(cx, cy, w, h):
    return P(f"M{f(cx - w)} {f(cy)} Q{f(cx)} {f(cy - h * 2)} {f(cx + w)} {f(cy)} Q{f(cx)} {f(cy + h * 2)} {f(cx - w)} {f(cy)} Z")


def w_pupil_line(cx, cy, w, a):
    pts = [(cx - w, cy - a), (cx - w / 2, cy + a), (cx, cy - a * 0.6), (cx + w / 2, cy + a), (cx + w, cy - a)]
    return P(smooth(pts, tension=0.9))


# ------------------------------------------------------------------ rarity seals (32 grid)

def tier(n):
    c = 16
    if n == 1:   # Commonplace: a grain, a bubble
        body = C(c, c, 7) + C(c, c, 1.6, fill='currentColor', stroke='none')
    elif n == 2:  # Curious: a young radiolarian, three spines
        body = C(c, c, 7) + spines(c, c, 7, 12.5, 3) + C(c, c, 2.4)
    elif n == 3:  # Obscure: five spines and an inner shell
        body = C(c, c, 7.2) + spines(c, c, 7.2, 13, 5) + ngon(c, c, 3.6, 5, start=-54)
    elif n == 4:  # Arcane: seven barbed spines, a heptagonal heart
        body = C(c, c, 6.6) + spines(c, c, 6.6, 13.2, 7, barb=2.4) + ngon(c, c, 3.4, 7)
    elif n == 5:  # Forbidden: a seven-pointed star around an open eye
        body = (ngon(c, c, 13.2, 7, step=3) + almond(c, c + 0.3, 5.0, 2.2)
                + C(c, c + 0.3, 1.5, fill='currentColor', stroke='none'))
    elif n == 6:  # Unspeakable: star, ring, rays, and the W-pupilled eye
        rays = ''
        for k in range(7):
            a = math.radians(-90 + 360 * (k + 0.5) / 7)
            rays += P(f"M{pt(polar(c, c, 12.6, a))} L{pt(polar(c, c, 15.2, a))}")
        body = (C(c, c, 12.2) + ngon(c, c, 12.2, 7, step=2) + rays + almond(c, c + 0.2, 5.4, 2.5)
                + w_pupil_line(c, c + 0.2, 2.6, 0.75))
    return stroke_group(body)


def refused():
    c = 16
    # A broken seal around a closed eye: the deep will not look at this.
    a0, a1 = math.radians(-60), math.radians(250)
    p0, p1 = polar(c, c, 12.5, a0), polar(c, c, 12.5, a1)
    ring = P(f"M{pt(p0)} A12.5 12.5 0 1 1 {pt(p1)}")
    crack = P(poly([polar(c, c, 12.5, math.radians(-75)), polar(c, c, 10.3, math.radians(-82)),
                    polar(c, c, 11.2, math.radians(-95)), polar(c, c, 9.0, math.radians(-104))], close=False))
    lid = P(f"M{f(c - 6.5)} {f(c - 0.8)} Q{f(c)} {f(c + 4.8)} {f(c + 6.5)} {f(c - 0.8)}")
    lashes = ''
    for k, x in enumerate([-4.6, -2.3, 0, 2.3, 4.6]):
        t = (x + 6.5) / 13
        y = (1 - t) ** 2 * (c - 0.8) + 2 * (1 - t) * t * (c + 4.8) + t ** 2 * (c - 0.8)
        y = y - 0.15
        lashes += P(f"M{f(c + x)} {f(y + 0.4)} L{f(c + x * 1.18)} {f(y + 3.2)}")
    return stroke_group(ring + crack + lid + lashes)


# ------------------------------------------------------------------ marks (32 grid): ward, milestone, diver

def catmull(points, closed=True, samples=10):
    """Dense points along a Catmull-Rom spline, to cut and rejoin outlines."""
    n = len(points)
    out = []
    rng_ = range(n) if closed else range(n - 1)
    for i in rng_:
        p0 = points[(i - 1) % n] if (closed or i > 0) else points[i]
        p1, p2 = points[i], points[(i + 1) % n]
        p3 = points[(i + 2) % n] if (closed or i + 2 < n) else points[(i + 1) % n]
        for k in range(samples):
            t = k / samples
            t2, t3 = t * t, t * t * t
            out.append(tuple(0.5 * ((2 * p1[j]) + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2
                                    + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3) for j in (0, 1)))
    if not closed:
        out.append(points[-1])
    return out


def nearest(pts, q):
    return min(range(len(pts)), key=lambda i: math.dist(pts[i], q))


def xform(pts, cx=0.0, cy=0.0, s=1.0, rot=0.0, dx=0.0, dy=0.0):
    """Scale and turn points about (cx, cy), then move them."""
    c, si = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    out = []
    for x, y in pts:
        x, y = (x - cx) * s, (y - cy) * s
        out.append((cx + x * c - y * si + dx, cy + x * si + y * c + dy))
    return out


# The ward is a hag stone: a sea-worn pebble with a hole worn right through it. Fishermen
# hung them in their boats against drowning and ill luck. Ours hangs from a cord.
PEBBLE = [(4.8, 20.4), (6.0, 15.4), (9.8, 12.2), (15.6, 11.0), (21.6, 11.6), (26.0, 14.6),
          (27.4, 19.6), (25.4, 24.4), (20.0, 27.2), (13.0, 27.6), (7.6, 25.4)]
HOLE = [(9.4, 17.8), (10.2, 15.4), (12.8, 14.4), (15.8, 14.8), (17.1, 16.8), (16.2, 19.4), (13.4, 20.4), (10.6, 19.8)]
LOOP = (14.6, 4.4, 1.6)


def ring_slice(pts, a, b):
    """Points a..b of a closed ring, wrapping round the end."""
    return pts[a:b + 1] if a <= b else pts[a:] + pts[:b + 1]


def ward_bands(s=1.0):
    """Two worn bands across the lower right of the stone, away from the hole."""
    out = ''
    for k in (0.74, 0.5):
        ring = catmull(xform(PEBBLE, 17.2, 19.6, k), samples=8)
        a = nearest(ring, xform([(26.6, 16.0)], 17.2, 19.6, k)[0])
        b = nearest(ring, xform([(16.0, 27.6)], 17.2, 19.6, k)[0])
        out += P(poly([(x * s, y * s) for x, y in ring_slice(ring, a, b)], close=False))
    return out


def ward(s=1.0, bands=True):
    """Held: the stone on its cord. s scales the drawing (0.75 puts it on the 24 grid)."""
    S = lambda pts: [(x * s, y * s) for x, y in pts]
    lx, ly, lr = LOOP
    body = P(smooth(S(PEBBLE), close=True)) + P(smooth(S(HOLE), close=True))
    body += C(lx * s, ly * s, lr * s)
    # One strand runs over the front of the stone and down into the hole; the other comes
    # up from behind, so it shows only above the stone's top edge.
    body += P(smooth(S([(13.9, 6.0), (13.2, 9.6), (12.9, 12.6), (12.9, 15.6)])))
    body += P(smooth(S([(15.4, 6.0), (16.9, 8.6), (17.6, 11.25)])))
    if bands:
        body += ward_bands(s)
    return body


def ward_spent():
    """Spent: the stone has split through its hole and the cord has parted."""
    outline = catmull(PEBBLE, samples=14)
    hole = catmull(HOLE, samples=10)
    crack_top = [(11.8, 12.0), (12.9, 12.9), (12.1, 13.6), (12.8, 14.4)]
    crack_bot = [(13.4, 20.4), (14.9, 22.0), (13.8, 23.9), (15.6, 25.6), (14.9, 26.6), (15.6, 27.5)]
    top_i, bot_i = nearest(outline, crack_top[0]), nearest(outline, crack_bot[-1])
    h_top, h_bot = nearest(hole, crack_top[-1]), nearest(hole, crack_bot[0])
    # Both rings run clockwise on screen (left, up, right, down).
    left = ring_slice(outline, bot_i, top_i) + crack_top + ring_slice(hole, h_bot, h_top)[::-1][1:-1] + crack_bot
    right = ring_slice(outline, top_i, bot_i) + crack_bot[::-1] + ring_slice(hole, h_top, h_bot)[::-1][1:-1] + crack_top[::-1]
    left = xform(left, 12.0, 21.0, 1.0, -11, -2.0, 1.8)
    right = xform(right, 16.0, 21.0, 1.0, 9, 1.8, 1.0)
    lx, ly, lr = LOOP
    body = P(poly(left)) + P(poly(right))
    body += C(lx, ly, lr)
    body += P(smooth([(14.6, 6.0), (14.0, 8.0), (14.4, 9.8)]))                          # the cord, parted
    body += P("M14.4 9.8 L13.3 11.0 M14.4 9.8 L14.6 11.5 M14.4 9.8 L15.6 10.9")       # frayed end
    return body


def milestone():
    """A surveyor's benchmark, carved where the line was passed: the datum bar, and the broad
    arrow pointing up to it. You can never drift back above it."""
    return (P("M4.5 10.6 L27.5 10.6", stroke_width='2.3')
            + P("M16 12.9 L16 25.8 M16 12.9 L9.4 24.4 M16 12.9 L22.6 24.4"))


def diver():
    """One diver in the shared view: a bathysphere on its cable. Filled, so a player's
    colour reads at any size; the porthole is punched through."""
    hull = circle_path(16, 18.4, 9.6) + ' ' + circle_path(16, 18.4, 4.9, ccw=True)
    return (P(hull, fill='currentColor', stroke='none', fill_rule='evenodd')
            + C(16, 18.4, 3.3, fill='currentColor', stroke='none', opacity='0.45')
            + C(16, 6.9, 1.5) + P("M16 0 L16 5.4"))


MARKS = [
    ('ward', 'Ward', 'A hag stone on its cord: a pebble with a hole worn through it. A ward you hold.', ward),
    ('ward-spent', 'Ward, spent', 'The hag stone split through its hole, the cord parted. A ward that was used.', ward_spent),
    ('milestone', 'Milestone', "A surveyor's benchmark: the datum bar and the broad arrow beneath it.", milestone),
    ('diver', 'Diver', 'A bathysphere on its cable, filled, with the porthole punched through.', diver),
]

TIERS = [
    ('commonplace', 'Commonplace', 'A grain of sand. Everyone says it.'),
    ('curious', 'Curious', 'A young radiolarian with three spines.'),
    ('obscure', 'Obscure', 'Five spines around a pentagonal shell.'),
    ('arcane', 'Arcane', 'Seven barbed spines around a heptagonal heart.'),
    ('forbidden', 'Forbidden', 'A seven-pointed star around an open eye.'),
    ('unspeakable', 'Unspeakable', 'Star, ring and rays around the W-pupilled eye.'),
]

# ------------------------------------------------------------------ the Drowned Script (20 x 32 cells)
# Each glyph hangs from the waterline at y = 3. Strokes are polylines (smoothed)
# or circles. Coordinates are in the cell.

TOP = 3.0
def spiral(cx, cy, r0, r1, turns, a0=-math.pi / 2, n=40):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = a0 + t * turns * math.tau
        r = r0 + (r1 - r0) * t
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def almond_pts(cx, cy, w, h, n=16):
    top = [(cx - w + 2 * w * i / n, cy - h * math.sin(math.pi * i / n)) for i in range(n + 1)]
    bot = [(cx + w - 2 * w * i / n, cy + h * math.sin(math.pi * i / n)) for i in range(1, n)]
    return top + bot


SCRIPT = {
    'eye':      dict(meaning='to see; the city', strokes=[[(10, TOP), (10, 15.5)]],
                     closed=[almond_pts(10, 21, 7, 4.2)], dots=[(10, 21, 1.6)]),
    'coil':     dict(meaning='to sleep; patience', strokes=[[(6, TOP), (6.2, 12), (8, 14.5)], spiral(11, 20.5, 6.2, 1.2, 1.7, a0=math.radians(215))]),
    'gate':     dict(meaning='a door; to enter', strokes=[[(4, TOP), (4, 26), (2.5, 29)], [(16, TOP), (16, 26), (17.5, 29)], [(4, 11), (10, 18), (16, 11)]],
                     dots=[(10, 23.5, 1.5)]),
    'sleeper':  dict(meaning='the one who dreams', strokes=[[(10, TOP), (10, 9)], [(2.5, 12), (10, 17.5), (17.5, 12)]],
                     polys=[[(5.2, 14.8), (4.4, 19)], [(7.6, 16.6), (7.2, 22)], [(10, 17.5), (10, 26)], [(12.4, 16.6), (12.8, 22)], [(14.8, 14.8), (15.6, 19)]],
                     dots=[(10, 28.5, 1.3)]),
    'tide':     dict(meaning='to rise; to return', polys=[[(12, TOP), (5.5, 9.5), (14, 16), (6.5, 22.5), (12, 27)]], dots=[(12, 29.5, 1.4)]),
    'fang':     dict(meaning='hunger', strokes=[[(3.5, TOP), (5, 13), (10, 21.5)], [(16.5, TOP), (15, 13), (10, 21.5)]], rings=[(10, 25, 2.6)]),
    'anchor':   dict(meaning='to hold; to drown', strokes=[[(10, TOP), (10, 8.6)], [(10, 13.4), (10, 25)], [(3.5, 18), (5, 23.5), (10, 26.5), (15, 23.5), (16.5, 18)]],
                     rings=[(10, 11, 2.4)], dots=[(3.5, 16.6, 1.3), (16.5, 16.6, 1.3)]),
    'talon':    dict(meaning='to seize', strokes=[[(10, TOP), (10, 16)], [(10, 16), (5, 20), (4.5, 25), (6.5, 27.5)], [(10, 16), (10.5, 29)], [(10, 16), (15, 20), (15.5, 25), (13.5, 27.5)]]),
    'sounding': dict(meaning='depth; to measure', strokes=[[(10, TOP), (10, 25)]], polys=[[(10, 9), (15.5, 9)], [(4.5, 14), (10, 14)], [(10, 19), (14, 19)]],
                     closed=[[(10, 24.5), (12.2, 28), (10, 30.5), (7.8, 28)]]),
    'maw':      dict(meaning='to speak; to devour', strokes=[[(10, TOP), (10, 12)]], rings=[(10, 19.5, 7)],
                     polys=[[(3, 19.5), (18.5, 19.5)], [(6, 19.5), (7, 22)], [(9.5, 19.5), (10.5, 22.5)], [(13, 19.5), (14, 22)]]),
    'root':     dict(meaning='old; before men', strokes=[[(10, TOP), (10, 14), (6, 20), (4, 26.5)], [(10, 14), (13, 19), (12, 23.5)], [(13, 19), (16.5, 24.5), (17, 27.5)]],
                     dots=[(4, 28.3, 1.2), (12, 25.2, 1.1), (17, 29.2, 1.2)]),
    'veil':     dict(meaning='the sea; to hide', strokes=[[(2.5, 14), (5, 6), (10, TOP), (15, 6), (17.5, 14)], [(6.5, 13), (5.5, 20), (7.5, 27)], [(13.5, 13), (14.5, 21), (12.5, 28)], [(10, 12), (10.4, 17)]]),
    'spire':    dict(meaning='a tower that was not built', closed=[[(4, TOP), (16, TOP), (16, 9), (4, 9)], [(6, 9), (14, 9), (14, 15), (6, 15)], [(8, 15), (12, 15), (12, 21), (8, 21)]],
                     strokes=[[(10, 21), (10, 26)]], dots=[(10, 28.6, 1.4)]),
    'knot':     dict(meaning='a bargain', strokes=[[(10, TOP), (10, 9), (14.5, 13.5), (10, 18), (5.5, 22.5), (10, 27), (14.5, 22.5), (10, 18), (5.5, 13.5), (10, 9)]]),
    'hand':     dict(meaning='to reach', strokes=[[(5, TOP), (5, 26)], [(5, 10), (10, 9), (14, 12), (15, 16)], [(5, 15.5), (10, 15), (13.5, 18.5), (14, 22.5)], [(5, 21), (9, 21), (11.5, 24.5), (11.5, 27.5)]],
                     dots=[(15.2, 17.8, 1.2), (14.1, 24.3, 1.2), (11.5, 29.3, 1.2)]),
    'void':     dict(meaning='nothing; the space between stars', strokes=[[(10, TOP), (10, 9)]], rings=[(10, 18, 8)], dots=[(10, 18, 1.4)]),
}


def script_glyph(spec, cell_w=20, with_line=True):
    out = []
    if with_line:
        out.append(P(f"M0 {f(TOP)} L{f(cell_w)} {f(TOP)}"))
    for s in spec.get('strokes', []):
        out.append(P(smooth(s) if len(s) > 2 else poly(s, close=False)))
    for s in spec.get('polys', []):
        out.append(P(poly(s, close=False)))
    for s in spec.get('closed', []):
        out.append(P(smooth(s, close=True) if len(s) > 4 else poly(s, close=True)))
    for (x, y, r) in spec.get('rings', []):
        out.append(C(x, y, r))
    for (x, y, r) in spec.get('dots', []):
        out.append(C(x, y, r, fill='currentColor', stroke='none'))
    return ''.join(out)


# ------------------------------------------------------------------ Sigils (32 grid)
# One per question topic, on the Logbook. Each is a Drowned Script word hung inside a
# porthole: the waterline becomes a chord across the ring. Parts are wired to CSS custom
# properties so one symbol can show all four brightness levels (see .cth-sigil):
#   --sigil-ring   opacity of the ring (default 1)
#   --sigil-dash   dash pattern of the ring (default none)
#   --sigil-rays   opacity of the seven rays that appear when a Sigil blazes (default 0)

SIGILS = [
    ('geography', 'sounding', 'Geography: the sounding line, to measure the world'),
    ('science', 'void', 'Science: the space between stars'),
    ('nature', 'coil', 'Nature: the coil of a shell, patience'),
    ('culture', 'spire', 'Culture: a tower that was not built'),
    ('history', 'root', 'History: old, before men'),
    ('myth', 'sleeper', 'Myth: the one who dreams'),
    ('food', 'fang', 'Food: hunger'),
    ('language', 'maw', 'Language: to speak'),
    ('sport', 'talon', 'Sport: to seize'),
    ('misc', 'knot', 'Everything else: a knot of loose ends'),
]


def sigil(glyph_key):
    c, R, chord_y = 16, 14.0, 8.0
    half = math.sqrt(R * R - (chord_y - c) ** 2)
    k = 0.78                                   # glyph cell (20 x 32) scaled into the ring
    tx, ty = c - 10 * k, chord_y - TOP * k
    ring = C(c, c, R, style='opacity: var(--sigil-ring, 1); stroke-dasharray: var(--sigil-dash, none)')
    chord = P(f"M{f(c - half)} {f(chord_y)} L{f(c + half)} {f(chord_y)}")
    rays = ''
    for i in range(7):
        a = math.radians(-90 + 360 * (i + 0.5) / 7)
        rays += P(f"M{pt(polar(c, c, R + 1.6, a))} L{pt(polar(c, c, R + 3.6, a))}")
    glyph = (f'<g transform="translate({f(tx)} {f(ty)}) scale({k})" stroke-width="{f(SW / k)}">'
             + script_glyph(SCRIPT[glyph_key], with_line=False) + '</g>')
    return ring + chord + glyph + f'<g style="opacity: var(--sigil-rays, 0)">{rays}</g>'


def main():
    os.makedirs(OUT, exist_ok=True)
    os.makedirs(os.path.join(OUT, 'script'), exist_ok=True)
    symbols = []
    for i, (key, name, desc) in enumerate(TIERS, start=1):
        body = tier(i)
        write(os.path.join(OUT, f'tier-{i}.svg'), svg(32, 32, body, title=f'{name} (tier {i})', desc=desc))
        symbols.append(f'<symbol id="tier-{i}" viewBox="0 0 32 32"><title>{name}</title>{body}</symbol>')
    body = refused()
    write(os.path.join(OUT, 'refused.svg'), svg(32, 32, body, title='Refused', desc='A broken seal around a closed eye.'))
    symbols.append(f'<symbol id="refused" viewBox="0 0 32 32"><title>Refused</title>{body}</symbol>')
    write(os.path.join(OUT, 'tiers-sprite.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(symbols) + '</svg>\n')

    script_symbols = []
    for key, spec in SCRIPT.items():
        inner = stroke_group(script_glyph(spec), sw=2)
        write(os.path.join(OUT, 'script', f'{key}.svg'),
              svg(20, 32, inner, title=f'Drowned Script: {key}', desc=spec['meaning']))
        script_symbols.append(f'<symbol id="g-{key}" viewBox="0 0 20 32"><title>{key}: {spec["meaning"]}</title>{inner}</symbol>')
    write(os.path.join(OUT, 'script-sprite.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(script_symbols) + '</svg>\n')

    # The Drowned City's name, as one joined word.
    word = ['eye', 'coil', 'gate', 'sleeper']
    inner = ''.join(f'<g transform="translate({20 * i} 0)">{script_glyph(SCRIPT[k])}</g>' for i, k in enumerate(word))
    write(os.path.join(OUT, 'drowned-city-name.svg'),
          svg(80, 32, stroke_group(inner, sw=2), title='The Drowned City',
              desc='Its true name in the Drowned Script: eye, coil, gate, sleeper.'))
    marks = []
    for key, name, desc, fn in MARKS:
        body = stroke_group(fn())
        write(os.path.join(OUT, f'{key}.svg'), svg(32, 32, body, title=name, desc=desc))
        marks.append(f'<symbol id="{key}" viewBox="0 0 32 32"><title>{name}</title>{body}</symbol>')
    write(os.path.join(OUT, 'marks-sprite.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(marks) + '</svg>\n')
    os.makedirs(os.path.join(OUT, 'sigils'), exist_ok=True)
    sigils = []
    for topic, key, desc in SIGILS:
        body = stroke_group(sigil(key))
        write(os.path.join(OUT, 'sigils', f'{topic}.svg'), svg(32, 32, body, viewbox='-4 -4 40 40', title=f'Sigil: {topic}', desc=desc))
        sigils.append(f'<symbol id="sigil-{topic}" viewBox="-4 -4 40 40"><title>{desc}</title>{body}</symbol>')
    write(os.path.join(OUT, 'sigils-sprite.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(sigils) + '</svg>\n')
    print('glyphs written to', OUT)


if __name__ == '__main__':
    main()
