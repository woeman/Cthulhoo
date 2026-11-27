import { defineConfig, type Plugin } from 'vitest/config';

// Public files that are not part of the bundle but belong in the offline cache.
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/app-icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/icon-monochrome-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Writes sw.js at build time with the exact list of hashed files, so an
 * installed copy of the game plays offline and updates itself on the next visit.
 */
function serviceWorker(): Plugin {
  return {
    name: 'cthulhoo-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter((f) => !f.endsWith('.map'));
      const files = ['./', ...[...built, ...PUBLIC_FILES].map((f) => `./${f}`)];
      const version = fnv(files.join('|'));
      const source = `// Generated at build time. Network first for the page, cache first for hashed files.
const CACHE = 'cthulhoo-${version}';
const FILES = ${JSON.stringify(files)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cthulhoo-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Static hosts add Vary headers (Origin, Accept-Encoding) that would make cached files miss.
const MATCH = { ignoreVary: true, ignoreSearch: false };
const slow = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), ms));

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    event.respondWith(
      Promise.race([fetch(req), slow(4000)])
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./', copy));
          }
          return res;
        })
        .catch(() => caches.match('./', MATCH)),
    );
    return;
  }
  event.respondWith(
    caches.match(req, MATCH).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.includes('/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
`;
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

// Relative base so the same build works on GitHub Pages (/Cthulhoo/),
// inside a native wrapper (Capacitor) and from any static host.
// The claude.ai preview (`--mode artifact`) is served as one file, so there
// everything loaded on demand (the specimen plates) goes into the one script.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [serviceWorker()],
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: false,
    rolldownOptions: mode === 'artifact' ? { output: { codeSplitting: false } } : {},
  },
  server: { host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
}));
