'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exampleScenario, ScenarioValidationSchema, SystemSnapshotSchema,
  type SystemSnapshot, type ScenarioValidation,
} from '@veriqo/contracts';

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
    code: <><path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" /></>,
    database: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0" /></>,
    layers: <><path d="m12 3 10 5-10 5L2 8l10-5Zm-9 9 9 5 9-5M3 17l9 5 9-5" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c6 5 6 13 0 18-6-5-6-13 0-18Z" /></>,
    agent: <><rect x="4" y="6" width="16" height="14" rx="4" /><path d="M12 2v4m-8 6H1m22 0h-3m-12 0v1m8-1v1m-7 4h6" /></>,
    mobile: <><rect x="6" y="2" width="12" height="20" rx="3" /><path d="M10 18h4" /></>,
    desktop: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 22h8m-4-5v5" /></>,
    voice: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10a7 7 0 0 0 14 0m-7 7v5m-4 0h8" /></>,
    refresh: <><path d="M20 8a8 8 0 1 0 0 8m0-13v5h-5" /></>,
    arrow: <><path d="M4 12h16m-6-6 6 6-6 6" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    shield: <><path d="m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6l9-4Z" /><path d="m8 12 3 3 5-6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.grid}</svg>;
}

const services = [
  { key: 'postgres', title: 'PostgreSQL', description: 'Metadata & migrations', icon: 'database' },
  { key: 'temporal', title: 'Temporal', description: 'Durable orchestration', icon: 'layers' },
  { key: 'coordinator', title: 'Coordinator', description: 'Development worker', icon: 'agent' },
  { key: 'fixture', title: 'Reference app', description: 'Synthetic support workflow', icon: 'globe' },
] as const;
const surfaces = [
  { title: 'Web', detail: 'Chromium · Firefox · WebKit', icon: 'globe' },
  { title: 'APIs', detail: 'REST · GraphQL · WebSocket', icon: 'code' },
  { title: 'AI agents', detail: 'HTTP · SDK · MCP', icon: 'agent' },
  { title: 'Mobile', detail: 'Android · iOS', icon: 'mobile' },
  { title: 'Desktop', detail: 'Windows · macOS · Linux', icon: 'desktop' },
  { title: 'Voice', detail: 'Audio · Turns · Handoffs', icon: 'voice' },
];

export function Dashboard() {
  const [snapshot, setSnapshot] = useState<SystemSnapshot | null>(null);
  const [connectionError, setConnectionError] = useState('');
  const [refreshing, setRefreshing] = useState(true);
  const request = useRef<AbortController | null>(null);
  const [source, setSource] = useState(JSON.stringify(exampleScenario, null, 2));
  const [validation, setValidation] = useState<ScenarioValidation | null>(null);
  const [validationError, setValidationError] = useState('');
  const [validating, setValidating] = useState(false);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setRefreshing(true);
    try {
      const response = await fetch('/api/system', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('API unavailable');
      const next = SystemSnapshotSchema.parse(await response.json());
      if (!controller.signal.aborted) { setSnapshot(next); setConnectionError(''); }
    } catch {
      if (!controller.signal.aborted) {
        setSnapshot(null);
        setConnectionError('The control API is unavailable. Start the local services, then refresh.');
      }
    } finally {
      if (!controller.signal.aborted) setRefreshing(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const interval = setInterval(() => { void refresh(); }, 15000);
    return () => { clearInterval(interval); request.current?.abort(); };
  }, [refresh]);

  async function validate() {
    setValidating(true); setValidation(null); setValidationError('');
    try {
      JSON.parse(source);
    } catch {
      setValidationError('Enter valid JSON. Check quotation marks, commas and brackets.');
      setValidating(false);
      return;
    }
    try {
      const response = await fetch('/api/scenarios/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: source,
        signal: AbortSignal.timeout(7000),
      });
      const data: unknown = await response.json();
      const parsed = ScenarioValidationSchema.safeParse(data);
      if (!parsed.success) throw new Error('Validation unavailable');
      setValidation(parsed.data);
    } catch {
      setValidationError('Validation is unavailable. Check the API connection and scenario size, then retry.');
    } finally { setValidating(false); }
  }

  const healthy = snapshot?.dependencies.filter((item) => item.status === 'healthy').length ?? 0;
  return <div className="shell">
    <a className="skip-link" href="#main">Skip to workspace</a>
    <aside className="sidebar">
      <a className="brand" href="#main" aria-label="Veriqo home">
        <span className="brand-mark"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m7 9 9 15L26 8M13 9l4 6" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
        <span>veriqo<span className="brand-dot">.</span></span>
      </a>
      <div className="project-switch"><span className="project-avatar">V</span><div><strong>Development workspace</strong><span>Local environment</span></div><span className="project-chevron">⌄</span></div>
      <div className="nav-caption">WORKSPACE</div>
      <nav aria-label="Workspace sections">
        <a className="nav-item active" href="#environment"><Icon name="grid" />Overview<span className="nav-dot" /></a>
        <a className="nav-item" href="#scenario"><Icon name="code" />Scenario contract</a>
        <a className="nav-item" href="#coverage"><Icon name="layers" />Application coverage</a>
      </nav>
      <div className="sidebar-bottom"><Icon name="shield" /><strong>Outcomes over appearances.</strong><p>Independent evidence for the workflows that matter.</p><span className="sidebar-version">FOUNDATION · SCHEMA 2.0</span></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>Overview</strong></div><span className="environment-pill"><i />Local development</span></header>
      <main id="main">
        <div className="page-heading"><div><div className="eyebrow">YOUR VERIFICATION WORKSPACE</div><h1>A clearer view of what works.</h1><p>Connect the foundation. Define the outcome. Build with evidence.</p></div><button className="button secondary refresh-button" onClick={() => { void refresh(); }} disabled={refreshing}><span className={refreshing ? 'spin' : ''}><Icon name="refresh" size={17} /></span>{refreshing ? 'Checking…' : 'Refresh status'}</button></div>

        <section className="intro-banner"><div className="intro-symbol"><Icon name="layers" size={26} /></div><div><span className="small-eyebrow">FOUNDATION IN PROGRESS</span><h2>Your first connection starts here.</h2><p>Live service checks and scenario validation are available. Customer test execution and account access are still being built.</p></div><a className="button primary" href="#scenario">Explore a scenario<Icon name="arrow" size={17} /></a></section>

        <section id="environment" aria-labelledby="environment-title">
          <div className="section-heading"><div><h2 id="environment-title">Connected services</h2><p>Observed from your local control API. Refreshes every 15 seconds.</p></div><span className={'summary-status ' + (snapshot?.overall_status === 'healthy' ? 'is-healthy' : '')}><span className="status-dot" />{snapshot ? healthy + ' of 4 available' : refreshing ? 'Checking services' : 'API unavailable'}</span></div>
          {connectionError && <div className="notice error" role="alert">{connectionError}</div>}
          <div className="service-grid">{services.map((service) => {
            const observation = snapshot?.dependencies.find((item) => item.name === service.key);
            const available = observation?.status === 'healthy';
            return <article className="service-card" key={service.key}><div className="service-top"><span className="service-icon"><Icon name={service.icon} size={23} /></span><span className={'service-badge ' + (available ? 'available' : '')}>{available ? 'Available' : observation ? 'Unavailable' : refreshing ? 'Checking' : 'Unknown'}</span></div><h3>{service.title}</h3><p className="service-description">{service.description}</p><div className="service-foot"><span className={'status-dot ' + (available ? 'green' : '')} /><span>{observation?.message ?? 'Waiting for a verified API observation.'}</span></div></article>;
          })}</div>
          <p className="observation-time" aria-live="polite">{snapshot ? 'Last observed ' + new Date(snapshot.observed_at).toLocaleTimeString() + ' · Dependency availability does not qualify an application integration.' : 'No current dependency observation is available.'}</p>
        </section>

        <section id="scenario" className="scenario-section" aria-labelledby="scenario-title">
          <div className="section-heading"><div><h2 id="scenario-title">Define the expected outcome</h2><p>A versioned contract connects actions, independent checks and resource limits.</p></div><span className="outline-badge">SCHEMA 2.0</span></div>
          <div className="scenario-layout">
            <div className="scenario-context"><span className="scenario-icon"><Icon name="code" size={25} /></span><h3>One request.<br />Three independent checks.</h3><p>Ask an agent to create an urgent support ticket, inspect the actual record, then confirm the customer can see it.</p><ol className="journey"><li><span>01</span><div><strong>Invoke the agent</strong><p>A scripted, bounded request.</p></div></li><li><span>02</span><div><strong>Observe the business state</strong><p>Exactly one ticket. Correct account.</p></div></li><li><span>03</span><div><strong>Confirm the customer view</strong><p>The same ticket, visible in the portal.</p></div></li></ol><div className="context-note"><Icon name="shield" size={18} /><p>Validation checks the contract only. It does not publish or execute this scenario.</p></div></div>
            <div className="editor-panel"><div className="editor-header"><span><i /><i /><i /></span><label htmlFor="scenario-source">support-ticket.scenario.json</label><button className="text-button" disabled={validating} onClick={() => { setSource(JSON.stringify(exampleScenario, null, 2)); setValidation(null); setValidationError(''); }}>Reset example</button></div><textarea id="scenario-source" aria-label="Scenario JSON" readOnly={validating} value={source} onChange={(event) => { setSource(event.target.value); setValidation(null); setValidationError(''); }} spellCheck={false} /><div className="editor-footer"><span>Structured inputs · Protected expectations</span><button className="button primary" onClick={() => { void validate(); }} disabled={validating}>{validating ? 'Validating…' : 'Validate contract'}<Icon name="arrow" size={16} /></button></div>
              <div aria-live="polite">{validationError && <div className="validation-result error" role="alert">{validationError}</div>}{validation?.valid && <div className="validation-result success"><Icon name="check" size={19} /><div><strong>Contract is valid</strong><p>{validation.target_count} targets · {validation.step_count} steps · {validation.required_check_count} required checks. Execution capabilities are not yet qualified.</p></div></div>}{validation && !validation.valid && <div className="validation-result error" role="alert"><div><strong>Review the contract</strong><ul>{validation.issues.slice(0, 10).map((issue, index) => <li key={index}><code>{issue.path || 'scenario'}</code>: {issue.message}</li>)}</ul></div></div>}</div>
            </div>
          </div>
        </section>

        <section id="coverage" aria-labelledby="coverage-title"><div className="section-heading"><div><h2 id="coverage-title">One platform. Every committed surface.</h2><p>Required application classes for the complete product. Adapter qualification is still planned.</p></div><span className="outline-badge">PRODUCT ROADMAP</span></div><div className="coverage-grid">{surfaces.map((surface) => <article className="coverage-card" key={surface.title}><Icon name={surface.icon} size={24} /><h3>{surface.title}</h3><p>{surface.detail}</p><span>Planned</span></article>)}</div></section>
        <footer className="workspace-footer"><span><strong>veriqo.</strong> Evidence for the complete outcome.</span><span>Development foundation · Not production ready</span></footer>
      </main>
    </div>
  </div>;
}
