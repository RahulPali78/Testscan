import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { startDevelopment, root } from './dev.mjs';

let development;
try {
  development = await startDevelopment({ infra: true, web: false });
  const child = spawn(process.execPath, ['--import', 'tsx', '--test', '--experimental-test-isolation=none', 'apps/coordinator/test/integration.test.ts'], {
    cwd: root, stdio: 'inherit', shell: process.platform === 'win32',
    env: { ...process.env, VERIQO_INTEGRATION: '1', VERIQO_API_URL: development.apiUrl, FIXTURE_URL: development.fixtureUrl },
  });
  const [code] = await once(child, 'exit');
  process.exitCode = code ?? 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await development?.stop();
}
