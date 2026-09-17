import { TopoLocalClient } from "./local-client.js";
import type { RelayContextTask } from "./remote-relay.js";
import type { RemoteContextResolver } from "./remote-gateway.js";

export interface RelayDeviceWorkerOptions {
  relayBaseUrl: string;
  deviceToken: string;
  resolver: RemoteContextResolver;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export interface LocalTopoRelayWorkerOptions {
  relayBaseUrl: string;
  deviceToken: string;
  discoveryPath?: string;
  fetchImpl?: typeof fetch;
  localFetch?: typeof fetch;
  now?: () => number;
}

export interface RelayDeviceWorkResult {
  processed: boolean;
  requestId?: string;
  status?: "completed" | "failed";
}

function join(base: string, path: string): URL {
  return new URL(path, `${base.replace(/\/$/, "")}/`);
}

function isTask(value: unknown): value is RelayContextTask {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.version !== "topo.remote-relay-task/0.1" ||
    record.action !== "context" ||
    typeof record.id !== "string" ||
    typeof record.deviceId !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.expiresAt !== "string" ||
    typeof record.request !== "object" ||
    record.request === null ||
    Array.isArray(record.request)
  ) {
    return false;
  }
  const request = record.request as Record<string, unknown>;
  if (
    typeof request.subject !== "string" ||
    typeof request.purpose !== "string" ||
    typeof request.requestedBy !== "string"
  ) {
    return false;
  }
  if (request.query !== undefined && typeof request.query !== "string") {
    return false;
  }
  if (
    request.maxItems !== undefined &&
    (!Number.isInteger(request.maxItems) ||
      Number(request.maxItems) < 1 ||
      Number(request.maxItems) > 100)
  ) {
    return false;
  }
  const created = Date.parse(record.createdAt);
  const expires = Date.parse(record.expiresAt);
  return !Number.isNaN(created) && !Number.isNaN(expires) && expires > created;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim().length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`TOPO relay returned invalid JSON (${response.status})`);
  }
}

async function post(
  fetchImpl: typeof fetch,
  url: URL,
  token: string,
  body: unknown,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const value = await parseJson(response);
    const detail =
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      typeof (value as Record<string, unknown>).error === "string"
        ? String((value as Record<string, unknown>).error)
        : `HTTP ${response.status}`;
    throw new Error(`TOPO relay rejected device response: ${detail}`);
  }
}

/**
 * Service at most one relay task using an outbound request from the TOPO device.
 *
 * A scheduler/desktop lifecycle can call this repeatedly or replace polling with
 * a streaming transport later. The local resolver remains authoritative.
 */
export async function serviceRelayOnce(
  options: RelayDeviceWorkerOptions,
): Promise<RelayDeviceWorkResult> {
  if (options.deviceToken.trim().length === 0) {
    throw new Error("deviceToken is required");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const clock = options.now ?? (() => Date.now());
  const next = await fetchImpl(join(options.relayBaseUrl, "/v0/device/next"), {
    method: "GET",
    headers: { Authorization: `Bearer ${options.deviceToken}` },
  });

  if (next.status === 204) return { processed: false };
  if (!next.ok) {
    throw new Error(`TOPO relay device poll failed with HTTP ${next.status}`);
  }

  const value = await parseJson(next);
  if (!isTask(value)) {
    throw new Error("TOPO relay returned an invalid device task");
  }
  if (clock() >= Date.parse(value.expiresAt)) {
    throw new Error("TOPO relay returned an expired device task");
  }

  let packet: unknown;
  try {
    packet = await options.resolver.context({
      subject: value.request.subject,
      purpose: value.request.purpose,
      requestedBy: value.request.requestedBy,
      ...(value.request.query === undefined ? {} : { query: value.request.query }),
      ...(value.request.maxItems === undefined
        ? {}
        : { maxItems: value.request.maxItems }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await post(
      fetchImpl,
      join(options.relayBaseUrl, "/v0/device/fail"),
      options.deviceToken,
      { requestId: value.id, error: message },
    );
    return { processed: true, requestId: value.id, status: "failed" };
  }

  await post(
    fetchImpl,
    join(options.relayBaseUrl, "/v0/device/complete"),
    options.deviceToken,
    { requestId: value.id, packet },
  );
  return { processed: true, requestId: value.id, status: "completed" };
}

/**
 * Convenience composition for the actual TOPO device: resolve relay tasks via
 * the same authenticated Desktop loopback client used by CLI/MCP integrations.
 */
export async function serviceLocalTopoRelayOnce(
  options: LocalTopoRelayWorkerOptions,
): Promise<RelayDeviceWorkResult> {
  const local = new TopoLocalClient({
    ...(options.discoveryPath === undefined
      ? {}
      : { discoveryPath: options.discoveryPath }),
    ...(options.localFetch === undefined ? {} : { fetch: options.localFetch }),
  });

  return serviceRelayOnce({
    relayBaseUrl: options.relayBaseUrl,
    deviceToken: options.deviceToken,
    resolver: local,
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}
