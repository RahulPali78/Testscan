import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { coordinatorHeartbeatKey, createPool, writeHeartbeat } from '@veriqo/db';
import { createActivities } from './activities.js';
import { createRunActivities } from './run-activities.js';
import { startDispatcher } from './dispatcher.js';

const pool = createPool();
const heartbeatKey = coordinatorHeartbeatKey();
let connection: NativeConnection | undefined;
let worker: Worker | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let heartbeatPending = false;
let stopDispatcher: (() => Promise<void>) | undefined;
try {
  connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' });
  worker = await Worker.create({
    connection,
    namespace: process.env.TEMPORAL_NAMESPACE ?? 'default',
    taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'veriqo-foundation',
    workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
    activities: { ...createActivities(pool, process.env.FIXTURE_URL ?? 'http://127.0.0.1:4100'), ...createRunActivities(pool, process.env.FIXTURE_URL ?? 'http://127.0.0.1:4100') },
    maxConcurrentActivityTaskExecutions: 5,
  });
  const running = worker.run();
  stopDispatcher = await startDispatcher(pool);
  await writeHeartbeat(pool, heartbeatKey);
  timer = setInterval(() => {
    if (heartbeatPending) return;
    heartbeatPending = true;
    void writeHeartbeat(pool, heartbeatKey).catch(() => {
      console.error('Coordinator heartbeat failed; dependency readiness will expire.');
    }).finally(() => { heartbeatPending = false; });
  }, 5000);
  timer.unref();
  console.log('Coordinator polling the development task queue.');
  await running;
} catch {
  console.error('Coordinator startup or execution failed. Check PostgreSQL migrations and Temporal connectivity.');
  if (worker?.getState() === 'RUNNING') worker.shutdown();
  process.exitCode = 1;
} finally {
  await stopDispatcher?.();
  if (timer) clearInterval(timer);
  await pool.query('DELETE FROM foundation_heartbeats WHERE service_key = $1', [heartbeatKey]).catch(() => {});
  await connection?.close();
  await pool.end();
}
