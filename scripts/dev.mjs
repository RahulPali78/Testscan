import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const delay = (ms) => new Promise((done) => setTimeout(done, ms));

async function command(binary, args, signal) {
  const child = spawn(binary, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32', signal });
  child.on('error', () => {});
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(binary + ' failed. Check local dependencies and the output above.');
}

export async function startDevelopment({ infra = true, web = true, signal } = {}) {
  signal?.throwIfAborted();
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use the pinned Node.js 24 toolchain.');
  if (infra) {
    await command('docker', ['compose', '-f', 'infra/local/compose.yml', 'up', '-d', '--wait'], signal);
  }
  await command(pnpm, ['db:migrate'], signal);
  const children = new Set();
  let stopping = false;
  let unexpectedExit;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    signal?.removeEventListener('abort', onAbort);
    const running = [...children].filter((child) => child.exitCode === null && child.signalCode === null);
    const completions = running.map((child) => once(child, 'exit').catch(() => {}));
    for (const child of running) {
      try {
        if (process.platform === 'win32') child.kill('SIGTERM');
        else process.kill(-child.pid, 'SIGTERM');
      } catch {}
    }
    const deadline = setTimeout(() => {
      for (const child of running) {
        if (child.exitCode !== null || child.signalCode !== null) continue;
        try {
          if (process.platform === 'win32') child.kill('SIGKILL');
          else process.kill(-child.pid, 'SIGKILL');
        } catch {}
      }
    }, 12000);
    deadline.unref();
    await Promise.all(completions);
    clearTimeout(deadline);
    // Persisted infrastructure is deliberately kept for the next dev session.
  };
  const onAbort = () => { void stop(); };
  signal?.addEventListener('abort', onAbort, { once: true });
  function service(name, args, extraEnv = {}, binary = process.execPath) {
    const child = spawn(binary, args, {
      cwd: root, stdio: 'inherit', detached: process.platform !== 'win32',
      shell: process.platform === 'win32', env: { ...process.env, ...extraEnv },
    });
    children.add(child);
    child.on('error', () => {
      unexpectedExit = name + ' could not start.';
      console.error(unexpectedExit); process.exitCode = 1; void stop();
    });
    child.on('exit', () => {
      if (!stopping) {
        unexpectedExit = name + ' stopped unexpectedly.';
        console.error(unexpectedExit); process.exitCode = 1; void stop();
      }
    });
    return child;
  }
  async function waitFor(url, timeout = 90000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline && !stopping) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
        if (response.ok) return;
      } catch {}
      await delay(500);
    }
    throw new Error(unexpectedExit ?? 'Service did not become ready: ' + url);
  }
  const apiUrl = process.env.VERIQO_API_URL ?? 'http://127.0.0.1:' + (process.env.API_PORT ?? '4000');
  const fixtureUrl = process.env.FIXTURE_URL ?? 'http://127.0.0.1:' + (process.env.FIXTURE_PORT ?? '4100');
  try {
    signal?.throwIfAborted();
    service('Reference app', ['--import', 'tsx', 'apps/api/src/fixture-server.ts']);
    await waitFor(new URL('/health/live', fixtureUrl));
    service('Coordinator', ['--import', 'tsx', 'apps/coordinator/src/worker.ts']);
    service('Control API', ['--import', 'tsx', 'apps/api/src/server.ts']);
    if (web) service('Dashboard', ['--filter', '@veriqo/web', 'dev'], { VERIQO_API_URL: apiUrl }, pnpm);
    await waitFor(new URL('/health/ready', apiUrl));
    if (web) await waitFor('http://127.0.0.1:' + (process.env.PORT ?? '3000'));
    return { stop, children, apiUrl, fixtureUrl };
  } catch (error) {
    await stop();
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const controller = new AbortController();
  process.once('SIGINT', () => { controller.abort(); });
  process.once('SIGTERM', () => { controller.abort(); });
  try {
    const development = await startDevelopment({ infra: !process.argv.includes('--apps-only'), signal: controller.signal });
    console.log('\nVeriqo development foundation is ready.');
    console.log('Dashboard: http://127.0.0.1:' + (process.env.PORT ?? '3000'));
    console.log('Control API: ' + development.apiUrl + ' | Reference app: ' + development.fixtureUrl);
    console.log('Temporal UI: http://127.0.0.1:8233');
    console.log('Ctrl+C stops application processes. Use pnpm infra:down to stop the local containers.\n');
  } catch (error) {
    console.error(error.message);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  }
}
