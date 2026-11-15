// Multi-stressor "Synergy Engine" (ported from the teammate's PR) + per-system guidance.
// Everything here is plain TypeScript with no UI dependencies.

export type Status = 'nominal' | 'caution' | 'critical';
export type SystemId = 'brain' | 'eyes' | 'heart' | 'lungs' | 'immune' | 'bones';
export interface Inputs { co2: number; radiation: number; days: number; sleep: number }
export interface SystemState {
  id: SystemId;
  label: string;
  risk: number;      // 0..1
  status: Status;
  reason: string;
  live?: boolean;    // true when a real Tempus reading raised this system
}

export const DEFAULT_INPUTS: Inputs = { co2: 1200, radiation: 10, days: 30, sleep: 7.5 };

export const STATUS_COLOR: Record<Status, string> = {
  nominal: '#22c55e',
  caution: '#f59e0b',
  critical: '#ef4444',
};

export const clamp = (v: number) => Math.min(1, Math.max(0, v));
const norm = (v: number, min: number, max: number) => clamp((v - min) / (max - min));
export const toStatus = (r: number): Status => (r < 0.35 ? 'nominal' : r < 0.65 ? 'caution' : 'critical');
const RANK: Record<Status, number> = { nominal: 0, caution: 1, critical: 2 };
export const worseOf = (a: Status, b: Status): Status => (RANK[a] >= RANK[b] ? a : b);

type Term = [string, number];
function build(id: SystemId, label: string, terms: Term[]): SystemState {
  const risk = clamp(terms.reduce((s, t) => s + t[1], 0));
  const status = toStatus(risk);
  const top = [...terms]
    .filter((t) => t[1] > 0.05)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map((t) => t[0]);
  const reason = status === 'nominal' ? 'Within baseline range.' : `Driven by ${top.join(' + ')}.`;
  return { id, label, risk, status, reason };
}

export function computeSynergy(i: Inputs): Record<SystemId, SystemState> {
  const co2 = norm(i.co2, 400, 5000);
  const rad = norm(i.radiation, 0, 100);
  const days = norm(i.days, 0, 900);
  const sleep = norm(8 - i.sleep, 0, 4); // sleep deficit
  const syn = co2 * rad;                 // non-additive interaction term
  const S = 'CO₂ × radiation synergy';
  return {
    brain: build('brain', 'Neuro-Cognitive', [['elevated CO₂', 0.35 * co2], ['sleep loss', 0.3 * sleep], ['radiation', 0.15 * rad], [S, 0.6 * syn]]),
    eyes: build('eyes', 'Neuro-Ocular (SANS)', [['mission duration', 0.5 * days], ['elevated CO₂', 0.35 * co2], [S, 0.3 * syn]]),
    heart: build('heart', 'Cardiovascular', [['radiation', 0.4 * rad], ['mission duration', 0.25 * days], ['sleep loss', 0.2 * sleep], [S, 0.3 * syn]]),
    lungs: build('lungs', 'Respiratory', [['elevated CO₂', 0.7 * co2], ['radiation', 0.2 * rad], [S, 0.4 * syn]]),
    immune: build('immune', 'Immune', [['radiation', 0.55 * rad], ['sleep loss', 0.2 * sleep], ['mission duration', 0.15 * days], [S, 0.35 * syn]]),
    bones: build('bones', 'Musculoskeletal', [['mission duration', 0.7 * days], ['radiation', 0.15 * rad], ['sleep loss', 0.1 * sleep]]),
  };
}

// ---------------------------------------------------------------------------
// Real Tempus readings win over the simulation: if the backend raised a flag,
// the matching body system is raised to at least caution (critical for a
// CRITICAL protocol), whatever the sandbox sliders say.
// ---------------------------------------------------------------------------
const FLAG_TO_SYSTEM: Record<string, { id: SystemId; reason: string }> = {
  hypoxia: { id: 'lungs', reason: 'Live Tempus reading: low blood oxygen (SpO₂).' },
  tachycardia: { id: 'heart', reason: 'Live Tempus reading: fast heart rate.' },
  hypertension: { id: 'heart', reason: 'Live Tempus reading: high blood pressure.' },
  edema: { id: 'eyes', reason: 'Live Tempus ultrasound: optic disc edema.' },
  bone_loss: { id: 'bones', reason: 'Live Tempus scan: bone density loss.' },
};

export function applyLiveFlags(
  systems: Record<SystemId, SystemState>,
  flags: string[] | undefined,
  severity: 'CRITICAL' | 'WARNING' | undefined,
): Record<SystemId, SystemState> {
  if (!flags || flags.length === 0) return systems;
  const out = { ...systems };
  const floor = severity === 'CRITICAL' ? 0.8 : 0.5;
  for (const f of flags) {
    const m = FLAG_TO_SYSTEM[f];
    if (!m) continue;
    const cur = out[m.id];
    const risk = Math.max(cur.risk, floor);
    out[m.id] = { ...cur, risk, status: toStatus(risk), reason: m.reason, live: true };
  }
  return out;
}

export function readiness(systems: Record<SystemId, SystemState>): number {
  const all = Object.values(systems);
  const avg = all.reduce((s, x) => s + x.risk, 0) / all.length;
  return Math.round(100 - avg * 100);
}

// ---------------------------------------------------------------------------
// Beginner-friendly guidance shown when a body system is clicked.
// ---------------------------------------------------------------------------
export const GUIDE: Record<SystemId, { what: string; why: string; how: string[] }> = {
  brain: {
    what: 'The brain controls thinking, memory and reaction time. High CO₂, poor sleep and radiation can slow it down.',
    why: 'Early signs (slower reactions, headache, trouble focusing) are easy to miss, and a quick check catches them before they affect critical tasks.',
    how: [
      'Run the onboard reaction-time or memory test (about 2 minutes).',
      'Note any headache, dizziness or trouble concentrating.',
      'Compare with your baseline score and log the result.',
    ],
  },
  eyes: {
    what: 'The eyes and optic nerve send images to the brain. In microgravity, fluid shifts toward the head and can swell the back of the eye (SANS).',
    why: 'Swelling can blur vision. Caught early it can be managed on board without evacuation.',
    how: [
      'Close your eyelid and place the ultrasound probe vertically over it.',
      'Angle the probe about 15° to the side, then follow the on-screen placement guide.',
      'Hold still for the scan, then log visual acuity with the onboard chart.',
    ],
  },
  heart: {
    what: 'The heart pumps blood around the body. Fluid shifts and radiation put extra load on it in space.',
    why: 'A fast heart rate or high blood pressure can mean strain, dehydration or stress that needs attention.',
    how: [
      'Sit still and relaxed for 5 minutes.',
      'Take a heart rate and blood pressure reading with the Tempus cuff.',
      'Repeat in 2 hours and compare the two readings.',
    ],
  },
  lungs: {
    what: 'The lungs bring oxygen in and push CO₂ out. High cabin CO₂ makes this harder.',
    why: 'Low blood oxygen is time-critical, and checking early shows whether it is the sensor or you.',
    how: [
      'Secure the pulse oximeter on your left index finger.',
      'Keep the hand warm and still for 30 seconds, then read SpO₂.',
      'Use the digital stethoscope to listen for even breathing on both sides.',
    ],
  },
  immune: {
    what: 'The immune system fights infection. Radiation, stress and poor sleep can weaken it in space.',
    why: 'Small infections can grow quickly when the crew is far from Earth, so early signs matter.',
    how: [
      'Take your body temperature.',
      'Note any sore throat, rash or unusual tiredness.',
      'Read your personal dosimeter and log the cumulative dose.',
    ],
  },
  bones: {
    what: 'Bones and muscles hold the body up. Without gravity they lose strength faster than on Earth.',
    why: 'Bone loss is silent. Regular checks show whether exercise and medication are working.',
    how: [
      'Complete the daily ARED resistive loading session.',
      'Log the weekly ARED resistive loading metrics.',
      'Check resorption markers or the latest bone scan result.',
    ],
  },
};

export const PROTOCOLS: Record<SystemId, { title: string; steps: string[] }> = {
  brain: {
    title: 'Cognitive Fatigue Countermeasure',
    steps: [
      'Check the cabin CO₂ scrubber and move to a low-CO₂ module if possible.',
      'Switch to dynamic lighting: 5,000 K at 300 lux during work periods.',
      'Reduce task complexity; use checklists for critical procedures.',
      'Schedule a protected 8-hour sleep window tonight.',
    ],
  },
  eyes: {
    title: 'Neuro-Ocular Monitoring',
    steps: [
      'Run the guided optic-nerve ultrasound self-scan (probe placement guide).',
      'Log visual acuity with the onboard chart.',
      'Reduce head-down tasks and limit time in high-CO₂ areas.',
      'Flag results for the Crew Medical Officer.',
    ],
  },
  heart: {
    title: 'Cardiovascular Stress Protocol',
    steps: [
      'Take a resting heart rate and blood pressure reading.',
      'Do a 20-minute low-intensity aerobic session.',
      'Increase fluid intake and avoid heavy exertion for 12 hours.',
      'Re-check vitals in 2 hours.',
    ],
  },
  lungs: {
    title: 'Elevated CO₂ Response',
    steps: [
      'Verify CO₂ scrubber and fan operation; swap the lithium hydroxide canister if required.',
      'Stop strenuous activity and rest in the best-ventilated module.',
      'Monitor SpO₂ every 15 minutes.',
      'Escalate to the Crew Medical Officer if symptoms persist.',
    ],
  },
  immune: {
    title: 'Radiation Exposure Protocol',
    steps: [
      'Move to the storm shelter or most shielded area immediately.',
      'Log cumulative dose from personal dosimeters.',
      'Raise immune biomarker monitoring to every 6 hours.',
      'Stay sheltered until the radiation event clears.',
    ],
  },
  bones: {
    title: 'Bone Loss Countermeasure',
    steps: [
      'Complete the daily ARED resistive loading session.',
      'If resorption markers are rising, use the medication in the kit check below, exactly as labelled.',
      'Check urinary resorption markers.',
      'Log the session to improve the Mission Readiness Score.',
    ],
  },
};

// Which inventory item each body system's treatment uses (matched against the DB by name fragment).
export const SYSTEM_ITEM: Partial<Record<SystemId, string>> = {
  bones: 'Alendronate',
  eyes: 'B-Vitamin',
  lungs: 'O2',
};
