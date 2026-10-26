import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = {
  transpilePackages: ['@veriqo/contracts'],
  poweredByHeader: false,
  logging: { incomingRequests: { ignore: [/\/api\/auth\/callback/] } },
  turbopack: { root: resolve(dirname(fileURLToPath(import.meta.url)), '../..') },
};
export default config;
