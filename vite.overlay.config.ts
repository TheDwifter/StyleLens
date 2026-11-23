import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Dedicated IIFE build for the on-demand content script overlay.
 * Bundling as a single self-contained IIFE guarantees `chrome.scripting.executeScript`
 * works on strict CSP sites without exposing `web_accessible_resources`.
 */
export default defineConfig({
  publicDir: false,
  build: {
    outDir: 'dist/content',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
    lib: {
      entry: resolve(__dirname, 'src/content/overlay.ts'),
      name: 'StyleLensOverlay',
      formats: ['iife'],
      fileName: () => 'overlay.js',
    },
    rollupOptions: {
      output: {
        extend: true,
      },
    },
  },
});
