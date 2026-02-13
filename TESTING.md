# TESTING

This guide is written for new contributors and testers. It explains the test stack, how tests are organized, how to run them locally, and what CI enforces.

## Quick start
```bash
pnpm install
pnpm build
pnpm test
pnpm test:e2e
```

## Test tooling (what we use and why)
- **Vitest** for unit/integration tests and coverage (`vitest.config.ts`).
- **Playwright** for end-to-end extension tests (`playwright.config.ts`).
- **jsdom** for DOM-focused unit/integration tests (list/options UI logic).
- **WXT** for building the extension outputs used by E2E (`tests/e2e/wxt.e2e.config.ts`).
- **Biome** for lint checks (`biome.json`).
- **web-ext** for manifest validation against the built extension (`pnpm lint:webext`).

## Project test layout (where to look)
```
tests/
  helpers/
    mock_chrome.ts              # Chrome API mock used by unit/integration tests
  unit/
    condense_logic.test.ts      # filter/transform logic for condense
    list_logic.test.ts          # list grouping/merge/normalize logic
    onetab_import.test.ts       # OneTab parsing rules
    settings_utils.test.ts      # settings input parsing
    storage_utils.test.ts       # storage helpers and normalization
  integration/
    background_condense.test.ts # background condense flows w/ mocked chrome
    background_entrypoint.test.ts
    list_page.test.ts           # list UI baseline
    list_page_edge.test.ts      # DOM edge cases
    list_tab.test.ts            # list tab focus/reuse behavior
    options_entrypoint.test.ts
    options_page.test.ts
    restore_logic.test.ts       # restore rules + window reuse
    storage.test.ts             # storage read/write + error cases
  e2e/
    extension.spec.ts           # real browser extension tests
    wxt.e2e.config.ts           # test-only WXT config for E2E builds
    entrypoints/
      background/index.ts       # test-only background entrypoint (adds E2E hook)
      nufftabs/index.ts         # proxy entrypoint to real list UI
      options/index.ts          # proxy entrypoint to real options UI
```

## Refactored code paths for testability (what changed)
To keep runtime behavior the same but improve testability, logic is now separated into focused modules:
- `entrypoints/shared/condense.ts` - pure condense filtering/transform helpers.
- `entrypoints/background/condense.ts` - background flow orchestration.
- `entrypoints/background/list_tab.ts` - list-tab focus/pin logic.
- `entrypoints/nufftabs/list.ts` - list grouping/merge/normalize helpers.
- `entrypoints/nufftabs/restore.ts` - restore rules + window reuse logic.
- `entrypoints/options/settings_page.ts` - options page orchestration.

Entry-point files (`entrypoints/*/index.ts`) now delegate to these modules.

## E2E build configuration (important)
E2E tests use a test-only WXT config so the production extension code remains unchanged:
- `tests/e2e/wxt.e2e.config.ts` points WXT at `tests/e2e/entrypoints/`.
- The E2E background entrypoint mirrors production behavior but adds a small test hook
  so Playwright can trigger "Condense" without changing the shipped extension.
- The output is written to `.output/chrome-mv3-e2e/` and is not shipped.

## Unit + integration tests (with coverage)
```bash
pnpm test
```
What this does:
- Runs Vitest in CI mode.
- Collects coverage from TypeScript source in `entrypoints/`.
- Enforces >= 90% on statements, branches, functions, and lines.

Coverage outputs:
- Text summary in console
- HTML report in `coverage/index.html`
- LCOV report in `coverage/lcov.info`

## Watch mode
```bash
pnpm test:watch
```

## E2E tests (Playwright)
```bash
pnpm test:e2e
```
What this does:
- Builds the test-only extension (`.output/chrome-mv3-e2e/`) via WXT.
- Launches Chromium with the unpacked MV3 build and drives real user flows.

Notes:
- E2E tests load the built MV3 extension from `.output/chrome-mv3-e2e/`.
- On Linux/CI, run headed mode under Xvfb:
  ```bash
  xvfb-run -a pnpm test:e2e
  ```

## Core scenarios covered (high level)
Unit + integration:
- Condense filtering and transforms
- Grouping/merge/normalize rules
- OneTab parsing and skipped reasons
- Storage read/write and error handling
- Restore rules (reuse current window vs new windows)
- Memory-saving restore discard after URL set (best-effort)
- Options/settings behavior

E2E:
- Condense tabs
- Group cards per condense action (group key)
- Restore single (current window)
- Restore all (post-single)
- Delete all
- Import JSON append
- Import OneTab + skipped reasons
- Focus existing list tab

## Coverage requirements
- Enforced in Vitest with >= 90% for statements, branches, functions, and lines.
- Coverage is collected from the TypeScript source in `entrypoints/`.
- Exclusion: `entrypoints/nufftabs/index.ts` is excluded from unit/integration coverage because it is DOM-heavy glue code best validated via E2E; logic is covered in `list.ts`/`restore.ts`.

## CI structure (GitHub Actions)
CI lives in `.github/workflows/ci.yml` and runs on PR + push.
1. **Code Quality**: `pnpm install`, `pnpm lint:webext`, `pnpm quality` (tsc + biome lint).
2. **Smoke Tests**: `pnpm install`, `pnpm smoke`, Playwright install, `xvfb-run -a pnpm smoke:e2e`.
3. **Unit Tests**: `pnpm install`, `pnpm test`, upload Codecov (`coverage/lcov.info`).
4. **Build & Package**: `pnpm install`, `pnpm package`, size budget check (1 MB), upload zip artifact.
5. **Release** (tags `v*` only): download artifact and create a draft GitHub release.

Artifacts:
- Screenshots, videos, and traces are stored in `test-results/` on failures.

## Common troubleshooting
- **E2E tests fail to find the extension**: run `pnpm build:e2e` and confirm `.output/chrome-mv3-e2e/` exists.
- **Timeouts in E2E**: re-run with `pnpm test:e2e -- --headed` and inspect trace:
  ```bash
  pnpm exec playwright show-trace test-results/<test>/trace.zip
  ```
- **Coverage drops**: run `pnpm test`, open `coverage/index.html`, and inspect uncovered branches/lines.

## Linting and manifest validation
```bash
pnpm lint
pnpm lint:webext
```
What this does:
- `lint`: Biome lint checks. The formatter is enabled in `biome.json` for local use,
  but CI only runs `biome lint` (it does not apply formatting).
- Lint rules apply uniformly across source and tests (no test-only relaxations).
- `lint:webext`: builds the Firefox MV2 bundle and runs `web-ext lint` against `.output/firefox-mv2/`.
