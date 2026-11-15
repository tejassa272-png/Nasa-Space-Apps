import { Settings } from 'lucide-react';
import { DEFAULT_INPUTS, type Inputs } from './engine';

interface SliderDef { key: keyof Inputs; label: string; unit: string; min: number; max: number; step: number; danger: (v: number) => boolean }

const SLIDERS: SliderDef[] = [
  { key: 'co2', label: 'Cabin CO₂', unit: 'ppm', min: 400, max: 5000, step: 50, danger: (v) => v > 3500 },
  { key: 'radiation', label: 'Solar Radiation Flux', unit: 'idx', min: 0, max: 100, step: 1, danger: (v) => v > 70 },
  { key: 'days', label: 'Days in Space', unit: 'd', min: 0, max: 900, step: 5, danger: (v) => v > 600 },
  { key: 'sleep', label: 'Hours of Sleep', unit: 'h', min: 3, max: 9, step: 0.5, danger: (v) => v < 5 },
];

const PRESETS: { name: string; values: Inputs }[] = [
  { name: 'Nominal', values: DEFAULT_INPUTS },
  { name: 'Radiation storm', values: { co2: 1500, radiation: 92, days: 120, sleep: 6 } },
  { name: 'Scrubber failure', values: { co2: 4600, radiation: 20, days: 90, sleep: 5.5 } },
  { name: 'Mars transit', values: { co2: 2600, radiation: 55, days: 700, sleep: 6 } },
  { name: 'Perfect storm', values: { co2: 4800, radiation: 95, days: 400, sleep: 4 } },
];

export default function SandboxPanel({ inputs, onChange }: { inputs: Inputs; onChange: (i: Inputs) => void }) {
  return (
    <div className="panel" style={{ flex: '0 1 auto', minHeight: 0, overflowY: 'auto' }}>
      <div className="panel-header">
        <Settings size={16} color="#9ca3af" /> JUDGE'S SANDBOX
      </div>

      <div className="sb-presets">
        {PRESETS.map((p) => (
          <button key={p.name} className="sb-preset" onClick={() => onChange(p.values)}>
            {p.name}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem 1.5rem' }}>
        {SLIDERS.map((s) => (
          <div key={s.key} className={`sandbox-control ${s.danger(inputs[s.key]) ? 'danger' : ''}`} style={{ marginBottom: 0 }}>
            <label style={{ fontSize: '0.75rem' }}>
              <span>{s.label}</span>
              <span>{inputs[s.key]} {s.unit}</span>
            </label>
            <input
              type="range"
              min={s.min}
              max={s.max}
              step={s.step}
              value={inputs[s.key]}
              onChange={(e) => onChange({ ...inputs, [s.key]: Number(e.target.value) })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
