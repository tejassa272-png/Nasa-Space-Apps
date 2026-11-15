import { useState } from 'react';
import { Activity, Watch, ShieldAlert, CheckCircle2, Bone, Eye, Wind, Satellite, Radio } from 'lucide-react';
import './DemoMenu.css';

const API_VITALS = 'http://localhost:8000/api/tempus/vitals';
const API_NASA = 'http://localhost:8000/api/nasa/sync';

interface Payload {
  heart_rate: number;
  spo2: number;
  bp_sys: number;
  bp_dia: number;
  ultrasound_status: string;
  bone_status: string;
  device: string;
}

const r = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const base = (): Payload => ({
  heart_rate: r(60, 80), spo2: r(97, 100), bp_sys: r(110, 120), bp_dia: r(70, 80),
  ultrasound_status: 'Clear', bone_status: 'Normal', device: 'Tempus Pro - Lunar Base'
});

const runSequence = async (anomalyFn: () => Payload) => {
  for (let i = 0; i < 3; i++) {
    await fetch(API_VITALS, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(base()),
    });
    await new Promise(resolve => setTimeout(resolve, 1200)); 
  }
  await fetch(API_VITALS, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(anomalyFn()),
  });
};

const SCENARIOS = [
  { label: 'Nominal Recovery', icon: CheckCircle2, color: 'var(--status-nominal)', action: () => runSequence(() => base()) },
  { label: 'Hypoxia (Lungs)', icon: Wind, color: 'var(--status-warning)', action: () => runSequence(() => ({ ...base(), spo2: r(86, 92) })) },
  { label: 'Edema (SANS)', icon: Eye, color: 'var(--status-warning)', action: () => runSequence(() => ({ ...base(), ultrasound_status: 'Optic Disc Edema Detected' })) },
  { label: 'Bone Resorption', icon: Bone, color: 'var(--status-warning)', action: () => runSequence(() => ({ ...base(), bone_status: 'Bone Density Loss Detected' })) },
  { label: 'Full System Anomaly', icon: ShieldAlert, color: 'var(--status-critical)', action: () => runSequence(() => ({ ...base(), heart_rate: r(110, 130), spo2: r(88, 93), bp_sys: r(140, 160), bp_dia: r(90, 100), ultrasound_status: 'Optic Disc Edema Detected' })) },
];

const EDGE_SCENARIO = {
  label: 'Trigger Edge Node Alert',
  icon: Watch,
  color: '#a855f7',
  action: () => runSequence(() => ({
    heart_rate: r(105, 120), spo2: r(88, 94), bp_sys: r(120, 135), bp_dia: r(80, 90),
    ultrasound_status: 'Clear', bone_status: 'Normal', device: 'Astro-Watch Series 1 (Edge Node)'
  }))
};

// ADDED THE PROP HERE
export default function DemoMenu({ onNasaSpike }: { onNasaSpike?: () => void }) {
  const [nasaLive, setNasaLive] = useState(false);

  const toggleNasaSync = async () => {
    const newState = !nasaLive;
    setNasaLive(newState);
    try {
      await fetch(API_NASA, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: newState }),
      });
      
      // TELL THE FRONTEND TO JUMP THE SLIDER
      if (newState && onNasaSpike) {
        onNasaSpike();
      }
      
    } catch (e) {
      console.error("NASA API Connection failed", e);
      setNasaLive(false);
    }
  };

  return (
    <aside className="demo-menu">
      <div className="dm-header">
        <Activity size={16} /> DEMO CONTROL
      </div>
      
      <div className="dm-section">
        <div className="dm-subtitle">OFFICIAL NASA APIs</div>
        <p className="dm-desc">Query live OSDR & DONKI Space Weather databases.</p>
        <button 
          className="dm-btn" 
          onClick={toggleNasaSync}
          style={{ 
            borderColor: nasaLive ? 'var(--status-nominal)' : 'var(--panel-border)',
            background: nasaLive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(255, 255, 255, 0.03)'
          }}
        >
          {nasaLive ? <Radio size={14} color="var(--status-nominal)" className="animate-pulse" /> : <Satellite size={14} color="var(--text-secondary)" />}
          {nasaLive ? 'Uplink Active (Live)' : 'Connect NASA Uplink'}
        </button>
      </div>

      <div className="dm-divider" />

      <div className="dm-section">
        <div className="dm-subtitle">TEMPUS PRO (HUB)</div>
        {SCENARIOS.map((s) => (
          <button key={s.label} className="dm-btn" onClick={s.action}>
            <s.icon size={14} style={{ color: s.color }} />
            {s.label}
          </button>
        ))}
      </div>

      <div className="dm-divider" />

      <div className="dm-section">
        <div className="dm-subtitle">WEARABLE (SPOKE)</div>
        <p className="dm-desc">Simulates GPU-less TinyML bypassing network until critical.</p>
        <button className="dm-btn edge" onClick={EDGE_SCENARIO.action}>
          <EDGE_SCENARIO.icon size={14} style={{ color: EDGE_SCENARIO.color }} />
          {EDGE_SCENARIO.label}
        </button>
      </div>
    </aside>
  );
}