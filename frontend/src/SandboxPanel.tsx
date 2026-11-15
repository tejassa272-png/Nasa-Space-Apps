import { useId, type CSSProperties } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { DEFAULT_INPUTS, type Inputs } from './engine';
import './SandboxPanel.css';

interface Slider {
  key: keyof Inputs;
  label: string;
  unit: string;
  spokenUnit: string;
  min: number;
  max: number;
  step: number;
  danger: (value: number) => boolean;
}

const SLIDERS: Slider[] = [
  { key: 'co2', label: 'Cabin CO₂', unit: 'ppm', spokenUnit: 'parts per million', min: 400, max: 5000, step: 50, danger: (value) => value > 3500 },
  { key: 'radiation', label: 'Solar radiation', unit: 'index', spokenUnit: 'index', min: 0, max: 100, step: 1, danger: (value) => value > 70 },
  { key: 'days', label: 'Mission duration', unit: 'days', spokenUnit: 'days', min: 0, max: 900, step: 5, danger: (value) => value > 600 },
  { key: 'sleep', label: 'Sleep per night', unit: 'h', spokenUnit: 'hours', min: 3, max: 9, step: 0.5, danger: (value) => value < 5 },
];

const PRESETS: { name: string; values: Inputs }[] = [
  { name: 'Baseline', values: DEFAULT_INPUTS },
  { name: 'Radiation storm', values: { ...DEFAULT_INPUTS, radiation: 92 } },
  { name: 'Scrubber failure', values: { ...DEFAULT_INPUTS, co2: 4800 } },
  { name: 'Mars transit', values: { co2: 1500, radiation: 55, days: 400, sleep: 6 } },
  { name: 'Combined hazards', values: { co2: 4800, radiation: 95, days: 400, sleep: 4 } },
];

export default function SandboxPanel({ inputs, onChange }: { inputs: Inputs; onChange: (inputs: Inputs) => void }) {
  const id = useId();
  const selected = PRESETS.find((preset) => SLIDERS.every(({ key }) => inputs[key] === preset.values[key]));

  return (
    <section className="sb" aria-labelledby={`${id}-title`}>
      <div className="sb-header">
        <div className="sb-icon"><SlidersHorizontal size={17} aria-hidden="true" /></div>
        <div>
          <h2 id={`${id}-title`}>Scenario sandbox</h2>
          <p>Simulate mission conditions and see how modeled crew risk changes.</p>
        </div>
      </div>

      <div className="sb-presets" role="group" aria-label="Scenario presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            className="sb-preset"
            type="button"
            aria-pressed={selected === preset}
            onClick={() => onChange(preset.values)}
          >
            {preset.name}
          </button>
        ))}
      </div>

      <div className="sb-controls">
        {SLIDERS.map((slider) => {
          const value = inputs[slider.key];
          const sliderValue = Math.min(slider.max, Math.max(slider.min, value));
          const inputId = `${id}-${slider.key}`;
          const fill = `${100 * (sliderValue - slider.min) / (slider.max - slider.min)}%`;
          const outsideRange = sliderValue !== value;
          return (
            <div key={slider.key} className="sb-control" data-elevated={slider.danger(value)} style={{ '--sb-fill': fill } as CSSProperties}>
              <div className="sb-control-label">
                <label htmlFor={inputId}>{slider.label}</label>
                <span aria-hidden="true">{value.toLocaleString()} <small>{slider.unit}{outsideRange ? ' · outside preview range' : ''}</small></span>
              </div>
              <input
                id={inputId}
                type="range"
                min={slider.min}
                max={slider.max}
                step={slider.step}
                value={sliderValue}
                aria-valuetext={`${sliderValue} ${slider.spokenUnit}${outsideRange ? `, reported value ${value} outside preview range` : ''}`}
                onChange={(event) => onChange({ ...inputs, [slider.key]: event.currentTarget.valueAsNumber })}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
