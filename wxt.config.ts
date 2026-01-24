import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    permissions: ['tabs', 'storage'],
    action: {
      default_title: 'Condense tabs',
    },
  },
});
