# TEST_PLAN

## Tools
- Unit/integration: Vitest + @vitest/coverage-v8 (TypeScript source coverage)
- E2E: Playwright (Chromium) with unpacked MV3 extension build from WXT

## Scope mapping
- Unit tests
  - `entrypoints/shared/storage.ts` (normalization, read/write transforms)
  - `entrypoints/nufftabs/onetab_import.ts` (OneTab parsing)
  - new shared logic modules extracted from list/background/options (grouping, counts, restore rules, import transforms)
- Integration tests
  - Storage + background/list logic using mocked `chrome` APIs
  - JSON import/merge and restore rules with mocked tab/window APIs
- E2E tests (real browser + built extension)
  - Condense tabs
  - Group tiles by windowId
  - Per-tile restore all / delete all
  - Restore single rules (current window)
  - Import JSON append behavior
  - Import OneTab behavior + skipped reasons
  - Focus existing list tab behavior

## Core scenarios to cover
- Condense filters pinned/list tab and saves eligible tabs
- Group key equals windowId (string) and groups render in UI
- Restore rules: single restores to current window; restore all opens new windows unless list tab is only tab
- Import JSON append vs replace; invalid JSON errors
- OneTab import parses allowed URLs and skips invalid lines with correct skipped counts

## Coverage plan (>=90%)
- Move pure logic from list/background/options into testable modules and cover with unit tests
- Mock `chrome` APIs to exercise storage reads/writes and restore/condense logic in integration tests
- Keep entrypoint files thin and test initialization paths to include them in coverage
- Minimize coverage exclusions; document any in `TESTING.md` if required
