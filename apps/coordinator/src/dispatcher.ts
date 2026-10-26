import { Client, Connection, WorkflowExecutionAlreadyStartedError } from '@temporalio/client';
import { ExecutionStore } from '@veriqo/db/execution';
import type { createPool } from '@veriqo/db';

export async function startDispatcher(pool: ReturnType<typeof createPool>) {
  const connection = await Connection.connect({ address: process.env.TEMPORAL_ADDRESS ?? '127.0.0.1:7233' });
  const client = new Client({ connection, namespace: process.env.TEMPORAL_NAMESPACE ?? 'default' });
  const store = new ExecutionStore(pool);
  let stopped = false;
  let pending: Promise<void> | undefined;
  async function tick() {
    for (const item of await store.leaseOutbox()) {
      try {
        await client.workflow.start(item.kind === 'RUN' ? 'referenceRunWorkflow' : 'retryCleanupWorkflow', {
          args: [item.run_id], taskQueue: process.env.TEMPORAL_TASK_QUEUE ?? 'veriqo-foundation',
          workflowId: item.workflow_id, workflowIdReusePolicy: 'REJECT_DUPLICATE',
        });
        await store.dispatched(item.id);
      } catch (error) {
        if (error instanceof WorkflowExecutionAlreadyStartedError) await store.dispatched(item.id);
        else await store.dispatchFailed(item.id);
      }
    }
  }
  const timer = setInterval(() => {
    if (stopped || pending) return;
    pending = tick().catch(() => console.error('Run dispatch unavailable; queued commands remain durable.')).finally(() => { pending = undefined; });
  }, 500);
  timer.unref();
  return async () => { stopped = true; clearInterval(timer); await pending; await connection.close(); };
}
