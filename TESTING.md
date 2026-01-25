# TESTING

## Unit + integration tests (with coverage)
```bash
pnpm test
```
- Runs Vitest in CI mode with coverage.
- Coverage reports:
  - Text summary in console
  - HTML report in `coverage/index.html`
  - LCOV in `coverage/lcov.info`

## Watch mode
```bash
pnpm test:watch
```

## E2E tests (Playwright)
```bash
pnpm build
pnpm test:e2e
```
Notes:
- E2E tests load the built MV3 extension from `.output/chrome-mv3/`.
- On Linux/CI, run headed mode under Xvfb:
  ```bash
  xvfb-run -a pnpm test:e2e
  ```

## Coverage requirements
- Enforced in Vitest with >= 90% for statements, branches, functions, and lines.
- Coverage is collected from the TypeScript source in `entrypoints/`.
- Exclusion: `entrypoints/nufftabs/index.ts` is excluded from unit/integration coverage because it is DOM-heavy glue code best validated via E2E; logic is covered in `list.ts`/`restore.ts`.

## CI structure (GitHub Actions)
1. Install dependencies
2. Build extension (`pnpm build`)
3. Unit + integration tests with coverage (`pnpm test`)
4. Install Playwright Chromium
5. E2E tests (`pnpm test:e2e` under Xvfb)
6. Upload Playwright artifacts on failure (`test-results/`)
