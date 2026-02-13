import { createSavedTab, type SavedTab } from '../shared/storage';

function isAllowedUrl(value: string): boolean {
  return /^(https?|file):\/\//i.test(value);
}

export function parseOneTabExport(text: string): { tabs: SavedTab[]; totalLines: number } {
  const lines = text.split(/\r?\n/);
  const savedTabs: SavedTab[] = [];
  let totalLines = 0;
  const now = Date.now();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    totalLines += 1;

    const pipeIndex = line.indexOf('|');
    const urlPart = pipeIndex >= 0 ? line.slice(0, pipeIndex).trim() : line;
    const titlePart = pipeIndex >= 0 ? line.slice(pipeIndex + 1).trim() : '';

    if (!isAllowedUrl(urlPart)) continue;

    savedTabs.push(
      createSavedTab({
        url: urlPart,
        title: titlePart && titlePart.length > 0 ? titlePart : urlPart,
        savedAt: now,
      }),
    );
  }

  return { tabs: savedTabs, totalLines };
}
