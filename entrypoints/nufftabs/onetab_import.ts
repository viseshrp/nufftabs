type SavedTab = {
  id: string;
  url: string;
  title: string;
  savedAt: number;
};

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

export function countOneTabNonEmptyLines(text: string): number {
  return text.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

export function parseOneTabExport(text: string): SavedTab[] {
  const lines = text.split(/\r?\n/);
  const savedTabs: SavedTab[] = [];
  const now = Date.now();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const pipeIndex = line.indexOf('|');
    const urlPart = pipeIndex >= 0 ? line.slice(0, pipeIndex).trim() : line;
    const titlePart = pipeIndex >= 0 ? line.slice(pipeIndex + 1).trim() : '';

    if (!isHttpUrl(urlPart)) continue;

    savedTabs.push({
      id: crypto.randomUUID(),
      url: urlPart,
      title: titlePart && titlePart.length > 0 ? titlePart : urlPart,
      savedAt: now,
    });
  }

  return savedTabs;
}
