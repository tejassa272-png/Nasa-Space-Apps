export type Status = 'nominal' | 'caution' | 'critical'
export type SystemId = 'brain' | 'eyes' | 'heart' | 'lungs' | 'immune' | 'bones'

export interface Inputs { co2: number; radiation: number; days: number; sleep: number }
export interface SystemState { id: SystemId; label: string; risk: number; status: Status; reason: string }

export const DEFAULT_INPUTS: Inputs = { co2: 1200, radiation: 10, days: 30, sleep: 7.5 }

export const STATUS_COLOR: Record<Status, string> = {
    nominal: '#22c55e',
    caution: '#f59e0b',
    critical: '#ef4444',
}

export const clamp = (v: number) => Math.min(1, Math.max(0, v))
const norm = (v: number, min: number, max: number) => clamp((v - min) / (max - min))
export const toStatus = (r: number): Status => (r < 0.35 ? 'nominal' : r < 0.65 ? 'caution' : 'critical')

type Term = [string, number]

function build(id: SystemId, label: string, terms: Term[]): SystemState {
    const risk = clamp(terms.reduce((s, t) => s + t[1], 0))
    const status = toStatus(risk)
    const top = [...terms]
        .filter((t) => t[1] > 0.05)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map((t) => t[0])
    const reason = status === 'nominal' ? 'Within baseline range.' : `Driven by ${top.join(' + ')}.`
    return { id, label, risk, status, reason }
}

export function computeSynergy(i: Inputs): Record<SystemId, SystemState> {
    const co2 = norm(i.co2, 400, 5000)
    const rad = norm(i.radiation, 0, 100)
    const days = norm(i.days, 0, 900)
    const sleep = norm(8 - i.sleep, 0, 4) // sleep deficit
    const syn = co2 * rad // non-additive interaction term
    const S = 'CO₂ × radiation synergy'

    return {
        brain: build('brain', 'Neuro-Cognitive', [['elevated CO₂', 0.35 * co2], ['sleep loss', 0.3 * sleep], ['radiation', 0.15 * rad], [S, 0.6 * syn]]),
        eyes: build('eyes', 'Neuro-Ocular (SANS)', [['mission duration', 0.5 * days], ['elevated CO₂', 0.35 * co2], [S, 0.3 * syn]]),
        heart: build('heart', 'Cardiovascular', [['radiation', 0.4 * rad], ['mission duration', 0.25 * days], ['sleep loss', 0.2 * sleep], [S, 0.3 * syn]]),
        lungs: build('lungs', 'Respiratory', [['elevated CO₂', 0.7 * co2], ['radiation', 0.2 * rad], [S, 0.4 * syn]]),
        immune: build('immune', 'Immune', [['radiation', 0.55 * rad], ['sleep loss', 0.2 * sleep], ['mission duration', 0.15 * days], [S, 0.35 * syn]]),
        bones: build('bones', 'Musculoskeletal', [['mission duration', 0.7 * days], ['radiation', 0.15 * rad], ['sleep loss', 0.1 * sleep]]),
    }
}

export function readiness(systems: Record<SystemId, SystemState>): number {
    const all = Object.values(systems)
    const avg = all.reduce((s, x) => s + x.risk, 0) / all.length
    return Math.round(100 - avg * 100)
}

export const PROTOCOLS: Record<SystemId, { title: string; steps: string[] }> = {
    brain: {
        title: 'Cognitive Fatigue Countermeasure',
        steps: [
            'Check cabin CO₂ scrubber status and move to a low-CO₂ module if possible.',
            'Switch to Dynamic Lighting: 5,000 K at 300 lux during work periods.',
            'Reduce task complexity; use checklists for critical procedures.',
            'Schedule a protected 8-hour sleep window tonight.',
        ],
    },
    eyes: {
        title: 'Neuro-Ocular Monitoring',
        steps: [
            'Run the guided optic-nerve ultrasound self-scan (probe placement overlay).',
            'Log visual acuity with the onboard chart.',
            'Reduce head-down tasks; limit time in high-CO₂ areas.',
            'Flag results for the Crew Medical Officer.',
        ],
    },
    heart: {
        title: 'Cardiovascular Stress Protocol',
        steps: [
            'Take a resting heart rate and blood pressure reading.',
            'Perform a 20-minute low-intensity aerobic session.',
            'Increase fluid intake; avoid heavy exertion for 12 hours.',
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
            'Move to the storm shelter / most shielded area immediately.',
            'Log cumulative dose from personal dosimeters.',
            'Elevate immune biomarker monitoring to every 6 hours.',
            'Remain sheltered until the radiation event clears.',
        ],
    },
    bones: {
        title: 'Bone Loss Countermeasure',
        steps: [
            'Complete the daily ARED resistive loading session.',
            'Take weekly alendronate with Vitamin D if resorption markers are rising.',
            'Check urinary resorption markers.',
            'Log the session to improve the Mission Readiness Score.',
        ],
    },
}

export function getKit(id: SystemId, days: number) {
    const potencyLoss = Math.min(40, Math.round(days / 60))
    const warning = `Potency reduced ~${potencyLoss}% due to flight duration.`
    if (id === 'bones') return { drug: 'Alendronate 10 mg', stock: 14, location: 'Medical Locker B, Drawer 2', drawer: 'B2', warning }
    if (id === 'immune') return { drug: 'Anti-inflammatory 200 mg', stock: 40, location: 'Medical Locker B, Drawer 4', drawer: 'B4', warning }
    if (id === 'lungs') return { drug: 'Supplemental oxygen kit', stock: 3, location: 'Medical Locker A, Drawer 3', drawer: 'A3', warning }
    return null
}