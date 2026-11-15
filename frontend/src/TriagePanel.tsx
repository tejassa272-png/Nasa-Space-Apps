import { MapPin, Package, ListChecks, Bot, AlertTriangle, ShieldCheck } from 'lucide-react';
import './TriagePanel.css';

export interface TriageItem {
  name: string;
  qty: number;
  unit?: string;
  location: string;
  potency_loss_pct: number;
  status?: 'ok' | 'low' | 'degraded' | 'unusable' | 'out';
  warning?: string | null;
}

export interface TriageStep {
  n: number;
  title: string;
  action: string;
  item: TriageItem | null;
  caution: string | null;
}

export interface Finding {
  label: string;
  value: string;
  state: 'low' | 'high' | 'alert';
}

export interface Protocol {
  id: number;
  severity: 'CRITICAL' | 'WARNING';
  headline: string;
  findings: Finding[];
  steps: TriageStep[];
  monitoring: string[];
  escalation: string;
  source: string;
  rationale: string;
  rationale_status: 'pending' | 'ready' | 'fallback';
  flags?: string[];   // which readings tripped (hypoxia, tachycardia, hypertension, edema, bone_loss)
  age_s: number;
}

const formatAge = (s: number) => (s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`);

const STATUS_LABEL: Record<string, string> = {
  ok: 'IN STOCK',
  low: 'LOW STOCK',
  degraded: 'IN STOCK · REDUCED POTENCY',
  unusable: 'TOO DEGRADED',
  out: 'OUT OF STOCK',
};

function ItemStrip({ item }: { item: TriageItem }) {
  const remaining = Math.max(0, 100 - item.potency_loss_pct);
  const status = item.status ?? (item.qty <= 3 ? 'low' : 'ok');
  const bad = status === 'out' || status === 'unusable';
  return (
    <div className={`tp-item ${bad ? 'bad' : ''}`}>
      <div className="tp-item-check">
        <span className="tp-item-check-label">Inventory check</span>
        <span className={`tp-status ${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="tp-item-top">
        <span className="tp-item-name">
          <Package size={14} /> {item.name}
        </span>
        <span className={`tp-qty ${status === 'low' || bad ? 'low' : ''}`}>
          {item.qty} {item.unit ?? ''} remaining
        </span>
      </div>
      <div className="tp-item-loc">
        <MapPin size={13} /> {item.location}
      </div>
      <div className="tp-potency">
        <span className="tp-potency-label">Potency {remaining.toFixed(0)}%</span>
        <div className="tp-bar">
          <div
            className={`tp-bar-fill ${item.potency_loss_pct > 0 ? 'degraded' : ''}`}
            style={{ width: `${remaining}%` }}
          />
        </div>
        {item.potency_loss_pct > 0 && (
          <span className="tp-potency-note">-{item.potency_loss_pct}% from radiation / flight time</span>
        )}
      </div>
    </div>
  );
}

export default function TriagePanel({ protocol, active }: { protocol: Protocol | null; active: boolean }) {
  if (!protocol) {
    return <div className="tp-empty">Awaiting biometric or environmental anomaly trigger...</div>;
  }

  const bannerClass = active ? protocol.severity.toLowerCase() : 'past';

  return (
    <div className={`tp-scroll ${active ? '' : 'dimmed'}`}>
      {/* Severity banner */}
      <div className={`tp-banner ${bannerClass}`}>
        <div className="tp-banner-top">
          <span className="tp-sev">
            <AlertTriangle size={16} /> {active ? protocol.severity : 'LAST EVENT'}
          </span>
          <span className="tp-age">{active ? 'ACTIVE NOW' : `${formatAge(protocol.age_s)} ago · vitals recovered`}</span>
        </div>
        <div className="tp-headline">{protocol.headline}</div>
        <div className="tp-chips">
          {protocol.findings.map((f) => (
            <span key={f.label} className={`tp-chip ${f.state}`}>
              {f.label}: <strong>{f.value}</strong>
              {f.state === 'low' ? ' ▼' : f.state === 'high' ? ' ▲' : ''}
            </span>
          ))}
        </div>
      </div>

      {/* Steps */}
      <h4 className="tp-section">What to do, in order</h4>
      {protocol.steps.map((s) => (
        <div key={s.n} className="tp-step">
          <div className="tp-step-num">{s.n}</div>
          <div className="tp-step-body">
            <div className="tp-step-title">{s.title}</div>
            <div className="tp-step-action">{s.action}</div>
            {s.item && <ItemStrip item={s.item} />}
            {s.caution && (
              <div className="tp-caution">
                <AlertTriangle size={13} /> {s.caution}
              </div>
            )}
          </div>
        </div>
      ))}

      {/* Monitoring */}
      <h4 className="tp-section">
        <ListChecks size={14} /> Keep monitoring
      </h4>
      <ul className="tp-monitor">
        {protocol.monitoring.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>

      {/* AI explanation */}
      <div className="tp-ai">
        <div className="tp-ai-head">
          <span>
            <Bot size={14} /> Why this matters
          </span>
          <span className={`tp-ai-status ${protocol.rationale_status}`}>
            {protocol.rationale_status === 'pending'
              ? 'AI generating…'
              : protocol.rationale_status === 'ready'
              ? 'Local AI (Ollama)'
              : 'Standard guidance'}
          </span>
        </div>
        <p>{protocol.rationale}</p>
      </div>

      <div className="tp-escalation">{protocol.escalation}</div>
      <div className="tp-footer">
        <ShieldCheck size={12} /> Source: {protocol.source}. Decision support only. Confirm with the Crew Medical Officer.
      </div>
    </div>
  );
}
