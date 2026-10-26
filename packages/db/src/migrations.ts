import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

export type Migration = { name: string; sql: string; checksum: string };

export async function loadMigrations(
  directory = fileURLToPath(new URL('../migrations/', import.meta.url)),
): Promise<Migration[]> {
  const files = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  return Promise.all(files.map(async (name) => {
    const sql = await readFile(directory + '/' + name, 'utf8');
    return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
  }));
}

export async function migrate(pool: pg.Pool): Promise<string[]> {
  const migrations = await loadMigrations();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(584930271)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (' +
      'name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT clock_timestamp())',
    );
    const existing = await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
    const known = new Map(existing.rows.map((row) => [row.name, row.checksum]));
    for (const name of known.keys()) {
      if (!migrations.some((migration) => migration.name === name)) {
        throw new Error('Previously applied migration is missing: ' + name);
      }
    }
    for (const migration of migrations) {
      if (known.has(migration.name)) {
        if (known.get(migration.name) !== migration.checksum) {
          throw new Error('Previously applied migration changed: ' + migration.name);
        }
        continue;
      }
      await client.query(migration.sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [migration.name, migration.checksum]);
      applied.push(migration.name);
    }
    await client.query('COMMIT');
    return applied;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
