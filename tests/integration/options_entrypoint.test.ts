// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createMockChrome, setMockChrome } from '../helpers/mock_chrome';

describe('options entrypoint', () => {
  it('initializes the settings page module', async () => {
    const mock = createMockChrome();
    setMockChrome(mock.chrome);

    document.body.innerHTML = `
      <input id="excludePinned" type="checkbox" />
      <input id="restoreBatchSize" type="number" />
      <input id="discardRestoredTabsDisabled" type="radio" name="discardRestoredTabs" value="false" />
      <input id="discardRestoredTabsEnabled" type="radio" name="discardRestoredTabs" value="true" />
      <input id="duplicateTabsAllow" type="radio" name="duplicateTabsPolicy" value="allow" />
      <input id="duplicateTabsReject" type="radio" name="duplicateTabsPolicy" value="reject" />
      <input id="themeOs" type="radio" name="theme" value="os" />
      <input id="themeLight" type="radio" name="theme" value="light" />
      <input id="themeDark" type="radio" name="theme" value="dark" />
      <div id="status"></div>
    `;

    await import('../../entrypoints/options/index');
    expect(document.querySelector('#excludePinned')).not.toBeNull();
  });
});

