import { AlertTriangle, ArrowUpRight, BookOpen, Check, ChevronDown, ClipboardList, Package, Radio } from 'lucide-react';
import type { TriageItem } from './api';
import { GUIDE, PROTOCOLS, SYSTEM_ITEM, type SystemState } from './engine';
import './SystemPanel.css';

const DRAWERS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4'];

function drawerOf(location: string): string | null {
  const match = location.match(/Locker\s+([A-C]),?\s+Drawer\s+(\d+)/i);
  return match ? `${match[1].toUpperCase()}${match[2]}` : null;
}

interface Props {
  system: SystemState;
  inventory: TriageItem[];
  unlocked: string[];
  onDispense: (item: TriageItem, itemKey: string) => void;
  inventoryAvailable?: boolean;
  canRecordDispense: boolean;
  dispensePending?: boolean;
  dispenseError?: string | null;
  unconfirmedDispenses: string[];
}

export default function SystemPanel({
  system,
  inventory,
  unlocked,
  onDispense,
  inventoryAvailable = true,
  canRecordDispense,
  dispensePending = false,
  dispenseError,
  unconfirmedDispenses,
}: Props) {
  const guide = GUIDE[system.id];
  const protocol = PROTOCOLS[system.id];
  const fragment = SYSTEM_ITEM[system.id];
  const item = fragment ? inventory.find((candidate) => candidate.name.toLowerCase().includes(fragment.toLowerCase())) : undefined;
  const drawer = item ? drawerOf(item.location) : null;
  const recorded = item ? unlocked.includes(item.name) : false;
  const canRetry = item ? unconfirmedDispenses.includes(item.name) : false;
  const blocked = item ? item.qty <= 0 || item.status === 'out' || item.status === 'unusable' : false;
  const canSubmit = inventoryAvailable && (canRetry || (canRecordDispense && !blocked));
  const elevated = system.status !== 'nominal';
  const risk = Math.round(system.risk * 100);

  return (
    <div className="sp">
      <div className="sp-assessment" data-status={system.status}>
        <div className="sp-assessment-top">
          <h3>{system.label}</h3>
          <span className="sp-status"><span aria-hidden="true" />{system.status}</span>
        </div>
        <p className="sp-reason">{system.reason}</p>
        <div className="sp-risk">
          <span>Modeled risk</span>
          <strong>{risk}%</strong>
        </div>
        <progress aria-label="Modeled risk" value={risk} max={100}>{risk}%</progress>
        {system.live && <p className="sp-live"><Radio size={13} aria-hidden="true" /> Includes a telemetry flag</p>}
      </div>

      <details className="sp-detail">
        <summary><BookOpen size={16} aria-hidden="true" /> About this system <ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="sp-detail-body">
          <p>{guide.what}</p>
          <p>{guide.why}</p>
        </div>
      </details>

      <details className="sp-detail">
        <summary><ClipboardList size={16} aria-hidden="true" /> Self-check reference <ChevronDown size={15} aria-hidden="true" /></summary>
        <div className="sp-detail-body">
          <ol className="sp-steps">
            {guide.how.map((step) => <li key={step}>{step}</li>)}
          </ol>
        </div>
      </details>

      {elevated && (
        <details className="sp-detail sp-protocol">
          <summary><AlertTriangle size={16} aria-hidden="true" /> Response reference <ChevronDown size={15} aria-hidden="true" /></summary>
          <div className="sp-detail-body">
            <h4>{protocol.title}</h4>
            <ol className="sp-steps">
              {protocol.steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </div>
        </details>
      )}

      {fragment && (elevated || canRetry) && (
        <section className="sp-kit">
          <h4><Package size={16} aria-hidden="true" /> Medical kit check</h4>
          {item ? (
            <>
              <p className="sp-kit-name">{item.name}</p>
              <dl className="sp-kit-data">
                <div><dt>Remaining</dt><dd>{item.qty} {item.unit}</dd></div>
                <div><dt>Location</dt><dd>{item.location}</dd></div>
              </dl>
              {drawer && (
                <div className="sp-drawers" aria-hidden="true">
                  {DRAWERS.map((slot) => <span key={slot} data-target={drawer === slot}>{slot}</span>)}
                </div>
              )}
              {item.warning && <p className="sp-warning"><AlertTriangle size={14} aria-hidden="true" /> {item.warning}</p>}
              {dispenseError && <p className="sp-error" role="alert">{dispenseError}</p>}
              {(!inventoryAvailable || (!canRecordDispense && !canRetry)) && !recorded && <p className="sp-kit-help">Dispense recording is unavailable for this view.</p>}
              <button
                className="sp-dispense"
                type="button"
                disabled={recorded || !canSubmit || dispensePending}
                onClick={() => onDispense(item, item.name)}
              >
                {recorded ? (
                  <><Check size={15} aria-hidden="true" /> Dispense recorded</>
                ) : (
                  <>
                    {dispensePending ? 'Recording…' : canRetry ? 'Retry dispense record' : blocked ? 'Supply unavailable' : 'Record one unit dispensed'}
                    {!dispensePending && canSubmit && <ArrowUpRight size={14} aria-hidden="true" />}
                  </>
                )}
              </button>
              {recorded && <span className="sp-recorded" role="status">Inventory updated for {item.name}.</span>}
            </>
          ) : (
            <p className="sp-kit-help">
              {inventoryAvailable ? 'The associated supply was not found in inventory.' : 'Inventory is unavailable until the backend reconnects.'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
