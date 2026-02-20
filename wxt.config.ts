/** WXT framework configuration for building the nufftabs Chrome extension. */
import { defineConfig } from 'wxt';

const manifestVersion = process.env.RELEASE_VERSION ?? process.env.npm_package_version ?? '1.0.0';
const extensionKey =
  process.env.EXTENSION_KEY ??
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs8vuyu7fneop/Iiy33HTgpaLewlWEtm0iSEKRxJAVQvy4aeb8aXGzmnJEWDdvoK2GmoVmb6/VLEiNVjPKEVp03HjY19tQIYQvd4FwSMYB6zNWzQJbzr17M5eVMEyZ4CAgjcZ92q6FnxEnxCARN+CYraIf0fN6gQWbdaMPYaPtvs38TB6Qy1dVLV9a+yGVCOTObWr2Iyc5ChAOW7xQNkyYRM8I93C9UNWK1m2DtSyhwWr8ecgrWfYp9gg87oVykKsGuwmV2wL8o1X39/b5UsRV5Z81d26v9MZbGOr2fc+AkHg2aQylf9aaiK3yL20nktHcB20DCJe2vUIlklFYWEtxQIDAQAB';

export default defineConfig({
  outDirTemplate: '{{browser}}-mv{{manifestVersion}}{{modeSuffix}}',
  vite: () => ({
    build: {
      sourcemap: false,
    },
  }),
  manifest: {
    version: manifestVersion,
    key: extensionKey,
    name: 'nufftabs',
    description: 'Enough tabs. Condense and restore.',
    homepage_url: 'https://github.com/viseshrp/nufftabs',
    permissions: ['tabs', 'storage', 'identity'],
    host_permissions: ['https://www.googleapis.com/'],
    oauth2: {
      client_id: '316914322209-3tclnhiqvs72o6807749be29llob6sgo.apps.googleusercontent.com',
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    },
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
