import { randomUUID } from "node:crypto";
import type { RemoteContextResolver } from "./remote-gateway.js";

export interface RelayContextTask {
  version: "topo.remote-relay-task/0.1";
  id: string;
  action: "context";
  deviceId: string;
  createdAt: string;
  expiresAt: string;
  request: {
    subject: string;
    purpose: string;
    requestedBy: string;
    query?: string;
    maxItems?: number;
  };
}

export interface InMemoryContextRelayOptions {
  deviceId: string;
  requestTtlMs?: number;
  maxPending?: number;
  maxResponseBytes?: number;
  now?: () => number;
  requestId?: () => string;
}

type PendingRelayEntry = {
  task: RelayContextTask;
  state: "queued" | "claimed";
  claimedBy: string | null;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const DEFAULT_REQUEST_TTL_MS = 20_000;
const DEFAULT_MAX_PENDING = 32;
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

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

function responseSize(value: unknown): number {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("TOPO relay response must be JSON serialisable");
  }
  return Buffer.byteLength(encoded, "utf8");
}

/**
 * Ephemeral broker used by the CE3 online-device relay experiment.
 *
 * The broker stores only outstanding requests in memory. It does not persist
 * Memory Pages or Context Packets. A remote gateway can use it as its resolver;
 * a TOPO device claims work over an outbound channel and completes the request
 * after running the normal local Desktop resolver.
 */
export class InMemoryContextRelay implements RemoteContextResolver {
  private readonly deviceId: string;
  private readonly requestTtlMs: number;
  private readonly maxPending: number;
  private readonly maxResponseBytes: number;
  private readonly now: () => number;
  private readonly requestId: () => string;
  private readonly pending = new Map<string, PendingRelayEntry>();

  constructor(options: InMemoryContextRelayOptions) {
    if (options.deviceId.trim().length === 0) {
      throw new Error("deviceId is required");
    }
    this.deviceId = options.deviceId.trim();
    this.requestTtlMs = positiveInteger(
      options.requestTtlMs,
      DEFAULT_REQUEST_TTL_MS,
      "requestTtlMs",
    );
    this.maxPending = positiveInteger(
      options.maxPending,
      DEFAULT_MAX_PENDING,
      "maxPending",
    );
    this.maxResponseBytes = positiveInteger(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "maxResponseBytes",
    );
    this.now = options.now ?? (() => Date.now());
    this.requestId = options.requestId ?? (() => `relay-${randomUUID()}`);
  }

  async context(
    request: RelayContextTask["request"],
  ): Promise<unknown> {
    this.pruneExpired();
    if (this.pending.size >= this.maxPending) {
      throw new Error("TOPO remote relay is at its pending request limit");
    }

    const id = this.requestId();
    if (id.trim().length === 0 || this.pending.has(id)) {
      throw new Error("TOPO remote relay generated an invalid request id");
    }

    const createdMs = this.now();
    const expiresMs = createdMs + this.requestTtlMs;
    const task: RelayContextTask = {
      version: "topo.remote-relay-task/0.1",
      id,
      action: "context",
      deviceId: this.deviceId,
      createdAt: iso(createdMs),
      expiresAt: iso(expiresMs),
      request: {
        subject: request.subject,
        purpose: request.purpose,
        requestedBy: request.requestedBy,
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.maxItems === undefined ? {} : { maxItems: request.maxItems }),
      },
    };

    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const current = this.pending.get(id);
        if (current === undefined) return;
        this.pending.delete(id);
        current.reject(new Error("TOPO remote relay request expired before the device responded"));
      }, this.requestTtlMs);

      this.pending.set(id, {
        task,
        state: "queued",
        claimedBy: null,
        resolve,
        reject,
        timeout,
      });
    });
  }

  claimNext(deviceId: string): RelayContextTask | undefined {
    this.assertDevice(deviceId);
    this.pruneExpired();

    for (const entry of this.pending.values()) {
      if (entry.state !== "queued") continue;
      entry.state = "claimed";
      entry.claimedBy = this.deviceId;
      return structuredClone(entry.task);
    }
    return undefined;
  }

  complete(deviceId: string, requestId: string, packet: unknown): void {
    const entry = this.claimedEntry(deviceId, requestId);
    const bytes = responseSize(packet);
    if (bytes > this.maxResponseBytes) {
      this.finishWithError(
        entry,
        requestId,
        new Error(
          `TOPO remote relay response exceeds ${this.maxResponseBytes} bytes`,
        ),
      );
      throw new Error(
        `TOPO remote relay response exceeds ${this.maxResponseBytes} bytes`,
      );
    }

    clearTimeout(entry.timeout);
    this.pending.delete(requestId);
    entry.resolve(packet);
  }

  fail(deviceId: string, requestId: string, message: string): void {
    const entry = this.claimedEntry(deviceId, requestId);
    const detail = message.trim().slice(0, 1000) || "TOPO device could not resolve context";
    this.finishWithError(entry, requestId, new Error(detail));
  }

  pendingCount(): number {
    this.pruneExpired();
    return this.pending.size;
  }

  close(): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timeout);
      entry.reject(new Error("TOPO remote relay closed before the device responded"));
      this.pending.delete(id);
    }
  }

  private assertDevice(deviceId: string): void {
    if (deviceId !== this.deviceId) {
      throw new Error("TOPO remote relay device identity does not match");
    }
  }

  private claimedEntry(deviceId: string, requestId: string): PendingRelayEntry {
    this.assertDevice(deviceId);
    this.pruneExpired();
    const entry = this.pending.get(requestId);
    if (entry === undefined) {
      throw new Error("TOPO remote relay request is missing or expired");
    }
    if (entry.state !== "claimed" || entry.claimedBy !== this.deviceId) {
      throw new Error("TOPO remote relay request has not been claimed by this device");
    }
    return entry;
  }

  private finishWithError(
    entry: PendingRelayEntry,
    requestId: string,
    error: Error,
  ): void {
    clearTimeout(entry.timeout);
    this.pending.delete(requestId);
    entry.reject(error);
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [id, entry] of this.pending.entries()) {
      const expires = Date.parse(entry.task.expiresAt);
      if (Number.isNaN(expires) || now < expires) continue;
      clearTimeout(entry.timeout);
      this.pending.delete(id);
      entry.reject(new Error("TOPO remote relay request expired before the device responded"));
    }
  }
}
