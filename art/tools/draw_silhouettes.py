"""Draws the things in the deep: silhouettes for the abyss renderer and for page art.

    python3 art/tools/draw_silhouettes.py

All shapes are filled with currentColor (white when rasterised to PNG for use as
alpha masks in a shader). Seeds are fixed, so the output is repeatable.

Rule from the style bible: show less. These are meant to be seen as an absence
of light, half-hidden by fog, never fully lit and never fully on screen.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from svgkit import f, pt, poly, smooth, circle_path, ring_path, polar, normal, svg, write, rng

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'textures', 'silhouettes')


# ------------------------------------------------------------------ tentacles

def tentacle(x0, y0, heading, length, width, curl=1.0, wiggle=0.25, seed=1, n=150, suckers=True, side=1):
    """A tapering arm whose curvature grows towards the tip until it coils.
    Returns (outline_path, sucker_holes_path)."""
    r = rng(seed)
    ds = length / n
    th = math.radians(heading)
    x, y = x0, y0
    spine, widths, ks = [], [], []
    ph = r.uniform(0, math.tau)
    for i in range(n + 1):
        s = i / n
        spine.append((x, y))
        widths.append(width * (1 - s) ** 1.25 * (1 + 0.06 * math.sin(s * 37 + ph)) + width * 0.012)
        k = side * (curl * (0.08 + 4.2 * s ** 3.0) / length * 6) + wiggle * math.sin(s * 7 + ph) / length * 4
        ks.append(k)
        th += k * ds
        x += math.cos(th) * ds
        y += math.sin(th) * ds
    left, right = [], []
    holes = []
    for i in range(n + 1):
        a = spine[max(0, i - 1)]
        b = spine[min(n, i + 1)]
        nx, ny = normal(a, b)
        w = widths[i]
        # scalloped inner edge: the suckers seen edge-on
        bump = 0.0
        if suckers and i > 4:
            per = max(2, int(3 + 9 * (1 - i / n)))
            bump = 0.18 * w * max(0.0, math.sin(math.pi * (i % per) / per))
        inner = side
        lw = w + (bump if inner < 0 else 0)
        rw = w + (bump if inner > 0 else 0)
        left.append((spine[i][0] + nx * lw, spine[i][1] + ny * lw))
        right.append((spine[i][0] - nx * rw, spine[i][1] - ny * rw))
        if suckers and i % max(2, int(3 + 9 * (1 - i / n))) == 0 and 6 < i < n - 8 and w > 3:
            cx = spine[i][0] - nx * w * 0.66 * side
            cy = spine[i][1] - ny * w * 0.66 * side
            holes.append(circle_path(cx, cy, w * 0.12, ccw=True))
    outline = smooth(left + right[::-1], close=True)
    return outline, ' '.join(holes)


def tentacle_svg():
    W, H = 1600, 1000
    body = []
    arms = [
        dict(x0=1180, y0=1080, heading=-98, length=1250, width=92, curl=0.9, wiggle=0.5, seed=3, side=-1),
        dict(x0=330, y0=1090, heading=-72, length=980, width=62, curl=0.7, wiggle=0.6, seed=8, side=1),
        dict(x0=800, y0=1090, heading=-92, length=640, width=40, curl=1.1, wiggle=0.8, seed=13, side=1),
    ]
    for a in arms:
        o, h = tentacle(**a)
        body.append(f'<path fill-rule="evenodd" d="{o} {h}"/>')
    write(os.path.join(OUT, 'tentacles-rising.svg'),
          svg(W, H, '<g fill="currentColor">' + ''.join(body) + '</g>', title='Tentacles rising',
              desc='Three arms rising from below the frame. Fill: currentColor. Place at the bottom edge; let fog cover the roots.'))
    o, h = tentacle(60, 560, -8, 1700, 74, curl=0.6, wiggle=0.7, seed=21, side=-1)
    write(os.path.join(OUT, 'tentacle-crossing.svg'),
          svg(1700, 900, f'<g fill="currentColor"><path fill-rule="evenodd" d="{o} {h}"/></g>', title='A tentacle crossing',
              desc='One vast arm crossing the far water, entering from the left. Fill: currentColor.'))


# ------------------------------------------------------------------ the drowned city skyline

def skyline_svg():
    """Colossal slabs that lean against each other at angles that do not agree.
    No domes, no windows, nothing a person would build: joints that cut across the
    stone at the wrong slope, stairs that stop in the air, one door with a lens-shaped
    opening, so the city looks back. Shapes that cross the tile edge are repeated on
    the other side, so the strip tiles horizontally without a seam."""
    W, H = 2400, 700
    base = H

    def quad_at(x0, x1, top_l, top_r, sh):
        return [(x0, base), (x1, base), (x1 + sh, top_r), (x0 + sh, top_l)]

    def inside_x(x0, sh, h, y):            # x of a leaning edge at height y
        return x0 + sh * (base - y) / max(h, 1)

    def seam(x0, x1, sh, h, y, slope, th):
        """A thin crack across the slab that does not reach its edges, at the wrong slope."""
        a = inside_x(x0, sh, h, y) + (x1 - x0) * 0.08
        b = inside_x(x1, sh, h, y) - (x1 - x0) * 0.08
        dy = slope * (b - a)
        return [(a, y), (a, y + th), (b, y + dy + th), (b, y + dy)]

    layers = {}
    for name, hmin, hmax, wmin, wmax, seed, th in (('far', 150, 430, 70, 210, 7, 2.2),
                                                   ('near', 130, 610, 100, 300, 1928, 3.2)):
        r = rng(seed)
        shapes = []                         # each shape: list of polygons, filled evenodd
        x = 0.0
        lean_prev = 0.0
        prev_top = base - 300
        eye_done = name == 'far'
        while x < W:
            w = r.uniform(wmin, wmax)
            h = r.uniform(hmin, hmax) * (1.0 if r.random() > 0.15 else 1.4)
            lean = max(-17.0, min(17.0, -0.55 * lean_prev + r.uniform(-11, 11)))   # neighbours lean together
            lean_prev = lean
            sh = math.tan(math.radians(lean)) * h
            slope = r.uniform(-0.9, 0.9)
            x0, x1 = x, x + w
            top_y = base - h
            kind = r.choices(['slab', 'obelisk', 'gate', 'stair', 'broken', 'fallen'],
                             weights=[5, 1.6, 1.3, 1.2, 1.5, 0.7])[0]
            if not eye_done and x > W * 0.55:
                kind, eye_done = 'door', True
                w = max(w, 230)
                x1 = x0 + w
                h = max(h, 520)
                top_y = base - h
                sh = math.tan(math.radians(lean)) * h
            polys = []
            if kind == 'slab':
                polys.append(quad_at(x0, x1, top_y - slope * w * 0.5, top_y + slope * w * 0.5, sh))
                for k in range(r.randint(1, 2)):
                    y = base - h * r.uniform(0.25, 0.75)
                    polys.append(seam(x0, x1, sh, h, y, slope + r.choice([-1, 1]) * r.uniform(0.18, 0.4), th)[::-1])
            elif kind == 'door':
                polys.append(quad_at(x0, x1, top_y - 30, top_y + 22, sh))
                # a lens-shaped opening, tilted against the door's own lean
                cx = x0 + w * 0.5 + sh * 0.55
                cy = base - h * 0.58
                L, A = w * 0.32, w * 0.12
                rot = math.radians(-lean * 0.6 + 9)
                lens = []
                for k in range(40):
                    t = k / 40 * math.tau
                    px, py = L * math.cos(t), A * math.sin(t) * abs(math.sin(t)) ** 0.15
                    lens.append((cx + px * math.cos(rot) - py * math.sin(rot), cy + px * math.sin(rot) + py * math.cos(rot)))
                polys.append(lens[::-1])
                polys.append(seam(x0, x1, sh, h, base - h * 0.22, 0.12, th)[::-1])
            elif kind == 'obelisk':
                cw = w * 0.5
                cx = x0 + w / 2
                tip = (cx + sh + slope * 40, top_y - h * 0.1)
                polys.append([(cx - cw / 2, base), (cx + cw / 2, base), (cx + cw * 0.3 + sh, top_y + h * 0.1), tip,
                              (cx - cw * 0.36 + sh, top_y + h * 0.16)])
            elif kind == 'gate':           # a trilithon whose lintel does not sit level
                pw = w * 0.26
                lint_h = h * 0.14
                y_l = top_y + lint_h
                polys.append(quad_at(x0, x0 + pw, y_l, y_l, sh * 0.6))
                polys.append(quad_at(x1 - pw, x1, y_l + slope * 30, y_l + slope * 30, -sh * 0.4))
                lx0, lx1 = x0 - w * 0.08 + sh * 0.6, x1 + w * 0.12 - sh * 0.4
                tilt = r.uniform(-0.16, 0.16) * w
                polys.append([(lx0, y_l + 6), (lx1, y_l + 6 + tilt), (lx1 + 8, top_y + tilt), (lx0 - 4, top_y - 6)])
            elif kind == 'stair':          # stairs that rise and then stop in the air
                steps = r.randint(5, 8)
                d = 1 if r.random() < 0.5 else -1
                pts = [(x0, base)] if d > 0 else [(x1, base)]
                for k in range(steps):
                    t0, t1 = k / steps, (k + 1) / steps
                    tread_tilt = r.uniform(-5, 5)
                    yk = base - h * 0.75 * t1
                    xa = x0 + w * t0 if d > 0 else x1 - w * t0
                    xb = x0 + w * t1 if d > 0 else x1 - w * t1
                    pts += [(xa, yk), (xb, yk + tread_tilt)]
                pts += [(pts[-1][0], base)]
                polys.append(pts)
            elif kind == 'broken':
                teeth = r.randint(3, 6)
                pts = [(x0, base), (x0 + sh, top_y)]
                for k in range(teeth):
                    t = (k + 0.5) / teeth
                    pts.append((x0 + sh + w * t, top_y + r.uniform(0, h * 0.4)))
                pts += [(x1 + sh, top_y + r.uniform(0, h * 0.2)), (x1, base)]
                polys.append(pts)
            else:                          # fallen: a beam resting against the last stone
                ang = math.radians(r.uniform(28, 48)) * (1 if r.random() < 0.5 else -1)
                length = min(900, (base - prev_top) / max(0.3, math.sin(abs(ang))) * 1.05)
                bw = w * 0.32
                fx, fy = (x1, base) if ang > 0 else (x0, base)
                ux, uy = -math.cos(ang) * (1 if ang > 0 else -1), -math.sin(abs(ang))
                nx, ny = -uy, ux
                polys.append([(fx, fy), (fx + nx * bw, fy + ny * bw), (fx + nx * bw + ux * length, fy + ny * bw + uy * length),
                              (fx + ux * length, fy + uy * length)])
            shapes.append(polys)
            prev_top = top_y
            x += w * r.uniform(0.62, 0.98)
        # wrap: anything crossing the tile edge is repeated on the other side
        wrapped = []
        for polys in shapes:
            xs = [px for poly_ in polys for px, _ in poly_]
            wrapped.append(polys)
            if max(xs) > W:
                wrapped.append([[(px - W, py) for px, py in poly_] for poly_ in polys])
            if min(xs) < 0:
                wrapped.append([[(px + W, py) for px, py in poly_] for poly_ in polys])
        # low rubble along the floor (periodic, so it wraps)
        rub = [(0, base)]
        for k in range(241):
            t = k / 240
            rub.append((W * t, base - 22 - 10 * math.sin(t * math.tau * 9 + 1) - 7 * abs(math.sin(t * math.tau * 31))))
        rub.append((W, base))
        wrapped.append([rub])
        layers[name] = [' '.join(poly(pp) for pp in polys) for polys in wrapped]
    body = ''.join(
        f'<g id="{name}" fill="currentColor"{" opacity=\"0.55\"" if name == "far" else ""}>' +
        ''.join(f'<path fill-rule="evenodd" d="{d}"/>' for d in shapes) + '</g>'
        for name, shapes in (('far', layers['far']), ('near', layers['near'])))
    write(os.path.join(OUT, 'drowned-city.svg'),
          svg(W, H, body, title='The Drowned City skyline',
              desc='Two parallax layers (#far, #near). Tiles horizontally. Slabs lean against each other, joints cut at the wrong slope, '
                   'stairs stop in the air, and one door has a lens-shaped opening. Fill: currentColor.'))


# ------------------------------------------------------------------ the great Eye

def eye_svg():
    W, H = 1400, 800
    cx, cy = W / 2, H / 2 + 10
    lw, lh = 620, 250
    up = [(cx - lw + 2 * lw * i / 40, cy - lh * math.sin(math.pi * i / 40) ** 0.9 * (1 + 0.1 * (i / 40 - 0.5))) for i in range(41)]
    lo = [(cx + lw - 2 * lw * i / 40, cy + lh * 0.78 * math.sin(math.pi * i / 40) ** 1.1) for i in range(1, 40)]
    almond = smooth(up + lo, close=True)
    folds = []
    for k, (off, frac) in enumerate(((22, 0.86), (46, 0.7), (72, 0.52))):
        pts = [(cx - lw * frac + 2 * lw * frac * i / 30,
                cy - lh * math.sin(math.pi * i / 30) ** 0.9 - off * (0.6 + 0.4 * math.sin(math.pi * i / 30))) for i in range(31)]
        wv = [9 - k * 2.2] * 31
        wv = [w * math.sin(math.pi * i / 30) ** 0.6 + 1 for i, w in enumerate(wv)]
        from svgkit import tapered
        folds.append(tapered(pts, wv))
    lower_fold = [(cx - lw * 0.7 + 2 * lw * 0.7 * i / 30, cy + lh * 0.78 * math.sin(math.pi * i / 30) ** 1.1 + 58) for i in range(31)]
    from svgkit import tapered
    folds.append(tapered(lower_fold, [9 * math.sin(math.pi * i / 30) ** 0.6 + 1 for i in range(31)]))
    R = 210
    r = rng(77)
    strokes = []
    for k in range(120):
        a = math.tau * k / 120 + r.uniform(-0.01, 0.01)
        r1, r2 = R * r.uniform(0.3, 0.38), R * r.uniform(0.86, 0.97)
        w1, w2 = 0.006, 0.02 * r.uniform(0.7, 1.3)
        strokes.append(poly([polar(cx, cy, r1, a - w1), polar(cx, cy, r2, a - w2), polar(cx, cy, r2, a + w2), polar(cx, cy, r1, a + w1)]))
    limbus = ring_path(cx, cy, R, R * 0.93)
    collar = ring_path(cx, cy, R * 0.45, R * 0.42)
    # W pupil
    L, A, T = R * 0.52, R * 0.1, R * 0.11
    top, bot = [], []
    for i in range(61):
        u = -1 + 2 * i / 60
        yc = -A * math.cos(math.tau * u)
        t = T * max(0.0, 1 - u * u) ** 0.55 * (1 + 0.35 * (1 - math.cos(math.tau * u)) / 2)
        top.append((cx + u * L, cy + yc - t))
        bot.append((cx + u * L, cy + yc + t))
    pupil = smooth(top + bot[::-1][1:-1], close=True)
    glint = smooth([polar(cx, cy, R * 0.8, math.radians(a)) for a in range(205, 246, 4)] +
                   [polar(cx, cy, R * 0.74, math.radians(a)) for a in range(245, 204, -4)], close=True)
    body = (
        f'<path id="lid" fill="var(--eye-lid, currentColor)" opacity="0.35" d="{almond}"/>'
        f'<g id="folds" fill="var(--eye-fold, currentColor)">' + ''.join(f'<path d="{d}"/>' for d in folds) + '</g>'
        f'<g id="iris" fill="var(--eye-iris, currentColor)"><path d="{" ".join(strokes)}"/>'
        f'<path fill-rule="evenodd" d="{limbus}"/><path fill-rule="evenodd" d="{collar}"/></g>'
        f'<path id="pupil" fill="var(--eye-pupil, #000)" d="{pupil}"/>'
        f'<path id="glint" fill="var(--eye-glint, currentColor)" opacity="0.8" d="{glint}"/>'
    )
    write(os.path.join(OUT, 'great-eye.svg'),
          svg(W, H, body, title='The great Eye',
              desc='Layers: #lid, #folds, #iris, #pupil (cuttlefish W), #glint. Colours via --eye-lid, --eye-fold, --eye-iris, --eye-pupil, --eye-glint when inlined.'))


# ------------------------------------------------------------------ creatures

def leviathan_svg():
    W, H = 2200, 800
    r = rng(5)
    # mantle: a long, faintly asymmetric teardrop, head to the right
    pts = []
    for i in range(60):
        t = i / 59
        a = math.pi * 2 * t
        x = 1450 + 520 * math.cos(a) * (1.0 if math.cos(a) > 0 else 1.15)
        y = 360 + 150 * math.sin(a) * (1 - 0.35 * max(0, math.cos(a))) + 12 * math.sin(a * 5)
        pts.append((x, y))
    mantle = smooth(pts, close=True)
    fin = poly([(1640, 330), (1880, 220), (2040, 345), (1880, 470), (1640, 400)])
    fin2 = ''
    arms = []
    for k in range(8):
        y0 = 300 + k * 17
        o, h = tentacle(1010, y0, 180 + r.uniform(-9, 9), r.uniform(700, 900), r.uniform(24, 34),
                        curl=r.uniform(0.05, 0.25), wiggle=0.9, seed=40 + k, side=1 if k % 2 else -1)
        arms.append(f'<path fill-rule="evenodd" d="{o} {h}"/>')
    for k, (y0, hd) in enumerate(((330, 177), (378, 184))):
        o, h = tentacle(1010, y0, hd, 1000, 12, curl=0.1, wiggle=1.0, seed=90 + k, side=1, suckers=False)
        arms.append(f'<path d="{o}"/>')
    eye = circle_path(1080, 345, 20, ccw=True)
    body = (f'<g fill="currentColor"><path fill-rule="evenodd" d="{mantle} {eye}"/><path d="{fin}"/>' + ''.join(arms) + '</g>')
    write(os.path.join(OUT, 'leviathan.svg'),
          svg(W, H, body, title='Something passing',
              desc='A vast cephalopod in profile, arms trailing left. Fill: currentColor. Show at most a third of it at once.'))


def angler_svg():
    """A deep-sea anglerfish: a globe of a body, a mouth too large for it, needle teeth."""
    W, H = 900, 640
    from svgkit import tapered
    r = rng(31)
    # body: near-round, the mouth a wide wedge cut from the front (right)
    pts = []
    for i in range(48):
        a = math.tau * i / 48
        rr = 230 * (1 + 0.06 * math.sin(a * 3 + 1) + 0.03 * math.sin(a * 7))
        pts.append((400 + rr * math.cos(a) * 1.08, 330 + rr * math.sin(a) * 0.92))
    body = smooth(pts, close=True)
    mouth = [(700, 250), (560, 300), (500, 340), (560, 392), (700, 440), (760, 420), (720, 345), (760, 268)]
    mouth_d = smooth(mouth[::-1], close=True)
    teeth = []
    for k in range(9):          # upper jaw: long, irregular needles pointing down
        t = k / 8
        x = 560 + t * 170
        y = 300 - t * 45 + 6
        L = r.uniform(30, 62)
        teeth.append(poly([(x - 5, y - 4), (x + r.uniform(-6, 8), y + L), (x + 5, y - 4)]))
    for k in range(8):          # lower jaw: pointing up
        t = k / 7
        x = 575 + t * 160
        y = 392 + t * 42 - 6
        L = r.uniform(24, 52)
        teeth.append(poly([(x - 5, y + 4), (x + r.uniform(-6, 8), y - L), (x + 5, y + 4)]))
    tail = smooth([(190, 300), (70, 220), (40, 330), (70, 450), (190, 370)], close=True)
    fin = smooth([(330, 470), (300, 560), (380, 520), (420, 470)], close=True)
    eye = circle_path(590, 220, 11, ccw=True)
    stalk = tapered([(470, 110), (520, 40), (620, 10), (720, 40), (770, 110)], [7, 5, 4, 3, 2.4])
    body_d = f"{body} {mouth_d} {eye}"
    svgbody = (f'<g fill="currentColor"><path fill-rule="evenodd" d="{body_d}"/><path d="{tail}"/><path d="{fin}"/>'
               f'<path d="{" ".join(teeth)}"/><path d="{stalk}"/></g>'
               f'<circle id="lure" cx="772" cy="124" r="15" fill="var(--lure, currentColor)"/>')
    write(os.path.join(OUT, 'anglerfish.svg'),
          svg(W, H, svgbody, title='Anglerfish',
              desc='Silhouette; the lure is a separate #lure circle to light in the accent colour.'))


def jellyfish_svg():
    W, H = 600, 1000
    cx = 300
    bell = [(cx - 200, 260)]
    for i in range(41):
        t = i / 40
        a = math.pi * (1 - t)
        bell.append((cx + 200 * math.cos(a), 260 - 210 * math.sin(a) ** 0.85))
    rim = []
    for i in range(16, -1, -1):
        t = i / 16
        x = cx - 200 + 400 * t
        rim.append((x, 262 + 16 * abs(math.sin(t * math.pi * 8))))
    bell_d = smooth(bell + rim, close=True)
    parts = [bell_d]
    from svgkit import tapered
    r = rng(9)
    for k in range(4):
        x0 = cx - 70 + k * 46
        pts = [(x0 + 30 * math.sin(i / 10 + k), 270 + i * 14) for i in range(46)]
        parts.append(tapered(pts, [14 * (1 - i / 46) ** 0.6 + 2 for i in range(46)]))
    for k in range(9):
        x0 = cx - 190 + k * 47
        n = int(r.uniform(40, 60))
        pts = [(x0 + 18 * math.sin(i / 6 + k * 1.7), 268 + i * 13) for i in range(n)]
        parts.append(tapered(pts, [2.2] * n))
    write(os.path.join(OUT, 'jellyfish.svg'),
          svg(W, H, '<g fill="currentColor">' + ''.join(f'<path d="{d}"/>' for d in parts) + '</g>', title='Jellyfish',
              desc='Bell, four oral arms, nine trailing threads. Fill: currentColor.'))


def siphonophore_svg():
    W, H = 400, 1400
    r = rng(12)
    spine = [(200 + 60 * math.sin(i / 14) + 20 * math.sin(i / 5), 20 + i * 9.5) for i in range(140)]
    from svgkit import tapered
    parts = [tapered(spine, [3.2 - 1.8 * i / 140 for i in range(140)])]
    for i in range(4, 40, 3):     # swimming bells at the top
        x, y = spine[i]
        side = -1 if (i // 3) % 2 else 1
        parts.append(smooth([(x, y - 10), (x + side * 34, y - 16), (x + side * 46, y + 2), (x + side * 30, y + 16), (x, y + 10)], close=True))
    for i in range(44, 138, 5):   # feeding polyps and their threads further down
        x, y = spine[i]
        parts.append(circle_path(x, y, 6 + 3 * r.random()))
        side = -1 if (i // 5) % 2 else 1
        th = [(x + side * (j * 4 + 6 * math.sin(j / 2)), y + j * 7) for j in range(int(r.uniform(6, 14)))]
        if len(th) > 2:
            parts.append(tapered(th, [1.4] * len(th)))
    write(os.path.join(OUT, 'siphonophore.svg'),
          svg(W, H, '<g fill="currentColor">' + ''.join(f'<path d="{d}"/>' for d in parts) + '</g>', title='Siphonophore',
              desc='A colony that is one animal: bells above, polyps and threads below. Fill: currentColor.'))


def bathysphere_svg():
    """The player's vessel as engraved line art (for the depth gauge and results)."""
    W, H = 240, 300
    cx, cy, R = 120, 182, 92
    s = []
    s.append('<path d="M120 0 V52" stroke-width="3"/>')                          # the cable
    s.append('<path d="M106 52 h28 l5 22 h-38 Z"/>')                             # shackle block
    s.append(f'<circle cx="{cx}" cy="{cy}" r="{R}" stroke-width="3"/>')
    # the entry hatch, bolted, up and to the left
    hx, hy, hr = 84, 140, 34
    s.append(f'<circle cx="{hx}" cy="{hy}" r="{hr}" stroke-width="2.4"/>')
    for k in range(10):
        x, y = polar(hx, hy, hr - 6, math.tau * k / 10)
        s.append(f'<circle cx="{f(x)}" cy="{f(y)}" r="1.8" fill="currentColor" stroke="none"/>')
    # one great quartz window and one small one, offset (never a face)
    for (px, py, pr) in ((150, 196, 26), (104, 228, 11)):
        s.append(f'<circle cx="{px}" cy="{py}" r="{pr}" stroke-width="3"/>')
        s.append(f'<circle cx="{px}" cy="{py}" r="{pr - 7}" class="glass" fill="var(--porthole, none)"/>')
    # engraved shading: curved hatching down the right flank
    for k in range(10):
        a0, a1 = math.radians(-40 + k * 2), math.radians(62 - k * 3)
        rr = R - 8 - k * 4.2
        p0, p1 = polar(cx, cy, rr, a0), polar(cx, cy, rr, a1)
        s.append(f'<path d="M{pt(p0)} A{f(rr)} {f(rr)} 0 0 1 {pt(p1)}" stroke-width="1" opacity="{f(0.75 - k * 0.05)}"/>')
    body = ('<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + ''.join(s) + '</g>')
    write(os.path.join(OUT, 'bathysphere.svg'),
          svg(W, H, body, title='The bathysphere',
              desc='Your vessel. Line art in currentColor; window glass can be lit via --porthole when inlined.'))


def main():
    os.makedirs(OUT, exist_ok=True)
    tentacle_svg()
    skyline_svg()
    eye_svg()
    leviathan_svg()
    angler_svg()
    jellyfish_svg()
    siphonophore_svg()
    bathysphere_svg()
    print('silhouettes written to', OUT)


if __name__ == '__main__':
    main()
