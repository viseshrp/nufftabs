// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('list page edge cases', () => {
  it('handles missing DOM nodes without crashing', async () => {
    vi.resetModules();
    document.body.innerHTML = '';
    const mock = createMockChrome();
    setMockChrome(mock.chrome);
    const setSpy = vi.spyOn(mock.chrome.storage.local, 'set');

    await import('../../entrypoints/nufftabs/index');
    expect(document.body.innerHTML).toBe('');
    expect(Object.keys(mock.storageData)).toHaveLength(0);
    expect(setSpy).not.toHaveBeenCalled();
    setSpy.mockRestore();
  });

  it('ignores unknown actions and empty targets', async () => {
    vi.resetModules();
    document.body.innerHTML = `
      <div id="groups"></div>
      <div id="empty"></div>
      <div id="snackbar"></div>
    `;
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    await import('../../entrypoints/nufftabs/index');
    const groups = document.querySelector<HTMLDivElement>('#groups');
    const snackbar = document.querySelector<HTMLDivElement>('#snackbar');
    expect(groups).not.toBeNull();
    expect(snackbar).not.toBeNull();
    if (!groups || !snackbar) {
      throw new Error('Missing list page elements');
    }
    snackbar.textContent = '';

    const card = document.createElement('section');
    card.className = 'group-card';
    card.dataset.groupKey = '1';

    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = 'unknown';
    card.appendChild(button);
    groups.appendChild(card);

    const emptyTarget = document.createElement('div');
    groups.appendChild(emptyTarget);

    groups.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    emptyTarget.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(snackbar.textContent).toBe('');
    expect(card.classList.contains('is-collapsed')).toBe(false);
  });
});


