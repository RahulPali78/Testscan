import { createPool } from './index.js';
import { migrate } from './migrations.js';
import { seedDevelopment } from './development.js';

const pool = createPool();
try {
  const applied = await migrate(pool);
  await seedDevelopment(pool);
  console.log(applied.length ? 'Applied migrations: ' + applied.join(', ') : 'Database migrations are up to date.');
} catch {
  console.error('Database migration failed. Check PostgreSQL availability and inspect migration checksums before retrying.');
  process.exitCode = 1;
} finally {
  await pool.end();
}
