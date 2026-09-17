export interface TopoRemoteClientOptions {
  baseUrl: string;
  accessToken: string;
  fetch?: typeof globalThis.fetch;
  maxResponseBytes?: number;
}

export interface TopoRemoteContextRequest {
  subject: string;
  purpose: string;
  requestedBy?: string;
  query?: string;
  maxItems?: number;
}

const DEFAULT_MAX_RESPONSE_BYTES = 512 * 1024;

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1"
  );
}

function validatedBaseUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    throw new Error("TOPO remote context requires HTTPS except on loopback development endpoints");
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new Error("TOPO remote context URL must not contain credentials");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/`;
  url.search = "";
  url.hash = "";
  return url;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read-only client for the CE3 remote context gateway.
 *
 * It intentionally has no capture/contribution methods. The bearer represents a
 * remote context grant, not general TOPO authority.
 */
export class TopoRemoteContextClient {
  readonly transport = "remote-context-gateway";

  private readonly baseUrl: URL;
  private readonly accessToken: string;
  private readonly fetcher: typeof globalThis.fetch;
  private readonly maxResponseBytes: number;

  constructor(options: TopoRemoteClientOptions) {
    this.baseUrl = validatedBaseUrl(options.baseUrl);
    this.accessToken = options.accessToken.trim();
    if (this.accessToken.length === 0) {
      throw new Error("TOPO remote context accessToken is required");
    }
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (!Number.isInteger(this.maxResponseBytes) || this.maxResponseBytes < 1) {
      throw new Error("maxResponseBytes must be a positive integer");
    }
  }

  async context(request: TopoRemoteContextRequest): Promise<unknown> {
    const url = new URL("v0/context", this.baseUrl);
    const response = await this.fetcher(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        subject: request.subject,
        purpose: request.purpose,
        ...(request.query === undefined ? {} : { query: request.query }),
        ...(request.maxItems === undefined ? {} : { maxItems: request.maxItems }),
      }),
    });

    const declaredLength = response.headers.get("content-length");
    if (
      declaredLength !== null &&
      Number.isFinite(Number(declaredLength)) &&
      Number(declaredLength) > this.maxResponseBytes
    ) {
      throw new Error("TOPO remote context response exceeded the configured size limit");
    }

    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > this.maxResponseBytes) {
      throw new Error("TOPO remote context response exceeded the configured size limit");
    }

    let value: unknown = {};
    if (text.trim().length > 0) {
      try {
        value = JSON.parse(text);
      } catch {
        throw new Error(`TOPO remote context returned invalid JSON (${response.status})`);
      }
    }

    if (!response.ok) {
      const detail =
        isRecord(value) && typeof value.error === "string"
          ? value.error
          : `HTTP ${response.status}`;
      throw new Error(`TOPO remote context request failed: ${detail}`);
    }
    return value;
  }
}
