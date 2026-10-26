import { proxyActivities, CancellationScope } from '@temporalio/workflow';
import type { RunActivities } from './run-activities.js';
import type { FoundationProbeInput, FoundationProbeResult } from '@veriqo/contracts';

const activities = proxyActivities<{
  checkFoundation(input: FoundationProbeInput): Promise<FoundationProbeResult>;
}>({
  startToCloseTimeout: '5 seconds',
  retry: { maximumAttempts: 2 },
});

// A connectivity proof only. This does not submit or grade a customer scenario.
export async function foundationProbeWorkflow(input: FoundationProbeInput): Promise<FoundationProbeResult> {
  return activities.checkFoundation(input);
}

const execution = proxyActivities<Pick<RunActivities, 'executeRun'>>({
  startToCloseTimeout: '125 seconds', heartbeatTimeout: '15 seconds',
  retry: { maximumAttempts: 1 },
});
const compensation = proxyActivities<Pick<RunActivities, 'cleanupRun' | 'finishRun' | 'markCleanupFailed'>>({
  startToCloseTimeout: '15 seconds', retry: { maximumAttempts: 3, initialInterval: '1 second' },
});
export async function referenceRunWorkflow(runId: string): Promise<void> {
  let failed = false;
  try { await execution.executeRun(runId); } catch { failed = true; }
  await CancellationScope.nonCancellable(async () => {
    try { await compensation.cleanupRun(runId, failed); } catch { await compensation.markCleanupFailed(runId); }
    await compensation.finishRun(runId);
  });
}
export async function retryCleanupWorkflow(runId: string): Promise<void> {
  try { await compensation.cleanupRun(runId, false); } catch { await compensation.markCleanupFailed(runId); }
}
