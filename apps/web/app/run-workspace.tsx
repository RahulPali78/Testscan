'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { RunDetailSchema, RunSummarySchema, ScenarioVersionSchema, type Session, type RunDetail, type RunSummary, type ScenarioVersion, type FixtureMode } from '@veriqo/contracts/product';
import { api } from './product-workspace';

export function RunWorkspace({ session, source }: { session: Session; source: string }) {
  const [projectId, setProjectId] = useState(session.projects[0]!.id);
  return <section id="runs" className="run-section"><div className="section-heading"><div><h2>Run and verify</h2><p>Reference support workflow · Agent actions + authoritative state checks</p></div><label>Project<select aria-label="Project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{session.projects.map((project) => <option key={project.id} value={project.id}>{project.organisation_name} / {project.name}</option>)}</select></label></div><ProjectRuns key={projectId} project={session.projects.find((project) => project.id === projectId)!} source={source} /></section>;
}
function ProjectRuns({ project, source }: { project: Session['projects'][number]; source: string }) {
  const [versions, setVersions] = useState<ScenarioVersion[]>([]), [selectedVersion, setSelectedVersion] = useState('');
  const [runs, setRuns] = useState<RunSummary[]>([]), [selectedRun, setSelectedRun] = useState(''), [detail, setDetail] = useState<RunDetail | null>(null);
  const [mode, setMode] = useState<FixtureMode>('correct'), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [token, setToken] = useState<{ id: string; token: string } | null>(null);
  const [detailRevision, setDetailRevision] = useState(0);
  const submission = useRef<{ fingerprint: string; key: string } | null>(null);
  const writable = project.role !== 'viewer';
  const refreshRuns = useCallback(async () => {
    const data = RunSummarySchema.array().parse(await api('projects/' + project.id + '/runs')); setRuns(data);
  }, [project.id]);
  const refreshVersions = useCallback(async () => {
    const latest = ScenarioVersionSchema.array().parse(await api('projects/' + project.id + '/scenarios'));
    const groups = await Promise.all(latest.map((entry) => api('scenarios/' + entry.scenario_id + '/versions')));
    const all = groups.flatMap((group) => ScenarioVersionSchema.array().parse(group));
    setVersions(all); setSelectedVersion((current) => current || all[0]?.id || '');
  }, [project.id]);
  useEffect(() => {
    void Promise.all([refreshRuns(), refreshVersions()]).catch((error) => setError(error.message));
    const timer = setInterval(() => { void refreshRuns().catch((error) => setError(error.message)); }, 2000);
    return () => clearInterval(timer);
  }, [refreshRuns, refreshVersions]);
  useEffect(() => {
    if (!selectedRun) { setDetail(null); return; }
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const data = RunDetailSchema.parse(await api('runs/' + selectedRun));
        if (!active) return;
        setDetail(data);
        setRuns((current) => current.map((run) => run.id === data.run.id ? data.run : run));
        if (!['FINISHED', 'ERROR', 'CANCELLED'].includes(data.run.execution_status) || ['PENDING', 'RUNNING'].includes(data.run.cleanup_status)) timer = setTimeout(() => { void refresh(); }, 1000);
      }
      catch (error) { if (active) { setError((error as Error).message); timer = setTimeout(() => { void refresh(); }, 3000); } }
    };
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [selectedRun, detailRevision]);
  async function action(work: () => Promise<void>) {
    setBusy(true); setError('');
    try { await work(); } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <><div className="run-controls"><div><strong>{project.role === 'viewer' ? 'Read-only access' : 'Publish the contract below'}</strong><p>Publishing freezes a new version. Execution accepts the reference agent and state operations only.</p></div><button className="button secondary" disabled={busy || !writable} onClick={() => { void action(async () => {
    const scenario = JSON.parse(source);
    const existing = versions.find((version) => version.name === scenario.scenario_id);
    const path = existing ? 'scenarios/' + existing.scenario_id + '/versions' : 'projects/' + project.id + '/scenarios';
    const version = ScenarioVersionSchema.parse(await api(path, { scenario })); await refreshVersions(); setSelectedVersion(version.id);
  }); }}>Publish scenario version</button></div>
  <div className="run-controls"><label>Published version<select aria-label="Published version" value={selectedVersion} onChange={(event) => setSelectedVersion(event.target.value)}><option value="">Publish a scenario first</option>{versions.map((version) => <option key={version.id} value={version.id}>{version.name} · v{version.version_number} · {version.definition_hash.slice(0, 8)}</option>)}</select></label><label>Reference behavior<select aria-label="Reference behavior" value={mode} onChange={(event) => setMode(event.target.value as FixtureMode)}>{['correct', 'missing-write', 'duplicate-write', 'wrong-tenant'].map((value) => <option key={value}>{value}</option>)}</select></label><button className="button primary" disabled={busy || !writable || !selectedVersion} onClick={() => { void action(async () => {
    const input = { scenario_version_id: selectedVersion, fixture_mode: mode };
    const fingerprint = JSON.stringify(input);
    if (submission.current?.fingerprint !== fingerprint) submission.current = { fingerprint, key: crypto.randomUUID() };
    const run = RunSummarySchema.parse(await api('projects/' + project.id + '/runs', input, submission.current.key));
    submission.current = null;
    setSelectedRun(run.id); setDetail(null); await refreshRuns();
  }); }}>{busy ? 'Working…' : 'Start run'}</button></div>
  {error && <div className="notice error" role="alert">{error}</div>}
  <div className="run-layout"><div className="run-list" aria-label="Recent runs"><h3>Recent runs</h3>{runs.length === 0 && <p>No runs in this project yet.</p>}{runs.map((run) => <button key={run.id} className={'run-row ' + (selectedRun === run.id ? 'selected' : '')} onClick={() => { setDetail(null); setSelectedRun(run.id); }}><strong>{run.scenario_name}</strong><span>{run.verdict ?? run.execution_status} · Cleanup {run.cleanup_status.toLowerCase()}</span><small>{new Date(run.created_at).toLocaleString()} · {run.id.slice(0, 8)}</small></button>)}</div><div className="run-detail">{detail ? <><div className="section-heading"><div><h3>Outcome: <span className={'verdict verdict-' + detail.run.verdict}>{detail.run.verdict ?? 'Pending'}</span></h3><p>{detail.run.execution_status} · Cleanup {detail.run.cleanup_status} · Build {detail.candidate_attested ? 'verified' : 'unverified'}</p></div></div><div className="run-buttons"><a className="button secondary" href={'/api/v1/runs/' + detail.run.id + '/export'}>Export evidence</a>{!['FINISHED', 'ERROR', 'CANCELLED'].includes(detail.run.execution_status) && <button className="button secondary" disabled={busy || !writable || detail.run.cancel_requested} onClick={() => { void action(async () => { await api('runs/' + detail.run.id + '/cancel', {}); await refreshRuns(); }); }}>{detail.run.cancel_requested ? 'Cancellation requested' : 'Cancel run'}</button>}{detail.run.cleanup_status === 'FAILED' && <button className="button secondary" disabled={busy || !writable} onClick={() => { void action(async () => { await api('runs/' + detail.run.id + '/cleanup', {}); setDetailRevision((value) => value + 1); }); }}>Retry cleanup</button>}</div>
  {detail.error_code && <p className="notice error">Execution issue: {detail.error_code}. The recorded outcome retains any witnessed failures.</p>}
  <div className="assertions">{detail.assertions.map((assertion) => <article key={assertion.check_id}><strong>{assertion.check_id}</strong><span className={'verdict verdict-' + assertion.outcome}>{assertion.outcome}</span><p>{assertion.evidence_refs.length} evidence reference(s)</p><details><summary>Expected and observed</summary><pre>{JSON.stringify({ expected: assertion.expected, observed: assertion.observed, evidence_refs: assertion.evidence_refs }, null, 2)}</pre></details></article>)}</div>
  <h3>Evidence timeline</h3><ol className="evidence-list">{detail.evidence.map((item) => <li key={item.id}><details><summary><strong>{item.kind}</strong> · {item.source} · {new Date(item.occurred_at).toLocaleTimeString()}</summary><p>Evidence {item.id}</p><pre>{JSON.stringify(item.payload, null, 2)}</pre></details></li>)}</ol><details><summary>Frozen run manifest</summary><pre>{JSON.stringify({ manifest_hash: detail.manifest_hash, manifest: detail.manifest }, null, 2)}</pre></details></> : <p>{selectedRun ? 'Loading run evidence…' : 'Select a run to inspect its outcome, assertions, manifest and evidence.'}</p>}</div></div>
  {project.role === 'owner' && <details className="token-panel"><summary>Project API access</summary><p>Create a revocable editor token to submit published runs from CI. Copy it once and keep it in your CI secret store.</p>{token ? <><code className="token-value">{token.token}</code><button className="button secondary" disabled={busy} onClick={() => { void action(async () => { const response = await fetch('/api/v1/projects/' + project.id + '/tokens/' + token.id, { method: 'DELETE' }); if (!response.ok) throw new Error('Token revocation failed.'); setToken(null); }); }}>Revoke token</button></> : <button className="button secondary" disabled={busy} onClick={() => { void action(async () => { setToken(await api('projects/' + project.id + '/tokens', { name: 'Dashboard CI token', role: 'editor', expires_in_days: 30 })); }); }}>Create CI token</button>}</details>}
  </>;
}
