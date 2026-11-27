"""Small helpers for drawing Cthulhoo's SVG assets procedurally.

No dependencies beyond the Python standard library (fontTools only where fonts are read).
Coordinates are plain floats; everything is rounded to 2 decimals on output.
"""
import math
import random

TAU = math.tau


def f(v):
    """Format a number compactly."""
    s = f"{v:.2f}".rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def pt(p):
    return f"{f(p[0])} {f(p[1])}"


def poly(points, close=True):
    """Straight-segment path."""
    d = 'M' + pt(points[0]) + ''.join(' L' + pt(p) for p in points[1:])
    return d + (' Z' if close else '')


def smooth(points, close=False, tension=1.0):
    """Catmull-Rom spline through points, emitted as cubic Béziers."""
    n = len(points)
    if n < 3:
        return poly(points, close)
    pts = points[:]
    d = 'M' + pt(pts[0])
    rng = range(n) if close else range(n - 1)
    for i in rng:
        p0 = pts[(i - 1) % n] if (close or i > 0) else pts[i]
        p1 = pts[i]
        p2 = pts[(i + 1) % n]
        p3 = pts[(i + 2) % n] if (close or i + 2 < n) else pts[(i + 1) % n]
        c1 = (p1[0] + (p2[0] - p0[0]) / 6 * tension, p1[1] + (p2[1] - p0[1]) / 6 * tension)
        c2 = (p2[0] - (p3[0] - p1[0]) / 6 * tension, p2[1] - (p3[1] - p1[1]) / 6 * tension)
        d += f" C{pt(c1)} {pt(c2)} {pt(p2)}"
    return d + (' Z' if close else '')


def circle_path(cx, cy, r, ccw=False):
    """A circle as a path (two arcs). ccw flips winding, useful for evenodd holes."""
    sweep = 0 if ccw else 1
    return (f"M{f(cx + r)} {f(cy)} A{f(r)} {f(r)} 0 1 {sweep} {f(cx - r)} {f(cy)} "
            f"A{f(r)} {f(r)} 0 1 {sweep} {f(cx + r)} {f(cy)} Z")


def ring_path(cx, cy, r_out, r_in):
    return circle_path(cx, cy, r_out) + ' ' + circle_path(cx, cy, r_in, ccw=True)


def polar(cx, cy, r, a):
    return (cx + r * math.cos(a), cy + r * math.sin(a))


def normal(p0, p1):
    dx, dy = p1[0] - p0[0], p1[1] - p0[1]
    L = math.hypot(dx, dy) or 1.0
    return (-dy / L, dx / L)


def tapered(spine, widths, cap=True):
    """Closed outline around a spine (list of points) with per-point half widths.
    Like a burin stroke: swell and taper. Returns a smooth closed path."""
    n = len(spine)
    left, right = [], []
    for i in range(n):
        a = spine[max(0, i - 1)]
        b = spine[min(n - 1, i + 1)]
        nx, ny = normal(a, b)
        w = widths[i]
        left.append((spine[i][0] + nx * w, spine[i][1] + ny * w))
        right.append((spine[i][0] - nx * w, spine[i][1] - ny * w))
    outline = left + right[::-1]
    return smooth(outline, close=True)


def resample(points, step):
    """Even spacing along a polyline."""
    out = [points[0]]
    acc = 0.0
    for a, b in zip(points, points[1:]):
        seg = math.dist(a, b)
        while acc + seg >= step:
            t = (step - acc) / seg
            a = (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
            out.append(a)
            seg = math.dist(a, b)
            acc = 0.0
        acc += seg
    if math.dist(out[-1], points[-1]) > step * 0.3:
        out.append(points[-1])
    return out


def svg(width, height, body, viewbox=None, extra_attrs='', title=None, desc=None):
    vb = viewbox or f"0 0 {f(width)} {f(height)}"
    head = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{f(width)}" height="{f(height)}"'
            f'{(" " + extra_attrs) if extra_attrs else ""}>')
    meta = ''
    if title:
        meta += f'<title>{title}</title>'
    if desc:
        meta += f'<desc>{desc}</desc>'
    return head + meta + body + '</svg>\n'


def write(path, text):
    with open(path, 'w', encoding='utf-8') as fh:
        fh.write(text)


def rng(seed):
    return random.Random(seed)
