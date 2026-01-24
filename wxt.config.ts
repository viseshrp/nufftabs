import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    permissions: ['tabs', 'storage'],
    action: {
      default_title: 'Condense tabs',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
