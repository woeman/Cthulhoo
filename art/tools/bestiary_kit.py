"""The engraver's kit for the bestiary plates (used by draw_bestiary.py).

A plate is built from parts, drawn in order (painter's order):
  body    a closed outline: a body fill, burin hatching on its shadow side, and a contour that
          swells where it turns away from the light
  thread  an open stroke that belongs to the animal (tentacles, threads, antennae, fin rays)
  solid   a small filled shape that belongs to the animal (teeth, spines, claws)
  line    a detail stroke, plate only (ribs, rings, folds)
  dots    stipple, plate only
  eye     an empty ring, plate only: preserved specimens do not look back
  glow    a living light (photophore, lure), class b-glow
Every plate renders twice: the engraving, and the silhouette (bodies, threads, solids and
lights filled, nothing else), for creatures not yet found.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from svgkit import normal, rng  # noqa: E402

LIGHT = (-0.6, -0.8)          # unit vector towards the light: upper left, as on every plate
S = 240                       # the canvas


def f1(v):
    s = f"{v:.1f}"
    if s.endswith('.0'):
        s = s[:-2]
    return '0' if s in ('-0', '') else s


def p1(p):
    return f"{f1(p[0])} {f1(p[1])}"


TOL = 0.16                    # how far a simplified outline may stray, in canvas units


def _rdp(P, tol):
    """Ramer-Douglas-Peucker: drop points that a straight segment already explains."""
    if len(P) < 3:
        return list(P)
    keep = [False] * len(P)
    keep[0] = keep[-1] = True
    stack = [(0, len(P) - 1)]
    while stack:
        i, j = stack.pop()
        (x0, y0), (x1, y1) = P[i], P[j]
        dx, dy = x1 - x0, y1 - y0
        L = math.hypot(dx, dy) or 1e-9
        best, k = -1.0, -1
        for m in range(i + 1, j):
            d = abs((P[m][0] - x0) * dy - (P[m][1] - y0) * dx) / L
            if d > best:
                best, k = d, m
        if best > tol:
            keep[k] = True
            stack += [(i, k), (k, j)]
    return [q for q, kp in zip(P, keep) if kp]


def polyline(P, close=True, tol=TOL):
    if tol and len(P) > 8:
        if close:
            k = len(P) // 2
            P = _rdp(list(P[:k + 1]), tol)[:-1] + _rdp(list(P[k:]) + [P[0]], tol)[:-1]
        else:
            P = _rdp(list(P), tol)
    # relative moves between rounded points: shorter, and no drift
    q = [(round(x, 1), round(y, 1)) for x, y in P]
    d = 'M' + p1(q[0])
    for (x0, y0), (x1, y1) in zip(q, q[1:]):
        dx, dy = f1(x1 - x0), f1(y1 - y0)
        if dx == '0' and dy == '0':
            continue
        d += 'l' + dx + ('' if dy.startswith('-') else ' ') + dy
    return d + ('Z' if close else '')


# ------------------------------------------------------------------ curves

def spline(points, close=True, n=8, tension=1.0):
    """Dense points along the Catmull-Rom spline that svgkit.smooth() draws."""
    N = len(points)
    if N < 3:
        return list(points)
    out = []
    for i in (range(N) if close else range(N - 1)):
        p0 = points[(i - 1) % N] if (close or i > 0) else points[i]
        a = points[i]
        b = points[(i + 1) % N]
        p3 = points[(i + 2) % N] if (close or i + 2 < N) else points[(i + 1) % N]
        c1 = (a[0] + (b[0] - p0[0]) / 6 * tension, a[1] + (b[1] - p0[1]) / 6 * tension)
        c2 = (b[0] - (p3[0] - a[0]) / 6 * tension, b[1] - (p3[1] - a[1]) / 6 * tension)
        for k in range(n):
            t = k / n
            u = 1 - t
            out.append((u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
                        u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]))
    if not close:
        out.append(points[-1])
    return out


def offset_sides(spine, widths):
    n = len(spine)
    left, right = [], []
    for i in range(n):
        a = spine[max(0, i - 1)]
        b = spine[min(n - 1, i + 1)]
        nx, ny = normal(a, b)
        w = widths[i] if isinstance(widths, (list, tuple)) else widths
        left.append((spine[i][0] + nx * w, spine[i][1] + ny * w))
        right.append((spine[i][0] - nx * w, spine[i][1] - ny * w))
    return left, right


def limb_outline(spine, widths, n=6):
    """Closed outline round a spine with per-point half widths (a tapering limb)."""
    sp = spline(spine, False, n)
    m = len(sp)
    if callable(widths):
        ws = [widths(i / (m - 1)) for i in range(m)]
    else:
        ws = [_lerp_list(widths, i / (m - 1)) for i in range(m)]
    left, right = offset_sides(sp, ws)
    return left + right[::-1]


def _lerp_list(vals, t):
    if len(vals) == 1:
        return vals[0]
    x = t * (len(vals) - 1)
    i = min(len(vals) - 2, int(x))
    u = x - i
    return vals[i] * (1 - u) + vals[i + 1] * u


def resample_closed(P, step):
    out = []
    n = len(P)
    acc = 0.0
    out.append(P[0])
    for i in range(n):
        a, b = P[i], P[(i + 1) % n]
        seg = math.dist(a, b)
        pos = step - acc
        while pos <= seg:
            t = pos / seg if seg else 0
            out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
            pos += step
        acc = seg - (pos - step)
    return out[:-1] if len(out) > 2 and math.dist(out[-1], out[0]) < step * 0.5 else out


def signed_area(P):
    n = len(P)
    return sum(P[i][0] * P[(i + 1) % n][1] - P[(i + 1) % n][0] * P[i][1] for i in range(n)) / 2


def bbox(P):
    xs = [p[0] for p in P]
    ys = [p[1] for p in P]
    return min(xs), min(ys), max(xs), max(ys)


def xform(P, cx=0, cy=0, s=1.0, rot=0.0, dx=0, dy=0):
    a = math.radians(rot)
    c, si = math.cos(a), math.sin(a)
    return [(cx + dx + (x - cx) * s * c - (y - cy) * s * si, cy + dy + (x - cx) * s * si + (y - cy) * s * c) for x, y in P]


def circle_pts(cx, cy, r, n=28, rx=None, ry=None, rot=0.0):
    rx = r if rx is None else rx
    ry = r if ry is None else ry
    a0 = math.radians(rot)
    out = []
    for k in range(n):
        t = math.tau * k / n
        x, y = rx * math.cos(t), ry * math.sin(t)
        out.append((cx + x * math.cos(a0) - y * math.sin(a0), cy + x * math.sin(a0) + y * math.cos(a0)))
    return out


# ------------------------------------------------------------------ the burin

def band(P, w_lit=0.42, w_dark=1.3):
    """A contour as a filled band, thin where the outline faces the light and swelling where it
    turns away, as a burin cuts deeper on the shadow side."""
    n = len(P)
    sgn = 1 if signed_area(P) > 0 else -1
    outer, inner = [], []
    for i in range(n):
        a, b = P[i - 1], P[(i + 1) % n]
        nx, ny = normal(a, b)
        nx, ny = -sgn * nx, -sgn * ny                  # outward
        d = -(nx * LIGHT[0] + ny * LIGHT[1])           # > 0 facing away from the light
        t = min(1.0, max(0.0, (d + 0.3) / 1.15))
        t = t * t * (3 - 2 * t)
        w = w_lit + (w_dark - w_lit) * t
        x, y = P[i]
        outer.append((x + nx * w, y + ny * w))
        inner.append((x - nx * w, y - ny * w))
    return polyline(outer) + polyline(inner[::-1])


def stroke_band(spine, w0, w1=None, taper='both', wind=0):
    """An open burin stroke. taper: 'both' swells in the middle and fines at the ends; 'end'
    starts full and fines to a point (tentacles, threads); False keeps an even width."""
    n = len(spine)
    w1 = w0 if w1 is None else w1
    ws = []
    for i in range(n):
        t = i / (n - 1) if n > 1 else 0
        w = w0 + (w1 - w0) * t
        if taper == 'end':
            w *= 0.22 + 0.78 * (1 - t) ** 0.7
        elif taper:
            w *= 0.35 + 0.65 * math.sin(math.pi * min(1, max(0, t))) ** 0.5
        ws.append(w)
    left, right = offset_sides(spine, ws)
    P = left + right[::-1]
    if wind and signed_area(P) * wind < 0:
        P = P[::-1]
    return polyline(P)


def lens(a, b, w):
    """One burin cut from a to b: a thin lens, widest (2w) in the middle. Relative coordinates."""
    nx, ny = normal(a, b)
    hx, hy = (b[0] - a[0]) / 2, (b[1] - a[1]) / 2
    ax, ay = round(a[0], 1), round(a[1], 1)
    bx, by = round(a[0] + 2 * hx - ax, 1), round(a[1] + 2 * hy - ay, 1)
    c1 = (hx + nx * w * 2, hy + ny * w * 2)
    c2 = (-hx - nx * w * 2, -hy - ny * w * 2)
    return f"M{f1(ax)} {f1(ay)}q{p1(c1)} {f1(bx)} {f1(by)}q{p1(c2)} {f1(-bx)} {f1(-by)}z"


def _intervals(rings, y):
    xs = []
    for P in rings:
        n = len(P)
        for i in range(n):
            x0, y0 = P[i]
            x1, y1 = P[(i + 1) % n]
            if (y0 <= y < y1) or (y1 <= y < y0):
                xs.append(x0 + (y - y0) * (x1 - x0) / (y1 - y0))
    xs.sort()
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]


def _subtract(A, B):
    out = []
    for a0, a1 in A:
        segs = [(a0, a1)]
        for b0, b1 in B:
            nxt = []
            for s0, s1 in segs:
                if b1 <= s0 or b0 >= s1:
                    nxt.append((s0, s1))
                    continue
                if b0 > s0:
                    nxt.append((s0, b0))
                if b1 < s1:
                    nxt.append((b1, s1))
            segs = nxt
        out += segs
    return out


def _intersect(A, B):
    out = []
    for a0, a1 in A:
        for b0, b1 in B:
            lo, hi = max(a0, b0), min(a1, b1)
            if hi > lo:
                out.append((lo, hi))
    return out


def hatch(rings, angle, spacing, shift=None, width=0.4, within=None, without=None, seed=1, jitter=0.6, minlen=1.4, inset=0.0):
    """Burin strokes at `angle` degrees (screen, clockwise) inside `rings` (even-odd).
    shift: only the shadow side, the shape minus itself moved this far towards the light."""
    a = math.radians(angle)
    ca, sa = math.cos(-a), math.sin(-a)
    cb, sb = math.cos(a), math.sin(a)

    def into(p):
        return (p[0] * ca - p[1] * sa, p[0] * sa + p[1] * ca)

    def back(p):
        return (p[0] * cb - p[1] * sb, p[0] * sb + p[1] * cb)

    rr = [[into(p) for p in P] for P in rings]
    lit = None
    if shift:
        v = into((LIGHT[0] * shift, LIGHT[1] * shift))
        lit = [[(x + v[0], y + v[1]) for x, y in P] for P in rr]
    win = [[into(p) for p in P] for P in within] if within else None
    wout = [[into(p) for p in P] for P in without] if without else None
    ys = [y for P in rr for _, y in P]
    r = rng(seed)
    out = []
    y = min(ys) + spacing * (0.5 + 0.4 * r.random())
    while y < max(ys):
        iv = _intervals(rr, y)
        if lit:
            iv = _subtract(iv, _intervals(lit, y))
        if win:
            iv = _intersect(iv, _intervals(win, y))
        if wout:
            iv = _subtract(iv, _intervals(wout, y))
        for x0, x1 in iv:
            x0 += inset + r.uniform(0, jitter)
            x1 -= inset + r.uniform(0, jitter)
            if x1 - x0 < minlen:
                continue
            a_, b_ = back((x0, y)), back((x1, y))
            ax, ay = round(a_[0], 1), round(a_[1], 1)
            out.append(f"M{f1(ax)} {f1(ay)}l{f1(b_[0] - ax)} {f1(b_[1] - ay)}")
        y += spacing
    return out


# ------------------------------------------------------------------ the plate

class Plate:
    def __init__(self, key, title, desc, mythic=False, hatch_angles=(-30, 55)):
        self.key, self.title, self.desc, self.mythic = key, title, desc, mythic
        self.angles = hatch_angles
        self.parts = []
        self.r = rng(sum(map(ord, key)))

    # ---- parts
    def body(self, ctrl, holes=(), n=8, shade=1.0, dark=0.0, hatch=True, contour=(0.42, 1.3), dense=False, spacing=None,
             glass=False, sil=True):
        """A closed outline. ctrl: spline control points (or dense points with dense=True).
        shade scales the shadow; dark (0..1) adds hatching across the lit side too.
        glass: a clear part (a dome, a bell): a fine contour and nothing inside it."""
        P = list(ctrl) if dense else spline(ctrl, True, n)
        H = [list(h) if dense else spline(h, True, n) for h in holes]
        if glass:
            hatch, contour = False, (0.26, 0.62)
        self.parts.append(('body', dict(P=P, H=H, shade=shade, dark=dark, hatch=hatch, contour=contour, spacing=spacing,
                                        glass=glass, sil=sil)))
        return P

    def limb(self, spine, widths, n=6, **kw):
        return self.body(limb_outline(spine, widths, n), dense=True, **kw)

    def thread(self, pts, w=0.6, sil=None, n=6, taper='end', smooth=True):
        sp = spline(pts, False, n) if smooth and len(pts) > 2 else list(pts)
        self.parts.append(('thread', dict(sp=sp, w=w, sil=sil if sil is not None else max(w, 0.9), taper=taper)))
        return sp

    def solid(self, P, sil=True):
        self.parts.append(('solid', dict(P=P, sil=sil)))

    def line(self, pts, w=0.5, n=6, smooth=True, taper=True, op=1.0, close=False):
        if close:
            sp = spline(pts, True, n) if smooth else list(pts)
            sp = sp + [sp[0]]
        else:
            sp = spline(pts, False, n) if smooth and len(pts) > 2 else list(pts)
        self.parts.append(('line', dict(sp=sp, w=w, taper=taper, op=op)))
        return sp

    def dots(self, pts, r=0.45, op=1.0):
        self.parts.append(('dots', dict(pts=pts, r=r, op=op)))

    def hatching(self, rings, angle, spacing, **kw):
        """Free hatching (a cast shadow, the sea floor), plate only."""
        self.parts.append(('hatch', dict(d=hatch(rings, angle, spacing, **kw))))

    def eye(self, cx, cy, r, w=0.55, ry=None, rot=0.0, fill=True):
        self.parts.append(('eye', dict(cx=cx, cy=cy, r=r, w=w, ry=ry, rot=rot, fill=fill)))

    def glow(self, cx, cy, r=1.6):
        self.parts.append(('glow', dict(cx=cx, cy=cy, r=r)))

    def pupil(self, P):
        self.parts.append(('pupil', dict(P=P)))

    def raw(self, markup, sil=None):
        """Markup dropped in as it is (an inscription); sil is what the silhouette gets, if anything."""
        self.parts.append(('raw', dict(markup=markup, sil=sil)))

    # ---- rendering
    def _body_svg(self, d, i):
        P, H = d['P'], d['H']
        rings = [P] + H
        x0, y0, x1, y1 = bbox(P)
        size = min(x1 - x0, y1 - y0)
        out = [] if d['glass'] else [f'<path fill="var(--beast-body, none)" fill-rule="evenodd" d="{"".join(polyline(R, tol=0.35) for R in rings)}"/>']
        if d['hatch']:
            sp = d['spacing'] or (2.6 if size < 40 else 3.0)
            a1, a2 = self.angles
            small = size < 22
            sets = []                          # (stroke width, cuts): the second set is cut finer, deeper in the shadow
            if d['dark'] > 0:
                sets.append((0.62, hatch(rings, a1, sp * (1.25 - 0.25 * d['dark']), seed=i * 7 + 1, inset=0.6)))
                if not small:
                    sets.append((0.68, hatch(rings, a2, sp * 1.15, shift=size * 0.32 * d['shade'], seed=i * 7 + 2, inset=0.6)))
            else:
                sets.append((0.72, hatch(rings, a1, sp, shift=size * 0.34 * d['shade'], seed=i * 7 + 1, inset=0.6)))
                if not small:
                    sets.append((0.66, hatch(rings, a2, sp * 1.15, shift=size * 0.15 * d['shade'], seed=i * 7 + 2, inset=0.6)))
            if self.mythic and size > 36:     # the wrong angle, six degrees off true
                sets.append((0.56, hatch(rings, 84, sp * 1.3, shift=size * 0.22 * d['shade'], seed=i * 7 + 3, inset=0.6)))
            for sw, cuts in sets:
                if cuts:
                    out.append(f'<path fill="none" stroke="currentColor" stroke-width="{sw}" stroke-linecap="round" d="{"".join(cuts)}"/>')
        lo, hi = d['contour']
        out.append(f'<path fill-rule="evenodd" d="{band(P, lo, hi)}{"".join(band(h, lo * 0.8, hi * 0.7) for h in H)}"/>')
        return ''.join(out)

    def plate_svg(self):
        out = []
        for i, (kind, d) in enumerate(self.parts):
            if kind == 'body':
                out.append(self._body_svg(d, i))
            elif kind == 'thread':
                out.append(f'<path d="{stroke_band(d["sp"], d["w"], taper=d["taper"])}"/>')
            elif kind == 'solid':
                out.append(f'<path d="{polyline(d["P"])}"/>')
            elif kind == 'line':
                op = f' opacity="{d["op"]}"' if d['op'] < 1 else ''
                out.append(f'<path{op} d="{stroke_band(d["sp"], d["w"], taper=d["taper"])}"/>')
            elif kind == 'dots':
                op = f' opacity="{d["op"]}"' if d['op'] < 1 else ''
                out.append(f'<path{op} d="' + ''.join(_dot(x, y, d['r']) for x, y in d['pts']) + '"/>')
            elif kind == 'hatch':
                if d['d']:
                    out.append(f'<path fill="none" stroke="currentColor" stroke-width="0.6" stroke-linecap="round" d="{"".join(d["d"])}"/>')
            elif kind == 'eye':
                cx, cy, r, w = d['cx'], d['cy'], d['r'], d['w']
                ry = d['ry'] or r
                ring = _ellipse(cx, cy, r + w, ry + w, d['rot']) + _ellipse(cx, cy, max(0.2, r - w), max(0.2, ry - w), d['rot'])
                knock = f'<path fill="var(--beast-body, none)" d="{_ellipse(cx, cy, r, ry, d["rot"])}"/>' if d['fill'] else ''
                out.append(f'{knock}<path fill-rule="evenodd" d="{ring}"/>')
            elif kind == 'glow':
                out.append(f'<path class="b-glow" fill="var(--beast-glow, currentColor)" style="filter: var(--beast-glow-filter, none)" d="{_dot(d["cx"], d["cy"], d["r"])}"/>')
            elif kind == 'pupil':
                out.append(f'<path fill="var(--beast-pupil, currentColor)" d="{polyline(d["P"])}"/>')
            elif kind == 'raw':
                out.append(d['markup'])
        return '<g fill="currentColor">' + ''.join(out) + '</g>'

    def silhouette_svg(self):
        out, glows = [], []
        wind = lambda P, sign=1: P if signed_area(P) * sign > 0 else P[::-1]  # noqa: E731
        for kind, d in self.parts:
            if kind == 'body' and d['sil']:
                out.append(polyline(wind(d['P'])) + ''.join(polyline(wind(h, -1)) for h in d['H']))
            elif kind == 'thread':
                out.append(stroke_band(d['sp'], d['sil'], taper=d['taper'], wind=1))
            elif kind == 'solid' and d['sil']:
                out.append(polyline(wind(d['P'])))
            elif kind == 'glow':
                glows.append(_dot(d['cx'], d['cy'], d['r']))
            elif kind == 'pupil':
                out.append(polyline(wind(d['P'])))
        s = f'<path fill="currentColor" d="{"".join(out)}"/>'
        if glows:
            s += f'<path class="b-glow" fill="var(--beast-glow, currentColor)" style="filter: var(--beast-glow-filter, none)" d="{"".join(glows)}"/>'
        return s


def _ellipse(cx, cy, rx, ry, rot=0.0):
    a = math.radians(rot)
    dx, dy = rx * math.cos(a), rx * math.sin(a)
    return (f"M{f1(cx - dx)} {f1(cy - dy)}a{f1(rx)} {f1(ry)} {f1(rot)} 1 0 {f1(2 * dx)} {f1(2 * dy)}"
            f"a{f1(rx)} {f1(ry)} {f1(rot)} 1 0 {f1(-2 * dx)} {f1(-2 * dy)}Z")


def _dot(x, y, r):
    return f"M{f1(x - r)} {f1(y)}a{f1(r)} {f1(r)} 0 1 0 {f1(2 * r)} 0a{f1(r)} {f1(r)} 0 1 0 {f1(-2 * r)} 0Z"


def scatter(r, n, test, box, min_d=0.0):
    """n random points inside box that pass test(x, y), kept min_d apart."""
    x0, y0, x1, y1 = box
    out = []
    tries = 0
    while len(out) < n and tries < n * 60:
        tries += 1
        x, y = r.uniform(x0, x1), r.uniform(y0, y1)
        if not test(x, y):
            continue
        if min_d and any((x - a) ** 2 + (y - b) ** 2 < min_d * min_d for a, b in out):
            continue
        out.append((x, y))
    return out


def inside(P, x, y):
    c = False
    n = len(P)
    for i in range(n):
        x0, y0 = P[i]
        x1, y1 = P[(i + 1) % n]
        if (y0 > y) != (y1 > y) and x < x0 + (y - y0) * (x1 - x0) / (y1 - y0):
            c = not c
    return c
