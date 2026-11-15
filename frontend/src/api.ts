import type { Inputs } from './engine';

export type InventoryStatus = 'ok' | 'low' | 'degraded' | 'unusable' | 'out';
export type ProtocolSeverity = 'CRITICAL' | 'WARNING';

export interface TriageItem {
  name: string;
  qty: number;
  unit: string;
  location: string;
  potency_loss_pct: number;
  status: InventoryStatus;
  warning: string | null;
}

export interface TriageStep {
  n?: number;
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
  created_at?: number;
  age_s?: number;
  severity: ProtocolSeverity;
  headline: string;
  findings: Finding[];
  steps: TriageStep[];
  monitoring: string[];
  escalation: string;
  source: string;
  rationale: string;
  rationale_status: 'pending' | 'ready' | 'fallback';
  flags?: string[];
}

export interface TempusTelemetry {
  heart_rate: number;
  spo2: number;
  bp_sys: number;
  bp_dia: number;
  ultrasound_status: 'Clear' | 'Optic Disc Edema Detected' | 'Not measured';
  bone_status?: 'Normal' | 'Bone Density Loss Detected' | 'Not measured';
  device: string;
}

export interface VitalsReading {
  heart_rate: number | '--';
  spo2: number | '--';
  bp_sys: number | '--';
  bp_dia: number | '--';
  ultrasound_status?: string;
  bone_status?: string;
  device?: string;
  source?: string;
}

export interface VitalsSample {
  hr: number;
  spo2: number;
  sys: number;
  dia: number;
}

export interface TimedVitalsSample extends VitalsSample {
  measuredAt: number;
  device?: string;
}

export interface ApiSession {
  id: number;
  key: string;
  signal: AbortSignal;
}

interface Access {
  demo: boolean;
  role: 'viewer' | 'operator' | 'telemetry' | 'demo';
  can_dispense: boolean;
}

export interface DashboardState {
  vitals: VitalsReading;
  status: string;
  tier: string;
  triage_protocol: string;
  is_critical: boolean;
  protocol: Protocol | null;
  inventory: TriageItem[];
  active_protocols?: Protocol[];
  telemetry_observed_at?: number | null;
  telemetry_received_at?: number | null;
  telemetry_revision?: number | null;
  telemetry_stale?: boolean;
  environment?: Inputs & { observed_at?: number | null };
  demo_stream?: { enabled: boolean; interval_seconds: number; resumes_at: number | null };
  access?: Access;
}

type DispenseResult = { ok: true; item: TriageItem } | { ok: false; error: string; item?: TriageItem };
type EnvironmentResult = { ok: true; extra_potency_loss_pct: number; applied?: boolean };
type TelemetryPage = {
  items: { id: number; received_at: number; observed_at?: number | null; vitals: VitalsReading }[];
  next_before_id: number | null;
};

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const apiOrigin = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '') ?? '';

async function request<T>(
  path: string,
  { body, signal, session, idempotencyKey, timeout = 10_000 }: {
    body?: object;
    signal?: AbortSignal;
    session?: ApiSession | null;
    idempotencyKey?: string;
    timeout?: number;
  } = {},
): Promise<T> {
  const deadline = AbortSignal.timeout(timeout);
  const requestSignal = AbortSignal.any([deadline, ...(signal ? [signal] : []), ...(session ? [session.signal] : [])]);
  const headers = new Headers();
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  if (session) headers.set('Authorization', `Bearer ${session.key}`);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  let response: Response;

  try {
    response = await fetch(`${apiOrigin}/api/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit',
      redirect: 'error',
      signal: requestSignal,
    });
  } catch (error) {
    if (signal?.aborted || session?.signal.aborted) throw error;
    const message = deadline.aborted ? 'The backend took too long to respond.' : 'Could not reach the AstroTwin backend.';
    throw new Error(message, { cause: error });
  }

  const result = await response.json().catch((error: unknown) => {
    if (requestSignal.aborted) throw error;
    return undefined;
  });

  if (!response.ok) {
    const detail = result?.error ?? result?.detail;
    throw new ApiError(response.status, typeof detail === 'string' ? detail : `Backend request failed (${response.status}).`);
  }
  if (result === undefined) throw new Error('The AstroTwin backend returned an unreadable response.');
  return result as T;
}

export const api = {
  async getState(session?: ApiSession | null, signal?: AbortSignal) {
    const state = await request<DashboardState>('state', { session, signal });
    if (!state?.vitals || !Array.isArray(state.inventory)) {
      throw new Error('The server did not return AstroTwin dashboard data. Check the API URL.');
    }
    return state;
  },

  getTelemetry: (limit: number, session?: ApiSession | null, signal?: AbortSignal) =>
    request<TelemetryPage>(`telemetry?limit=${limit}`, { session, signal }),

  sendVitals: (vitals: TempusTelemetry, signal?: AbortSignal) =>
    request<DashboardState>('tempus/vitals', { body: vitals, signal, timeout: 120_000 }),

  setEnvironment: (inputs: Inputs, signal?: AbortSignal) =>
    request<EnvironmentResult>('environment', { body: inputs, signal }),

  async dispense(medication: string, idempotencyKey: string, session?: ApiSession | null) {
    const result = await request<DispenseResult>('inventory/dispense', { body: { medication }, idempotencyKey, session });
    if (!result.ok) throw new ApiError(409, result.error);
    return result.item;
  },

  async syncNasa(session?: ApiSession | null) {
    const result = await request<{ status: string } | null>('nasa/sync', { body: { active: true }, session, timeout: 45_000 });
    if (result?.status === 'Failed to reach NASA APIs') throw new Error('The backend could not reach the NASA services.');
    return result?.status ?? 'NASA sync completed. No CME was reported.';
  },
};

export function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'The request could not be completed.';
}

export function toVitalsSample(vitals: VitalsReading): VitalsSample | null {
  const { heart_rate: hr, spo2, bp_sys: sys, bp_dia: dia } = vitals;
  if (typeof hr !== 'number' || typeof spo2 !== 'number' || typeof sys !== 'number' || typeof dia !== 'number') return null;
  if (![hr, spo2, sys, dia].every(Number.isFinite)) return null;
  return { hr, spo2, sys, dia };
}

export function toTimedVitalsSample(vitals: VitalsReading, measuredAt: number): TimedVitalsSample | null {
  const sample = toVitalsSample(vitals);
  return sample && Number.isFinite(measuredAt) ? { ...sample, measuredAt, device: vitals.device } : null;
}
