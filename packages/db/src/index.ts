import pg from 'pg';
export const LOCAL_DATABASE_URL = 'postgresql://veriqo:veriqo_dev@127.0.0.1:5432/veriqo';

export function coordinatorHeartbeatKey(): string {
  return 'coordinator:' + JSON.stringify([
    process.env.TEMPORAL_NAMESPACE ?? 'default',
    process.env.TEMPORAL_TASK_QUEUE ?? 'veriqo-foundation',
  ]);
}

export function createPool(connectionString = process.env.DATABASE_URL ?? LOCAL_DATABASE_URL): pg.Pool {
  return new pg.Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 2000,
    query_timeout: 2000,
    statement_timeout: 2000,
    idleTimeoutMillis: 10000,
  });
}

export async function writeHeartbeat(pool: pg.Pool, serviceKey: string): Promise<void> {
  await pool.query(
    'INSERT INTO foundation_heartbeats (service_key, last_seen_at) VALUES ($1, clock_timestamp()) ' +
    'ON CONFLICT (service_key) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at',
    [serviceKey],
  );
}

export async function isHeartbeatFresh(pool: pg.Pool, serviceKey: string, maxAgeSeconds = 20): Promise<boolean> {
  const result = await pool.query<{ fresh: boolean }>(
    "SELECT last_seen_at > clock_timestamp() - ($2::double precision * interval '1 second') AS fresh " +
    'FROM foundation_heartbeats WHERE service_key = $1',
    [serviceKey, maxAgeSeconds],
  );
  return result.rows[0]?.fresh === true;
}
