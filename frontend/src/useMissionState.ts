import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, getErrorMessage, toTimedVitalsSample, type ApiSession, type DashboardState, type TimedVitalsSample } from './api';

type Connection = 'loading' | 'online' | 'offline';

interface MissionState {
  data: DashboardState | null;
  connection: Connection;
  checkedAt: number | null;
  history: TimedVitalsSample[];
  historyUnavailable: boolean;
}

const HISTORY_LIMIT = 40;
const EMPTY_MISSION: MissionState = { data: null, connection: 'loading', checkedAt: null, history: [], historyUnavailable: false };

function appendReading(history: TimedVitalsSample[], sample: TimedVitalsSample | null, hasTimestamp: boolean) {
  if (!sample) return history;
  const last = history.at(-1);
  if (last) {
    if (hasTimestamp && sample.measuredAt <= last.measuredAt) return history;
    if (!hasTimestamp && last.hr === sample.hr && last.spo2 === sample.spo2 && last.sys === sample.sys && last.dia === sample.dia && last.device === sample.device) {
      return history;
    }
  }
  return [...history, sample].slice(-HISTORY_LIMIT);
}

export function useMissionState() {
  const [mission, setMission] = useState<MissionState>(EMPTY_MISSION);
  const [session, setSession] = useState<ApiSession | null>(null);
  const [requiresAuth, setRequiresAuth] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [refreshId, setRefreshId] = useState(0);
  const sessionController = useRef<AbortController | null>(null);
  const nextSessionId = useRef(0);
  const historyRevision = useRef<number | null | undefined>(undefined);
  const legacyHistory = useRef(false);
  const refresh = useCallback(() => setRefreshId((id) => id + 1), []);

  const requireAuth = useCallback((message: string | null = null) => {
    sessionController.current?.abort();
    sessionController.current = null;
    historyRevision.current = undefined;
    legacyHistory.current = false;
    setMission(EMPTY_MISSION);
    setSession(null);
    setAuthError(message);
    setRequiresAuth(true);
  }, []);

  const signIn = useCallback((key: string) => {
    requireAuth();
    const controller = new AbortController();
    sessionController.current = controller;
    setSession({ key, signal: controller.signal, id: ++nextSessionId.current });
  }, [requireAuth]);

  const handleUnauthorized = useCallback((error: unknown, attemptedSession: ApiSession | null) => {
    if (error instanceof ApiError && error.status === 401 && !attemptedSession?.signal.aborted) {
      requireAuth('Access expired. Enter a valid viewer or operator key.');
    }
  }, [requireAuth]);

  useEffect(() => {
    if (requiresAuth && !session) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let historyPending = false;
    const aborted = () => controller.signal.aborted || session?.signal.aborted;

    async function syncHistory(revision: number | null) {
      historyPending = true;
      try {
        const page = await api.getTelemetry(HISTORY_LIMIT, session, controller.signal);
        if (aborted()) return;
        const history = [...page.items]
          .sort((a, b) => (a.observed_at ?? a.received_at) - (b.observed_at ?? b.received_at) || a.id - b.id)
          .map(({ vitals, observed_at, received_at }) => toTimedVitalsSample(vitals, observed_at ?? received_at))
          .filter((sample): sample is TimedVitalsSample => sample !== null);
        historyRevision.current = revision;
        setMission((previous) => ({ ...previous, history, historyUnavailable: false }));
      } catch (error) {
        if (aborted()) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          requireAuth('Access expired. Enter a valid viewer or operator key.');
          return;
        }
        if (error instanceof ApiError && error.status === 404) legacyHistory.current = true;
        setMission((previous) => previous.historyUnavailable ? previous : { ...previous, historyUnavailable: true });
      } finally {
        historyPending = false;
      }
    }

    async function poll() {
      let delay = 1000;
      try {
        const data = await api.getState(session, controller.signal);
        if (aborted()) return;
        const revision = data.telemetry_revision ?? data.telemetry_received_at;
        const durableHistory = revision !== undefined && !legacyHistory.current;
        const checkedAt = Date.now();
        const measuredAt = data.telemetry_observed_at ?? data.telemetry_received_at;
        setMission((previous) => ({
          ...previous,
          data,
          connection: 'online',
          checkedAt,
          history: durableHistory ? previous.history : appendReading(
            previous.history,
            toTimedVitalsSample(data.vitals, measuredAt ?? checkedAt / 1000),
            measuredAt != null,
          ),
        }));
        if (requiresAuth) setRequiresAuth(false);

        if (durableHistory && historyRevision.current !== revision && !historyPending) void syncHistory(revision);
      } catch (error) {
        if (aborted()) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          requireAuth(session ? 'Enter a valid viewer or operator key.' : null);
          return;
        }
        if (requiresAuth) {
          requireAuth(getErrorMessage(error));
          return;
        }
        delay = 3000;
        setMission((previous) => previous.connection === 'offline' ? previous : { ...previous, connection: 'offline' });
      }
      timer = setTimeout(poll, delay);
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [refreshId, requireAuth, requiresAuth, session]);

  return { ...mission, refresh, session, requiresAuth, authError, signIn, signOut: requireAuth, handleUnauthorized };
}
