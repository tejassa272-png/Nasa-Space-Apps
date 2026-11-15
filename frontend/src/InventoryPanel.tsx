import { Crosshair, MapPin } from 'lucide-react';
import type { TriageItem } from './TriagePanel';
import './InventoryPanel.css';

/** Live medical kit from the PostgreSQL inventory table (via /api/state). */
export default function InventoryPanel({ items, inUse }: { items: TriageItem[]; inUse: Set<string> }) {
  return (
    <div className="panel">
      <div className="panel-header">
        <Crosshair size={16} color="#38bdf8" /> MEDICAL INVENTORY (DB)
      </div>

      {items.length === 0 && <div className="inv-empty">Reading inventory database…</div>}

      <div className="inv-list">
        {items.map((it) => {
          const status = it.status ?? 'ok';
          const remaining = Math.max(0, 100 - it.potency_loss_pct);
          return (
            <div key={it.name} className={`inv-row ${inUse.has(it.name) ? 'in-use' : ''}`}>
              <div className="inv-top">
                <span className="inv-name">
                  {it.name}
                  {inUse.has(it.name) && <span className="inv-tag">IN PROTOCOL</span>}
                </span>
                <span className={`inv-qty ${status}`}>
                  {it.qty} <span className="inv-unit">{it.unit}</span>
                </span>
              </div>
              <div className="inv-meta">
                <span className="inv-loc">
                  <MapPin size={11} /> {it.location}
                </span>
                {(status === 'low' || status === 'out') && (
                  <span className={`inv-flag ${status}`}>{status === 'out' ? 'OUT' : 'LOW'}</span>
                )}
                {it.potency_loss_pct > 0 && (
                  <span className={`inv-flag ${status === 'unusable' ? 'out' : 'degraded'}`}>
                    POTENCY {remaining.toFixed(0)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
