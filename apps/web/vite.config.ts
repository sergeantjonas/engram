import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The one `.env` lives at the repo root next to the API's. Vite only exposes
  // `VITE_`-prefixed variables to the bundle, so the secrets in that file stay
  // out of it; the API's own variables are simply never read here.
  envDir: '../..',
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react(), tailwindcss()],
  build: {
    // A font inlined into the stylesheet is paid for by every page, where a
    // file is fetched only by a page that draws a character in its range.
    assetsInlineLimit: (file) => (file.endsWith('.woff2') ? false : undefined),
  },
  server: {
    // Baked into the API's `WEB_ORIGIN`, so a fallback port would silently
    // break CORS and the post-login redirect rather than help.
    port: 2011,
    strictPort: true,
  },
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
  },
});
