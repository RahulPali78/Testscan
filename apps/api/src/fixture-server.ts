import { buildReferenceApp } from './reference-app.js';
const app = buildReferenceApp();
const stop = async () => { await app.close(); };
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
try {
  const port = Number(process.env.FIXTURE_PORT ?? 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FIXTURE_PORT');
  await app.listen({ host: process.env.FIXTURE_HOST ?? '127.0.0.1', port });
  console.log('Synthetic support application listening on port ' + port + '.');
} catch {
  console.error('Reference application could not start. Check its host and port.');
  await app.close();
  process.exitCode = 1;
}
