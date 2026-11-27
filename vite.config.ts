import { defineConfig } from 'vitest/config';

// Relative base so the same build works on GitHub Pages (/Cthulhoo/),
// inside a native wrapper (Capacitor) and from any static host.
export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: false,
  },
  server: { host: true },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
