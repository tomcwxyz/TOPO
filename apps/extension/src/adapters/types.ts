import type {
  CaptureMode,
  CaptureProduct,
  CaptureRole,
} from "@topo/schemas";

export interface ParsedTurn {
  role: CaptureRole;
  content: string;
  providerTurnId?: string;
}

export interface SiteAdapter {
  product: CaptureProduct;
  provider: string;
  matches(url: URL): boolean;
  detectMode(): CaptureMode;
  conversationId(url: URL): string | undefined;
  conversationTitle(): string | undefined;
  parseTurns(): ParsedTurn[];
}

export function cleanText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function activeModeLabel(): string | undefined {
  const candidates = document.querySelectorAll(
    '[aria-pressed="true"], [aria-selected="true"], [data-state="active"]',
  );
  for (const node of candidates) {
    const label = cleanText(node.textContent);
    if (label === "Work" || label === "Cowork" || label === "Chat") {
      return label;
    }
  }
  return undefined;
}
