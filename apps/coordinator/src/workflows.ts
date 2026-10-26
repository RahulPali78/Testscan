import { proxyActivities } from '@temporalio/workflow';
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
