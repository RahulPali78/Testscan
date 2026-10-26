import { FoundationProbeInputSchema, type FoundationProbeInput, type FoundationProbeResult } from '@veriqo/contracts';
import type { createPool } from '@veriqo/db';

export function createActivities(pool: ReturnType<typeof createPool>, fixtureUrl: string) {
  return {
    async checkFoundation(input: FoundationProbeInput): Promise<FoundationProbeResult> {
      const parsed = FoundationProbeInputSchema.parse(input);
      await pool.query('SELECT 1');
      const response = await fetch(new URL('/health/live', fixtureUrl), { signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error('Synthetic fixture unavailable');
      const body = await response.json() as { service?: string };
      if (body.service !== 'veriqo-support-fixture') throw new Error('Unexpected fixture service');
      return {
        correlation_id: parsed.correlation_id, database: 'healthy', fixture: 'healthy',
        checked_at: new Date().toISOString(),
      };
    },
  };
}
