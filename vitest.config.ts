import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          include: ['apps/api/src/**/*.test.ts', 'packages/*/src/**/*.test.ts'],
        },
      },
      // Brings its own environment (happy-dom) and Vite plugins from its config.
      'apps/web',
    ],
  },
});
