"""Draws the séance for party mode, "The Séance": a table seen from above, with twelve hands
laid round a porthole and their fingertips on its rim, and the twelve marks of the Drowned
Script round the edge like the letters of a talking board. Also the candle that burns for each
question. Engraved with the bestiary kit; the whole table shares one light (upper left), so each
hand is drawn in place rather than rotated from one copy.

    python3 art/tools/draw_seance.py

Writes art/seance/seance.svg (the table, 240 x 240) and art/seance/seance-sprite.svg with the
symbols #seance, #seance-hand, #seance-candle, #seance-flame and #seance-porthole.

A séance holds twelve sitters (MAX_SITTERS in the game), and each holds a mark: one of the twelve
glyphs of the Script that are not letters of the city's true name. Seat N belongs to mark N - 1,
clockwise from the top, so a sitter always sits at their own mark. Each seat reads its own custom
properties:
  --seance-hand-N    colour of seat N's hand and mark (default currentColor): a token colour
  --seance-seat-N    opacity of seat N's hand (default 1): an empty chair might be 0.16; the mark
                     never fades below 0.35, so the board keeps its letters
  --seance-glass     fill of the porthole glass (default none): light it for the reveal
  --seance-fade      how long a hand or a flame takes to change (default 0.8s)
  --beast-body, --beast-glow-filter   as on the bestiary plates
The candle reads --seance-lit (0 puts it out), --seance-flame (its colour) and --seance-burn
(0 whole, 1 burnt down to a stub).
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from bestiary_kit import LIGHT, Plate, spline, circle_pts, xform, f1, polyline, stroke_band  # noqa: E402
from draw_glyphs import SCRIPT, script_glyph  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'seance')

N = 12                         # a séance holds twelve sitters
CX = CY = 120.0
R_PORT, R_GLASS = 40.0, 33.4   # the porthole: its frame and its glass
R_TIP = 40.4                   # where the fingertips rest, on the frame's outer edge
HAND_S = 0.96                  # the hands, scaled from their drawing units
R_LINE, R_EDGE = 112.6, 116.6  # the Script's waterline, and the outer rule
GLYPH_S = 0.46                 # the Script's 20 x 32 grid, scaled
# The twelve marks, in order: the Script without eye, coil, gate and sleeper, the city's true name.
MARKS = ('tide', 'fang', 'anchor', 'talon', 'sounding', 'maw', 'root', 'veil', 'spire', 'knot', 'hand', 'void')


# ------------------------------------------------------------------ geometry

def chaikin(P, k=2):
    for _ in range(k):
        Q = []
        for i in range(len(P)):
            a, b = P[i], P[(i + 1) % len(P)]
            Q += [(0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]),
                  (0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1])]
        P = Q
    return P


def arc(cx, cy, r, a0, a1, n=24):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


class Digit:
    """A finger or thumb, back view. Local hand units: fingers point up (-y)."""

    def __init__(self, B, ang, L, w):
        self.B, self.L, self.w = B, L, w
        a = math.radians(ang)
        self.d = (math.sin(a), -math.cos(a))       # along the digit, towards the tip
        self.n = (math.cos(a), math.sin(a))        # across it, towards its right-hand edge
        self.hc = self.half(1.0)
        self.Lc = L - self.hc

    def half(self, t):
        w = self.w
        return (w * 0.5 * (1 - 0.13 * t) + 0.05 * w * math.exp(-((t - 0.52) / 0.1) ** 2)
                + 0.03 * w * math.exp(-((t - 0.8) / 0.07) ** 2))

    def at(self, u, v):
        return (self.B[0] + self.d[0] * u + self.n[0] * v, self.B[1] + self.d[1] * u + self.n[1] * v)

    def edge(self, side, t0, t1, k=8):
        return [self.at((t0 + (t1 - t0) * i / k) * self.Lc, side * self.half(t0 + (t1 - t0) * i / k)) for i in range(k + 1)]

    def cap(self, k=9):
        return [self.at(self.Lc + math.sin(math.pi * i / k) * self.hc * 1.05, math.cos(math.pi * i / k) * self.hc)
                for i in range(1, k)]

    def nail(self, thumb=False):
        ln, wn = (0.24 if thumb else 0.2) * self.L, 0.31 * self.w
        uc = self.L - 0.45 - ln / 2
        pts = []
        for i in range(20):
            th = 2 * math.pi * i / 20
            c, s = math.cos(th), math.sin(th)
            pts.append(self.at(uc + ln / 2 * math.copysign(abs(c) ** 0.55, c), wn * math.copysign(abs(s) ** 0.7, s)))
        return pts

    def crease(self, t, span=0.52, bow=0.3):
        h = self.half(t * self.L / self.Lc if t * self.L < self.Lc else 1.0) * span
        return [self.at(t * self.L - bow * (1 - (v / h) ** 2), v) for v in (-h, -h / 2, 0, h / 2, h)]


def make_hand(seed=0):
    """A right hand laid flat, back up, fingers up (-y), the wrist at y = +22, then a lace cuff
    and a sleeve that goes into the dark. Local units. Returns its parts as point lists."""
    r = random.Random(seed)
    j = (lambda a: a + r.uniform(-1.8, 1.8)) if seed else (lambda a: a)
    s = (lambda v: v * r.uniform(0.97, 1.03)) if seed else (lambda v: v)
    fingers = [Digit((6.8, 1.4), j(10.0), s(12.8), 3.45),
               Digit((2.55, -0.5), j(3.5), s(16.4), 3.8),
               Digit((-1.75, -0.95), j(-1.5), 18.0, 4.0),
               Digit((-6.0, -0.1), j(-7.0), s(16.0), 3.85)]
    thumb = Digit((-8.1, 9.6), j(-33.0), s(14.6), 4.6)
    t_sep = 0.24
    P = [(6.4, 22.6), (7.6, 18.6), (8.75, 14.2), (9.3, 9.4), (9.1, 4.6)]
    for i, f in enumerate(fingers):
        P += f.edge(+1, 0.0 if i == 0 else t_sep, 1.0)
        P += f.cap()
        P += f.edge(-1, 1.0, 0.0 if i == len(fingers) - 1 else t_sep)
        if i < len(fingers) - 1:
            a, b = f.at(t_sep * f.Lc, -f.half(t_sep)), fingers[i + 1].at(t_sep * fingers[i + 1].Lc, fingers[i + 1].half(t_sep))
            P.append(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 0.75))
    P.append((-8.45, 2.6))                                              # the web of the thumb
    P += thumb.edge(+1, 0.42, 1.0)
    P += thumb.cap()
    P += thumb.edge(-1, 1.0, 0.0)
    P += [(-9.4, 14.6), (-8.05, 18.4), (-6.7, 22.6)]
    outline = chaikin(P, 2)

    details = []                                                        # (points, width, opacity, closed)
    for f in fingers:
        details.append((f.nail(), 0.2, 0.95, True))
        details.append((f.crease(0.5), 0.17, 0.85, False))
        details.append((f.crease(0.56, 0.38), 0.14, 0.6, False))
        details.append((f.crease(0.79, 0.36, 0.2), 0.14, 0.7, False))
        k0, k1 = f.at(-0.7, -0.28 * f.w), f.at(-0.7, 0.28 * f.w)        # the knuckle, a short arc
        details.append(([k0, f.at(-0.25, 0), k1], 0.18, 0.7, False))
    details.append((thumb.nail(True), 0.2, 0.95, True))
    details.append((thumb.crease(0.55, 0.42), 0.16, 0.8, False))
    for f in fingers[1:]:                                               # tendons, only where they show
        details.append(([f.at(-1.6, 0.1), f.at(-4.2, 0.35), f.at(-7.2, 0.5)], 0.14, 0.45, False))

    # the cuff: a band of linen at the wrist, edged with lace scallops on the hand's side
    sc = 7
    cuff = [(-8.5, 25.4), (8.6, 25.2), (8.85, 22.6)]
    for i in range(sc * 6 + 1):
        x = 8.85 - 17.6 * i / (sc * 6)
        q = (i % 6) / 6
        cuff.append((x, 22.6 - 0.95 * math.sqrt(max(0.0, 1 - (2 * q - 1) ** 2))))
    cuff.append((-8.75, 22.6))
    cuff_lines = [([(-8.6, 24.05), (0, 23.9), (8.7, 23.85)], 0.17, 0.8, False)]
    cuff_dots = [(-8.75 + 17.6 * (i + 0.5) / sc, 22.05) for i in range(sc)]
    # the sleeve, going into the dark: lines round its form, fewer and shorter as it goes
    rr = random.Random(seed + 50)
    y0, y1 = 25.3, 37.5
    hw = lambda y: 8.6 + 1.8 * (y - y0) / (y1 - y0)                     # noqa: E731
    rings = []
    y = y0 + 0.95
    while y < y1:
        u = (y - y0) / (y1 - y0)
        if rr.random() < (1 - u) ** 0.8 + 0.08:
            h = hw(y)
            rings.append((u, [(-h + 0.3, y + 0.15), (-h * 0.5, y - 0.45), (0, y - 0.62), (h * 0.5, y - 0.45), (h - 0.3, y + 0.15)]))
        y += 1.05 + 0.5 * u
    sides = ([(-8.5, 25.4), (-9.5, 31.5), (-10.4, 37.5)], [(8.6, 25.2), (9.5, 31.4), (10.4, 37.5)])
    return dict(outline=outline, details=details, cuff=cuff, cuff_lines=cuff_lines, cuff_dots=cuff_dots,
                sleeve_rings=rings, sleeve_sides=sides, tip=min(outline, key=lambda p: p[1]))


def hand_plate(T, seed=0):
    """One hand, placed by T (local points -> plate points), lit from the plate's upper left."""
    h = make_hand(seed)
    p = Plate('hand', 'A hand', '')
    O = T(h['outline'])
    big = 40
    palm = T([(-big, 1.2), (big, 1.2), (big, big), (-big, big)])
    digits = T([(-big, 1.2), (big, 1.2), (big, -big), (-big, -big)])
    p.body(O, dense=True, hatch=False, contour=(0.34, 1.0))
    p.hatching([O], -30, 1.55, shift=5.2, within=[palm], seed=seed * 5 + 1, jitter=0.5, minlen=0.8, inset=0.35)
    p.hatching([O], 55, 1.9, shift=2.4, within=[palm], seed=seed * 5 + 2, jitter=0.5, minlen=0.8, inset=0.35)
    p.hatching([O], -30, 1.45, shift=1.7, within=[digits], seed=seed * 5 + 3, jitter=0.3, minlen=0.6, inset=0.3)
    for pts, w, op, closed in h['details']:
        p.line(T(pts), w=w, op=op, close=closed, smooth=not closed, taper=not closed)
    C = T(h['cuff'])
    p.body(C, dense=True, hatch=False, contour=(0.28, 0.8))
    p.hatching([C], 55, 1.3, shift=1.0, seed=seed * 5 + 4, jitter=0.2, minlen=0.5, inset=0.25)
    for pts, w, op, closed in h['cuff_lines']:
        p.line(T(pts), w=w, op=op, taper=True)
    p.dots(T(h['cuff_dots']), r=0.28, op=0.9)
    # the sleeve: no outline at its far end; each line swells on the side away from the light
    a, b = T([(-1, 0), (1, 0)])
    rx, ry = (b[0] - a[0]) / 2, (b[1] - a[1]) / 2                       # the hand's right, on the plate
    right_dark = rx * LIGHT[0] + ry * LIGHT[1] < 0
    for u, pts in h['sleeve_rings']:
        Q = T(pts)
        frac = 1 - 0.55 * u
        if not right_dark:
            Q = Q[::-1]
        Q = Q[::-1]                                                     # start on the dark side
        k = max(2, round(len(Q) * frac))
        p.line(Q[:k] if k >= len(Q) else Q[:k], w=0.42 * (1 - 0.45 * u), taper='end', op=0.95)
    for side in h['sleeve_sides']:
        p.line(T(side), w=0.5, taper='end')
    return p, O


SAUCER = [(-7.5, -2.0), (-4.0, -2.55), (4.0, -2.55), (7.5, -2.0), (6.9, -0.6), (4.2, 0.75), (-4.2, 0.75), (-6.9, -0.6)]
BASE, TOP = -1.6, -20.4        # the wax, from the dish to its melted top, when it is whole
BURN = 0.7                     # how much of it a candle burns before it goes out
RIM = [(-2.85, -19.7), (-2.7, -20.15), (-1.6, -20.85), (-0.45, -20.3), (0.85, -20.85), (2.05, -20.55), (2.8, -19.75)]
DRIPS = ([(-2.85, -19.4), (-3.4, -18.6), (-3.6, -17.3), (-3.35, -16.3), (-2.95, -16.0), (-2.8, -16.7)],
         [(2.85, -19.2), (3.3, -18.4), (3.35, -17.5), (3.0, -17.1), (2.8, -17.6)])
FLAME = [(0.55, -31.4), (1.75, -28.1), (2.25, -25.3), (1.9, -23.3), (1.0, -22.3), (0.15, -22.0), (-0.8, -22.3),
         (-1.7, -23.3), (-2.0, -25.2), (-1.3, -27.9)]
CORE = [(0.4, -26.6), (0.95, -24.7), (0.75, -23.35), (0.1, -22.95), (-0.55, -23.35), (-0.78, -24.7)]
FLAME_C = (0.2, -25.9)


def flame_svg(lit_var, fill_var):
    """The flame and its rays, which go out together: lit_var is the opacity, fill_var the colour."""
    outer, core = spline(FLAME, True, 6), spline(CORE, True, 5)
    rays = ''
    cx, cy = FLAME_C
    for k in range(-5, 6):
        a = math.radians(-90 + 24 * k)
        r0, r1 = (5.4, 8.0) if k % 2 == 0 else (6.0, 7.4)
        if abs(k) == 5:
            r0, r1 = 6.2, 7.2
        seg = [(cx + r * math.cos(a), cy + r * math.sin(a)) for r in (r0, (r0 + r1) / 2, r1)]
        rays += stroke_band(seg, 0.2, taper=True)
    return (f'<g style="opacity: var({lit_var}, 1); transition: opacity var(--seance-fade, 0.8s) ease">'
            f'<path fill="{fill_var}" opacity="0.8" d="{rays}"/>'
            f'<path class="seance-flame" fill="{fill_var}" fill-rule="evenodd" style="filter: var(--beast-glow-filter, none)" '
            f'd="{polyline(outer)}{polyline(core)}"/></g>')


def candle_svg():
    """One candle in its chamberstick, lit, which burns down as --seance-burn goes from 0 to 1.
    The wax is a plain cylinder shaded with upright strokes, so it can be shortened without
    distorting them; the melted top, the wick and the flame ride down on it."""
    s = Plate('saucer', 'A chamberstick', '')
    s.body(spline(SAUCER, True, 4), dense=True, shade=1.0, spacing=1.7)
    s.line([(-6.6, -1.75), (-3.6, -1.05), (0, -0.9), (3.6, -1.05), (6.6, -1.75)], w=0.2, op=0.9)   # the dish's far rim
    s.eye(9.2, -1.2, 1.3, w=0.4)                                                                  # its ring
    h = TOP - BASE
    wax = (f'<path fill="var(--beast-body, none)" d="M-2.85 {f1(BASE)}V{f1(TOP)}H2.85V{f1(BASE)}Z"/>'
           f'<path d="M-3.17 {f1(BASE)}V{f1(TOP)}h0.64V{f1(BASE)}ZM1.9 {f1(BASE)}V{f1(TOP)}h1.9V{f1(BASE)}Z'
           + ''.join(stroke_band([(x, BASE - 0.8), (x, (BASE + TOP) / 2), (x, TOP + 0.9)], w, taper=True)
                     for x, w in ((0.7, 0.13), (1.15, 0.17), (1.55, 0.2)))
           + f'"/><path opacity="0.55" d="{stroke_band([(-1.75, BASE - 1.4), (-1.65, (BASE + TOP) / 2), (-1.75, TOP + 2.6)], 0.09, taper=True)}"/>')
    cap = Plate('cap', 'The melted top', '')
    for d in DRIPS:
        cap.body(spline(d, True, 4), dense=True, shade=0.6, contour=(0.28, 0.8))
    cap.line(RIM, w=0.42, taper=False)
    cap.line([(-2.5, -19.9), (-1.0, -19.25), (0.6, -19.15), (2.5, -19.55)], w=0.2, op=0.85)        # the near lip
    cap.line([(0.15, -20.3), (0.3, -21.4), (0.75, -22.5)], w=0.32, taper='end')                    # the wick
    scale = f'calc(1 - {BURN} * var(--seance-burn, 0))'
    return (s.plate_svg()
            + f'<g fill="currentColor" style="transform: translateY({f1(BASE)}px) scaleY({scale}) translateY({f1(-BASE)}px)">{wax}</g>'
            + f'<g style="transform: translateY(calc(var(--seance-burn, 0) * {f1(-h * BURN)}px))">'
            + cap.plate_svg() + flame_svg('--seance-lit', 'var(--seance-flame, currentColor)') + '</g>')


def porthole_plate(cx, cy):
    p = Plate('porthole', 'The porthole', '')
    rim = circle_pts(cx, cy, R_PORT, 90)
    glass = circle_pts(cx, cy, R_GLASS, 90)
    p.raw(f'<circle cx="{f1(cx)}" cy="{f1(cy)}" r="{f1(R_GLASS)}" fill="var(--seance-glass, none)"/>')
    p.hatching([glass], -30, 1.8, shift=-3.6, seed=31, jitter=0.4, minlen=0.8)    # the frame's shadow on the glass
    p.hatching([glass], 55, 2.1, shift=-1.6, seed=32, jitter=0.4, minlen=0.8)
    p.line(arc(cx, cy, R_GLASS - 4.2, 18, 64, 12), w=0.42, taper=True)            # a glint on the glass
    p.line(arc(cx, cy, R_GLASS - 6.6, 30, 47, 8), w=0.3, taper=True)
    p.body(rim, holes=[glass], dense=True, hatch=False, contour=(0.5, 1.45))
    p.hatching([rim, glass], -30, 1.7, shift=3.6, seed=33, jitter=0.3, minlen=0.7, inset=0.4)
    p.hatching([rim, glass], 55, 2.0, shift=1.7, seed=34, jitter=0.3, minlen=0.7, inset=0.4)
    p.line(circle_pts(cx, cy, R_GLASS + 1.5, 90), w=0.2, op=0.8, close=True, smooth=False, taper=False)  # the bevel
    for k in range(N):                                                            # a rivet between each pair of seats
        a = math.radians(-90 + 360 * (k + 0.5) / N)
        p.eye(cx + (R_PORT - 3.1) * math.cos(a), cy + (R_PORT - 3.1) * math.sin(a), 1.0, w=0.38)
    return p


# ------------------------------------------------------------------ the circle

def board():
    """The outer rules, and a stop on the waterline between each pair of seats."""
    out = [f'<circle cx="{f1(CX)}" cy="{f1(CY)}" r="{f1(R_EDGE)}" fill="none" stroke="currentColor" stroke-width="0.45" opacity="0.8"/>',
           f'<circle cx="{f1(CX)}" cy="{f1(CY)}" r="{f1(R_LINE)}" fill="none" stroke="currentColor" stroke-width="0.7"/>']
    dots, ticks = '', ''
    for k in range(N):
        b = math.radians(-90 + 360 * (k + 0.5) / N)
        rd = R_LINE - 1.6
        dots += f'M{f1(CX + rd * math.cos(b))} {f1(CY + rd * math.sin(b))}m-0.6 0a0.6 0.6 0 1 0 1.2 0a0.6 0.6 0 1 0 -1.2 0'
        for j in (-2, -1, 1, 2):                                                  # little ticks either side, like a dial
            c = math.radians(-90 + 360 * (k + 0.5) / N + j * 2.2)
            ticks += (f'M{f1(CX + R_LINE * math.cos(c))} {f1(CY + R_LINE * math.sin(c))}'
                      f'L{f1(CX + (R_EDGE - 0.4) * math.cos(c))} {f1(CY + (R_EDGE - 0.4) * math.sin(c))}')
    out.append(f'<path fill="currentColor" d="{dots}"/>')
    out.append(f'<path fill="none" stroke="currentColor" stroke-width="0.35" opacity="0.75" d="{ticks}"/>')
    return ''.join(out)


def mark_svg(k):
    """Seat k's mark, the glyph of the Script that its sitter holds, hung from the waterline."""
    th = -90 + 360 * k / N
    a = math.radians(th)
    x, y = CX + R_LINE * math.cos(a), CY + R_LINE * math.sin(a)
    return (f'<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" '
            f'transform="translate({f1(x)} {f1(y)}) rotate({f1(th + 90)}) scale({GLYPH_S}) translate(-10 -3)">'
            f'{script_glyph(SCRIPT[MARKS[k]], with_line=False)}</g>')


def seat_transform(k):
    """Local hand units -> plate units for seat k (0 is the top), fingertips on the rim."""
    a = -90 + 360 * k / N
    rot = a + 270 + random.Random(100 + k).uniform(-2.0, 2.0)
    tip = make_hand(k + 1)['tip']
    touch = (CX + R_TIP * math.cos(math.radians(a)), CY + R_TIP * math.sin(math.radians(a)))
    t0 = xform([tip], s=HAND_S, rot=rot)[0]
    dx, dy = touch[0] - t0[0], touch[1] - t0[1]
    return lambda P: xform(P, s=HAND_S, rot=rot, dx=dx, dy=dy)


def motif():
    parts = [board(), porthole_plate(CX, CY).plate_svg()]
    fade = 'transition: opacity var(--seance-fade, 0.8s) ease'
    for k in range(N):
        n = k + 1
        hand = hand_plate(seat_transform(k), seed=n)[0].plate_svg()
        parts.append(f'<g style="color: var(--seance-hand-{n}, currentColor)">'
                     f'<g style="opacity: var(--seance-seat-{n}, 1); {fade}">{hand}</g>'
                     f'<g style="opacity: calc(0.35 + 0.65 * var(--seance-seat-{n}, 1)); {fade}">{mark_svg(k)}</g></g>')
    return ''.join(parts)


def clearance():
    """The narrowest gap between two neighbouring hands, in plate units (for tuning HAND_S)."""
    outs = [seat_transform(k)(make_hand(k + 1)['outline']) for k in range(N)]
    best = 1e9
    for k in range(N):
        A, B = outs[k], outs[(k + 1) % N]
        for p in A[::3]:
            for q in B[::3]:
                best = min(best, math.hypot(p[0] - q[0], p[1] - q[1]))
    return best


def main():
    os.makedirs(OUT, exist_ok=True)
    body = motif()
    head = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240" width="240" height="240">'
    with open(os.path.join(OUT, 'seance.svg'), 'w') as fh:
        fh.write(head + '<title>The séance</title><desc>Twelve hands laid round a porthole, their fingertips on its rim, '
                 'and the twelve marks of the Drowned Script round the edge like the letters of a talking board.</desc>'
                 + body + '</svg>\n')
    hand = hand_plate(lambda P: list(P))[0].plate_svg()
    sprite = ('<svg xmlns="http://www.w3.org/2000/svg" style="display:none">'
              f'<symbol id="seance" viewBox="0 0 240 240">{body}</symbol>'
              f'<symbol id="seance-hand" viewBox="-21 -21 33 60">{hand}</symbol>'
              f'<symbol id="seance-candle" viewBox="-11 -35 22 37">{candle_svg()}</symbol>'
              f'<symbol id="seance-flame" viewBox="-8.5 -35 17 17">{flame_svg("--seance-lit", "var(--seance-flame, currentColor)")}</symbol>'
              f'<symbol id="seance-porthole" viewBox="-42 -42 84 84">{porthole_plate(0, 0).plate_svg()}</symbol>'
              '</svg>\n')
    with open(os.path.join(OUT, 'seance-sprite.svg'), 'w') as fh:
        fh.write(sprite)
    print(f'séance drawn: {len(body) // 1024} KB for the table; narrowest gap between hands {clearance():.1f}')


if __name__ == '__main__':
    main()
