"""Draws the bestiary: a specimen plate for each of the 24 creatures, and its silhouette.

    python3 art/tools/draw_bestiary.py

Writes art/bestiary/plates/<id>.svg, art/bestiary/silhouettes/<id>.svg, the sprite
art/bestiary/bestiary-sprite.svg (symbols #b-<id> and #b-<id>-sil) and bestiary.json.

Every plate is engraved on a 240 x 240 canvas in currentColor, lit from the upper left:
contours swell on the shadow side, hatching at -30 degrees and a second set at 55 where it is
darker. The four of the Drowned City carry a third set at 84 degrees, six off true: the wrong
angle. An animal's eye is an empty ring, because preserved specimens do not look back; only the
Dreamer has a pupil. Seeds are fixed, so the output is repeatable.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from bestiary_kit import Plate, spline, circle_pts, scatter, inside, bbox  # noqa: E402


def bbox_of(P):
    return bbox(P)
from svgkit import rng  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'bestiary')


def interp_y(points, x):
    """y on a polyline (sorted by x) at x."""
    pts = sorted(points)
    if x <= pts[0][0]:
        return pts[0][1]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        if x0 <= x <= x1:
            return y0 + (y1 - y0) * (x - x0) / ((x1 - x0) or 1)
    return pts[-1][1]


def petal(origin, ang, L, W, seed=0, wav=0.18, n=8):
    """A leaf or lobe: from origin out along ang (degrees), length L, half width W, wavy margins."""
    r = rng(seed)
    a = math.radians(ang)
    ca, sa = math.cos(a), math.sin(a)
    ph1, ph2 = r.uniform(0, 6), r.uniform(0, 6)
    up = [(L * i / n, W * math.sin(math.pi * i / n) ** 0.8 * (1 + wav * math.sin(i / n * 19 + ph1))) for i in range(n + 1)]
    lo = [(L * i / n, -W * math.sin(math.pi * i / n) ** 0.8 * (1 + wav * math.sin(i / n * 23 + ph2))) for i in range(n - 1, 0, -1)]
    return [(origin[0] + x * ca - y * sa, origin[1] + x * sa + y * ca) for x, y in up + lo]


def curl_spine(x0, y0, heading, length, curl=1.0, wiggle=0.25, seed=1, n=22, side=1):
    """The spine of an arm whose curvature grows towards the tip until it coils."""
    r = rng(seed)
    ds = length / n
    th = math.radians(heading)
    x, y = x0, y0
    ph = r.uniform(0, math.tau)
    pts = [(x, y)]
    for i in range(n):
        s_ = i / n
        k = side * (curl * (0.08 + 4.2 * s_ ** 3.0) / length * 6) + wiggle * math.sin(s_ * 7 + ph) / length * 4
        th += k * ds
        x += math.cos(th) * ds
        y += math.sin(th) * ds
        pts.append((x, y))
    return pts


def along(sp, i, off):
    """A point beside a spine at index i, off to its left (negative: right)."""
    a, b = sp[max(0, i - 1)], sp[min(len(sp) - 1, i + 1)]
    L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    nx, ny = -(b[1] - a[1]) / L, (b[0] - a[0]) / L
    return (sp[i][0] + nx * off, sp[i][1] + ny * off)


def fan(p, origin, ang, L, spread, rays=6, glass=False, shade=0.7, dark=0.0, seed=1):
    """A rayed fin: a sector from origin, heading ang (degrees), length L, opening spread degrees,
    with a softly scalloped outer edge between the rays."""
    pts = [origin]
    n = rays * 2
    for i in range(n + 1):
        t = i / n
        a = math.radians(ang - spread / 2 + spread * t)
        rr = L * (0.82 + 0.18 * math.sin(math.pi * t) ** 0.5) * (1.0 if i % 2 == 0 else 0.93)
        pts.append((origin[0] + rr * math.cos(a), origin[1] + rr * math.sin(a)))
    p.body(pts, n=3, glass=glass, shade=shade, dark=dark)
    for i in range(1, rays):
        a = math.radians(ang - spread / 2 + spread * i / rays)
        rr = L * (0.8 + 0.18 * math.sin(math.pi * i / rays) ** 0.5)
        p.line([(origin[0] + 2 * math.cos(a), origin[1] + 2 * math.sin(a)), (origin[0] + rr * math.cos(a), origin[1] + rr * math.sin(a))],
               w=0.2, smooth=False, op=0.85)


def seabed(p, y, seed=3, x0=0, x1=240, fade=26):
    """The floor: one soft line, sediment hatched below it, and a little stipple."""
    r = rng(seed)
    line = [(x, y + 1.6 * math.sin(x / 23 + seed) + 0.8 * math.sin(x / 7)) for x in range(int(x0), int(x1) + 1, 4)]
    p.line(line, w=0.42, taper='both')
    for k in range(1, 6):
        yy = y + k * 5
        segs = []
        x = x0 + r.uniform(0, 12)
        while x < x1:
            L = r.uniform(10, 34) * (1 - k / 8)
            segs.append((x, min(x1, x + L)))
            x += L + r.uniform(5, 16) * (1 + k * 0.5)
        for a, b in segs:
            p.line([(a, yy + 1.2 * math.sin(a / 23 + seed)), (b, yy + 1.2 * math.sin(b / 23 + seed))], w=0.26, smooth=False, op=max(0.25, 1 - k / 6))
    p.dots([(r.uniform(x0, x1), y + r.uniform(2, fade)) for _ in range(60)], r=0.4, op=0.7)


def snow(p, n, seed, box, test=lambda x, y: True):
    """Marine snow: the small things that tell you how big the big things are."""
    r = rng(seed)
    pts = scatter(r, n, test, box, 9)
    p.dots(pts, r=0.7, op=0.8)


# ======================================================================= The Shallows

def lions_mane():
    p = Plate('lions-mane', "Lion's mane jellyfish",
              'Cyanea capillata: a bell as wide as a cartwheel and a mane of threads that trails for thirty metres.')
    r = p.r
    cx, x_l, x_r, rim = 120, 36, 204, 84
    lobes = 8
    notch = [x_l + (x_r - x_l) * k / lobes for k in range(lobes + 1)]
    # the mane: seven threads from each notch, swept by the current
    for k, x0 in enumerate(notch):
        for j in range(7):
            xs = x0 + r.uniform(-6, 6)
            yend = r.uniform(214, 262)
            ph = r.uniform(0, math.tau)
            amp = r.uniform(3, 8)
            drift = (x0 - cx) * 0.18 + r.uniform(6, 22)
            pts = [(xs + drift * (i / 6) ** 1.4 + amp * math.sin(2.1 * i / 6 * math.pi + ph) * (i / 6),
                    rim + 3 + (yend - rim) * i / 6) for i in range(7)]
            p.thread(pts, w=0.38, sil=0.75, n=5)
    # five oral arms: broad frilled curtains hanging from the middle
    for k in range(5):
        x0 = 98 + k * 11
        sway = r.uniform(-4, 14)
        L = r.uniform(70, 96)
        spine = [(x0 + sway * (i / 6) ** 1.5 + 3 * math.sin(i * 1.2 + k), rim - 2 + L * i / 6) for i in range(7)]
        p.limb(spine, lambda t, k=k: (9.0 - 5.0 * t) * (1 + 0.32 * math.sin(t * 46 + k * 2.1)), n=12, shade=0.9)
    # the bell
    def dome(x):
        u = (x - cx) / ((x_r - x_l) / 2)
        return rim - 48 * max(0.0, 1 - u * u) ** 0.6
    top = [(x_l + (x_r - x_l) * i / 16, dome(x_l + (x_r - x_l) * i / 16)) for i in range(17)]
    edge = []
    for k in range(lobes, 0, -1):
        a, b = notch[k], notch[k - 1]
        for j, dy in ((0.2, 4.5), (0.5, 7.0), (0.8, 4.5)):
            edge.append((a + (b - a) * j, rim + dy))
        if k > 1:
            edge.append((b, rim + 0.5))
    P = p.body(top[1:] + edge + [top[0]], n=6, shade=1.5)
    for k in range(1, lobes):                       # the radial grooves, like meridians on a dome
        xk = notch[k]
        pts = [(cx + (xk - cx) * t, dome(cx + (xk - cx) * t) + 3 + 5 * t ** 2) for t in (0.08, 0.4, 0.75, 1.0)]
        pts[-1] = (xk, rim - 1)
        p.line(pts, w=0.3)
    p.line([(x_l + 8, rim - 4), (cx, rim - 1), (x_r - 8, rim - 4)], w=0.3, op=0.8)
    return p


def man_o_war():
    p = Plate('man-o-war', "Portuguese man o' war",
              'Physalia physalis: not one animal but a colony. A float sails the surface; the threads below sting.')
    r = p.r
    wl = 78
    # stinging threads: long, beaded, trailing back from the float
    for k in range(11):
        x0 = 92 + k * 8.2 + r.uniform(-2, 2)
        y0 = wl + 12 + r.uniform(0, 6)
        L = r.uniform(112, 170)
        drift = r.uniform(-18, 0) - (k - 5) * 1.5
        ph = r.uniform(0, 6)
        pts = [(x0 + drift * (i / 7) ** 1.2 + 4 * math.sin(i / 7 * 5 + ph) * (i / 7), y0 + L * i / 7) for i in range(8)]
        sp = p.thread(pts, w=0.42, sil=0.8, n=5)
        p.dots([sp[j] for j in range(7, len(sp) - 3, 5)], r=0.9)
    for k, x0 in enumerate((108, 132, 156)):       # three threads drawn up into coils
        pts = [(x0 + 2.8 * math.cos(t / 59 * 42), wl + 15 + t / 59 * (44 + k * 9) + 1.5 * math.sin(t / 59 * 42)) for t in range(60)]
        p.thread(pts, w=0.36, sil=0.75, smooth=False, taper=False)
    # polyps clustered under the float
    for k in range(13):
        x0 = 88 + k * 7.4 + r.uniform(-2, 2)
        y0 = wl + 3 + 4 * math.sin(k / 12 * math.pi)
        L = r.uniform(8, 16)
        tip = (x0 + r.uniform(-4, 3), y0 + L)
        p.limb([(x0, y0), ((x0 + tip[0]) / 2 + r.uniform(-1.4, 1.4), (y0 + tip[1]) / 2), tip],
               lambda t: 2.2 * (1 - 0.6 * t) + 0.3, hatch=False, contour=(0.3, 0.7))
    # the float: a balloon with one end raised to a point, the other round, and a crimped crest on top
    fl = [(40, 30), (52, 42), (70, 52), (96, 56), (124, 54), (150, 48), (170, 45), (187, 50), (197, 62), (195, 76),
          (182, 86), (156, 91), (122, 90), (92, 84), (68, 72), (52, 56)]
    top = [(52, 42), (70, 52), (96, 56), (124, 54), (150, 48), (170, 45), (187, 50)]
    crest_top, crest_base = [], []
    for i in range(29):
        t = i / 28
        x = 60 + 124 * t
        h = 22 * math.sin(math.pi * t ** 0.85) ** 0.7
        crest_top.append((x, interp_y(top, x) - h - 1.8 * math.sin(t * 40) - 1))
        crest_base.append((x, interp_y(top, x) + 2))
    p.body(crest_top + crest_base[::-1][1:-1], dense=True, shade=0.8)
    for i in range(1, 17):
        x = 60 + 124 * i / 17
        yt = crest_top[min(28, round(i / 17 * 28))][1]
        p.line([(x - 1.5, interp_y(top, x)), (x, (interp_y(top, x) + yt) / 2), (x + 1.5, yt + 1.6)], w=0.26)
    p.body(fl, n=8, shade=0.9)
    p.line([(150, 54), (170, 52), (184, 58)], w=0.3, op=0.9)                # the sheen on the glass
    p.line([(84, 79), (120, 85), (156, 85), (184, 76)], w=0.3, op=0.7)
    p.line([(178, 56), (188, 64), (189, 74)], w=0.3, op=0.8)
    # the surface of the sea
    for (x0, x1, y, op) in ((0, 58, wl, 1.0), (192, 240, wl, 1.0), (6, 50, wl + 5, 0.6), (198, 236, wl + 6, 0.6), (14, 40, wl + 10, 0.4)):
        pts = [(x, y + 1.3 * math.sin(x / 7.5)) for x in range(int(x0), int(x1) + 1, 4)]
        p.line(pts, w=0.34, op=op)
    return p


def leafy_seadragon():
    p = Plate('leafy-seadragon', 'Leafy seadragon',
              'Phycodurus eques: a pipefish dressed as drifting weed. The leaves are skin, not fins.')
    r = p.r
    spine = [(14, 76), (28, 75), (42, 73), (54, 71), (64, 72), (75, 78), (88, 86), (102, 92), (120, 96), (138, 101),
             (152, 110), (161, 124), (165, 142), (164, 160), (158, 176), (148, 188), (136, 192), (128, 186), (131, 177), (139, 177)]
    widths = [1.6, 1.8, 2.1, 4.6, 6.4, 5.3, 6.4, 8.0, 8.8, 8.4, 7.2, 6.0, 4.8, 3.8, 3.0, 2.4, 1.9, 1.4, 1.0, 0.7]
    leaves = [  # base on the body, heading, size
        ((60, 66), -100, 24), ((80, 74), -78, 32), ((77, 86), 112, 28), ((106, 86), -74, 44), ((112, 102), 96, 46),
        ((140, 94), -44, 36), ((146, 116), 116, 34), ((166, 140), 2, 26), ((161, 168), 24, 24), ((94, 90), 160, 20)]
    for k, (base, ang, size) in enumerate(leaves):
        a = math.radians(ang)
        end = (base[0] + math.cos(a) * size * 0.36, base[1] + math.sin(a) * size * 0.36)
        p.limb([base, ((base[0] + end[0]) / 2 + r.uniform(-1.5, 1.5), (base[1] + end[1]) / 2), end],
               lambda t: 1.3 - 0.5 * t, hatch=False, contour=(0.3, 0.7))
        n_br = 3 if size > 30 else 2
        for j in range(n_br):
            ba = ang + (j - (n_br - 1) / 2) * 34 + r.uniform(-8, 8)
            bl = size * r.uniform(0.12, 0.2)
            bend = (end[0] + math.cos(math.radians(ba)) * bl, end[1] + math.sin(math.radians(ba)) * bl)
            p.thread([end, bend], w=0.55, sil=0.8, smooth=False, taper=False)
            L = size * r.uniform(0.5, 0.66)
            W = size * r.uniform(0.1, 0.13)
            p.body(petal(bend, ba + r.uniform(-10, 10), L, W, seed=k * 10 + j, wav=0.34, n=10), n=4, shade=0.7)
            ca, sa = math.cos(math.radians(ba)), math.sin(math.radians(ba))
            p.line([bend, (bend[0] + L * 0.82 * ca, bend[1] + L * 0.82 * sa)], w=0.22, smooth=False)
    p.limb(spine, widths, n=6, shade=1.0)
    sp = spline(spine, False, 6)
    from bestiary_kit import _lerp_list
    for i in range(26, len(sp) - 14, 4):        # bony rings
        a, b = sp[i - 1], sp[i + 1]
        nx, ny = -(b[1] - a[1]), b[0] - a[0]
        L = math.hypot(nx, ny) or 1
        w = 0.86 * _lerp_list(widths, i / (len(sp) - 1))
        p.line([(sp[i][0] + nx / L * w, sp[i][1] + ny / L * w), (sp[i][0] - nx / L * w, sp[i][1] - ny / L * w)], w=0.26, smooth=False)
    for i in range(30, 76, 6):                  # small spines along the back
        a, b = sp[i - 1], sp[i + 1]
        L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
        tx, ty = (b[0] - a[0]) / L, (b[1] - a[1]) / L
        nx, ny = -ty, tx
        w = _lerp_list(widths, i / (len(sp) - 1))
        base = (sp[i][0] - nx * w, sp[i][1] - ny * w)
        p.solid([(base[0] - tx * 1.4, base[1] - ty * 1.4), (base[0] - nx * 4.2 + tx * 1.6, base[1] - ny * 4.2 + ty * 1.6), (base[0] + tx * 1.4, base[1] + ty * 1.4)])
    p.eye(62, 70.5, 2.3)
    p.line([(57, 75), (61, 78), (66, 78.6)], w=0.28)   # gill cover
    p.line([(14, 75.5), (18, 76.5)], w=0.3, smooth=False, taper=False)
    return p


def sunfish():
    p = Plate('sunfish', 'Ocean sunfish',
              'Mola mola: the heaviest bony fish, a head with a fin above and below and no tail at all.')
    r = p.r
    dorsal = [(126, 68), (138, 44), (152, 24), (165, 11), (171, 15), (168, 36), (164, 58), (163, 75)]
    anal = [(128, 181), (139, 204), (153, 222), (166, 233), (172, 228), (168, 206), (165, 186), (163, 170)]
    p.body(dorsal, n=6, shade=0.9)
    p.body(anal, n=6, shade=1.1)
    for k in range(1, 6):
        t = k / 6
        p.line([(130 + 32 * t, 70 + 4 * t), (151 + 16 * t, 34 - 12 * t)], w=0.24, op=0.8)
        p.line([(132 + 31 * t, 180 - 8 * t), (152 + 16 * t, 214 + 12 * t)], w=0.24, op=0.8)
    body = [(34, 123), (39, 104), (52, 86), (74, 71), (104, 62), (136, 63), (162, 72), (178, 86), (183, 92)]
    for k in range(7):          # the clavus: a rudder of seven soft scallops
        y0 = 93 + k * 10.4
        body += [(186.2, y0 + 2.6), (187.4, y0 + 5.2), (186.2, y0 + 7.8), (184.4, y0 + 10.4)]
    body += [(180, 168), (166, 177), (140, 186), (108, 185), (78, 174), (56, 158), (42, 142)]
    P = p.body(body, n=5, shade=1.0)
    for k in range(8):           # rays across the clavus
        y = 95 + k * 9.2
        p.line([(171, y + 1), (182, y + 3.4)], w=0.24, op=0.8)
    p.line([(169, 84), (173, 112), (173, 142), (168, 168)], w=0.34)
    pec_o = (86, 121)
    p.body(petal(pec_o, -14, 30, 7.5, seed=4, wav=0.06, n=10), n=4, shade=0.5)
    for k in (-0.7, -0.35, 0, 0.35, 0.7):
        a = math.radians(-14 + k * 22)
        p.line([pec_o, (pec_o[0] + 27 * math.cos(a), pec_o[1] + 27 * math.sin(a))], w=0.2, smooth=False, op=0.8)
    p.line([(80, 108), (77, 118), (80, 129)], w=0.32)       # the gill opening
    p.eye(60, 107, 4.4, w=0.6)
    p.line([(33, 120), (36, 123), (33, 126)], w=0.36, taper=False)  # mouth
    p.dots(scatter(r, 70, lambda x, y: inside(P, x, y) and y < 140 and x < 162, (40, 64, 170, 140), 3.6), r=0.36, op=0.8)
    return p


# ======================================================================= The Gloaming

def barreleye():
    p = Plate('barreleye', 'Barreleye',
              'Macropinna microstoma: its head is a clear dome, and the eyes inside it turn to look straight up through it.')
    tail = [(186, 128), (214, 104), (222, 106), (208, 136), (222, 166), (214, 168), (188, 143)]
    p.body(tail, n=5, shade=0.8)
    for k in range(6):
        t = (k + 0.5) / 6
        p.line([(191, 131 + 9 * t), (216 - 8 * abs(t - 0.5) * 2, 108 + 56 * t)], w=0.2, op=0.8, smooth=False)
    p.body([(146, 122), (151, 106), (166, 110), (162, 124)], n=4, shade=0.6)          # dorsal fin
    p.body([(172, 126), (176, 118), (182, 128)], n=3, shade=0.5)                     # adipose fin
    p.body([(150, 151), (157, 166), (171, 162), (166, 149)], n=4, shade=0.8)          # anal fin
    body = [(26, 140), (32, 130), (46, 124), (76, 121), (112, 119), (146, 121), (170, 125), (187, 129), (189, 142),
            (170, 147), (142, 153), (108, 158), (74, 158), (48, 154), (33, 148)]
    P = p.body(body, n=6, shade=1.1)
    for row in range(4):            # scales, as small arcs
        for k in range(10):
            x = 118 + k * 7 + (row % 2) * 3.5 - row * 2
            y = 127 + row * 6.5
            if inside(P, x + 3, y + 2) and inside(P, x - 2, y + 5):
                p.line([(x, y), (x + 2.6, y + 2.6), (x, y + 5.2)], w=0.2, op=0.7)
    p.line([(70, 124), (128, 132), (182, 136)], w=0.22, op=0.8)                        # lateral line
    p.line([(84, 125), (80, 139), (84, 153)], w=0.34)                                  # gill cover
    p.line([(26, 139), (31, 142), (37, 141)], w=0.3, taper=False)                      # a small mouth
    pec = (92, 147)
    p.body(petal(pec, 22, 66, 15, seed=7, wav=0.08, n=12), n=4, glass=True)
    for k in range(-4, 5):
        a = math.radians(22 + k * 6.5)
        p.line([pec, (pec[0] + 62 * math.cos(a), pec[1] + 62 * math.sin(a))], w=0.2, smooth=False, op=0.85)
    pel = (118, 156)
    p.body(petal(pel, 64, 28, 7, seed=9, wav=0.08, n=8), n=4, glass=True)
    for k in range(-2, 3):
        a = math.radians(64 + k * 9)
        p.line([pel, (pel[0] + 26 * math.cos(a), pel[1] + 26 * math.sin(a))], w=0.2, smooth=False, op=0.85)
    # the eyes: two barrels inside the dome, turned to look straight up; the far one half hidden
    for (ex, top, sh) in ((70, 88, 0.7), (58, 84, 1.2)):
        p.body([(ex - 6, 122), (ex - 6.5, 100), (ex - 5.5, top + 2), (ex + 5.5, top + 2), (ex + 6.5, 100), (ex + 6, 122)], n=4, shade=sh, dark=0.5)
        p.eye(ex, top + 2, 5.6, ry=2.2, w=0.5)
    # the shield: a clear dome over the whole head
    p.body([(30, 128), (32, 104), (44, 80), (64, 63), (88, 60), (106, 70), (114, 92), (116, 121)], n=8, glass=True)
    p.line([(38, 104), (44, 88), (56, 74)], w=0.26, op=0.8)
    p.line([(104, 84), (108, 100)], w=0.26, op=0.7)
    return p


def vampire_squid():
    p = Plate('vampire-squid', 'Vampire squid',
              'Vampyroteuthis infernalis: neither squid nor octopus. It wraps itself in its own cloak and lights its arm tips.')
    H = (100, 102)                                   # the head, where the arms begin
    a = math.radians(38)
    AX = (math.cos(a), math.sin(a))                  # the cloak opens down and to the right
    PP = (-AX[1], AX[0])
    R = (H[0] + AX[0] * 96, H[1] + AX[1] * 96)
    rim = lambda th, k=1.0: (R[0] + 64 * math.cos(th) * PP[0] + 17 * k * math.sin(th) * AX[0],  # noqa: E731
                             R[1] + 64 * math.cos(th) * PP[1] + 17 * k * math.sin(th) * AX[1])
    at = lambda t, w: (H[0] + AX[0] * t + PP[0] * w, H[1] + AX[1] * t + PP[1] * w)  # noqa: E731
    # the inside of the cloak, seen through its mouth: black, with the far arms and their soft spines
    far = [rim(math.pi + math.pi * i / 24) for i in range(25)]
    near = [rim(math.pi - math.pi * i / 24) for i in range(25)]
    p.body(far + near[::-1][1:-1], dense=True, dark=1.0, shade=1.4, contour=(0.3, 0.7))
    for k in range(3):
        th = math.pi + math.pi * (k + 1) / 4
        tip = rim(th)
        base = at(52, 0)
        sp = p.line([base, ((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2 - 4), tip], w=0.4)
        for j in range(len(sp) // 2, len(sp) - 1, 2):
            (x0, y0), (x1, y1) = sp[j], sp[j + 1]
            L = math.hypot(x1 - x0, y1 - y0) or 1
            nx, ny = -(y1 - y0) / L, (x1 - x0) / L
            p.line([(x0 + nx, y0 + ny), (x0 + nx * 3.6, y0 + ny * 3.6)], w=0.28, smooth=False)
        p.glow(tip[0], tip[1], 1.5)
    # the outside of the cloak: a bell of web from the head to the near rim, scalloped between five arm tips
    tips = [math.pi - math.pi * (k + 0.5) / 5 for k in range(5)]
    edge = [rim(math.pi)]
    for k, th in enumerate(tips):
        edge.append(rim(th))
        nxt = tips[k + 1] if k < 4 else 0.0
        mid = (th + nxt) / 2
        mx, my = rim(mid)
        edge.append((mx - AX[0] * 7, my - AX[1] * 7))
    edge = edge[:-1] + [rim(0.0)]
    up = [at(t, 23 + (64 - 23) * (t / 96) ** 1.6) for t in range(0, 97, 12)]
    lo = [at(t, -(23 + (64 - 23) * (t / 96) ** 1.6)) for t in range(0, 97, 12)]
    cloak = [at(-4, -21)] + lo[1:-1] + edge + up[::-1][1:-1] + [at(-4, 21)]
    p.body(cloak, n=5, shade=1.0, dark=0.7)
    for th in tips:                                   # the arms, as ribs in the web, ending in lights
        tip = rim(th)
        ext = (tip[0] + AX[0] * 6, tip[1] + AX[1] * 6)
        mid = at(52, 64 * math.cos(th) * 0.62)
        p.line([at(6, 16 * math.cos(th)), mid, tip], w=0.55)
        p.thread([tip, ext], w=0.9, sil=1.0, smooth=False)
        p.glow(ext[0] + AX[0] * 0.8, ext[1] + AX[1] * 0.8, 1.7)
    # the mantle, rising behind, with its two fins near the end like ears
    prof = lambda t: 22 * max(0.0, 1 - (t / 74) ** 2.4) ** 0.5  # noqa: E731
    side1 = [at(-t, prof(t)) for t in range(0, 75, 6)]
    side2 = [at(-t, -prof(t)) for t in range(0, 75, 6)]
    mantle = side1 + [at(-75, 0)] + side2[::-1]
    base1, base2 = at(-46, -prof(46) * 0.85), at(-62, -prof(62) * 0.7)      # the far fin, behind the mantle
    p.body([base1, at(-48, -30), at(-54, -42), at(-58, -44), at(-64, -38), base2], n=5, shade=0.8)
    p.body(mantle, n=4, shade=1.0, dark=0.5)
    base1, base2 = at(-46, 22 * 0.85 * 0.98), at(-62, 15)
    fin = [base1, at(-46, 30), at(-52, 42), at(-58, 45), at(-64, 38), base2]
    p.body(fin, n=5, shade=0.7)
    p.glow(*at(-50, 20), r=1.6)
    p.eye(*at(-6, 8), r=7.6, w=0.65)
    return p


def hatchetfish():
    p = Plate('hatchetfish', 'Hatchetfish',
              'Argyropelecus: thin as a blade and silver, with lights along its keel to erase its own shadow.')
    tail = [(186, 106), (206, 90), (212, 92), (202, 112), (212, 132), (206, 134), (186, 117)]
    p.body(tail, n=5, shade=0.8)
    for k in range(5):
        t = (k + 0.5) / 5
        p.line([(189, 108 + 7 * t), (206 - 6 * abs(t - 0.5) * 2, 93 + 38 * t)], w=0.22, op=0.8, smooth=False)
    p.body([(118, 74), (124, 56), (132, 54), (138, 78)], n=4, shade=0.7)               # dorsal fin
    p.body([(140, 132), (150, 146), (162, 140), (160, 126)], n=4, shade=0.9)           # anal fin
    body = [(40, 94), (46, 82), (62, 75), (92, 72), (120, 72), (140, 78), (156, 90), (176, 102), (188, 105), (188, 117),
            (174, 119), (157, 123), (145, 134), (127, 151), (106, 166), (90, 175), (75, 167), (60, 149), (48, 127), (42, 110)]
    P = p.body(body, n=6, shade=0.9)
    # silver plates down the flank
    for k in range(8):
        x = 62 + k * 10.5
        top = interp_y([(42, 92), (50, 80), (70, 73), (100, 71), (122, 74), (140, 80)], x) + 6
        bot = interp_y([(60, 149), (75, 167), (90, 175), (106, 166), (127, 151), (145, 134)], x) - 6
        p.line([(x, top), (x - 2, (top + bot) / 2), (x + 1, bot)], w=0.26, op=0.75)
    p.line([(80, 77), (78, 100), (84, 124)], w=0.34)                                   # gill cover
    p.line([(43, 90), (52, 92), (60, 88)], w=0.34, taper=False)                        # mouth, opening upward
    # the dorsal blade
    p.solid([(104, 72), (110, 62), (114, 72)])
    # the eye: a barrel turned to look up
    p.body([(56, 92), (55, 78), (60, 72), (70, 72), (75, 78), (74, 92)], n=4, shade=0.8)
    p.eye(65, 76.5, 4.4, w=0.55)
    # lights along the keel, and a few on the tail
    keel = spline([(56, 143), (68, 160), (86, 172), (104, 165), (122, 153), (140, 138)], False, 4)
    for q in keel[::2]:
        p.glow(q[0], q[1] - 2.4, 1.35)
    for k in range(5):
        p.glow(146 + k * 7.5, 124.5 - k * 0.6, 1.2)
    return p


def siphonophore():
    p = Plate('siphonophore', 'Giant siphonophore',
              'Praya dubia: one of the longest animals alive, a colony of thousands strung on one stem and fishing with all of them.')
    r = p.r
    # the stem: a long open spiral, the head (and its swimming bells) at the outer end
    stem = []
    for i in range(240):
        t = i / 239
        a = math.radians(200 + 500 * t)
        rad = 92 * (1 - 0.7 * t)
        stem.append((126 + rad * math.cos(a) * 1.04, 112 + rad * math.sin(a) * 0.62 + 34 * t))
    # every cormidium lets down a fishing line, so the colony hangs a curtain
    for i in range(12, 236, 6):
        x, y = stem[i]
        L = r.uniform(30, 70) * (1.15 - i / 300)
        ph = r.uniform(0, 6)
        line = [(x + 1.2 * math.sin(j * 0.8 + ph) + j * 0.4, y + 3 + L * j / 5) for j in range(6)]
        sp = p.thread(line, w=0.24, sil=0.5, n=4)
        for j in range(3, len(sp) - 1, 3):
            qx, qy = sp[j]
            side = 1 if (j // 3) % 2 else -1
            p.line([(qx, qy), (qx + side * 2.4, qy + 1.8), (qx + side * 3.0, qy + 3.8)], w=0.18, smooth=False, op=0.85)
    p.thread(stem, w=0.7, sil=1.0, n=1, taper='end')
    for i in range(12, 236, 6):
        x, y = stem[i]
        a, b = stem[i - 1], stem[i + 1]
        ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        s_ = 1.0 - i / 400
        p.body(petal((x, y), ang - 70, 8 * s_, 2.8 * s_, seed=i, wav=0.08, n=6), n=3, glass=True)
        p.limb([(x, y), (x + 0.8, y + 2.6), (x + 0.4, y + 5.6)], lambda t: 1.5 - 0.7 * t, hatch=False, contour=(0.28, 0.6))
        if i % 24 == 0:
            p.glow(x + 0.4, y + 6, 1.0)
    # two swimming bells at the head of the stem
    hx, hy = stem[0]
    for k, (dx, dy, sc) in enumerate(((-22, -8, 1.25), (-6, -20, 1.15))):
        bx, by = hx + dx, hy + dy
        bell = [(bx - 9 * sc, by + 8 * sc), (bx - 11 * sc, by - 2 * sc), (bx - 5 * sc, by - 11 * sc), (bx + 5 * sc, by - 11 * sc),
                (bx + 11 * sc, by - 2 * sc), (bx + 9 * sc, by + 8 * sc), (bx, by + 5 * sc)]
        p.body(bell, n=5, shade=0.5, contour=(0.3, 0.8))
        p.line([(bx - 6 * sc, by + 3 * sc), (bx - 5 * sc, by - 5 * sc), (bx + 1 * sc, by - 7 * sc)], w=0.24, op=0.8)
        p.glow(bx + 2 * sc, by + 1 * sc, 1.1)
    p.line([(hx - 16, hy - 2), (hx - 4, hy - 0.5), (hx, hy)], w=0.45)
    return p


# ======================================================================= The Stygian Dark

def black_seadevil():
    p = Plate('black-seadevil', 'Black seadevil',
              'Melanocetus johnsonii: a globe of a fish, all mouth, fishing in the dark with a light that grows on its own head.')
    r = p.r
    tail = [(186, 116), (214, 96), (224, 104), (222, 128), (226, 150), (214, 160), (186, 140)]
    p.body(tail, n=5, shade=0.9, dark=0.5)
    for k in range(7):
        t = (k + 0.5) / 7
        p.line([(190, 120 + 16 * t), (218 + 4 * math.sin(t * math.pi), 100 + 56 * t)], w=0.2, op=0.8, smooth=False)
    p.body([(160, 64), (172, 52), (184, 60), (178, 76)], n=4, shade=0.8, dark=0.4)      # dorsal fin
    p.body([(166, 172), (180, 184), (188, 172), (178, 160)], n=4, shade=0.8, dark=0.4)  # anal fin
    body = [(36, 96), (50, 76), (78, 60), (116, 52), (152, 58), (176, 76), (190, 106), (192, 132), (182, 158), (158, 182),
            (122, 196), (86, 192), (56, 178), (36, 160)]
    P = p.body(body, n=6, shade=1.0, dark=1.0)
    mouth = [(32, 94), (60, 104), (102, 128), (62, 150), (34, 164), (26, 128)]
    p.dots(scatter(r, 50, lambda x, y: inside(P, x, y) and not inside(mouth, x, y), (50, 56, 186, 190), 6), r=0.5, op=0.9)
    # the mouth, wide open, and the needles in it
    p.body(mouth, n=5, dark=1.0, shade=2.0, contour=(0.5, 1.1))
    for k in range(10):             # upper jaw, needles hanging down
        t = k / 9
        x, y = 36 + t * 58, 97 + t * 26
        L = r.uniform(12, 22) * (1 - 0.45 * t)
        p.solid([(x - 1.4, y - 1), (x + r.uniform(-1.5, 2.5), y + L), (x + 1.4, y - 1)])
    for k in range(9):              # lower jaw, pointing up
        t = k / 8
        x, y = 38 + t * 56, 161 - t * 28
        L = r.uniform(11, 20) * (1 - 0.45 * t)
        p.solid([(x - 1.4, y + 1), (x + r.uniform(-1.5, 2.5), y - L), (x + 1.4, y + 1)])
    fan(p, (128, 152), 40, 26, 74, rays=7, glass=True, seed=3)                           # pectoral fin
    p.eye(92, 88, 3.2)
    # the lure: a rod from the forehead, and the light at its end
    p.thread([(74, 62), (64, 40), (48, 26), (32, 26), (24, 36)], w=0.85, sil=1.1, taper=False)
    p.body(circle_pts(23, 41, 5.2, 18), dense=True, shade=0.6, contour=(0.35, 0.8))
    p.glow(22.5, 42, 3.0)
    for a in (200, 240, 280):
        x0, y0 = 23 + 5.6 * math.cos(math.radians(a)), 41 + 5.6 * math.sin(math.radians(a))
        p.thread([(x0, y0), (x0 + 4 * math.cos(math.radians(a)), y0 + 4 * math.sin(math.radians(a)))], w=0.4, sil=0.6, smooth=False)
    return p


def gulper_eel():
    p = Plate('gulper-eel', 'Gulper eel',
              'Eurypharynx pelecanoides: a mouth that unhinges like a net, a body like a whip, and a red light at the end of it.')
    tailsp = [(96, 72), (128, 78), (156, 98), (170, 128), (166, 160), (146, 182), (114, 190), (84, 184), (64, 196), (60, 214),
              (76, 228), (110, 230), (146, 224), (178, 214), (204, 212)]
    sp = spline(tailsp, False, 8)
    m = len(sp)
    p.limb(tailsp, lambda t: 5.6 * (1 - t) ** 1.3 + 0.35, n=8, shade=1.0, dark=0.8)
    for i in range(10, int(m * 0.6), 4):      # a low fin along the back, as fine rays
        a = along(sp, i, -5.2 * (1 - i / m) ** 1.3 - 0.4)
        b = along(sp, i, -5.2 * (1 - i / m) ** 1.3 - 3.2)
        p.line([a, b], w=0.18, smooth=False, op=0.8)
    p.glow(205.5, 212, 2.6)
    for k, a in enumerate((-50, 0, 50)):
        x0, y0 = 206 + 2.6 * math.cos(math.radians(a)), 212 + 2.6 * math.sin(math.radians(a))
        p.thread([(x0, y0), (x0 + 3.5 * math.cos(math.radians(a)), y0 + 3.5 * math.sin(math.radians(a)))], w=0.35, sil=0.5, smooth=False)
    # the pouch: the lower jaw, a sack of black skin
    pouch = [(30, 58), (34, 84), (44, 108), (64, 124), (88, 120), (100, 98), (98, 78), (80, 72), (54, 64)]
    P = p.body(pouch, n=6, dark=1.0, shade=1.2)
    for k in range(5):
        t = (k + 1) / 6
        p.line([(32 + 6 * t, 62 + 10 * t), (44 + 26 * t, 96 + 18 * t * (1 - t) * 2), (60 + 34 * t, 112 - 26 * t)], w=0.24, op=0.85)
    # the upper jaw, a thin bar from the snout to the hinge, with the tiny eye at its tip
    jaw = [(26, 55), (40, 52), (66, 58), (92, 66), (102, 72), (98, 77), (66, 64), (40, 59), (27, 59)]
    p.body(jaw, n=5, shade=0.8, contour=(0.4, 1.0))
    p.eye(33, 54, 1.7, w=0.45)
    return p


def colossal_squid():
    p = Plate('colossal-squid', 'Colossal squid',
              'Mesonychoteuthis hamiltoni: the heaviest invertebrate, with the largest eye of any animal, and hooks that turn in its arms.')
    r = p.r
    # arms first, sweeping down and away to the left; the frame cuts them
    for k in range(8):
        hd = 128 + k * 11 + r.uniform(-4, 4)
        L = r.uniform(150, 210)
        sp = curl_spine(150 + k * 3.5, 108 + k * 1.5, hd, L, curl=r.uniform(0.2, 0.7), wiggle=0.6, seed=20 + k, side=1 if k % 2 else -1)
        w0 = r.uniform(7.5, 9.5)
        p.limb(sp, lambda t, w0=w0: w0 * (1 - t) ** 1.1 + 0.7, n=4, shade=1.0, dark=0.6)
        dense = spline(sp, False, 4)
        md = len(dense)
        for i in range(4, md - 6, 4):        # suckers along the inner edge
            w = w0 * (1 - i / md) ** 1.1 + 0.7
            q = along(dense, i, -w * 0.55 * (1 if k % 2 else -1))
            p.eye(q[0], q[1], max(0.5, w * 0.22), w=0.25)
    for k, (hd, L) in enumerate(((150, 230), (176, 220))):   # the two long tentacles, with hooked clubs
        sp = curl_spine(160, 112, hd, L, curl=0.15, wiggle=0.4, seed=60 + k, side=-1 if k else 1)
        p.limb(sp, lambda t: 3.6 * (1 - t * 0.7) if t < 0.72 else (3.6 * 0.5 + 3.4 * math.sin(math.pi * (t - 0.72) / 0.28)) * (1.05 - t) * 3, n=4, shade=1.0, dark=0.5)
        dense = spline(sp, False, 4)
        md = len(dense)
        for i in range(int(md * 0.74), md - 3, 3):            # the swivelling hooks on the club
            q = along(dense, i, 2.4 * (1 if k else -1))
            a, b = dense[i - 1], dense[i + 1]
            ang = math.atan2(b[1] - a[1], b[0] - a[0])
            hk = [(q[0] + 1.8 * math.cos(ang + 1.57), q[1] + 1.8 * math.sin(ang + 1.57)),
                  (q[0] + 5.2 * math.cos(ang + 0.6), q[1] + 5.2 * math.sin(ang + 0.6)),
                  (q[0] + 2.6 * math.cos(ang + 0.2), q[1] + 2.6 * math.sin(ang + 0.2)),
                  (q[0] + 1.8 * math.cos(ang - 1.57), q[1] + 1.8 * math.sin(ang - 1.57))]
            p.solid(hk)
    # the head and the start of the mantle, cut by the frame
    mantle = [(150, 70), (162, 30), (184, -6), (244, -6), (244, 64), (222, 86), (196, 98)]
    p.body(mantle, n=6, shade=1.0, dark=0.7)
    head = [(136, 92), (142, 72), (160, 60), (184, 64), (200, 82), (198, 104), (180, 118), (154, 118)]
    p.body(head, n=6, shade=1.0, dark=0.5)
    p.eye(170, 86, 13.5, w=0.8)
    p.line(spline(circle_pts(170, 86, 17, 10), True, 4)[:30], w=0.3, op=0.8)
    p.line([(140, 104), (156, 112), (178, 116)], w=0.3, op=0.8)
    return p


def fangtooth():
    p = Plate('fangtooth', 'Fangtooth',
              'Anoplogaster cornuta: for its size, the longest teeth of any fish in the sea. Its lower fangs fold up into sockets beside its brain.')
    r = p.r
    tail = [(186, 110), (212, 92), (220, 98), (206, 120), (220, 142), (212, 148), (186, 130)]
    p.body(tail, n=5, shade=0.9, dark=0.4)
    for k in range(6):
        t = (k + 0.5) / 6
        p.line([(190, 113 + 14 * t), (214 - 6 * abs(t - 0.5) * 2, 96 + 48 * t)], w=0.2, op=0.8, smooth=False)
    p.body([(122, 62), (138, 54), (160, 66), (174, 90), (160, 92)], n=5, shade=0.8, dark=0.3)      # dorsal fin
    p.body([(152, 146), (168, 154), (180, 138), (168, 134)], n=4, shade=0.8, dark=0.3)             # anal fin
    body = [(26, 108), (34, 82), (56, 60), (92, 50), (128, 56), (160, 78), (188, 108), (188, 132), (160, 144), (126, 164),
            (90, 182), (52, 180), (30, 160)]
    P = p.body(body, n=6, shade=1.0, dark=0.8)
    for k in range(4):                         # the sculpted bones of the head
        t = k / 3
        p.line([(42 + 6 * t, 90 - 10 * t), (66 + 8 * t, 72 - 8 * t), (96 + 4 * t, 74 + 2 * t)], w=0.32, op=0.85)
    p.line([(102, 66), (98, 116), (108, 162)], w=0.38)                                              # gill cover
    p.line([(88, 70), (84, 108), (92, 150)], w=0.26, op=0.7)
    p.dots(scatter(r, 60, lambda x, y: inside(P, x, y) and x > 110, (110, 56, 188, 170), 5), r=0.55, op=0.9)
    mouth = [(24, 106), (56, 114), (100, 130), (62, 146), (30, 162), (20, 134)]
    p.body(mouth, n=5, dark=1.0, shade=2.0, contour=(0.5, 1.1))
    # the fangs: two great ones below, curved like tusks, and more above
    for (x, y, L, lean) in ((32, 160, 40, 0.16), (48, 156, 34, -0.04), (66, 150, 16, 0.12), (82, 142, 10, 0.1)):
        p.solid([(x - 2.8, y + 1.5), (x + L * lean - 0.4, y - L), (x + 2.8, y + 1)])
    for (x, y, L, lean) in ((30, 108, 22, -0.12), (44, 112, 28, 0.06), (60, 118, 16, 0.0), (76, 124, 11, 0.05), (88, 128, 7, 0.0)):
        p.solid([(x - 2.4, y - 1.5), (x + L * lean, y + L), (x + 2.4, y - 1)])
    fan(p, (120, 126), 26, 28, 68, rays=7, glass=True, seed=5)                                      # pectoral fin
    p.eye(70, 94, 4.0, w=0.55)
    return p


# ======================================================================= The Cyclopean Abyss

def dumbo_octopus():
    p = Plate('dumbo-octopus', 'Dumbo octopus',
              'Grimpoteuthis: the deepest-living octopus, which swims by flapping two fins like ears and drifts in its own skirt.')
    r = p.r
    p.body([(160, 64), (184, 44), (204, 46), (204, 64), (182, 84), (162, 84)], n=5, shade=0.8)   # the far fin, behind
    # the skirt: eight arms webbed nearly to their tips, the hem in soft scallops
    tips = []
    for k in range(8):
        t = k / 7
        tips.append((50 + 140 * t, 188 + 12 * math.sin(math.pi * t) + r.uniform(-3, 3)))
    hem = []
    for k, (x, y) in enumerate(tips):
        hem.append((x, y))
        if k < 7:
            nx_, ny_ = tips[k + 1]
            hem.append((x + (nx_ - x) * 0.3, y + (ny_ - y) * 0.3 - 6))
            hem.append((x + (nx_ - x) * 0.5, y + (ny_ - y) * 0.5 - 8))
            hem.append((x + (nx_ - x) * 0.7, y + (ny_ - y) * 0.7 - 6))
    skirt = [(84, 112), (66, 136), (52, 164)] + hem + [(190, 164), (176, 136), (160, 112)]
    p.body(skirt, n=4, shade=1.0)
    for k, (x, y) in enumerate(tips):          # arms as ribs in the web, each with its double row of cirri
        base = (92 + 56 * k / 7, 118)
        mid = ((base[0] + x) / 2 + (x - 120) * 0.12, (base[1] + y) / 2 + 2)
        sp = p.line([base, mid, (x, y)], w=0.48)
        for j in range(4, len(sp) - 1, 2):
            p.line([along(sp, j, 1.4), along(sp, j, 3.8)], w=0.2, smooth=False, op=0.9)
            p.line([along(sp, j, -1.4), along(sp, j, -3.8)], w=0.2, smooth=False, op=0.9)
        curl = [(x, y), (x + (x - 120) * 0.05, y + 6), (x + (x - 120) * 0.1 + 3, y + 9)]
        p.thread(curl, w=0.9, sil=1.1)
    mantle = [(80, 118), (74, 92), (82, 62), (102, 42), (128, 36), (150, 44), (164, 66), (166, 94), (160, 118), (120, 126)]
    p.body(mantle, n=6, shade=1.0)
    p.body([(84, 70), (60, 48), (40, 50), (38, 68), (58, 88), (80, 90)], n=5, shade=0.7)          # the near fin
    for k in range(4):
        t = (k + 1) / 5
        p.line([(80, 74 + 10 * t), (60 - 8 * math.sin(t * 3), 58 + 18 * t)], w=0.2, op=0.7)
    p.eye(96, 100, 6.2, w=0.6, ry=5.4, rot=-20)
    p.line([(88, 93), (97, 91), (105, 95)], w=0.28)       # the lid
    p.dots(scatter(r, 40, lambda x, y: inside(mantle, x, y), (80, 36, 166, 126), 6), r=0.4, op=0.7)
    return p


def tripod_fish():
    p = Plate('tripod-fish', 'Tripod fish',
              'Bathypterois grallator: it stands on the ooze on three long fin rays, faces into the current, and waits.')
    seabed(p, 206, seed=4)
    # the stilts: two from the pelvic fins, one from the tail
    p.thread([(98, 138), (94, 172), (88, 206)], w=0.85, sil=1.1, taper=False)
    p.thread([(104, 138), (106, 172), (110, 206)], w=0.85, sil=1.1, taper=False)
    p.thread([(176, 131), (192, 150), (202, 178), (208, 206)], w=0.85, sil=1.1, taper=False)
    for x in (88, 110, 208):
        p.line([(x - 4, 206.5), (x + 4, 206.5)], w=0.3, smooth=False, op=0.7)
    p.body([(176, 125), (196, 108), (202, 112), (190, 130)], n=4, shade=0.7)                 # upper tail lobe
    p.body([(94, 116), (104, 98), (112, 98), (122, 116)], n=4, shade=0.6)                    # dorsal fin
    body = [(42, 127), (50, 119), (72, 114), (110, 113), (146, 117), (176, 124), (179, 131), (150, 136), (112, 140),
            (74, 140), (54, 136)]
    p.body(body, n=6, shade=1.0)
    p.line([(64, 116), (62, 127), (65, 138)], w=0.3)
    p.line([(70, 124), (120, 126), (172, 128)], w=0.2, op=0.8)
    p.eye(52, 123, 1.9, w=0.45)
    p.line([(42, 127), (48, 129), (54, 129)], w=0.26, taper=False)
    # the pectoral fins: long rays held forward above the head, feeling the water
    for k in range(6):
        a = math.radians(-118 - k * 9)
        L = 64 + 8 * math.sin(k)
        p.thread([(66, 121), (66 + 0.35 * L * math.cos(a) - 6, 121 + 0.35 * L * math.sin(a)),
                  (66 + 0.75 * L * math.cos(a - 0.12) - 4, 121 + 0.75 * L * math.sin(a - 0.12)), (66 + L * math.cos(a - 0.3), 121 + L * math.sin(a - 0.3))],
                 w=0.42, sil=0.7, n=5)
    p.body(petal((98, 138), 96, 10, 3.5, seed=2, wav=0.05, n=6), n=3, shade=0.5)
    return p


def foot_w(w0):
    """Half widths for a tube foot: fat at the body, narrowing, and rounded at the end."""
    def w(t):
        base = w0 * (1 - 0.38 * t)
        return base * math.sqrt(max(0.0, 1 - ((t - 0.78) / 0.22) ** 2)) + 0.3 if t > 0.78 else base
    return w


def sea_pig():
    p = Plate('sea-pig', 'Sea pig',
              'Scotoplanes: a sea cucumber that walks the abyssal plain in herds, on fat legs that are really tube feet.')
    r = p.r
    seabed(p, 198, seed=7)
    for k in range(5):                         # far legs and papillae first, lighter
        x = 78 + k * 27
        p.limb([(x + 5, 172), (x + 6, 184), (x + 4, 195)], foot_w(4.6), shade=0.6, contour=(0.3, 0.8))
    p.limb([(104, 116), (106, 98), (100, 82), (92, 74)], lambda t: 3.0 * (1 - t) + 0.8, shade=0.6)
    body = [(36, 158), (42, 136), (60, 120), (92, 110), (132, 108), (168, 114), (194, 128), (208, 150), (202, 170), (180, 180),
            (134, 184), (88, 184), (54, 178)]
    P = p.body(body, n=6, shade=1.0)
    p.dots(scatter(r, 120, lambda x, y: inside(P, x, y) and y > 118, (36, 108, 208, 184), 3.2), r=0.42, op=0.75)
    p.line([(58, 150), (110, 160), (170, 158), (198, 150)], w=0.24, op=0.6)      # the gut, through the skin
    for k in range(5):                         # near legs: tube feet, splayed
        x = 64 + k * 28
        lean = (k - 2) * 2.2
        p.limb([(x, 172), (x - 2 + lean * 0.5, 185), (x - 4 + lean, 198)], foot_w(5.6), shade=0.9, contour=(0.36, 1.0))
    p.limb([(74, 120), (70, 100), (60, 82), (50, 72)], lambda t: 4.0 * (1 - t) + 1.0, shade=0.9)   # papillae, held up
    p.limb([(88, 114), (88, 94), (82, 76), (74, 66)], lambda t: 3.6 * (1 - t) + 0.9, shade=0.9)
    for k in range(5):                         # the mouth tentacles, feeling the ooze
        a = math.radians(100 + k * 18)
        x0, y0 = 42 + 4 * math.cos(a), 168
        p.limb([(x0, y0), (x0 + 6 * math.cos(a), y0 + 10), (x0 + 9 * math.cos(a), y0 + 20)], lambda t: 2.0 + 1.0 * math.sin(math.pi * t), hatch=False, contour=(0.3, 0.8))
    snow(p, 9, 21, (10, 10, 230, 100))
    return p


def xenophyophore():
    p = Plate('xenophyophore', 'Xenophyophore',
              'Syringammina fragilissima: a single cell the size of a fist, which builds itself a house out of the sea floor.')
    r = p.r
    seabed(p, 204, seed=9)
    # one fragile mound, its surface a maze of tubes
    out = []
    for i in range(121):
        a = math.pi + math.pi * i / 120
        rad = 1 + 0.045 * abs(math.sin(a * 7.5)) + 0.03 * abs(math.sin(a * 17 + 1)) + 0.05 * math.sin(a * 2.2)
        out.append((120 + 86 * rad * math.cos(a), 204 + 104 * rad * math.sin(a)))
    out += [(196, 207), (44, 207)]
    P = p.body(out, dense=True, shade=1.1, spacing=2.8)
    # the maze: meandering walls of cemented grains
    for k in range(34):
        x, y = scatter(r, 1, lambda x, y: inside(P, x, y) and y < 196, (40, 90, 200, 200))[0]
        pts = [(x, y)]
        ang = r.uniform(0, math.tau)
        for j in range(r.randint(4, 8)):
            ang += r.uniform(-1.3, 1.3)
            x, y = x + 6 * math.cos(ang), y + 6 * math.sin(ang)
            if not inside(P, x, y):
                break
            pts.append((x, y))
        if len(pts) > 2:
            p.line(pts, w=0.34, op=0.9)
    for k in range(24):                        # the mouths of its tubes
        x, y = scatter(r, 1, lambda x, y: inside(P, x, y) and y < 192, (40, 90, 200, 200))[0]
        p.eye(x, y, r.uniform(1.6, 3.2), w=0.45, ry=r.uniform(1.0, 2.2), rot=r.uniform(-30, 30))
    p.dots(scatter(r, 260, lambda x, y: inside(P, x, y), (34, 88, 206, 206), 2.0), r=0.42, op=0.85)
    snow(p, 8, 33, (8, 10, 232, 80))
    return p


# ======================================================================= The Dreaming Deep

def snailfish():
    p = Plate('snailfish', 'Mariana snailfish',
              'Pseudoliparis swirei: the deepest fish ever caught, soft as jelly, at home under eight hundred atmospheres.')
    fold_top = [(84, 101), (120, 90), (160, 94), (196, 110), (222, 124)]
    fold_bot = [(90, 150), (120, 159), (160, 155), (196, 138), (222, 124)]
    p.body(fold_top + fold_bot[::-1][1:], n=6, glass=True)
    btop = [(50, 96), (74, 94), (104, 100), (140, 106), (176, 114), (214, 123)]
    bbot = [(46, 146), (72, 150), (104, 146), (140, 140), (176, 132), (214, 124)]
    for k in range(28):                       # the rays of the long fins
        x = 92 + 120 * k / 27
        p.line([(x, interp_y(btop, x) - 0.5), (x + 3, interp_y(fold_top, x + 3) + 1.2)], w=0.17, smooth=False, op=0.8)
        p.line([(x, interp_y(bbot, x) + 0.5), (x + 3, interp_y(fold_bot, x + 3) - 1.2)], w=0.17, smooth=False, op=0.8)
    body = [(28, 126), (34, 108), (50, 96), (74, 94), (104, 100), (140, 106), (176, 114), (214, 123), (176, 132), (140, 140),
            (104, 146), (72, 150), (46, 146), (32, 138)]
    p.body(body, n=6, shade=0.6)
    sp = p.line([(64, 118), (120, 121), (170, 122), (210, 123)], w=0.3, op=0.6, taper=False)   # the backbone, seen through it
    for i in range(2, len(sp) - 1, 2):
        p.line([along(sp, i, 2.2), along(sp, i, -2.2)], w=0.16, smooth=False, op=0.55)
    p.line(circle_pts(76, 132, 0, 12, rx=11, ry=7, rot=-8), w=0.22, op=0.55, close=True)        # the liver
    fan(p, (68, 138), 72, 36, 96, rays=9, glass=True)
    p.eye(46, 110, 3.0, w=0.5)
    p.line([(28, 128), (34, 130.5), (41, 129.5)], w=0.3, taper=False)
    return p


def amphipod():
    p = Plate('amphipod', 'Supergiant amphipod',
              'Alicella gigantea: a beach hopper the length of a hand, scavenging at the bottom of the trenches.')
    C = (126, 168)
    Ro, Ri = 86, 56
    D = lambda th, rr=Ro: (C[0] + rr * math.cos(math.radians(th)), C[1] + rr * math.sin(math.radians(th)))  # noqa: E731
    segs = [(200 + 13 * k, 213.8 + 13 * k) for k in range(7)] + [(291 + 10 * k, 301.8 + 10 * k) for k in range(3)] + [(321, 334)]
    # legs first, behind the plates: two pairs of grasping legs in front, five walking pairs behind
    for k, (a, b) in enumerate(segs[:7]):
        th = (a + b) / 2
        hip = D(th, Ri - 14 if k < 4 else Ri - 8)
        if k < 2:
            knee = (hip[0] - 10, hip[1] + 14)
            foot = (knee[0] - 12, knee[1] + 4)
            claw = (foot[0] - 2, foot[1] - 5)
            p.thread([hip, knee, foot, claw], w=0.9, sil=1.2, smooth=False, taper=False)
        else:
            lean = (k - 3.5) * 6
            knee = (hip[0] + lean * 0.4, hip[1] + 18)
            ankle = (knee[0] + lean + (6 if k > 3 else -6), knee[1] + 16)
            foot = (ankle[0] + (4 if k > 3 else -4), ankle[1] + 10)
            p.thread([hip, knee, ankle, foot], w=0.8, sil=1.1, smooth=False, taper=False)
    for k, (a, b) in enumerate(segs[7:10]):  # swimming legs under the tail: feathered
        th = (a + b) / 2
        hip = D(th, Ri - 2)
        tip = (hip[0] + 12 * math.cos(math.radians(th + 60)), hip[1] + 14 * math.sin(math.radians(th + 60)) + 6)
        p.thread([hip, tip], w=0.6, sil=0.8, smooth=False)
        for t in (0.35, 0.55, 0.75):
            q = (hip[0] + (tip[0] - hip[0]) * t, hip[1] + (tip[1] - hip[1]) * t)
            p.line([q, (q[0] + 3, q[1] + 1.5)], w=0.16, smooth=False)
    a, b = segs[-1]                          # the tail fans
    for k in range(3):
        base = D(b - 2, Ri + 10 + k * 8)
        ang = math.radians(b + 70 - k * 14)
        p.thread([base, (base[0] + 16 * math.cos(ang), base[1] + 16 * math.sin(ang))], w=0.7, sil=1.0, smooth=False)
    # the plates, tail first so each overlaps the next
    for k in range(len(segs) - 1, -1, -1):
        a, b = segs[k]
        ro = Ro - (0 if k < 7 else 4 * (k - 6))
        ri = Ri + (0 if k < 7 else 3 * (k - 6))
        plate = [D(a, ri), D(a, ro), D((a + b) / 2, ro + 2), D(b + 1.2, ro), D(b + 1.2, ri)]
        p.body(plate, n=3, shade=1.0)
        p.line([D(a + 2, ro - 4), D((a + b) / 2, ro - 3), D(b - 1, ro - 4)], w=0.22, op=0.7)
        if k < 7:                             # the side plate below each segment
            depth = 16 if k < 4 else 9
            cox = [D(a + 1, ri + 2), D(b, ri + 2), D(b - 1, ri - depth * 0.6), D((a + b) / 2, ri - depth), D(a + 1.5, ri - depth * 0.7)]
            p.body(cox, n=3, shade=0.8)
    # the head, its kidney eye, and two pairs of antennae
    hx, hy = D(193, 72)
    head = [(hx + 10, hy - 14), (hx - 6, hy - 14), (hx - 16, hy - 4), (hx - 15, hy + 8), (hx - 4, hy + 14), (hx + 10, hy + 12)]
    p.body(head, n=4, shade=0.9)
    p.eye(hx - 6, hy - 3, 2.6, w=0.45, ry=4.6, rot=18)
    for (L, a0, bend) in ((52, 218, -12), (80, 196, 10)):
        base = (hx - 14, hy + (-4 if a0 > 200 else 4))
        pts = [base]
        for i in range(1, 5):
            t = i / 4
            ang = math.radians(a0 + bend * t)
            pts.append((base[0] + L * t * math.cos(ang), base[1] + L * t * math.sin(ang)))
        sp = p.thread(pts, w=0.65, sil=0.9)
        for j in range(3, len(sp) - 2, 3):
            p.line([along(sp, j, 1.2), along(sp, j, -1.2)], w=0.16, smooth=False, op=0.8)
    return p


def sea_cucumber():
    p = Plate('sea-cucumber', 'Swimming sea cucumber',
              'Enypniastes eximia: the "headless chicken monster", a sea cucumber that swims with a veil and keeps its gut behind glass.')
    r = p.r
    # the veil: a webbed hood at the front, flared like a cape, behind the body
    edge = []
    for i in range(15):
        t = i / 14
        a = math.radians(196 + 150 * t)
        rr = 98 * (1 + 0.06 * math.sin(i * 1.9)) - (5 if i % 2 else 0)
        edge.append((124 + rr * math.cos(a) * 0.98, 112 + rr * math.sin(a) * 0.72))
    veil = edge + [(168, 104), (144, 96), (104, 96), (80, 104)]
    p.body(veil, n=4, shade=0.9, dark=0.2)
    for i in range(1, 14, 2):                # ribs of the veil
        x, y = edge[i]
        p.line([(124 + (x - 124) * 0.32, 100 + (y - 100) * 0.25), ((x + 124) / 2, (y + 100) / 2 - 3), (x, y)], w=0.3, op=0.85)
    # the body: a clear sac, and the gut inside it
    body = [(86, 98), (112, 90), (146, 94), (164, 116), (168, 152), (158, 184), (138, 202), (112, 204), (94, 188), (84, 154), (80, 122)]
    P = p.body(body, n=6, shade=0.6)
    gut = [(112, 104), (136, 110), (146, 128), (122, 140), (102, 152), (110, 172), (136, 178), (142, 194)]
    p.line(gut, w=1.4)
    p.dots(scatter(r, 50, lambda x, y: inside(P, x, y), (80, 90, 168, 204), 4), r=0.4, op=0.7)
    # tentacles round the mouth, under the front of the veil
    for k in range(9):
        a = math.radians(140 + k * 9)
        x0, y0 = 88 + 6 * math.cos(a), 108 + 4 * math.sin(a)
        tip = (x0 + 13 * math.cos(a), y0 + 13 * math.sin(a) + 5)
        p.limb([(x0, y0), ((x0 + tip[0]) / 2, (y0 + tip[1]) / 2 + 1), tip], lambda t: 1.0 + 1.6 * math.sin(math.pi * min(1, t * 1.15)), hatch=False, contour=(0.28, 0.7))
    # the brim at the back end
    p.body([(102, 198), (92, 214), (112, 224), (142, 218), (152, 200)], n=5, shade=0.8)
    for x in (108, 122, 136):
        p.line([(x, 202), (x - 2, 212), (x - 1, 220)], w=0.22, op=0.8)
    for (x, y) in ((44, 96), (70, 54), (176, 56), (206, 92), (150, 34)):
        p.glow(x, y, 1.3)
    return p


def deep_one():
    p = Plate('deep-one', 'A Deep One',
              'An amphibious thing of the trench floor, gilled and webbed. Fishermen tell older stories about it than scientists do.')
    r = p.r
    seabed(p, 208, seed=11)
    # the far limbs, behind
    p.limb([(170, 156), (196, 176), (182, 198), (166, 206)], [7, 6, 4.5, 3.5], shade=0.6)
    p.limb([(94, 158), (88, 184), (80, 205)], [6, 5, 3.6], shade=0.6)
    # the crest along the back: spines and a web between them
    crest = [(96, 104), (102, 74), (116, 88), (124, 60), (138, 86), (150, 66), (160, 92), (172, 80), (180, 108)]
    p.body(crest + [(170, 112), (130, 102), (100, 108)], n=3, shade=0.7)
    for (x0, y0) in crest[1::2]:
        p.line([(x0, y0), (x0 - 2, (y0 + 104) / 2), (x0 - 3, 104)], w=0.28, op=0.9)
    trunk = [(70, 122), (98, 100), (140, 94), (174, 104), (192, 130), (190, 160), (168, 178), (124, 180), (92, 172), (72, 150)]
    P = p.body(trunk, n=6, shade=1.0, dark=0.4)
    for row in range(5):                     # scales
        for k in range(9):
            x = 104 + k * 9 + (row % 2) * 4.5
            y = 108 + row * 11
            if inside(P, x + 3, y + 4) and inside(P, x - 3, y + 8):
                p.line([(x - 4, y), (x, y + 4), (x + 4, y)], w=0.22, op=0.8)
    p.dots(scatter(r, 30, lambda x, y: inside(P, x, y) and y > 150, (72, 150, 190, 180), 5), r=0.6, op=0.9)
    # the near hind leg, folded like a frog's: thigh forward, shin back, a long webbed foot
    p.limb([(178, 142), (152, 172), (176, 190), (190, 200)], [12, 9, 6.5, 4.6], shade=1.0, dark=0.3)
    foot = [(192, 196), (176, 202), (150, 203), (128, 205), (122, 210), (146, 212), (172, 211), (194, 206)]
    p.body(foot, n=4, shade=0.8)
    for k, (x, y) in enumerate(((122, 209), (132, 211), (144, 212))):
        p.solid([(x + 1, y - 1.2), (x - 5, y + 0.6), (x + 1, y + 1.3)])
        p.line([(x + 2, y), (x + 18 + k * 6, y - 4)], w=0.2, op=0.8, smooth=False)
    # the head: broad and flat, a wide mouth of needles, gill slits and frills
    head = [(22, 140), (28, 118), (48, 104), (78, 104), (96, 120), (94, 150), (72, 164), (40, 160)]
    p.body(head, n=6, shade=1.0, dark=0.35)
    p.line([(22, 143), (42, 149), (72, 149), (90, 141)], w=0.5)
    for k in range(9):
        x = 28 + k * 6.4
        y = 145 + 4.4 * math.sin(k / 8 * math.pi)
        p.solid([(x - 1.0, y - 0.6), (x + 0.2, y + 4.2), (x + 1.0, y - 0.6)])
    p.eye(56, 118, 4.0, w=0.55)
    p.limb([(40, 113), (52, 108), (66, 110)], [1.2, 2.2, 1.0], hatch=False, contour=(0.4, 0.9))      # the brow
    for k in range(3):                       # gill slits and the frills behind them
        x = 86 + k * 6
        p.line([(x, 122 + k), (x - 2, 136 + k), (x, 152 + k)], w=0.38)
        for j in range(5):
            y = 124 + j * 6.5 + k
            p.thread([(x + 2, y), (x + 8, y - 2), (x + 11, y + 1.5)], w=0.5, sil=0.75)
    # the near arm, planted, with long webbed fingers and claws
    p.limb([(84, 150), (70, 178), (58, 200)], [8, 6.4, 4.6], shade=1.0, dark=0.3)
    hand = [(66, 197), (52, 196), (36, 199), (26, 206), (42, 209), (58, 209), (68, 205)]
    p.body(hand, n=4, shade=0.8)
    for (x, y) in ((26, 206), (36, 208.5), (48, 209.5)):
        p.solid([(x + 1, y - 1.3), (x - 5.5, y + 0.6), (x + 1, y + 1.3)])
    return p


# ======================================================================= The Drowned City

def dagon():
    from draw_glyphs import SCRIPT, script_glyph
    p = Plate('dagon', 'Father Dagon',
              'It came up out of the deep and threw its arms about the stone. The stone is carved in the Drowned Script: the Sleeper sees; the tide returns.',
              mythic=True)
    # the monolith, leaning, its foot lost below the frame
    mono = [(92, 250), (98, 44), (104, 38), (150, 34), (156, 40), (160, 250)]
    M = p.body(mono, n=1, shade=0.8, contour=(0.5, 1.4))
    for y in (124, 196):
        p.line([(95, y + 3), (159, y - 2)], w=0.3, op=0.8, smooth=False)
    glyphs = ''
    for k, key in enumerate(('sleeper', 'eye', 'tide', 'gate')):
        gx, gy = 116 - k * 0.6, 48 + k * 46
        glyphs += f'<g transform="translate({gx} {gy}) scale(0.95) rotate(1.2)">{script_glyph(SCRIPT[key], with_line=True)}</g>'
    p.raw(f'<g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.92">{glyphs}</g>')
    # two vast arms out of the dark, each hand closing round an edge of the stone, fingers across its face
    hands = (
        # forearm outline, palm centre, finger bases and tips (left hand: fingers reach right across the face)
        dict(arm=[(-12, 100), (20, 76), (60, 70), (86, 78), (96, 98), (90, 120), (60, 124), (24, 128), (-12, 140)],
             fingers=[((96, 84), (116, 80), (128, 86)), ((98, 96), (120, 95), (134, 102)), ((97, 108), (118, 110), (130, 117)), ((92, 118), (106, 124), (114, 132))],
             scales=(lambda k, row: (4 + k * 9 + (row % 2) * 4.5, 86 + row * 8))),
        dict(arm=[(252, 150), (222, 136), (190, 136), (164, 146), (156, 166), (164, 186), (192, 186), (222, 180), (252, 190)],
             fingers=[((156, 152), (138, 150), (126, 156)), ((154, 164), (132, 165), (118, 172)), ((156, 176), (136, 180), (124, 188)), ((162, 186), (150, 194), (142, 202))],
             scales=(lambda k, row: (236 - k * 9 - (row % 2) * 4.5, 146 + row * 8))),
    )
    for h in hands:
        A = p.body(h['arm'], n=5, shade=1.0, dark=0.5)
        for row in range(5):                  # scales along the forearm
            for k in range(10):
                x, y = h['scales'](k, row)
                if inside(A, x, y + 3) and inside(A, x, y + 7) and inside(A, x + 6, y + 3) and inside(A, x - 6, y + 3):
                    p.line([(x - 3.5, y), (x, y + 3.5), (x + 3.5, y)], w=0.24, op=0.85)
        f = h['fingers']
        web = [f[0][0]] + [q[1] for q in f] + [f[-1][0]]
        p.body(web, n=3, shade=0.7)                                           # the web between the fingers
        for (base, mid, tip) in f:
            p.limb([base, mid, tip], [4.4, 3.6, 2.0], shade=1.0, dark=0.4)
            ta = math.atan2(tip[1] - mid[1], tip[0] - mid[0])
            p.solid([(tip[0] - 1.8 * math.sin(ta), tip[1] + 1.8 * math.cos(ta)), (tip[0] + 7.5 * math.cos(ta + 0.45), tip[1] + 7.5 * math.sin(ta + 0.45)),
                     (tip[0] + 1.8 * math.sin(ta), tip[1] - 1.8 * math.cos(ta))])
    # the bathysphere, down by the foot of the stone, for scale
    p.line([(208, -2), (208, 205)], w=0.3, taper=False, smooth=False)
    p.body(circle_pts(208, 210, 4.6, 16), dense=True, shade=0.6, contour=(0.3, 0.7))
    p.glow(209.2, 211, 1.2)
    snow(p, 12, 44, (6, 6, 234, 236), lambda x, y: not inside(M, x, y) and not (y > 60 and y < 200))
    return p


def hydra():
    p = Plate('hydra', 'Mother Hydra',
              'A polyp the height of a tower, crowned with seven arms. Like the small hydras of ponds it does not grow old, and it buds daughters.',
              mythic=True)
    r = p.r
    # the drowned city at its foot: slabs that lean against each other at angles that do not agree
    for (pts, sh) in (([(2, 250), (14, 170), (52, 162), (58, 250)], 0.9), ([(176, 250), (190, 178), (236, 190), (230, 250)], 1.0),
                      ([(40, 250), (60, 196), (92, 204), (84, 250)], 1.1)):
        p.body(pts, n=1, shade=sh, dark=0.5)
        p.line([pts[0], pts[1]], w=0.3, smooth=False, op=0.6)
    # seven arms spread from the crown and falling away, beaded with stinging cells
    crown = (120, 74)
    for k in range(7):
        ang = -176 + k * (172 / 6) + r.uniform(-5, 5)
        L = r.uniform(96, 124)
        x0 = crown[0] + 12 * math.cos(math.radians(ang))
        y0 = crown[1] + 6 * math.sin(math.radians(ang)) - 2
        side = 1 if math.cos(math.radians(ang)) > 0 else -1
        sp = curl_spine(x0, y0, ang, L, curl=r.uniform(0.3, 0.7), wiggle=0.7, seed=80 + k, side=side, n=26)
        p.limb(sp, lambda t: 3.6 * (1 - t) ** 0.9 + 0.6, n=4, shade=1.0, dark=0.3)
        dense = spline(sp, False, 4)
        p.dots([dense[i] for i in range(6, len(dense) - 3, 5)], r=1.1)
        if k in (1, 3, 5):
            p.glow(*dense[-1], r=1.3)
    # the column, ringed, rising from below the frame
    col = [(104, 250), (106, 196), (110, 140), (108, 100), (110, 84), (120, 78), (130, 84), (132, 100), (134, 140), (138, 196), (142, 250)]
    C_ = p.body(col, n=5, shade=1.0, dark=0.3)
    for y in range(96, 240, 9):
        p.line([(108 - (y - 92) * 0.02, y), (120, y + 2.4), (134 + (y - 92) * 0.03, y)], w=0.26, op=0.8)
    p.body([(106, 82), (110, 66), (120, 60), (130, 66), (134, 82)], n=4, shade=0.8)            # the mouth cone, crowned
    # two daughters budding from the column, each with its own small crown
    for (bx, by, side, sc) in ((108, 170, -1, 1.0), (134, 132, 1, 0.82)):
        tip = (bx + side * 22 * sc, by - 26 * sc)
        p.limb([(bx, by), (bx + side * 12 * sc, by - 10 * sc), tip], [5 * sc, 4.2 * sc, 3.6 * sc], shade=1.0, dark=0.3)
        p.body([(tip[0] - 4 * sc, tip[1] + 2), (tip[0] - 3 * sc, tip[1] - 4 * sc), (tip[0], tip[1] - 6 * sc), (tip[0] + 3 * sc, tip[1] - 4 * sc), (tip[0] + 4 * sc, tip[1] + 2)], n=3, shade=0.8)
        for j in range(5):
            a = -160 + j * 35
            sp = curl_spine(tip[0] + 4 * sc * math.cos(math.radians(a)), tip[1] - 3 * sc, a, 26 * sc, curl=0.6, wiggle=0.4,
                            seed=100 + j + int(bx), side=1 if math.cos(math.radians(a)) > 0 else -1, n=12)
            p.limb(sp, lambda t, sc=sc: 1.4 * sc * (1 - t) + 0.4, n=3, hatch=False, contour=(0.3, 0.7))
    snow(p, 12, 55, (4, 4, 236, 236), lambda x, y: not inside(C_, x, y))
    return p


def shoggoth():
    p = Plate('shoggoth', 'A shoggoth',
              'A mass of bubbling, self-lit flesh that takes whatever shape it needs, pouring out of a gate in the city.',
              mythic=True)
    r = p.r
    # the gate: two uprights and a lintel, leaning at angles that do not agree
    p.body([(38, 252), (50, 50), (78, 48), (74, 252)], n=1, shade=1.0, dark=0.6)
    p.body([(166, 252), (164, 44), (192, 46), (204, 252)], n=1, shade=1.0, dark=0.6)
    p.body([(26, 58), (30, 30), (214, 18), (218, 46)], n=1, shade=1.0, dark=0.5)
    for (a, b) in (((52, 120), (76, 128)), ((48, 190), (75, 182)), ((165, 110), (193, 120)), ((166, 176), (199, 168)), ((96, 26), (104, 52))):
        p.line([a, b], w=0.32, smooth=False, op=0.8)
    # the mass: bubbles, back to front, filling the gate and spilling out of it
    bubbles = []
    tries = 0
    while len(bubbles) < 78 and tries < 6000:
        tries += 1
        y = r.uniform(56, 250)
        t = (y - 56) / 194
        half = 46 + 80 * t ** 1.6
        x = 120 + r.uniform(-half, half)
        rad = r.uniform(5, 11) + 15 * t * r.random()
        if any(math.hypot(x - bx, y - by) < (rad + br) * 0.72 for bx, by, br in bubbles):
            continue
        bubbles.append((x, y, rad))
    bubbles.sort(key=lambda b: b[1] + b[2] * 0.5)
    for i, (x, y, rad) in enumerate(bubbles):
        pts = circle_pts(x, y, rad, 22, rx=rad * r.uniform(0.95, 1.1), ry=rad * r.uniform(0.85, 1.0))
        p.body(pts, dense=True, shade=1.0, spacing=2.6 if rad < 10 else 3.0, contour=(0.4, 1.2))
        roll = r.random()
        if roll < 0.16:                        # a pustule forming: rings, never a pupil
            p.eye(x - rad * 0.15, y - rad * 0.1, rad * 0.42, w=0.4)
            p.eye(x - rad * 0.15, y - rad * 0.1, rad * 0.2, w=0.35)
        elif roll < 0.26:                      # a faint light inside the flesh
            p.glow(x + rad * 0.3, y + rad * 0.25, max(0.9, rad * 0.1))
        elif roll < 0.4:
            p.line([(x - rad * 0.55, y - rad * 0.35), (x - rad * 0.2, y - rad * 0.62), (x + rad * 0.2, y - rad * 0.6)], w=0.28, op=0.9)
    return p


def dreamer():
    p = Plate('dreamer', 'The Dreamer',
              'Only the eye. The rest of it is the Drowned City, and the city is asleep.',
              mythic=True)
    r = p.r
    cx, cy, lw, lh_up, lh_lo = 120, 126, 106, 60, 46
    up = [(cx - lw + 2 * lw * i / 40, cy - lh_up * math.sin(math.pi * i / 40) ** 0.9 * (1 + 0.12 * (i / 40 - 0.5))) for i in range(41)]
    lo = [(cx + lw - 2 * lw * i / 40, cy + lh_lo * math.sin(math.pi * i / 40) ** 1.1) for i in range(1, 40)]
    almond = up + lo
    # the flesh round it, filling the plate, and the heavy folds of the lids
    p.body([(-4, -4), (244, -4), (244, 244), (-4, 244)], holes=[almond], dense=True, shade=1.0, dark=0.9, contour=(0.3, 0.5), sil=False)
    for k, (off, frac, w) in enumerate(((9, 0.95, 3.8), (21, 0.84, 3.0), (34, 0.66, 2.2))):
        pts = [(cx - lw * frac + 2 * lw * frac * i / 24, cy - lh_up * math.sin(math.pi * i / 24) ** 0.9 * (1 + 0.12 * (i / 24 - 0.5)) - off * (0.35 + 0.65 * math.sin(math.pi * i / 24)))
               for i in range(25)]
        p.limb(pts, lambda t, w=w: w * math.sin(math.pi * t) ** 0.6 + 0.5, n=3, shade=0.8, contour=(0.4, 1.0))
    for (off, frac, w) in ((10, 0.8, 3.0), (22, 0.6, 2.0)):
        pts = [(cx - lw * frac + 2 * lw * frac * i / 24, cy + lh_lo * math.sin(math.pi * i / 24) ** 1.1 + off * (0.4 + 0.6 * math.sin(math.pi * i / 24))) for i in range(25)]
        p.limb(pts, lambda t, w=w: w * math.sin(math.pi * t) ** 0.6 + 0.5, n=3, shade=0.8, contour=(0.4, 1.0))
    # the eye itself: the white, then the iris of fine gold lines, the limbus and the collar
    p.body(almond, dense=True, hatch=False, contour=(0.6, 1.6))
    R = 52
    p.eye(cx, cy, R, w=1.5)
    for k in range(96):
        a = math.tau * k / 96 + r.uniform(-0.012, 0.012)
        r1, r2 = R * r.uniform(0.47, 0.52), R * r.uniform(0.84, 0.95)
        p.line([(cx + r1 * math.cos(a), cy + r1 * math.sin(a)), (cx + r2 * math.cos(a), cy + r2 * math.sin(a))], w=0.3, smooth=False)
    p.eye(cx, cy, R * 0.45, w=0.55, fill=False)
    # the pupil: a cuttlefish W, the only pupil in the bestiary
    L, A, T = R * 0.56, R * 0.1, R * 0.12
    top, bot = [], []
    for i in range(41):
        u = -1 + 2 * i / 40
        yc = -A * math.cos(math.tau * u)
        t = T * max(0.0, 1 - u * u) ** 0.55 * (1 + 0.35 * (1 - math.cos(math.tau * u)) / 2)
        top.append((cx + u * L, cy + yc - t))
        bot.append((cx + u * L, cy + yc + t))
    p.pupil(top + bot[::-1][1:-1])
    glint = [(cx + R * 0.8 * math.cos(math.radians(a)), cy + R * 0.8 * math.sin(math.radians(a))) for a in range(206, 246, 5)]
    glint += [(cx + R * 0.7 * math.cos(math.radians(a)), cy + R * 0.7 * math.sin(math.radians(a))) for a in range(245, 205, -5)]
    p.raw(f'<path fill="var(--beast-body, none)" d="M{" L".join(f"{x:.1f} {y:.1f}" for x, y in glint)}Z"/>')
    return p


CREATURES = [
    ('surface', lions_mane), ('surface', man_o_war), ('surface', leafy_seadragon), ('surface', sunfish),
    ('twilight', barreleye), ('twilight', vampire_squid), ('twilight', hatchetfish), ('twilight', siphonophore),
    ('midnight', black_seadevil), ('midnight', gulper_eel), ('midnight', colossal_squid), ('midnight', fangtooth),
    ('abyss', dumbo_octopus), ('abyss', tripod_fish), ('abyss', sea_pig), ('abyss', xenophyophore),
    ('hadal', snailfish), ('hadal', amphipod), ('hadal', sea_cucumber), ('hadal', deep_one),
    ('floor', dagon), ('floor', hydra), ('floor', shoggoth), ('floor', dreamer),
]


def main():
    plates_dir = os.path.join(OUT, 'plates')
    sil_dir = os.path.join(OUT, 'silhouettes')
    os.makedirs(plates_dir, exist_ok=True)
    os.makedirs(sil_dir, exist_ok=True)
    symbols, manifest = [], []
    for zone, fn in CREATURES:
        p = fn()
        head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">'
        with open(os.path.join(plates_dir, p.key + '.svg'), 'w') as fh:
            fh.write(head + f'<title>{p.title}</title><desc>{p.desc}</desc>' + p.plate_svg() + '</svg>\n')
        with open(os.path.join(sil_dir, p.key + '.svg'), 'w') as fh:
            fh.write(head + f'<title>{p.title} (not yet found)</title>' + p.silhouette_svg() + '</svg>\n')
        symbols.append(f'<symbol id="b-{p.key}" viewBox="0 0 240 240">{p.plate_svg()}</symbol>')
        symbols.append(f'<symbol id="b-{p.key}-sil" viewBox="0 0 240 240">{p.silhouette_svg()}</symbol>')
        manifest.append({'id': p.key, 'name': p.title, 'zone': zone, 'note': p.desc})
    with open(os.path.join(OUT, 'bestiary-sprite.svg'), 'w') as fh:
        fh.write('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(x for x in symbols if '-sil"' not in x) + '</svg>\n')
    with open(os.path.join(OUT, 'silhouettes-sprite.svg'), 'w') as fh:
        fh.write('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(x for x in symbols if '-sil"' in x) + '</svg>\n')
    with open(os.path.join(OUT, 'bestiary.json'), 'w') as fh:
        json.dump(manifest, fh, indent=2, ensure_ascii=False)
        fh.write('\n')
    print(f'{len(manifest)} creatures')


if __name__ == '__main__':
    main()
