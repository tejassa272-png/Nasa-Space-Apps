import { useEffect, useMemo, useState } from 'react';
import { Activity, Zap, HeartPulse, Database, TrendingUp, ShieldAlert } from 'lucide-react';
import BioTwin from './BioTwin';
import VitalsChart, { type VitalsSample } from './VitalsChart';
import TriagePanel, { type Protocol, type TriageItem } from './TriagePanel';
import InventoryPanel from './InventoryPanel';
import SandboxPanel from './SandboxPanel';
import SystemPanel from './SystemPanel';
import DemoMenu from './DemoMenu.tsx'
import {
  DEFAULT_INPUTS, STATUS_COLOR, applyLiveFlags, clamp, computeSynergy, readiness, worseOf,
  type Inputs, type Status, type SystemId,
} from './engine';
import './index.css';

const API = 'http://localhost:8000';
const HISTORY_LIMIT = 40;

function App() {
  const [data, setData] = useState({
    vitals: { heart_rate: '--', spo2: '--', bp_sys: '--', bp_dia: '--' } as Record<string, number | string>,
    status: 'Waiting for telemetry...',
    tier: 'Standby',
    triage_protocol: 'System standing by...',
    is_critical: false,
    protocol: null as Protocol | null,
    inventory: [] as TriageItem[],
  });

  const [history, setHistory] = useState<VitalsSample[]>([]);
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [selected, setSelected] = useState<SystemId | null>(null);
  const [tab, setTab] = useState<'guide' | 'triage'>('guide');
  const [unlocked, setUnlocked] = useState<string[]>([]);

  // ---- poll the backend (live Tempus vitals, triage protocol, inventory) ----
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

  // ---- tell the backend the sandbox values (potency of medicines depends on them) ----
  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`${API}/api/environment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inputs),
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [inputs]);

  // A real anomaly switches the right panel to the live triage steps.
  useEffect(() => {
    if (data.is_critical) setTab('triage');
  }, [data.is_critical]);

  // ---- body-system state: sandbox simulation + live Tempus flags ----
  const systems = useMemo(
    () => applyLiveFlags(computeSynergy(inputs), data.is_critical ? data.protocol?.flags : undefined, data.protocol?.severity),
    [inputs, data.is_critical, data.protocol]
  );
  const list = Object.values(systems);
  const worst = list.reduce((a, b) => (b.risk > a.risk ? b : a));
  const active = systems[selected ?? worst.id];
  const score = readiness(systems);
  const scoreColor = score >= 65 ? STATUS_COLOR.nominal : score >= 40 ? STATUS_COLOR.caution : STATUS_COLOR.critical;
  const criticalCount = list.filter((s) => s.status === 'critical').length;
  const anomaly = criticalCount >= 2;
  const overall: Status = list.reduce<Status>((acc, s) => worseOf(acc, s.status), 'nominal');
  const systemCritical = overall === 'critical' || data.is_critical;
  const vignette = clamp((inputs.radiation - 60) / 40);

  const inUse = new Set<string>(
    data.is_critical ? (data.protocol?.steps ?? []).flatMap((st) => (st.item ? [st.item.name] : [])) : []
  );

  const pickSystem = (id: SystemId | null) => {
    setSelected(id);
    if (id) setTab('guide');
  };

  const dispense = (item: TriageItem, key: string) => {
    fetch(`${API}/api/inventory/dispense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ medication: item.name }),
    })
      .then((r) => r.json())
      .then((r) => {
        if (r.ok) setUnlocked((u) => (u.includes(key) ? u : [...u, key]));
        else console.warn('Dispense refused:', r.error);
      })
      .catch((e) => console.error('Dispense failed', e));
  };

  const R = 22;
  const C = 2 * Math.PI * R;

  return (
    <div style={{ display: 'flex', height: '100%', width: '100%' }}>
      
      {/* 1. The Demo Menu on the left */}
      <DemoMenu onNasaSpike={() => {
        // 1. DONKI (Radiation) + OSDR (Microgravity / Time in space)
        // Pushing Days in Space to 600 creates the critical synergy that turns the model RED.
        setInputs(prev => ({ ...prev, radiation: 85, days: 600 }));
        
        // 2. Kickstart a nominal Tempus reading so the charts aren't empty
        fetch('http://localhost:8000/api/tempus/vitals', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            heart_rate: 75, spo2: 98, bp_sys: 118, bp_dia: 76,
            ultrasound_status: 'Clear', bone_status: 'Normal', device: 'Tempus Pro - Lunar Base'
          })
        });
      }} />

      {/* 2. The main dashboard flex container */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1.5rem', overflow: 'hidden', position: 'relative' }}>
        
        {/* Fixed: Reconnected the string and restored the multiplication (*) signs */}
        <div className="vignette" style={{ boxShadow: `inset 0 0 ${120 * vignette}px rgba(239, 68, 68, ${0.55 * vignette})` }} />

        <header className="dashboard-header">
          <div>
            <h1 className="brand-title">AstroTwin</h1>
            <p className="brand-subtitle">EARTH-INDEPENDENT MEDICAL OPERATIONS (EIMO)</p>
          </div>
          <div className="header-status-bar">
            <div className="status-badge">
              <Database size={16} /> ENV: LUNAR BASE
            </div>
            <div className={`status-badge ${systemCritical ? 'critical' : 'nominal'}`}>
              <Activity size={16} /> {systemCritical ? 'CRITICAL ALERT' : 'NOMINAL'}
            </div>
          </div>
        </header>

        <div className="dashboard-grid">
          {/* Left Column: live Tempus vitals + trend */}
          <div className="col-left">
            <div className={`panel ${data.is_critical ? 'critical' : ''}`}>
              <div className="panel-header"><Zap size={16} color="#facc15" /> TEMPUS PRO STREAM</div>

              <div className="data-row">
                <span className="data-label"><HeartPulse size={14} style={{ display: 'inline', marginRight: '4px' }} /> Heart Rate</span>
                <div>
                  <span className={`data-value ${data.is_critical ? 'critical' : 'nominal'}`}>{data.vitals.heart_rate}</span>
                  <span className="data-unit">BPM</span>
                </div>
              </div>
              <div className="data-row">
                <span className="data-label">Blood O2 (SpO2)</span>
                <div>
                  <span className={`data-value ${data.is_critical ? 'critical' : 'nominal'}`}>{data.vitals.spo2}</span>
                  <span className="data-unit">%</span>
                </div>
              </div>
              <div className="data-row">
                <span className="data-label">Blood Pressure</span>
                <div>
                  <span className={`data-value ${data.is_critical ? 'critical' : 'nominal'}`}>{data.vitals.bp_sys}/{data.vitals.bp_dia}</span>
                </div>
              </div>
            </div>

            <div className={`panel ${data.is_critical ? 'critical' : ''}`} style={{ flex: 1, minHeight: 0 }}>
              <div className="panel-header"><TrendingUp size={16} color="#38bdf8" /> VITALS TREND</div>
              <VitalsChart history={history} />
            </div>
          </div>

          {/* Center Column: Judge's Sandbox + Bio-Twin */}
          <div className="col-left" style={{ minHeight: 0 }}>
            <SandboxPanel inputs={inputs} onChange={setInputs} />

            <div
              className={`panel ${systemCritical ? 'critical' : ''}`}
              style={{ flex: '1 1 0', minHeight: '320px', padding: 0, backgroundColor: '#090e17' }}
            >
              <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
                <BioTwin systems={systems} selected={selected} onSelect={pickSystem} tint={overall} />

                <div style={{ position: 'absolute', top: '0.75rem', left: '1rem', fontSize: '0.7rem', letterSpacing: '0.1em', color: 'var(--accent-blue)', pointerEvents: 'none' }}>
                  3D BIO-TWIN · CLICK A DOT
                </div>

                <div className="readiness">
                  <div className="readiness-label">MISSION<br />READINESS</div>
                  <svg width="56" height="56" viewBox="0 0 56 56">
                    <circle cx="28" cy="28" r={R} fill="none" stroke="rgba(148,163,184,0.2)" strokeWidth="5" />
                    <circle
                      cx="28" cy="28" r={R} fill="none" stroke={scoreColor} strokeWidth="5" strokeLinecap="round"
                      strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)}
                      transform="rotate(-90 28 28)" style={{ transition: 'all 0.6s ease' }}
                    />
                    <text x="28" y="33" textAnchor="middle" fill={scoreColor} fontSize="14" fontWeight="700">{score}</text>
                  </svg>
                </div>

                <div style={{ position: 'absolute', bottom: '0.75rem', width: '100%', textAlign: 'center', pointerEvents: 'none' }}>
                  {anomaly ? (
                    <span className="anomaly-banner" style={{ position: 'static', transform: 'none', display: 'inline-flex' }}>
                      <ShieldAlert size={15} /> MULTI-STRESSOR ANOMALY DETECTED
                    </span>
                  ) : (
                    <span style={{ fontWeight: 700, fontSize: '0.8rem', letterSpacing: '0.1em', color: STATUS_COLOR[overall] }}>
                      {overall === 'critical' ? 'CRITICAL HAZARD DETECTED' : overall === 'caution' ? 'CAUTION: MONITOR CLOSELY' : 'BIOMETRICS NOMINAL'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: live inventory + system guide / live triage */}
          <div className="col-right">
            <InventoryPanel items={data.inventory ?? []} inUse={inUse} />

            <div className={`panel ${data.is_critical ? 'critical' : ''}`} style={{ flex: 1, minHeight: 0 }}>
              <div className="panel-header" style={{ justifyContent: 'space-between' }}>
                <div className="tabs">
                  <button className={`tab ${tab === 'guide' ? 'active' : ''}`} onClick={() => setTab('guide')}>SYSTEM GUIDE</button>
                  <button className={`tab ${tab === 'triage' ? 'active' : ''}`} onClick={() => setTab('triage')}>
                    LIVE TRIAGE{data.is_critical && <span className="tab-dot" />}
                  </button>
                </div>
                <span style={{ color: data.is_critical ? 'var(--status-critical)' : 'var(--status-nominal)', fontSize: '0.7rem' }}>
                  RAG: ONLINE
                </span>
              </div>

              {tab === 'guide' ? (
                <SystemPanel system={active} inventory={data.inventory ?? []} unlocked={unlocked} onDispense={dispense} />
              ) : (
                <TriagePanel protocol={data.protocol} active={data.is_critical} />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;