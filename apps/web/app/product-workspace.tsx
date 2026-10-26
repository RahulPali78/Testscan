'use client';
import { useEffect, useState } from 'react';
import { SessionSchema, type Session } from '@veriqo/contracts/product';
import { Dashboard } from './workspace';

export async function api(path: string, body?: unknown, key?: string) {
  const response = await fetch('/api/v1/' + path, { method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(key ? { 'idempotency-key': key } : {}) },
    body: body === undefined ? null : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message ?? 'The operation could not complete.');
  return result;
}
export function ProductWorkspace() {
  const [session, setSession] = useState<Session | null>(null);
  const [config, setConfig] = useState<{ mode: string; accounts: { id: string; label: string }[] } | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [name, setName] = useState('');
  async function refreshSession() {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (response.status === 401) { setSession(null); return; }
      if (!response.ok) throw new Error('Account services are unavailable. Check the local services.');
      setSession(SessionSchema.parse(await response.json())); setError('');
    } catch (error) { setError((error as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => {
    void refreshSession();
    void fetch('/api/auth/config').then(async (response) => { if (response.ok) setConfig(await response.json()); }).catch(() => {});
    const timer = setInterval(() => { void refreshSession(); }, 30000);
    return () => clearInterval(timer);
  }, []);
  async function login(account: string) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/development', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ account_id: account }) });
      if (!response.ok) throw new Error('Sign-in failed. Restart local services and retry.');
      await refreshSession();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out failed. Retry.');
      setSession(null);
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  if (session?.projects.length) return <Dashboard session={session} logout={() => { void logout(); }} />;
  return <main className="auth-page"><div className="auth-card"><div className="eyebrow">VERIQO · VERIFIED OUTCOMES</div><h1>{session ? 'Create your workspace' : 'Sign in to your workspace'}</h1><p>Publish expectations, run a workflow, and inspect the independent evidence.</p>
    {error && <p className="notice error" role="alert">{error}</p>}
    {loading ? <p>Checking your session…</p> : session ? <form onSubmit={(event) => { event.preventDefault(); setBusy(true); void api('workspaces', { name, project_name: 'Main project' }).then(refreshSession).catch((error) => setError(error.message)).finally(() => setBusy(false)); }}><label>Workspace name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} /></label><button className="button primary" disabled={busy}>Create workspace</button><button type="button" className="button secondary" onClick={() => { void logout(); }}>Sign out</button></form> : config?.mode === 'development' ? <><p className="notice">Local synthetic accounts. Select a role to explore the reference workflow.</p><div className="auth-actions">{config.accounts.map((account) => <button className="button secondary" key={account.id} disabled={busy} onClick={() => { void login(account.id); }}>{account.label}</button>)}</div></> : config ? <a className="button primary" href="/api/auth/login">Sign in with your identity provider</a> : <button className="button secondary" onClick={() => location.reload()}>Retry connection</button>}
    <p className="small-print">Reference execution is available. General customer integrations and remaining application adapters are in development.</p>
  </div></main>;
}
