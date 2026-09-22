import { randomUUID } from "node:crypto";
import {
  capturedInteractionSchema,
  type CapturedInteraction,
  type JsonValue,
} from "@topo/schemas";

export interface MobileContextClient {
  context(request: {
    subject: string;
    purpose: string;
    requestedBy?: string;
    query?: string;
    maxItems?: number;
  }): Promise<unknown>;
}

export interface MobileUseContextRequest {
  subject: string;
  purpose: string;
  query?: string;
  maxItems?: number;
}

export interface MobileContextProjectionOptions {
  maxChars?: number;
  maxPages?: number;
}

export interface MobileContextProjection {
  text: string;
  pageCount: number;
  truncated: boolean;
}

export interface MobileRememberCaptureInput {
  text: string;
  subject?: string;
  title?: string;
  sourceUrl?: string;
  sourceApp?: string;
  provider?: string;
  capturedAt?: string;
  interactionId?: string;
  turnId?: string;
  metadata?: Record<string, JsonValue>;
}

const DEFAULT_SHARE_MAX_CHARS = 6_000;
const DEFAULT_SHARE_MAX_PAGES = 6;
const MAX_MOBILE_CAPTURE_CHARS = 5_000;
const SHARE_PREAMBLE = "Relevant context from my TOPO memory for this task:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  field: string,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new Error(`${field} must be an integer between 1 and ${maximum}`);
  }
  return resolved;
}

function compact(value: string, maxChars: number): { text: string; truncated: boolean } {
  const clean = value.trim();
  if (clean.length <= maxChars) return { text: clean, truncated: false };
  if (maxChars <= 1) return { text: "…", truncated: true };
  const text = `${clean.slice(0, maxChars - 1).trimEnd()}…`;
  return { text, truncated: true };
}

function memoryPageShareParts(value: unknown): { title: string; content: string } | undefined {
  if (!isRecord(value) || value.type !== "topo.memory_page" || !isRecord(value.value)) {
    return undefined;
  }
  const title = typeof value.value.title === "string" ? value.value.title.trim() : "";
  const content = typeof value.value.content === "string" ? value.value.content.trim() : "";
  if (content.length === 0) return undefined;
  return { title, content };
}

/**
 * Convert an already-governed Context Packet into plain text suitable for a
 * mobile share sheet or paste action.
 *
 * The projection intentionally omits TOPO ids, provenance, source references,
 * revisions, sensitivity metadata and the original request purpose/query.
 */
export function projectContextPacketForMobileShare(
  packet: unknown,
  options: MobileContextProjectionOptions = {},
): MobileContextProjection {
  const maxChars = boundedInteger(
    options.maxChars,
    DEFAULT_SHARE_MAX_CHARS,
    "maxChars",
    20_000,
  );
  const maxPages = boundedInteger(
    options.maxPages,
    DEFAULT_SHARE_MAX_PAGES,
    "maxPages",
    20,
  );

  if (!isRecord(packet) || !Array.isArray(packet.objects)) {
    throw new Error("TOPO mobile share requires a Context Packet with objects");
  }

  const pages = packet.objects
    .map(memoryPageShareParts)
    .filter((page): page is { title: string; content: string } => page !== undefined);

  let text = SHARE_PREAMBLE;
  let pageCount = 0;
  let truncated = pages.length > maxPages;

  for (const page of pages.slice(0, maxPages)) {
    const prefix = page.title.length > 0 ? `\n\n${page.title}\n` : "\n\n";
    const remaining = maxChars - text.length - prefix.length;
    if (remaining <= 0) {
      truncated = true;
      break;
    }

    const projected = compact(page.content, remaining);
    text += `${prefix}${projected.text}`;
    pageCount += 1;
    if (projected.truncated) {
      truncated = true;
      break;
    }
  }

  if (text.length > maxChars) {
    const projected = compact(text, maxChars);
    text = projected.text;
    truncated = true;
  }

  return { text, pageCount, truncated };
}

/**
 * Request purpose-bound context and immediately reduce it to the mobile share
 * projection. The returned value is suitable for explicit user share/paste;
 * the full Context Packet does not need to be passed to the target AI app.
 */
export async function useMobileContext(
  client: MobileContextClient,
  request: MobileUseContextRequest,
  projection: MobileContextProjectionOptions = {},
): Promise<MobileContextProjection> {
  const packet = await client.context({
    subject: request.subject,
    purpose: request.purpose,
    requestedBy: "topo-mobile",
    ...(request.query === undefined ? {} : { query: request.query }),
    ...(request.maxItems === undefined ? {} : { maxItems: request.maxItems }),
  });
  return projectContextPacketForMobileShare(packet, projection);
}

/**
 * Turn explicitly selected mobile text into an ordinary TOPO capture source.
 *
 * This is not a memory write. The capture still requires TOPO extraction and
 * review before any durable Memory Page can be created.
 */
export function createMobileRememberCapture(
  input: MobileRememberCaptureInput,
): CapturedInteraction {
  const text = input.text.trim();
  if (text.length === 0) {
    throw new Error("Remember this requires selected text");
  }
  if (text.length > MAX_MOBILE_CAPTURE_CHARS) {
    throw new Error(
      `Remember this accepts at most ${MAX_MOBILE_CAPTURE_CHARS} characters per selected capture`,
    );
  }

  const metadata: Record<string, JsonValue> = {
    ...(input.metadata ?? {}),
    "topo.mobile.shareKind": "selected-content",
    ...(input.sourceApp === undefined || input.sourceApp.trim().length === 0
      ? {}
      : { "topo.mobile.sourceApp": input.sourceApp.trim() }),
  };

  return capturedInteractionSchema.parse({
    id: input.interactionId ?? `mobile-${randomUUID()}`,
    kind: "manual",
    product: "generic",
    client: "mobile",
    mode: "generic",
    captureMethod: "manual",
    fidelity: "partial-visible",
    provider: input.provider?.trim() || "topo-mobile-share",
    subject: input.subject?.trim() || "self",
    ...(input.title === undefined || input.title.trim().length === 0
      ? {}
      : { title: input.title.trim() }),
    ...(input.sourceUrl === undefined || input.sourceUrl.trim().length === 0
      ? {}
      : { sourceUrl: input.sourceUrl.trim() }),
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    turns: [
      {
        id: input.turnId ?? "u1",
        role: "user",
        content: text,
      },
    ],
    retention: "review-window",
    metadata,
  });
}
