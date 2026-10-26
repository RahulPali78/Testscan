import { Connection } from '@temporalio/client';
import { coordinatorHeartbeatKey, isHeartbeatFresh, type createPool } from '@veriqo/db';
import type { DependencyStatus } from '@veriqo/contracts';

async function measure(
  name: DependencyStatus['name'], check: () => Promise<void>, success: string, failure: string,
): Promise<DependencyStatus> {
  const started = performance.now();
  try {
    await check();
    return { name, status: 'healthy', latency_ms: Math.round(performance.now() - started), message: success };
  } catch {
    return { name, status: 'unavailable', latency_ms: Math.round(performance.now() - started), message: failure };
  }
}

export function createDependencyProbe(pool: ReturnType<typeof createPool>) {
  return () => Promise.all([
    measure('postgres', async () => { await pool.query('SELECT 1'); },
      'Database connection verified.', 'Database unavailable. Check PostgreSQL and DATABASE_URL.'),
    measure('temporal', async () => {
      const connection = await Connection.connect({
        address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233', connectTimeout: 2000,
      });
      await connection.close();
    }, 'Temporal connection verified.', 'Temporal unavailable. Start the local Temporal service.'),
    measure('coordinator', async () => {
      if (!await isHeartbeatFresh(pool, coordinatorHeartbeatKey())) throw new Error('No fresh heartbeat');
    }, 'A recent worker heartbeat is present.', 'No recent worker heartbeat. Check migrations and start the coordinator.'),
    measure('fixture', async () => {
      const response = await fetch(new URL('/health/live', process.env.FIXTURE_URL ?? 'http://127.0.0.1:4100'), {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error('Fixture unavailable');
      const body = await response.json() as { service?: string };
      if (body.service !== 'veriqo-support-fixture') throw new Error('Unexpected fixture service');
    }, 'Synthetic support application is available.', 'Reference app unavailable. Start the support fixture.'),
  ]);
}
