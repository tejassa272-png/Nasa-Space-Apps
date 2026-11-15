import { lazy, Suspense, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  Activity, ArrowDownRight, ArrowUpRight, Box, ChevronRight, Crosshair, FlaskConical,
  HeartPulse, LayoutGrid, Orbit, Radio, RefreshCw, ShieldPlus, Signal, Wind,
} from 'lucide-react';
import VitalsChart from './VitalsChart';
import TriagePanel from './TriagePanel';
import InventoryPanel from './InventoryPanel';
import SandboxPanel from './SandboxPanel';
import SystemPanel from './SystemPanel';
import DemoMenu from './DemoMenu';
import { api, ApiError, getErrorMessage, type Protocol, type TriageItem } from './api';
import {
  DEFAULT_INPUTS, applyLiveFlags, computeSynergy, readiness, worseOf,
  type Inputs, type Status, type SystemId,
} from './engine';
import { useMissionState } from './useMissionState';

const BioTwin = lazy(() => import('./BioTwin'));

const NAVIGATION = [
  { id: 'overview', label: 'Overview', icon: LayoutGrid },
  { id: 'responses', label: 'Crew response', icon: ShieldPlus },
  { id: 'medical-kit', label: 'Medical kit', icon: Box },
  { id: 'simulation', label: 'Simulation lab', icon: FlaskConical },
] as const;

type SectionId = (typeof NAVIGATION)[number]['id'];
type ResponseTab = 'triage' | 'guide';

const RING_CIRCUMFERENCE = 2 * Math.PI * 18;
const checkedTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const receivedTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const EMPTY_INVENTORY: TriageItem[] = [];
const EMPTY_PROTOCOLS: Protocol[] = [];

function subscribeToHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

function readSection(): SectionId {
  return NAVIGATION.find(({ id }) => `#${id}` === window.location.hash)?.id ?? 'overview';
}

function Metric({
  label, value, unit, icon, tone, detail, graphic,
}: {
  label: string;
  value: number | string;
  unit: string;
  icon: ReactNode;
  tone: 'pink' | 'cyan' | 'blue' | 'green';
  detail: string;
  graphic?: ReactNode;
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-head"><span className="metric-icon">{icon}</span><h2>{label}</h2></div>
      <div className="metric-reading">
        <div><span className="metric-number">{value}</span>{value !== '—' && <span className="metric-unit">{unit}</span>}</div>
        {graphic}
      </div>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

function AccessForm({ onSignIn, pending, error }: {
  onSignIn: (key: string) => void;
  pending: boolean;
  error: string | null;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = new FormData(form).get('access-key');
    form.reset();
    if (typeof key === 'string' && key.trim()) onSignIn(key.trim());
  }

  return (
    <main className="access-screen">
      <section className="panel access-panel" aria-labelledby="access-title">
        <span className="brand-icon"><Orbit size={23} aria-hidden="true" /></span>
        <h1 id="access-title">Sign in to AstroTwin</h1>
        <p>Enter your viewer or operator access key.</p>
        <form onSubmit={submit}>
          <label htmlFor="access-key">Access key</label>
          <input id="access-key" name="access-key" type="password" autoComplete="off" maxLength={256} required disabled={pending} />
          {error && <p className="access-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const mission = useMissionState();
  if (mission.requiresAuth) {
    return <AccessForm onSignIn={mission.signIn} pending={mission.session !== null} error={mission.authError} />;
  }
  return <Dashboard key={mission.session?.id ?? 0} mission={mission} />;
}
  // --- UI Routing State ---
  // The default view is now the Judge's Sandbox
  const [view, setView] = useState<'sandbox' | 'triage' | 'inventory' | 'demo'>('sandbox');

type SectionId = (typeof NAVIGATION)[number]['id'];
type ResponseTab = 'triage' | 'guide';

function Dashboard({ mission }: { mission: ReturnType<typeof useMissionState> }) {
  const { data, checkedAt, connection, history, refresh, session, signOut, handleUnauthorized } = mission;
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [selected, setSelected] = useState<SystemId | null>(null);
  const [tabChoice, setTabChoice] = useState<{ tab: ResponseTab; alertId: number | null } | null>(null);
  const section = useSyncExternalStore(subscribeToHash, readSection);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const dispenseRequests = useRef(new Map<string, string>());
  const [dispensePending, setDispensePending] = useState(false);
  const [dispenseError, setDispenseError] = useState<string | null>(null);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [environmentResult, setEnvironmentResult] = useState<{ inputs: Inputs; tone: 'success' | 'error'; text: string } | null>(null);
  const [chosenProtocolId, setChosenProtocolId] = useState<number | null>(null);

  const connected = connection === 'online';
  const isCritical = data?.is_critical === true;
  const storedProtocol = data?.protocol ?? null;
  const activeProtocols = useMemo(
    () => data?.active_protocols ?? (isCritical && storedProtocol ? [storedProtocol] : EMPTY_PROTOCOLS),
    [data?.active_protocols, isCritical, storedProtocol],
  );
  const primaryProtocol = activeProtocols[0] ?? null;
  const protocol = activeProtocols.find(({ id }) => id === chosenProtocolId) ?? primaryProtocol ?? storedProtocol;
  const inventory = data?.inventory ?? EMPTY_INVENTORY;
  const demoMode = data !== null && (data.access?.demo ?? true);
  const canDispense = data?.access?.can_dispense ?? demoMode;
  const canCheckNasa = demoMode || data?.access?.role === 'operator';
  const staleAt = data?.telemetry_stale === true ? data.telemetry_observed_at ?? data.telemetry_received_at ?? null : null;
  const alertId = isCritical ? primaryProtocol?.id ?? 0 : null;
  const tab = tabChoice?.alertId === alertId ? tabChoice.tab : 'triage';
  // ---- poll the backend ----
  useEffect(() => {
    const interval = setInterval(() => {
      fetch(`${API}/api/state`)
        .then((res) => res.json())
        .then((state) => {
          setData(state);
          const v = state?.vitals;
          if (v && typeof v.heart_rate === 'number') {
            const sample: VitalsSample = { hr: v.heart_rate, spo2: v.spo2, sys: v.bp_sys, dia: v.bp_dia };
            setHistory((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.hr === sample.hr && last.spo2 === sample.spo2 && last.sys === sample.sys && last.dia === sample.dia) {
                return prev;
              }
              return [...prev, sample].slice(-HISTORY_LIMIT);
            });
          }
        })
        .catch((err) => console.error('Backend offline', err));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

function readSection(): SectionId {
  return NAVIGATION.find(({ id }) => `#${id}` === window.location.hash)?.id ?? 'overview';
}

function Metric({
  label, value, unit, icon, tone, detail, graphic,
}: {
  label: string;
  value: number | string;
  unit: string;
  icon: ReactNode;
  tone: 'pink' | 'cyan' | 'blue' | 'green';
  detail: string;
  graphic?: ReactNode;
}) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-head"><span className="metric-icon">{icon}</span><h2>{label}</h2></div>
      <div className="metric-reading">
        <div><span className="metric-number">{value}</span>{value !== '—' && <span className="metric-unit">{unit}</span>}</div>
        {graphic}
      </div>
      <p className="metric-detail">{detail}</p>
    </article>
  );
}

function AccessForm({ onSignIn, pending, error }: {
  onSignIn: (key: string) => void;
  pending: boolean;
  error: string | null;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const key = new FormData(form).get('access-key');
    form.reset();
    if (typeof key === 'string' && key.trim()) onSignIn(key.trim());
  }

  return (
    <main className="access-screen">
      <section className="panel access-panel" aria-labelledby="access-title">
        <span className="brand-icon"><Orbit size={23} aria-hidden="true" /></span>
        <h1 id="access-title">Sign in to AstroTwin</h1>
        <p>Enter your viewer or operator access key.</p>
        <form onSubmit={submit}>
          <label htmlFor="access-key">Access key</label>
          <input id="access-key" name="access-key" type="password" autoComplete="off" maxLength={256} required disabled={pending} />
          {error && <p className="access-error" role="alert">{error}</p>}
          <button type="submit" className="button button-primary" disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}

function App() {
  const mission = useMissionState();
  if (mission.requiresAuth) {
    return <AccessForm onSignIn={mission.signIn} pending={mission.session !== null} error={mission.authError} />;
  }
  return <Dashboard key={mission.session?.id ?? 0} mission={mission} />;
}

function Dashboard({ mission }: { mission: ReturnType<typeof useMissionState> }) {
  const { data, checkedAt, connection, history, refresh, session, signOut, handleUnauthorized } = mission;
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [selected, setSelected] = useState<SystemId | null>(null);
  const [tabChoice, setTabChoice] = useState<{ tab: ResponseTab; alertId: number | null } | null>(null);
  const section = useSyncExternalStore(subscribeToHash, readSection);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const dispenseRequests = useRef(new Map<string, string>());
  const [dispensePending, setDispensePending] = useState(false);
  const [dispenseError, setDispenseError] = useState<string | null>(null);
  const [unconfirmedDispenses, setUnconfirmedDispenses] = useState<string[]>([]);
  const [simulationBusy, setSimulationBusy] = useState(false);
  const [applying, setApplying] = useState(false);
  const [environmentResult, setEnvironmentResult] = useState<{ inputs: Inputs; tone: 'success' | 'error'; text: string } | null>(null);
  const [chosenProtocolId, setChosenProtocolId] = useState<number | null>(null);

  const connected = connection === 'online';
  const isCritical = data?.is_critical === true;
  const storedProtocol = data?.protocol ?? null;
  const activeProtocols = useMemo(
    () => data?.active_protocols ?? (isCritical && storedProtocol ? [storedProtocol] : EMPTY_PROTOCOLS),
    [data?.active_protocols, isCritical, storedProtocol],
  );
  const primaryProtocol = activeProtocols[0] ?? null;
  const protocol = activeProtocols.find(({ id }) => id === chosenProtocolId) ?? primaryProtocol ?? storedProtocol;
  const inventory = data?.inventory ?? EMPTY_INVENTORY;
  const demoMode = data !== null && (data.access?.demo ?? true);
  const canDispense = data?.access?.can_dispense ?? demoMode;
  const canCheckNasa = demoMode || data?.access?.role === 'operator';
  const staleAt = data?.telemetry_stale === true ? data.telemetry_observed_at ?? data.telemetry_received_at ?? null : null;
  const alertId = isCritical ? primaryProtocol?.id ?? 0 : null;
  const tab = tabChoice?.alertId === alertId ? tabChoice.tab : 'triage';
  const systems = useMemo(
    () => activeProtocols.reduceRight(
      (state, alert) => applyLiveFlags(state, alert.flags, alert.severity),
      computeSynergy(inputs),
    ),
    [inputs, activeProtocols],
  );
  const list = Object.values(systems);
  const worst = list.reduce((highest, system) => system.risk > highest.risk ? system : highest);
  const activeSystem = systems[selected ?? worst.id];
  const overall = list.reduce<Status>((previous, system) => worseOf(previous, system.status), 'nominal');
  const readinessScore = readiness(systems);
  const flagsUsed = list.some((system) => system.live);
  const inUse = new Set(activeProtocols.flatMap(({ steps }) => steps.flatMap((step) => step.item ? [step.item.name] : [])));
  const vitals = data?.vitals;
  const streamDetail = typeof vitals?.heart_rate !== 'number'
    ? 'Awaiting telemetry'
    : staleAt !== null || !connected ? 'Last received reading' : 'Latest reading';
  const simulationLocked = simulationBusy || applying || dispensePending;

  function changeTab(next: ResponseTab) {
    setTabChoice({ tab: next, alertId });
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'triage' : event.key === 'End' ? 'guide' : tab === 'triage' ? 'guide' : 'triage';
    changeTab(next);
    document.getElementById(`response-tab-${next}`)?.focus();
  }

  function pickSystem(id: SystemId | null) {
    setSelected(id);
    setDispenseError(null);
    if (id) changeTab('guide');
  }

  async function dispense(item: TriageItem, key: string) {
    if (!connected || !canDispense || (!demoMode && !activeSystem.live) || simulationLocked || unlocked.includes(key)) return;
    const priorKey = dispenseRequests.current.get(key);
    if (priorKey && !data?.access) {
      setDispenseError('The earlier dispense is unconfirmed. Check the inventory before recording it again.');
      return;
    }
    const requestKey = priorKey ?? crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    dispenseRequests.current.set(key, requestKey);
    setDispensePending(true);
    setDispenseError(null);
    try {
      await api.dispense(item.name, requestKey, session);
      dispenseRequests.current.delete(key);
      setUnlocked((current) => [...current, key]);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 408 && error.status !== 429) {
        dispenseRequests.current.delete(key);
      }
      handleUnauthorized(error, session);
      setDispenseError(getErrorMessage(error));
    } finally {
      refresh();
      setDispensePending(false);
    }
  }
    if (id) {
      setTab('guide');
    }
    const requestKey = priorKey ?? crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    dispenseRequests.current.set(key, requestKey);
    setDispensePending(true);
    setDispenseError(null);
    try {
      await api.dispense(item.name, requestKey, session);
      dispenseRequests.current.delete(key);
      setUnconfirmedDispenses((current) => current.filter((itemKey) => itemKey !== key));
      setUnlocked((current) => [...current, key]);
    } catch (error) {
      if (error instanceof ApiError && error.status < 500 && error.status !== 408 && error.status !== 429) {
        dispenseRequests.current.delete(key);
        setUnconfirmedDispenses((current) => current.filter((itemKey) => itemKey !== key));
      } else if (data?.access) {
        setUnconfirmedDispenses((current) => current.includes(key) ? current : [...current, key]);
      }
      handleUnauthorized(error, session);
      setDispenseError(getErrorMessage(error));
    } finally {
      refresh();
      setDispensePending(false);
    }
  }

  async function applyEnvironment() {
    if (!connected || !demoMode || simulationLocked) return;
    setApplying(true);
    setEnvironmentResult(null);
    try {
      const result = await api.setEnvironment(inputs);
      setEnvironmentResult({
        inputs,
        tone: 'success',
        text: `Inputs applied. The API reports ${result.extra_potency_loss_pct}% additional potency loss for pills and doses.`,
      });
    } catch (error) {
      setEnvironmentResult({ inputs, tone: 'error', text: getErrorMessage(error) });
    } finally {
      refresh();
      setApplying(false);
    }
  }

  const changeInputs = (next: Inputs) => {
    setInputs(next);
    setEnvironmentResult(null);
  };

  const alertTone = isCritical ? (primaryProtocol?.severity === 'CRITICAL' ? 'critical' : 'warning') : 'neutral';
  const device = vitals?.device ?? 'Tempus Pro';
  const bloodPressure = typeof vitals?.bp_sys === 'number' && typeof vitals.bp_dia === 'number'
    ? `${vitals.bp_sys}/${vitals.bp_dia}`
    : '—';

  return (
    <div className="app-shell">
      <a className="skip-link" href="#overview">Skip to mission overview</a>
      <aside className="app-sidebar">
        <a className="app-brand" href="#overview">
          <span className="brand-icon"><Orbit size={23} aria-hidden="true" /></span>
          <span><strong>AstroTwin</strong><small>CREW HEALTH SYSTEM</small></span>
        </a>
        <nav aria-label="Mission workspace">
          <p className="nav-label">Workspace</p>
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <a
              className="nav-link"
              key={id}
              href={`#${id}`}
              aria-current={section === id ? 'location' : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight className="nav-chevron" size={14} aria-hidden="true" />
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-foot-icon"><Radio size={17} aria-hidden="true" /></span>
          <div><strong>Lunar base</strong><small>Mission workspace</small></div>
        </div>
      </aside>

      <div className="workspace">
        <header className="workspace-bar">
          <div className="workspace-path"><span>Mission control</span><ChevronRight size={13} aria-hidden="true" /><strong>{NAVIGATION.find(({ id }) => id === section)?.label}</strong></div>
          <div className="workspace-connection">
            {checkedAt !== null && <span className="last-sync">Checked {checkedTime.format(checkedAt)}</span>}
            <span className={`connection-pill connection-${connection}`} role="status">
              <span className="connection-dot" aria-hidden="true" />
              {connected ? 'API connected' : connection === 'offline' ? 'API offline' : 'Connecting'}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-shell">
      <a className="skip-link" href="#overview">Skip to mission overview</a>
      <aside className="app-sidebar">
        <a className="app-brand" href="#overview">
          <span className="brand-icon"><Orbit size={23} aria-hidden="true" /></span>
          <span><strong>AstroTwin</strong><small>CREW HEALTH SYSTEM</small></span>
        </a>
        <nav aria-label="Mission workspace">
          <p className="nav-label">Workspace</p>
          {NAVIGATION.map(({ id, label, icon: Icon }) => (
            <a
              className="nav-link"
              key={id}
              href={`#${id}`}
              aria-current={section === id ? 'location' : undefined}
            >
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
              <ChevronRight className="nav-chevron" size={14} aria-hidden="true" />
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="sidebar-foot-icon"><Radio size={17} aria-hidden="true" /></span>
          <div><strong>Lunar base</strong><small>Mission workspace</small></div>
        </div>
      </aside>
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      
      {/* --- MASTER NAVIGATION SIDEBAR --- */}
      <nav className="master-nav">
        <div className="nav-brand">AT</div>
        <button className={`nav-item ${view === 'sandbox' ? 'active' : ''}`} onClick={() => setView('sandbox')} title="Judge's Sandbox">
          <Sliders size={20} />
        </button>
        <button className={`nav-item ${view === 'triage' ? 'active' : ''}`} onClick={() => setView('triage')} title="System Guide & Live Triage">
          <Stethoscope size={20} />
        </button>
        <button className={`nav-item ${view === 'inventory' ? 'active' : ''}`} onClick={() => setView('inventory')} title="Medical Inventory">
          <Package size={20} />
        </button>
        <button className={`nav-item ${view === 'demo' ? 'active' : ''}`} onClick={() => setView('demo')} title="Demo Mode">
          <MonitorPlay size={20} />
        </button>
      </nav>

      {/* --- MAIN CONTENT AREA --- */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflow: 'hidden', position: 'relative' }}>
        <div className="vignette" style={{ boxShadow: `inset 0 0 ${120 * vignette}px rgba(239,68,68,${0.55 * vignette})` }} />

      <div className="workspace">
        <header className="workspace-bar">
          <div className="workspace-path"><span>Mission control</span><ChevronRight size={13} aria-hidden="true" /><strong>{NAVIGATION.find(({ id }) => id === section)?.label}</strong></div>
          <div className="workspace-connection">
            {checkedAt !== null && <span className="last-sync">Checked {checkedTime.format(checkedAt)}</span>}
            <span className={`connection-pill connection-${connection}`} role="status">
              <span className="connection-dot" aria-hidden="true" />
              {connected ? 'API connected' : connection === 'offline' ? 'API offline' : 'Connecting'}
            </span>
            {session && <button type="button" className="button button-secondary sign-out" onClick={() => signOut()}>Sign out</button>}
          </div>
        </header>

        <main className="workspace-main" id="overview" tabIndex={-1}>
          <div className="workspace-intro">
            <div>
              <p className="section-kicker"><Crosshair size={14} aria-hidden="true" /> Earth-independent medical operations</p>
              <h1>Crew health overview</h1>
              <p className="intro-description">Monitor crew telemetry, inspect body-system risks, and review onboard response protocols.</p>
            </div>
            <a className="button button-primary" href="#simulation">
              <FlaskConical size={16} aria-hidden="true" /> Simulation lab <ArrowUpRight size={15} aria-hidden="true" />
            </a>
          </div>

          {connection === 'offline' && (
            <div className="offline-banner">
              <div><Signal size={17} aria-hidden="true" /><p><strong>Backend unavailable.</strong> {data ? 'Showing the last received data. The dashboard reconnects automatically.' : 'Live telemetry and inventory will appear when the API is reachable.'}</p></div>
              <button type="button" className="button button-secondary" onClick={refresh}><RefreshCw size={14} aria-hidden="true" /> Retry connection</button>
            </div>
          )}

          {staleAt !== null && connected && (
            <div className="offline-banner" role="status">
              <div><Signal size={17} aria-hidden="true" /><p><strong>Telemetry is stale.</strong> Latest measurement from {receivedTime.format(staleAt * 1000)}.</p></div>
            </div>
          )}

          <section className="metrics-grid" aria-label="Crew health indicators">
            <Metric label="Heart rate" value={vitals?.heart_rate === '--' ? '—' : vitals?.heart_rate ?? '—'} unit="bpm" tone="pink" icon={<HeartPulse size={17} />} detail={streamDetail} />
            <Metric label="Blood oxygen" value={vitals?.spo2 === '--' ? '—' : vitals?.spo2 ?? '—'} unit="%" tone="cyan" icon={<Wind size={17} />} detail={streamDetail} />
            <Metric label="Blood pressure" value={bloodPressure} unit="mmHg" tone="blue" icon={<Activity size={17} />} detail={streamDetail} />
            <Metric
              label="Mission readiness"
              value={readinessScore}
              unit="/ 100"
              tone="green"
              icon={<Crosshair size={17} />}
              detail={flagsUsed ? 'Sandbox model with API flags' : 'Sandbox model score'}
              graphic={
                <svg className="metric-ring" viewBox="0 0 46 46" aria-hidden="true">
                  <circle cx="23" cy="23" r="18" />
                  <circle className="metric-ring-value" cx="23" cy="23" r="18" transform="rotate(-90 23 23)" strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={RING_CIRCUMFERENCE * (1 - readinessScore / 100)} />
                </svg>
              }
            />
          </section>

          <div className="workspace-grid">
            <section className="panel twin-panel" aria-labelledby="twin-title">
              <div className="card-heading">
                <div className="card-heading-main">
                  <span className="card-icon"><Orbit size={19} aria-hidden="true" /></span>
                  <div><h2 id="twin-title">Crew digital twin</h2><p>Explore the modeled state of six body systems.</p></div>
                </div>
                <span className={`state-tag state-${overall}`}>{overall === 'nominal' ? 'Nominal model' : overall === 'caution' ? 'Model caution' : 'Critical model'}</span>
              </div>
              <Suspense fallback={<div className="twin-loading" role="status">Loading digital twin…</div>}>
                <BioTwin systems={systems} selected={selected} onSelect={pickSystem} tint={overall} />
              </Suspense>
              {selected && <a className="twin-guide-link" href="#responses">View {activeSystem.label} guide <ArrowDownRight size={14} aria-hidden="true" /></a>}
            </section>

            <section className="panel response-panel" id="responses" aria-labelledby="response-title">
              <div className="card-heading">
                <div className="card-heading-main">
                  <span className="card-icon"><ShieldPlus size={19} aria-hidden="true" /></span>
                  <div><h2 id="response-title">Crew response</h2><p>{connected && isCritical ? data.status : 'Incident guidance and system checks'}</p></div>
                </div>
                {connected && isCritical && <span className={`state-tag state-${alertTone}`}>{primaryProtocol?.severity === 'CRITICAL' ? 'Critical' : primaryProtocol ? 'Warning' : 'Alert'}</span>}
              </div>
              <div className="response-tabs" role="tablist" aria-label="Response views">
                {(['triage', 'guide'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    id={`response-tab-${view}`}
                    aria-selected={tab === view}
                    aria-controls="response-content"
                    tabIndex={tab === view ? 0 : -1}
                    onClick={() => changeTab(view)}
                    onKeyDown={onTabKey}
                  >
                    {view === 'triage' ? 'Live triage' : 'System guide'}
                    {view === 'triage' && connected && isCritical && <span className="tab-alert" aria-label="Alert active" />}
                  </button>
                ))}
              </div>
              <div className="response-body" id="response-content" role="tabpanel" aria-labelledby={`response-tab-${tab}`} tabIndex={0}>
                {tab === 'triage' ? (
                  <>
                    {activeProtocols.length > 1 && (
                      <label className="protocol-select">
                        <span>Active alert</span>
                        <select value={protocol?.id} onChange={(event) => setChosenProtocolId(Number(event.target.value))}>
                          {activeProtocols.map((alert) => <option value={alert.id} key={alert.id}>{alert.headline}</option>)}
                        </select>
                      </label>
                    )}
                    <TriagePanel protocol={protocol} active={isCritical} connection={connection} inventory={inventory} />
                  </>
                ) : (
                  <SystemPanel
                    system={activeSystem}
                    inventory={inventory}
                    unlocked={unlocked}
                    onDispense={dispense}
                    dispensePending={dispensePending}
                    dispenseError={dispenseError}
                    inventoryAvailable={connected && canDispense && (demoMode || Boolean(activeSystem.live)) && !applying && !simulationBusy}
                  />
                )}
              </div>
            </section>

            <section className="panel trends-panel" aria-labelledby="trends-title">
              <div className="card-heading">
                <div className="card-heading-main">
                  <span className="card-icon"><Activity size={19} aria-hidden="true" /></span>
                  <div><h2 id="trends-title">Telemetry trends</h2><p>{device}</p></div>
                </div>
              </div>
              <VitalsChart history={history} />
            </section>

            <div className="inventory-anchor" id="medical-kit">
              <InventoryPanel items={inventory} inUse={inUse} connection={connection} />
        {/* PAGE 1: Judge's Sandbox */}
        {view === 'sandbox' && (
          <div className="dashboard-grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
            <div className="col-left" style={{ minHeight: 0 }}>
              <SandboxPanel inputs={inputs} onChange={setInputs} />
              {renderTwin()}
            </div>
          )}

          {staleAt !== null && connected && (
            <div className="offline-banner" role="status">
              <div><Signal size={17} aria-hidden="true" /><p><strong>Telemetry is stale.</strong> Latest measurement from {receivedTime.format(staleAt * 1000)}.</p></div>
            </div>
          )}

          <section className="metrics-grid" aria-label="Crew health indicators">
            <Metric label="Heart rate" value={vitals?.heart_rate === '--' ? '—' : vitals?.heart_rate ?? '—'} unit="bpm" tone="pink" icon={<HeartPulse size={17} />} detail={streamDetail} />
            <Metric label="Blood oxygen" value={vitals?.spo2 === '--' ? '—' : vitals?.spo2 ?? '—'} unit="%" tone="cyan" icon={<Wind size={17} />} detail={streamDetail} />
            <Metric label="Blood pressure" value={bloodPressure} unit="mmHg" tone="blue" icon={<Activity size={17} />} detail={streamDetail} />
            <Metric
              label="Mission readiness"
              value={readinessScore}
              unit="/ 100"
              tone="green"
              icon={<Crosshair size={17} />}
              detail={flagsUsed ? 'Sandbox model with API flags' : 'Sandbox model score'}
              graphic={
                <svg className="metric-ring" viewBox="0 0 46 46" aria-hidden="true">
                  <circle cx="23" cy="23" r="18" />
                  <circle className="metric-ring-value" cx="23" cy="23" r="18" transform="rotate(-90 23 23)" strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={RING_CIRCUMFERENCE * (1 - readinessScore / 100)} />
                </svg>
              }
            />
          </section>

          <div className="workspace-grid">
            <section className="panel twin-panel" aria-labelledby="twin-title">
              <div className="card-heading">
                <div className="card-heading-main">
                  <span className="card-icon"><Orbit size={19} aria-hidden="true" /></span>
                  <div><h2 id="twin-title">Crew digital twin</h2><p>Explore the modeled state of six body systems.</p></div>
                </div>
                <span className={`state-tag state-${overall}`}>{overall === 'nominal' ? 'Nominal model' : overall === 'caution' ? 'Model caution' : 'Critical model'}</span>
              </div>
              <Suspense fallback={<div className="twin-loading" role="status">Loading digital twin…</div>}>
                <BioTwin systems={systems} selected={selected} onSelect={pickSystem} tint={overall} />
              </Suspense>
              {selected && <a className="twin-guide-link" href="#responses">View {activeSystem.label} guide <ArrowDownRight size={14} aria-hidden="true" /></a>}
            </section>

            <section className="panel response-panel" id="responses" aria-labelledby="response-title">
              <div className="card-heading">
                <div className="card-heading-main">
                  <span className="card-icon"><ShieldPlus size={19} aria-hidden="true" /></span>
                  <div><h2 id="response-title">Crew response</h2><p>{connected && isCritical ? data.status : 'Incident guidance and system checks'}</p></div>
                </div>
                {connected && isCritical && <span className={`state-tag state-${alertTone}`}>{primaryProtocol?.severity === 'CRITICAL' ? 'Critical' : primaryProtocol ? 'Warning' : 'Alert'}</span>}
              </div>
              <div className="response-tabs" role="tablist" aria-label="Response views">
                {(['triage', 'guide'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    role="tab"
                    id={`response-tab-${view}`}
                    aria-selected={tab === view}
                    aria-controls="response-content"
                    tabIndex={tab === view ? 0 : -1}
                    onClick={() => changeTab(view)}
                    onKeyDown={onTabKey}
                  >
                    {view === 'triage' ? 'Live triage' : 'System guide'}
                    {view === 'triage' && connected && isCritical && <span className="tab-alert" aria-label="Alert active" />}
                  </button>
                ))}
              </div>
              <div className="response-body" id="response-content" role="tabpanel" aria-labelledby={`response-tab-${tab}`} tabIndex={0}>
                {tab === 'triage' ? (
                  <>
                    {activeProtocols.length > 1 && (
                      <label className="protocol-select">
                        <span>Active alert</span>
                        <select value={protocol?.id} onChange={(event) => setChosenProtocolId(Number(event.target.value))}>
                          {activeProtocols.map((alert) => <option value={alert.id} key={alert.id}>{alert.headline}</option>)}
                        </select>
                      </label>
                    )}
                    <TriagePanel protocol={protocol} active={isCritical} connection={connection} inventory={inventory} />
                  </>
                ) : (
                  <SystemPanel
                    system={activeSystem}
                    inventory={inventory}
                    unlocked={unlocked}
                    onDispense={dispense}
                    dispensePending={dispensePending}
                    dispenseError={dispenseError}
                    unconfirmedDispenses={unconfirmedDispenses}
                    inventoryAvailable={connected && canDispense && !applying && !simulationBusy}
                    canRecordDispense={demoMode || Boolean(activeSystem.live)}
                  />
                )}
              </div>
            </section>

            <section className="panel trends-panel" aria-labelledby="trends-title">
              <div className="card-heading">
                <div className="card-heading-main">
                  <span className="card-icon"><Activity size={19} aria-hidden="true" /></span>
                  <div><h2 id="trends-title">Telemetry trends</h2><p>{device}</p></div>
                </div>
              </div>
              <VitalsChart history={history} />
            </section>

          <section className="simulation-section" id="simulation" aria-labelledby="simulation-title">
            <div className="section-heading">
              <p className="section-kicker"><FlaskConical size={14} aria-hidden="true" /> Scenario testing</p>
              <h2 id="simulation-title">Simulation lab</h2>
              <p>{demoMode ? 'Model mission conditions or send a test telemetry sequence to the connected backend.' : 'Explore modeled mission conditions in the local sandbox.'}</p>
            </div>
            <div className="workspace-grid">
              <div className="environment-group">
                <SandboxPanel inputs={inputs} onChange={changeInputs} />
                {demoMode && (
                  <div className="environment-actions">
                    <p>Apply these values to update the backend’s environmental assessment and inventory potency.</p>
                    <button type="button" className="button button-secondary" disabled={!connected || simulationLocked} onClick={applyEnvironment}>
                      <Signal size={15} aria-hidden="true" /> {applying ? 'Applying inputs…' : 'Apply to backend'}
                    </button>
                    {environmentResult?.inputs === inputs && <p className={`environment-result result-${environmentResult.tone}`} role={environmentResult.tone === 'error' ? 'alert' : 'status'}>{environmentResult.text}</p>}
                  </div>
                )}
              </div>
              {(demoMode || canCheckNasa) && (
                <DemoMenu
                  disabled={!connected || applying || dispensePending}
                  allowScenarios={demoMode}
                  session={session}
                  onBusyChange={setSimulationBusy}
                  onUpdated={refresh}
                  onUnauthorized={handleUnauthorized}
                />
              )}
            </div>
          </section>
        </main>
        {/* PAGE 3: Medical Inventory (Full Page) */}
        {view === 'inventory' && (
          <div className="dashboard-grid inventory-page" style={{ gridTemplateColumns: '1fr' }}>
            <InventoryPanel items={data.inventory ?? []} inUse={inUse} />
          </div>

          <section className="simulation-section" id="simulation" aria-labelledby="simulation-title">
            <div className="section-heading">
              <p className="section-kicker"><FlaskConical size={14} aria-hidden="true" /> Scenario testing</p>
              <h2 id="simulation-title">Simulation lab</h2>
              <p>{demoMode ? 'Model mission conditions or send a test telemetry sequence to the connected backend.' : 'Explore modeled mission conditions in the local sandbox.'}</p>
            </div>
            <div className="workspace-grid">
              <div className="environment-group">
                <SandboxPanel inputs={inputs} onChange={changeInputs} />
                {demoMode && (
                  <div className="environment-actions">
                    <p>Apply these values to update the backend’s environmental assessment and inventory potency.</p>
                    <button type="button" className="button button-secondary" disabled={!connected || simulationLocked} onClick={applyEnvironment}>
                      <Signal size={15} aria-hidden="true" /> {applying ? 'Applying inputs…' : 'Apply to backend'}
                    </button>
                    {environmentResult?.inputs === inputs && <p className={`environment-result result-${environmentResult.tone}`} role={environmentResult.tone === 'error' ? 'alert' : 'status'}>{environmentResult.text}</p>}
                  </div>
                )}
              </div>
              {(demoMode || canCheckNasa) && (
                <DemoMenu
                  disabled={!connected || applying || dispensePending}
                  allowScenarios={demoMode}
                  session={session}
                  onBusyChange={setSimulationBusy}
                  onUpdated={refresh}
                  onUnauthorized={handleUnauthorized}
                />
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

export default App;
