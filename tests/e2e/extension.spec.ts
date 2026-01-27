import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const extensionPath = resolve(process.cwd(), '.output', 'chrome-mv3-e2e');

async function launchExtension(): Promise<{ context: BrowserContext; extensionId: string; page: Page }> {
  if (!existsSync(extensionPath)) {
    throw new Error('Extension build not found. Run `pnpm build:e2e` before e2e tests.');
  }

  const context = await chromium.launchPersistentContext('', {
    headless: process.env.PW_HEADLESS === 'true',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const background = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(background.url()).host;
  const page = await context.newPage();

  return { context, extensionId, page };
}

function extensionUrl(extensionId: string, path: string): string {
  return `chrome-extension://${extensionId}/${path}`;
}

async function sendCondense(page: Page, windowId: number) {
  await page.evaluate(async (id) => {
    await chrome.runtime.sendMessage({ type: 'condense', windowId: id });
  }, windowId);
}

async function waitForSavedGroupCount(page: Page, expectedCount: number) {
  await page.waitForFunction(async (expected) => {
    const result = await chrome.storage.local.get(['savedTabsIndex']);
    const index = result.savedTabsIndex;
    return Array.isArray(index) && index.length >= expected;
  }, expectedCount);
}

async function getOrOpenListPage(context: BrowserContext, listUrl: string): Promise<Page> {
  const existing = context.pages().find((p) => p.url() === listUrl);
  if (existing) return existing;
  const waited = await context
    .waitForEvent('page', {
      predicate: (p) => p.url() === listUrl,
      timeout: 5000,
    })
    .catch(() => null);
  if (waited) return waited;
  const page = await context.newPage();
  await page.goto(listUrl);
  return page;
}

async function createWindowWithTabs(page: Page, urls: string[]) {
  const windowId = await page.evaluate(async (targetUrls) => {
    const created = await chrome.windows.create({ url: targetUrls });
    if (!created || typeof created.id !== 'number') {
      throw new Error('Missing window id');
    }
    return created.id;
  }, urls);
  await page.waitForFunction(
    async ({ id, expected }) => {
      const tabs = await chrome.tabs.query({ windowId: id });
      const withUrls = tabs.filter((tab) => typeof tab.url === 'string' && tab.url.length > 0);
      return tabs.length >= expected && withUrls.length >= expected;
    },
    { id: windowId, expected: urls.length },
  );
  return windowId;
}

async function getListTabCount(page: Page, listUrl: string) {
  return page.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs.length;
  }, listUrl);
}

async function seedSavedGroup(page: Page, groupKey: string, urls: string[]) {
  await page.evaluate(async ({ key, values }) => {
    const savedTabs = values.map((url) => ({
      id: crypto.randomUUID(),
      url,
      title: url,
      savedAt: Date.now(),
    }));
    await chrome.storage.local.set({
      savedTabsIndex: [key],
      [`savedTabs:${key}`]: savedTabs,
    });
  }, { key: groupKey, values: urls });
}

async function getAllSavedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const result = await chrome.storage.local.get(['savedTabsIndex']);
    const index = result.savedTabsIndex;
    if (!Array.isArray(index) || index.length === 0) return [];
    const groupKeys = index.map((key) => `savedTabs:${key}`);
    const groups = await chrome.storage.local.get(groupKeys);
    const urls: string[] = [];
    for (const key of index) {
      const tabs = groups[`savedTabs:${key}`];
      if (!Array.isArray(tabs)) continue;
      for (const tab of tabs) {
        if (tab && typeof tab.url === 'string') urls.push(tab.url);
      }
    }
    return urls;
  });
}

test.describe('nufftabs extension e2e', () => {
  test('condense tabs and group by window', async () => {
    const { context, extensionId, page } = await launchExtension();
    const listUrl = extensionUrl(extensionId, 'nufftabs.html');

    await page.goto(extensionUrl(extensionId, 'options.html'));

    const windowA = await createWindowWithTabs(page, ['https://example.com/a', 'https://example.com/b']);
    const windowB = await createWindowWithTabs(page, ['https://example.com/c']);

    await sendCondense(page, windowA);
    await waitForSavedGroupCount(page, 1);
    await sendCondense(page, windowB);
    await waitForSavedGroupCount(page, 2);

    const listPage = await context.newPage();
    await listPage.goto(listUrl);

    await expect(listPage.locator('.group-card')).toHaveCount(2, { timeout: 15000 });

    const groupKeys = await listPage.$$eval('.group-card', (cards) =>
      cards.map((card) => (card as HTMLElement).dataset.groupKey),
    );
    expect(groupKeys).toContain(String(windowA));
    expect(groupKeys).toContain(String(windowB));

    await context.close();
  });

  test('restore single and restore all rules', async () => {
    const { context, extensionId, page } = await launchExtension();
    const listUrl = extensionUrl(extensionId, 'nufftabs.html');

    await page.goto(extensionUrl(extensionId, 'options.html'));

    await seedSavedGroup(page, 'restore-group', ['https://example.com/1', 'https://example.com/2']);
    await waitForSavedGroupCount(page, 1);

    let listPage = await getOrOpenListPage(context, listUrl);

    await expect(listPage.locator('.group-card')).toHaveCount(1, { timeout: 15000 });

    // Restore single into current list window
    await expect(listPage.locator('button[data-action="restore-single"]')).toHaveCount(2);
    await listPage.locator('button[data-action="restore-single"]').first().click();
    await expect(listPage.locator('li.item:not(.load-more)')).toHaveCount(1);

    const listWindowId = await listPage.evaluate(async () => {
      const current = await chrome.tabs.getCurrent();
      if (!current || typeof current.windowId !== 'number') return null;
      return current.windowId;
    });
    expect(listWindowId).not.toBeNull();

    const restoredTabs = await listPage.evaluate(async () => {
      const tabs = await chrome.tabs.query({ url: 'https://example.com/1' });
      return tabs.map((tab) => ({ url: tab.url, windowId: tab.windowId }));
    });

    expect(restoredTabs.length).toBeGreaterThan(0);
    expect(restoredTabs[0]?.windowId).toBe(listWindowId);

    // Restore all remaining
    await expect(listPage.locator('button[data-action="restore-group"]')).toHaveCount(1);
    await listPage.locator('button[data-action="restore-group"]').click();
    await expect(listPage.locator('#snackbar')).toContainText('Restored all tabs');
    await expect(listPage.locator('.group-card')).toHaveCount(0);

    await context.close();
  });

  test('delete all from a group', async () => {
    const { context, extensionId, page } = await launchExtension();
    const listUrl = extensionUrl(extensionId, 'nufftabs.html');

    await page.goto(extensionUrl(extensionId, 'options.html'));

    await seedSavedGroup(page, 'delete-group', ['https://example.com/3']);
    await waitForSavedGroupCount(page, 1);

    const listPage = await getOrOpenListPage(context, listUrl);
    await expect(listPage.locator('.group-card')).toHaveCount(1, { timeout: 15000 });

    await expect(listPage.locator('button[data-action="delete-group"]')).toHaveCount(1);
    await listPage.locator('button[data-action="delete-group"]').click();
    await expect(listPage.locator('#snackbar')).toContainText('Deleted');
    await expect(listPage.locator('.group-card')).toHaveCount(0);

    await context.close();
  });

  test('import JSON append + OneTab behavior + focus existing list tab', async () => {
    const { context, extensionId, page } = await launchExtension();
    const listUrl = extensionUrl(extensionId, 'nufftabs.html');

    await page.goto(extensionUrl(extensionId, 'options.html'));

    const listPage = await getOrOpenListPage(context, listUrl);

    // Focus existing list tab behavior: condense from another window should reuse list tab.
    const windowId = await createWindowWithTabs(page, ['https://example.com/x']);
    await sendCondense(page, windowId);
    await waitForSavedGroupCount(page, 1);

    const listTabCount = await getListTabCount(page, listUrl);
    expect(listTabCount).toBe(1);
    await listPage.close();
    listPage = await context.newPage();
    await listPage.goto(listUrl);
    await expect(listPage.locator('.group-card')).toHaveCount(1, { timeout: 15000 });

    // Import JSON append
    await listPage.locator('#toggleIo').click();
    let jsonArea = listPage.locator('#jsonArea');
    await jsonArea.fill(JSON.stringify([{ url: 'https://example.com/imported' }]));
    await listPage.locator('#importJson').click();
    await expect
      .poll(async () => getAllSavedUrls(page))
      .toEqual(expect.arrayContaining(['https://example.com/x', 'https://example.com/imported']));

    // Import OneTab with skipped lines
    const oneTabText = [
      'https://example.com/onetab | OneTab',
      'notaurl | skipped',
    ].join('\n');
    await jsonArea.fill(oneTabText);
    await listPage.locator('#importOneTab').click();

    const snackbar = listPage.locator('#snackbar');
    await expect(snackbar).toContainText('skipped 1');

    await context.close();
  });
});
