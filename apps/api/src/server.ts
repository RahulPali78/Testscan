import { createPool } from '@veriqo/db';
import { buildApi } from './app.js';
import { createDependencyProbe } from './dependencies.js';
import { authFromEnvironment } from './auth.js';
import { ProductStore } from '@veriqo/db/product';

const pool = createPool();
const app = buildApi({ probe: createDependencyProbe(pool), logger: true, auth: authFromEnvironment(), store: new ProductStore(pool) });
app.addHook('onClose', async () => { await pool.end(); });
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
};
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
  const port = Number(process.env.API_PORT ?? 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid API_PORT');
  await app.listen({ port, host: process.env.API_HOST ?? '127.0.0.1' });
} catch {
  app.log.error('API startup failed. Check the configured host, port and local environment.');
  await stop();
  process.exitCode = 1;
}
