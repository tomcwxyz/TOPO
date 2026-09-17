import { createHash, timingSafeEqual } from "node:crypto";
import { InMemoryContextRelay } from "./remote-relay.js";

export interface RelayDeviceIdentity {
  deviceId: string;
}

export interface RelayDeviceAuthorizer {
  authorise(authorization: string | null): Promise<RelayDeviceIdentity | undefined>;
}

export interface RelayDeviceHandlerOptions {
  relay: InMemoryContextRelay;
  authorizer: RelayDeviceAuthorizer;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function body(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function waitMsFrom(url: URL): number | undefined | "invalid" {
  const raw = url.searchParams.get("waitMs");
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 25_000) return "invalid";
  return value;
}

/**
 * Device-facing side of the CE3 relay experiment.
 *
 * This handler is intended to live at the remote relay. TOPO Desktop calls it
 * over an outbound connection; it never requires the relay to connect back to
 * Desktop or know the Desktop loopback endpoint.
 */
export function createRelayDeviceHandler(
  options: RelayDeviceHandlerOptions,
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const identity = await options.authorizer.authorise(
      request.headers.get("Authorization"),
    );
    if (identity === undefined) {
      return json({ error: "unauthorised", code: "TOPO_RELAY_DEVICE_UNAUTHORISED" }, 401);
    }

    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/v0/device/capabilities") {
      return json({
        protocol: "topo.remote-relay-device/0.1",
        deviceId: identity.deviceId,
        actions: ["poll", "long-poll", "complete", "fail"],
        maxLongPollMs: 25_000,
        memoryStorage: false,
        inboundDesktopConnectionRequired: false,
      });
    }

    if (request.method === "GET" && url.pathname === "/v0/device/next") {
      const waitMs = waitMsFrom(url);
      if (waitMs === "invalid") {
        return json({ error: "waitMs must be an integer between 1 and 25000" }, 400);
      }
      try {
        const task =
          waitMs === undefined
            ? options.relay.claimNext(identity.deviceId)
            : await options.relay.waitForNext(identity.deviceId, waitMs);
        if (task === undefined) {
          return new Response(null, {
            status: 204,
            headers: { "Cache-Control": "no-store" },
          });
        }
        return json(task);
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : String(error),
            code: "TOPO_RELAY_DEVICE_SCOPE",
          },
          403,
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/v0/device/complete") {
      const value = await body(request);
      if (
        value === undefined ||
        typeof value.requestId !== "string" ||
        !("packet" in value)
      ) {
        return json({ error: "requestId and packet are required" }, 400);
      }
      try {
        options.relay.complete(identity.deviceId, value.requestId, value.packet);
        return json({ accepted: true, requestId: value.requestId });
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : String(error),
            code: "TOPO_RELAY_COMPLETE_REJECTED",
          },
          409,
        );
      }
    }

    if (request.method === "POST" && url.pathname === "/v0/device/fail") {
      const value = await body(request);
      if (
        value === undefined ||
        typeof value.requestId !== "string" ||
        typeof value.error !== "string"
      ) {
        return json({ error: "requestId and error are required" }, 400);
      }
      try {
        options.relay.fail(identity.deviceId, value.requestId, value.error);
        return json({ accepted: true, requestId: value.requestId });
      } catch (error) {
        return json(
          {
            error: error instanceof Error ? error.message : String(error),
            code: "TOPO_RELAY_FAILURE_REJECTED",
          },
          409,
        );
      }
    }

    return json({ error: "not found" }, 404);
  };
}

function digest(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/**
 * Prototype-only enrolled-device authorizer. Production should use revocable
 * device credentials established by a device-enrolment flow.
 */
export class StaticRelayDeviceAuthorizer implements RelayDeviceAuthorizer {
  private readonly deviceId: string;
  private readonly tokenDigest: Buffer;

  constructor(deviceId: string, token: string) {
    if (deviceId.trim().length === 0) {
      throw new Error("deviceId is required");
    }
    if (token.trim().length < 32) {
      throw new Error("Relay prototype device tokens must contain at least 32 characters");
    }
    this.deviceId = deviceId.trim();
    this.tokenDigest = digest(token);
  }

  async authorise(
    authorization: string | null,
  ): Promise<RelayDeviceIdentity | undefined> {
    if (authorization === null || !authorization.startsWith("Bearer ")) {
      return undefined;
    }
    const candidate = digest(authorization.slice("Bearer ".length));
    if (
      candidate.length !== this.tokenDigest.length ||
      !timingSafeEqual(candidate, this.tokenDigest)
    ) {
      return undefined;
    }
    return { deviceId: this.deviceId };
  }
}
