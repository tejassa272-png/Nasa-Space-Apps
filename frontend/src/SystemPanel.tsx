import { BookOpen, ClipboardList, Lock, Pill, Stethoscope } from 'lucide-react';
import { GUIDE, PROTOCOLS, STATUS_COLOR, SYSTEM_ITEM, type SystemState } from './engine';
import type { TriageItem } from './TriagePanel';
import './SystemPanel.css';

const DRAWERS = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4', 'C1', 'C2', 'C3', 'C4'];

/** "Medical Locker B, Drawer 2" -> "B2" (null when the location is not a locker drawer). */
export function drawerOf(location: string): string | null {
  const m = location.match(/Locker\s+([A-C])\D+(\d)/i);
  return m ? `${m[1].toUpperCase()}${m[2]}` : null;
}

interface Props {
  system: SystemState;
  inventory: TriageItem[];
  unlocked: string[];
  onDispense: (item: TriageItem, drawerKey: string) => void;
}

export default function SystemPanel({ system, inventory, unlocked, onDispense }: Props) {
  const color = STATUS_COLOR[system.status];
  const guide = GUIDE[system.id];
  const protocol = PROTOCOLS[system.id];
  const fragment = SYSTEM_ITEM[system.id];
  const item = fragment ? inventory.find((i) => i.name.toLowerCase().includes(fragment.toLowerCase())) : undefined;
  const drawer = item ? drawerOf(item.location) : null;
  const key = item ? drawer ?? item.name : '';
  const open = unlocked.includes(key);
  const blocked = item ? item.status === 'out' || item.status === 'unusable' : false;
  const needsKit = system.status !== 'nominal';

  return (
    <div className="sp-scroll">
      <div className="sp-title">
        <span className="sp-dot" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
        <h3>{system.label}</h3>
        <span className="sp-status" style={{ color, borderColor: color }}>
          {system.status.toUpperCase()} · {Math.round(system.risk * 100)}%
        </span>
      </div>
      <p className="sp-reason">{system.reason}</p>

      <h4 className="sp-section"><BookOpen size={14} /> What this system does</h4>
      <p className="sp-text">{guide.what}</p>

      <h4 className="sp-section"><Stethoscope size={14} /> Why check it</h4>
      <p className="sp-text">{guide.why}</p>

      <h4 className="sp-section"><ClipboardList size={14} /> How to check it yourself</h4>
      <ol className="sp-steps">
        {guide.how.map((s, i) => (
          <li key={i}><span className="sp-num">{i + 1}</span><span>{s}</span></li>
        ))}
      </ol>

      {needsKit && (
        <>
          <h4 className="sp-section sp-protocol">{protocol.title}</h4>
          <ol className="sp-steps">
            {protocol.steps.map((s, i) => (
              <li key={i}><span className="sp-num warn">{i + 1}</span><span>{s}</span></li>
            ))}
          </ol>
        </>
      )}

      {needsKit && item && (
        <div className={`sp-kit ${blocked ? 'bad' : ''}`}>
          <div className="sp-kit-head"><Pill size={14} /> MEDICAL KIT CHECK</div>

          {drawer && (
            <div className="sp-drawers">
              {DRAWERS.map((d) => {
                const target = d === drawer;
                return (
                  <div key={d} className={`sp-drawer ${target ? (open ? 'open' : 'target') : ''}`}>{d}</div>
                );
              })}
            </div>
          )}

          <div>Recommended: <strong>{item.name}</strong></div>
          <div>Inventory check: <strong>{item.qty} {item.unit}</strong> remaining</div>
          <div>Location: {item.location}</div>
          {item.warning && <div className="sp-warn">Warning: {item.warning}</div>}

          <button
            className={`sp-unlock ${open ? 'done' : ''}`}
            disabled={open || blocked}
            onClick={() => onDispense(item, key)}
          >
            <Lock size={13} />{' '}
            {blocked
              ? 'CANNOT DISPENSE · SEE WARNING'
              : open
              ? `${drawer ? `DRAWER ${drawer} UNLOCKED` : 'ITEM RELEASED'} · DISPENSE LOGGED`
              : `ACKNOWLEDGE & UNLOCK${drawer ? ` DRAWER ${drawer}` : ''}`}
          </button>
        </div>
      )}
    </div>
  );
}
