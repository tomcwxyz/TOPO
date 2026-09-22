import {
  serviceRelayOnce,
  type RelayDeviceWorkerOptions,
  type RelayDeviceWorkResult,
} from "./remote-relay-device.js";

export type RelayDeviceSessionPhase =
  | "connecting"
  | "online"
  | "backoff"
  | "stopped";

export interface RelayDeviceSessionState {
  phase: RelayDeviceSessionPhase;
  at: string;
  consecutiveFailures: number;
  retryInMs?: number;
  error?: string;
}

export interface RelayDeviceSessionSummary {
  polls: number;
  completed: number;
  failed: number;
  reconnects: number;
  stoppedAt: string;
}

export interface RelayDeviceSessionOptions extends RelayDeviceWorkerOptions {
  signal: AbortSignal;
  minRetryMs?: number;
  maxRetryMs?: number;
  random?: () => number;
  onState?: (state: RelayDeviceSessionState) => void;
  onResult?: (result: RelayDeviceWorkResult) => void;
  serviceOnce?: (
    options: RelayDeviceWorkerOptions,
  ) => Promise<RelayDeviceWorkResult>;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

const DEFAULT_MIN_RETRY_MS = 500;
const DEFAULT_MAX_RETRY_MS = 15_000;

function positiveInteger(
  value: number | undefined,
  fallback: number,
  field: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1) {
    throw new Error(`${field} must be a positive integer`);
  }
  return resolved;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function aborted(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  return (
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

function retryDelay(
  failures: number,
  minimum: number,
  maximum: number,
  random: () => number,
): number {
  const exponent = Math.min(Math.max(failures - 1, 0), 20);
  const base = Math.min(maximum, minimum * 2 ** exponent);
  const sample = Math.min(1, Math.max(0, random()));
  const jitter = 0.8 + sample * 0.4;
  return Math.max(1, Math.round(base * jitter));
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", finish, { once: true });
  });
}

function safeStateCallback(
  callback: RelayDeviceSessionOptions["onState"],
  state: RelayDeviceSessionState,
): void {
  try {
    callback?.(state);
  } catch {
    // Session lifecycle must not be owned by UI/telemetry callbacks.
  }
}

function safeResultCallback(
  callback: RelayDeviceSessionOptions["onResult"],
  result: RelayDeviceWorkResult,
): void {
  try {
    callback?.(result);
  } catch {
    // Session lifecycle must not be owned by UI/telemetry callbacks.
  }
}

/**
 * Keep one TOPO device connected to the relay using bounded long-poll requests.
 *
 * The session owns continuity/reconnect behaviour only. It never caches memory,
 * broadens authority or resolves context itself; each task still passes through
 * serviceRelayOnce and the configured local Desktop resolver.
 */
export async function runRelayDeviceSession(
  options: RelayDeviceSessionOptions,
): Promise<RelayDeviceSessionSummary> {
  const minRetryMs = positiveInteger(
    options.minRetryMs,
    DEFAULT_MIN_RETRY_MS,
    "minRetryMs",
  );
  const maxRetryMs = positiveInteger(
    options.maxRetryMs,
    DEFAULT_MAX_RETRY_MS,
    "maxRetryMs",
  );
  if (maxRetryMs < minRetryMs) {
    throw new Error("maxRetryMs must be greater than or equal to minRetryMs");
  }

  const random = options.random ?? Math.random;
  const serviceOnce = options.serviceOnce ?? serviceRelayOnce;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => Date.now());
  const workerOptions: RelayDeviceWorkerOptions = {
    relayBaseUrl: options.relayBaseUrl,
    deviceToken: options.deviceToken,
    resolver: options.resolver,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    now,
    ...(options.longPollMs === undefined
      ? {}
      : { longPollMs: options.longPollMs }),
    signal: options.signal,
  };

  let polls = 0;
  let completed = 0;
  let failed = 0;
  let reconnects = 0;
  let consecutiveFailures = 0;
  let online = false;

  const emit = (
    phase: RelayDeviceSessionPhase,
    extra: Pick<RelayDeviceSessionState, "retryInMs" | "error"> = {},
  ) => {
    safeStateCallback(options.onState, {
      phase,
      at: new Date(now()).toISOString(),
      consecutiveFailures,
      ...(extra.retryInMs === undefined
        ? {}
        : { retryInMs: extra.retryInMs }),
      ...(extra.error === undefined ? {} : { error: extra.error }),
    });
  };

  emit("connecting");

  while (!options.signal.aborted) {
    try {
      const result = await serviceOnce(workerOptions);
      polls += 1;
      consecutiveFailures = 0;

      if (!online) {
        online = true;
        emit("online");
      }

      if (result.processed) {
        if (result.status === "completed") completed += 1;
        if (result.status === "failed") failed += 1;
        safeResultCallback(options.onResult, result);
      }
    } catch (error) {
      if (aborted(error, options.signal)) break;

      online = false;
      consecutiveFailures += 1;
      reconnects += 1;
      const retryInMs = retryDelay(
        consecutiveFailures,
        minRetryMs,
        maxRetryMs,
        random,
      );
      emit("backoff", {
        retryInMs,
        error: errorText(error).slice(0, 1000),
      });
      await sleep(retryInMs, options.signal);
      if (!options.signal.aborted) emit("connecting");
    }
  }

  emit("stopped");
  return {
    polls,
    completed,
    failed,
    reconnects,
    stoppedAt: new Date(now()).toISOString(),
  };
}
