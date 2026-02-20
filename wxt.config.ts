/** WXT framework configuration for building the nufftabs Chrome extension. */
import { defineConfig } from 'wxt';

const manifestVersion = process.env.RELEASE_VERSION ?? process.env.npm_package_version ?? '1.0.0';
const oauthClientId =
  process.env.GOOGLE_OAUTH_CLIENT_ID ??
  '316914322209-3tclnhiqvs72o6807749be29llob6sgo.apps.googleusercontent.com';
const extensionKey =
  process.env.CHROME_EXTENSION_KEY ?? process.env.EXTENSION_MANIFEST_KEY ?? process.env.EXTENSION_KEY;

export default defineConfig({
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  vite: () => ({
    build: {
      sourcemap: false,
    },
  }),
  manifest: {
    version: manifestVersion,
    name: 'nufftabs',
    description: 'Enough tabs. Condense and restore.',
    homepage_url: 'https://github.com/viseshrp/nufftabs',
    permissions: ['tabs', 'storage', 'identity'],
    host_permissions: ['https://www.googleapis.com/'],
    oauth2: {
      client_id: oauthClientId,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    },
    ...(extensionKey ? { key: extensionKey } : {}),
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
  },
});
