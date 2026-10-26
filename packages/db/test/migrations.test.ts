import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadMigrations, migrate } from '../src/migrations.js';
import type pg from 'pg';

test('changed applied migrations roll back rather than silently running modified SQL', async () => {
  const migration = (await loadMigrations())[0]!;
  const statements: string[] = [];
  let released = false;
  const client = {
    query: async (sql: string) => {
      statements.push(sql);
      return { rows: sql === 'SELECT name, checksum FROM schema_migrations'
        ? [{ name: migration.name, checksum: 'different-applied-checksum' }] : [] };
    },
    release: () => { released = true; },
  };
  const pool = { connect: async () => client } as unknown as pg.Pool;
  await assert.rejects(migrate(pool), /Previously applied migration changed/);
  assert.ok(statements.includes('ROLLBACK'));
  assert.equal(statements.includes('COMMIT'), false);
  assert.equal(statements.includes(migration.sql), false);
  assert.ok(released);
});
