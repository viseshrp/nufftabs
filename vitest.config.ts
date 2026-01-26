import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: 'coverage',
      thresholds: {
        statements: 90,
        branches: 90,
        functions: 90,
        lines: 90,
      },
      include: ['entrypoints/**/*.ts'],
      // Exclude DOM-heavy glue code; behavior is validated via Playwright E2E coverage.
      exclude: ['**/*.d.ts', 'entrypoints/nufftabs/index.ts'],
    },
  },
});
