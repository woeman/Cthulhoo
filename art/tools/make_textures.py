"""Generates Cthulhoo's raster textures. All tiles wrap seamlessly.

    python3 art/tools/make_textures.py

Outputs to art/textures/:
  paper-grain.png  512x512 greyscale. Multiply it over any paper colour: fibres, mottling, plate tone.
  foxing.png       1024x1024 RGBA. Age spots and a tide-mark stain, transparent elsewhere. Surface plates only.
  film-grain.png   256x256 RGBA. Neutral grain for dark water; animate by jumping background-position.
  murk.png         512x512 greyscale. Soft drifting-fog noise for the deep (screen or overlay blend).
Plus SVG pattern tiles for CSS masks: hatch-sea.svg, hatch-30.svg, hatch-cross.svg, stipple.svg.
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'textures')
R = np.random.default_rng(1928)


def blur_wrap(a, sigma):
    """Gaussian blur with wrap-around (via FFT), so the result tiles."""
    h, w = a.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    g = np.exp(-2 * (math.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def norm(a):
    a = a - a.min()
    return a / (a.max() or 1)


def octaves(size, sigmas, weights):
    acc = np.zeros((size, size))
    for s, w in zip(sigmas, weights):
        acc += w * norm(blur_wrap(R.standard_normal((size, size)), s))
    return norm(acc)


def paper_grain():
    S = 512
    mottle = octaves(S, [40, 14, 5], [0.55, 0.3, 0.15])
    tooth = norm(blur_wrap(R.standard_normal((S, S)), 0.7))
    # fibres: short curved strokes, drawn on a 3x canvas and folded back so they wrap
    big = Image.new('L', (S * 3, S * 3), 0)
    d = ImageDraw.Draw(big)
    for _ in range(900):
        x, y = R.uniform(S, 2 * S), R.uniform(S, 2 * S)
        a = R.uniform(0, math.pi)
        L = R.uniform(6, 30)
        pts = []
        for k in range(6):
            t = k / 5
            a2 = a + 0.4 * math.sin(t * 3 + x)
            pts.append((x + math.cos(a2) * L * t, y + math.sin(a2) * L * t))
        d.line(pts, fill=int(R.uniform(40, 120)), width=1)
    big = np.asarray(big.filter(ImageFilter.GaussianBlur(0.6)), dtype=float) / 255
    fib = np.zeros((S, S))
    for i in range(3):
        for j in range(3):
            fib += big[i * S:(i + 1) * S, j * S:(j + 1) * S]
    fib = np.clip(fib, 0, 1)
    v = 1.0 - 0.10 * mottle - 0.05 * tooth - 0.10 * fib
    img = Image.fromarray(np.uint8(np.clip(v, 0, 1) * 255), 'L')
    img.save(os.path.join(OUT, 'paper-grain.png'), optimize=True)


def foxing():
    S = 1024
    yy, xx = np.mgrid[0:S, 0:S] / S
    alpha = np.zeros((S, S))
    # spots, more of them near the edges
    for _ in range(140):
        edge = R.random() < 0.75
        if edge:
            side = R.integers(4)
            u, v = R.uniform(0, 1), R.uniform(0, 0.16)
            cx, cy = [(u, v), (1 - v, u), (u, 1 - v), (v, u)][side]
        else:
            cx, cy = R.uniform(0.1, 0.9), R.uniform(0.1, 0.9)
        r = R.uniform(0.002, 0.018) * (1.6 if R.random() < 0.1 else 1)
        dd = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        ring = np.exp(-((dd - r) / (r * 0.35 + 1e-4)) ** 2) * 0.5 + np.exp(-(dd / (r + 1e-4)) ** 2) * 0.6
        alpha = np.maximum(alpha, ring * R.uniform(0.25, 0.6))
    # a tide mark: an irregular ring of darker stain
    n = norm(blur_wrap(R.standard_normal((S, S)), 30))
    dd = np.sqrt((xx - 0.78) ** 2 + (yy - 0.82) ** 2) + (n - 0.5) * 0.08
    tide = np.exp(-((dd - 0.33) / 0.012) ** 2) * 0.35 + (dd < 0.33) * 0.05
    alpha = np.clip(np.maximum(alpha, tide), 0, 0.75)
    rgba = np.zeros((S, S, 4), dtype=np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2] = 110, 72, 34      # rust-brown iron gall foxing
    rgba[..., 3] = np.uint8(alpha * 255)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'foxing.png'), optimize=True)


def film_grain():
    S = 256
    g = R.standard_normal((S, S))
    g = 0.65 * g + 0.35 * blur_wrap(R.standard_normal((S, S)), 0.8) * 3
    g = norm(g)
    rgba = np.zeros((S, S, 4), dtype=np.uint8)
    lum = np.uint8(np.where(g > 0.5, 255, 0))
    rgba[..., 0] = rgba[..., 1] = rgba[..., 2] = lum
    rgba[..., 3] = np.uint8(np.abs(g - 0.5) * 2 * 70)
    Image.fromarray(rgba, 'RGBA').save(os.path.join(OUT, 'film-grain.png'), optimize=True)


def murk():
    S = 512
    m = octaves(S, [60, 24, 9], [0.6, 0.3, 0.1])
    m = np.clip((m - 0.35) / 0.5, 0, 1) ** 1.4
    Image.fromarray(np.uint8(m * 255), 'L').save(os.path.join(OUT, 'murk.png'), optimize=True)


PATTERNS = {
    # wavy engraved-sea lines, 6 px apart (tile 48 x 12)
    'hatch-sea.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="12" viewBox="0 0 48 12">'
                     '<path d="M0 3 C8 1.6 16 1.6 24 3 S40 4.4 48 3 M0 9 C8 7.6 16 7.6 24 9 S40 10.4 48 9" '
                     'fill="none" stroke="#000" stroke-width="1.1"/></svg>',
    'hatch-30.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="6.928" viewBox="0 0 12 6.928">'
                    '<path d="M0 6.928 L12 0 M-6 6.928 L6 0 M6 6.928 L18 0" stroke="#000" stroke-width="0.9"/></svg>',
    'hatch-cross.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8" viewBox="0 0 8 8">'
                       '<path d="M0 8 L8 0 M-4 4 L4 -4 M4 12 L12 4 M0 0 L8 8 M-4 4 L4 12 M4 -4 L12 4" stroke="#000" stroke-width="0.8"/></svg>',
    'stipple.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">'
                   '<circle cx="2" cy="3" r="0.8"/><circle cx="9" cy="1.5" r="0.6"/><circle cx="13.5" cy="6" r="0.9"/>'
                   '<circle cx="5.5" cy="8.5" r="0.7"/><circle cx="11" cy="12" r="0.6"/><circle cx="2.5" cy="13.5" r="0.9"/>'
                   '<circle cx="7.5" cy="14.5" r="0.5"/><circle cx="14.5" cy="15" r="0.6"/></svg>',
}


def main():
    os.makedirs(OUT, exist_ok=True)
    paper_grain()
    foxing()
    film_grain()
    murk()
    for name, s in PATTERNS.items():
        with open(os.path.join(OUT, name), 'w') as fh:
            fh.write(s + '\n')
    print('textures written to', OUT)


if __name__ == '__main__':
    main()
