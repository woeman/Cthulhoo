"""Writes Cthulhoo's UI icons (24 grid, 1.5 stroke, round caps, currentColor).

    python3 art/tools/draw_icons.py

Nautical, 1920s-instrument flavour: a bell for sound, a lantern for streaks,
a bottle for sharing, a valve wheel for settings, a cairn for the leaderboard.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
from svgkit import f, polar, svg, write

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
OUT = os.path.join(ROOT, 'icons')


def wheel():
    out = '<circle cx="12" cy="12" r="7.6"/><circle cx="12" cy="12" r="2.1"/>'
    for k in range(5):
        a = math.radians(-90 + 72 * k)
        x0, y0 = polar(12, 12, 2.1, a)
        x1, y1 = polar(12, 12, 7.6, a)
        kx, ky = polar(12, 12, 9.7, a)
        out += f'<path d="M{f(x0)} {f(y0)} L{f(x1)} {f(y1)}"/>'
        out += f'<circle cx="{f(kx)}" cy="{f(ky)}" r="1.25" fill="currentColor" stroke="none"/>'
    return out


ICONS = {
    'close':      ('Close', '<path d="M6 6 L18 18 M18 6 L6 18"/>'),
    'back':       ('Back', '<path d="M15 5 L8 12 L15 19"/>'),
    'menu':       ('Menu', '<path d="M3 7c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0'
                           'M3 12c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0'
                           'M3 17c1.5-1.5 3-1.5 4.5 0s3 1.5 4.5 0 3-1.5 4.5 0 3 1.5 4.5 0"/>'),
    'descend':    ('Descend', '<path d="M12 3.5 V16.5 M7 11.5 L12 16.5 L17 11.5"/>'
                              '<path d="M3 20.5c1.5-1.4 3-1.4 4.5 0s3 1.4 4.5 0 3-1.4 4.5 0 3 1.4 4.5 0"/>'),
    'share':      ('Share (a message in a bottle)',
                   '<g transform="rotate(35 12 12)"><rect x="8.25" y="9.5" width="7.5" height="11" rx="2.6"/>'
                   '<path d="M10.4 9.5 V6 H13.6 V9.5 M9.9 6 V3.6 H14.1 V6 M10.6 13.2 H13.4 M10.6 15.8 H13.4"/></g>'),
    'settings':   ('Settings (a valve wheel)', wheel()),
    'info':       ('About (an open book)', '<path d="M12 6.8 C10 5.3 6.5 4.9 3.5 5.4 V18.4 C6.5 17.9 10 18.4 12 19.9 '
                                           'C14 18.4 17.5 17.9 20.5 18.4 V5.4 C17.5 4.9 14 5.3 12 6.8 Z M12 6.8 V19.9"/>'),
    'sound-on':   ('Sound on (a ship\'s bell)', '<path d="M5.5 16 V11.6 a4.5 4.5 0 0 1 9 0 V16 l1.6 2 H3.9 Z M10 7.1 V5 M8.5 20.2 a1.5 1.5 0 0 0 3 0"/>'
                                               '<path d="M18.2 9.4 q1.7 2.6 0 5.2 M20.6 7.2 q3.2 4.8 0 9.6"/>'),
    'sound-off':  ('Sound off', '<path d="M5.5 16 V11.6 a4.5 4.5 0 0 1 9 0 V16 l1.6 2 H3.9 Z M10 7.1 V5 M8.5 20.2 a1.5 1.5 0 0 0 3 0"/>'
                                '<path d="M17.5 9.5 L22 14 M22 9.5 L17.5 14"/>'),
    'streak':     ('Streak (a lantern)', '<circle cx="12" cy="3.4" r="1.4"/><path d="M8.6 7 H15.4 L14 4.9 H10 Z '
                                         'M8.6 7 C7.2 10 7.2 16 8.6 19 H15.4 C16.8 16 16.8 10 15.4 7 M7.8 19 H16.2 V21 H7.8 Z"/>'
                                         '<path d="M12 10.4 c1.7 1.9 1.7 3.7 0 5.2 c-1.7 -1.5 -1.7 -3.3 0 -5.2 Z"/>'),
    'daily':      ('Today\'s descent (the moon)', '<path d="M15.2 3.7 A8.6 8.6 0 1 0 20.6 18.2 A7.2 7.2 0 0 1 15.2 3.7 Z"/>'
                                                  '<path d="M18.5 7.5 l0.6 1.4 1.4 0.6 -1.4 0.6 -0.6 1.4 -0.6 -1.4 -1.4 -0.6 1.4 -0.6 Z" fill="currentColor" stroke-width="0.6"/>'),
    'leaderboard': ('The Roll of the Drowned (a cairn)', '<ellipse cx="12" cy="18.6" rx="8" ry="2.7"/><ellipse cx="11.4" cy="13.4" rx="5.6" ry="2.3"/>'
                                                       '<ellipse cx="12.4" cy="8.7" rx="3.4" ry="1.9"/><circle cx="12" cy="5" r="1"/>'),
    'timer':      ('Timer (an hourglass)', '<path d="M6.5 3.5 H17.5 M6.5 20.5 H17.5 M7.6 3.5 C7.6 9 12 9.6 12 12 C12 14.4 7.6 15 7.6 20.5 '
                                           'M16.4 3.5 C16.4 9 12 9.6 12 12 C12 14.4 16.4 15 16.4 20.5"/>'
                                           '<path d="M9.6 18.8 Q12 16 14.4 18.8 Z" fill="currentColor" stroke-width="1"/>'),
    'stats':      ('Your soundings (depth chart)', '<path d="M3.5 4.5 H20.5 M6.5 4.5 V10.5 M10 4.5 V15.5 M13.5 4.5 V12.5 M17 4.5 V18.5"/>'
                                                   '<circle cx="6.5" cy="12.3" r="1.3" fill="currentColor" stroke="none"/>'
                                                   '<circle cx="10" cy="17.3" r="1.3" fill="currentColor" stroke="none"/>'
                                                   '<circle cx="13.5" cy="14.3" r="1.3" fill="currentColor" stroke="none"/>'
                                                   '<circle cx="17" cy="20.3" r="1.3" fill="currentColor" stroke="none"/>'),
    'hint':       ('Hint (an eye opens)', '<path d="M2.5 12 C6 6.2 18 6.2 21.5 12 C18 17.8 6 17.8 2.5 12 Z"/><circle cx="12" cy="12" r="4"/>'
                                          '<path d="M10.1 11.3 L11.05 12.75 L12 11.7 L12.95 12.75 L13.9 11.3" stroke-width="1.2"/>'),
    'depth':      ('Depth (a sounding line)', '<path d="M12 2.5 V14.6 M9.4 5.8 H12 M12 8.8 H14.6 M9.4 11.8 H12 M12 14.6 L14.6 18.6 C14.6 21.2 9.4 21.2 9.4 18.6 Z"/>'),
    'help':       ('How to play', '<circle cx="12" cy="12" r="9.2"/><path d="M9.4 9.6 a2.6 2.6 0 1 1 3.8 2.3 c-0.9 0.5 -1.2 1.1 -1.2 2.1"/>'
                                  '<circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/>'),
    'check':      ('Accepted', '<path d="M5 12.5 L10 17.5 L19 6.5"/>'),
}


def main():
    os.makedirs(OUT, exist_ok=True)
    group = lambda inner: (f'<g fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" '
                           f'stroke-linejoin="round">{inner}</g>')
    symbols = []
    for key, (title, inner) in ICONS.items():
        write(os.path.join(OUT, f'{key}.svg'), svg(24, 24, group(inner), title=title))
        symbols.append(f'<symbol id="i-{key}" viewBox="0 0 24 24"><title>{title}</title>{group(inner)}</symbol>')
    write(os.path.join(OUT, 'sprite.svg'),
          '<svg xmlns="http://www.w3.org/2000/svg" style="display:none">' + ''.join(symbols) + '</svg>\n')
    print(len(ICONS), 'icons written to', OUT)


if __name__ == '__main__':
    main()
