import type pg from 'pg';
export const DEVELOPMENT_ISSUER = 'urn:veriqo:development';
export const DEVELOPMENT_ACCOUNTS = [
  { id: 'developer', subject: 'dev-developer', label: 'Developer', userId: '10000000-0000-4000-8000-000000000001', project: 'alpha', role: 'owner' },
  { id: 'second-owner', subject: 'dev-second-owner', label: 'Second workspace', userId: '10000000-0000-4000-8000-000000000002', project: 'beta', role: 'owner' },
  { id: 'viewer', subject: 'dev-viewer', label: 'Reviewer (read only)', userId: '10000000-0000-4000-8000-000000000003', project: 'alpha', role: 'viewer' },
] as const;
export const DEVELOPMENT_PROJECTS = {
  alpha: { organisationId: '20000000-0000-4000-8000-000000000001', projectId: '30000000-0000-4000-8000-000000000001', name: 'Alpha workspace' },
  beta: { organisationId: '20000000-0000-4000-8000-000000000002', projectId: '30000000-0000-4000-8000-000000000002', name: 'Beta workspace' },
};
export async function seedDevelopment(pool: pg.Pool) {
  if (process.env.VERIQO_AUTH_MODE !== 'development' || process.env.NODE_ENV === 'production') return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const project of Object.values(DEVELOPMENT_PROJECTS)) {
      await client.query('INSERT INTO organisations(id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [project.organisationId, project.name]);
      await client.query('INSERT INTO projects(id,organisation_id,name) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [project.projectId, project.organisationId, 'Support verification']);
    }
    for (const account of DEVELOPMENT_ACCOUNTS) {
      await client.query('INSERT INTO users(id,issuer,subject,display_name) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [account.userId, DEVELOPMENT_ISSUER, account.subject, account.label]);
      const project = DEVELOPMENT_PROJECTS[account.project];
      await client.query('INSERT INTO project_memberships(user_id,organisation_id,project_id,role) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',
        [account.userId, project.organisationId, project.projectId, account.role]);
    }
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
