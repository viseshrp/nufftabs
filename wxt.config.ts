import { defineConfig } from 'wxt';

export default defineConfig({
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  vite: () => ({
    build: {
      sourcemap: false,
    },
  }),
  manifest: {
    version: '1.0.0',
    name: 'nufftabs',
    description: 'Enough tabs. Condense and restore.',
    homepage_url: 'https://github.com/viseshrp/nufftabs',
    permissions: ['tabs', 'storage'],
    action: {
      default_title: 'Condense tabs',
      default_icon: {
        16: 'icon/16.png',
        19: 'icon/19.png',
        32: 'icon/32.png',
        38: 'icon/38.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
    icons: {
      16: 'icon/16.png',
      19: 'icon/19.png',
      32: 'icon/32.png',
      38: 'icon/38.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    options_ui: {
      page: 'options.html',
      open_in_tab: true,
    },
  },
});
