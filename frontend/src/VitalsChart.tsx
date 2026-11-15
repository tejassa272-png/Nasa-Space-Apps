import { useId } from 'react';
import type { TimedVitalsSample, VitalsSample } from './api';
import './VitalsChart.css';

export type { VitalsSample } from './api';

interface Metric {
  key: keyof VitalsSample;
  label: string;
  unit: string;
  min: number;
  max: number;
  interval: number;
  threshold: number;
  operator: '>' | '<' | '≥';
}

const METRICS: Metric[] = [
  { key: 'hr', label: 'Heart rate', unit: 'bpm', min: 50, max: 140, interval: 10, threshold: 100, operator: '>' },
  { key: 'spo2', label: 'Oxygen saturation', unit: '%', min: 85, max: 100, interval: 5, threshold: 95, operator: '<' },
  { key: 'sys', label: 'Systolic pressure', unit: 'mmHg', min: 90, max: 170, interval: 10, threshold: 140, operator: '≥' },
  { key: 'dia', label: 'Diastolic pressure', unit: 'mmHg', min: 60, max: 110, interval: 10, threshold: 90, operator: '≥' },
];

const WIDTH = 100;
const HEIGHT = 40;
const INSET = 2;
const GAP_SECONDS = 30;
const clockTime = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function isOutsideThreshold(value: number, metric: Metric) {
  if (metric.operator === '<') return value < metric.threshold;
  if (metric.operator === '≥') return value >= metric.threshold;
  return value > metric.threshold;
}

function Track({ metric, history, segmentStarts }: { metric: Metric; history: TimedVitalsSample[]; segmentStarts: boolean[] }) {
  const gradientId = useId();
  const { label, unit, interval, operator, threshold } = metric;
  const values = history.map((sample) => sample[metric.key]);
  const first = values[0];
  const last = values.at(-1);
  const outOfRange = last !== undefined && isOutsideThreshold(last, metric);
  const min = Math.floor(Math.min(metric.min, ...values) / interval) * interval;
  const max = Math.ceil(Math.max(metric.max, ...values) / interval) * interval;
  const toY = (value: number) => INSET + ((max - value) / (max - min)) * (HEIGHT - 2 * INSET);
  const start = history[0]?.measuredAt ?? 0;
  const span = (history.at(-1)?.measuredAt ?? 0) - start;
  const toX = (sample: TimedVitalsSample) => span > 0
    ? INSET + (sample.measuredAt - start) / span * (WIDTH - 2 * INSET)
    : WIDTH - INSET;
  const path = history.map((sample, index) => `${segmentStarts[index] ? 'M' : 'L'}${toX(sample)},${toY(sample[metric.key])}`).join(' ');
  const thresholdY = toY(threshold);
  const lowerZone = operator === '<';
  const upperColor = lowerZone ? 'var(--vitals-accent)' : 'var(--vitals-alert)';
  const lowerColor = lowerZone ? 'var(--vitals-alert)' : 'var(--vitals-accent)';
  const trend = values.length > 1 ? `From ${first} to ${last} ${unit}.` : `One reading at ${last} ${unit}.`;

  return (
    <figure className="vt-track">
      <figcaption className="vt-track-head">
        <span className="vt-label">{label}</span>
        <span className={`vt-value${outOfRange ? ' vt-value-alert' : ''}`}>
          {last === undefined ? '—' : last}
          <span className="vt-unit">{unit}</span>
        </span>
      </figcaption>
      <div className="vt-chart-row">
        <div className="vt-plot" role="img" aria-label={`${label}. ${last === undefined ? 'Awaiting telemetry.' : trend}`}>
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={HEIGHT}>
                <stop offset={0} stopColor={upperColor} />
                <stop offset={thresholdY / HEIGHT} stopColor={upperColor} />
                <stop offset={thresholdY / HEIGHT} stopColor={lowerColor} />
                <stop offset={1} stopColor={lowerColor} />
              </linearGradient>
            </defs>
            <rect className="vt-zone" x="0" y={lowerZone ? thresholdY : 0} width={WIDTH} height={lowerZone ? HEIGHT - thresholdY : thresholdY} />
            <line className="vt-limit" x1="0" x2={WIDTH} y1={thresholdY} y2={thresholdY} />
            {values.length > 1 && <path className="vt-line" d={path} stroke={`url(#${gradientId})`} />}
            {history.slice(0, -1).map((sample, index) => segmentStarts[index] && segmentStarts[index + 1] && (
              <circle key={index} cx={toX(sample)} cy={toY(sample[metric.key])} r="0.8" fill={`url(#${gradientId})`} />
            ))}
          </svg>
          {last === undefined ? (
            <span className="vt-empty" aria-hidden="true">Awaiting telemetry</span>
          ) : (
            <span
              className={`vt-marker${outOfRange ? ' vt-marker-alert' : ''}`}
              style={{ left: `${WIDTH - INSET}%`, top: `${toY(last) / HEIGHT * 100}%` }}
              aria-hidden="true"
            />
          )}
        </div>
        <div className="vt-axis" aria-hidden="true"><span>{max}</span><span>{min}</span></div>
      </div>
      <div className="vt-threshold">
        <span className="vt-limit-key" aria-hidden="true" />
        <span>Alert {operator} {threshold} {unit}</span>
        {outOfRange && <strong>Outside threshold</strong>}
      </div>
    </figure>
  );
}

export default function VitalsChart({ history, historyUnavailable = false }: { history: TimedVitalsSample[]; historyUnavailable?: boolean }) {
  const segmentStarts = history.map((sample, index) => {
    const previous = history[index - 1];
    return !previous || sample.device !== previous.device || sample.measuredAt - previous.measuredAt > GAP_SECONDS;
  });
  const latest = history.at(-1);

  return (
    <div className="vt-wrap">
      {historyUnavailable && <p className="vt-history-warning" role="status">Stored history is unavailable. The latest vitals can still update.</p>}
      <div className="vt-grid">
        {METRICS.map((metric) => <Track key={metric.key} metric={metric} history={history} segmentStarts={segmentStarts} />)}
      </div>
      <div className="vt-footnote">
        <span>{history.length} {history.length === 1 ? 'reading' : 'readings'}</span>
        {latest && <span>Latest charted at <time dateTime={new Date(latest.measuredAt * 1000).toISOString()}>{clockTime.format(latest.measuredAt * 1000)}</time></span>}
      </div>
    </div>
  );
}
