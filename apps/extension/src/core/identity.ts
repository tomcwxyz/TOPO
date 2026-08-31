import type { CaptureRole } from "@topo/schemas";

function normalize(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

export function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fallbackConversationId(
  product: string,
  title: string | undefined,
  firstUserTurn: string,
): string {
  return `fallback-${fnv1a(
    [product, normalize(title ?? ""), normalize(firstUserTurn)].join("|"),
  )}`;
}

export function turnId(
  role: CaptureRole,
  content: string,
  index: number,
  providerTurnId?: string,
): string {
  return providerTurnId ?? `${role}-${index}-${fnv1a(normalize(content))}`;
}
