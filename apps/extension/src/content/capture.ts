import type { CapturedInteraction } from "@topo/schemas";
import { detectAdapter } from "../adapters/index.js";
import { fallbackConversationId, fnv1a, turnId } from "../core/identity.js";

const MUTATION_SETTLE_MS = 1500;
const SNAPSHOT_STABLE_MS = 2500;

const adapter = detectAdapter();
let enabled = false;
let observer: MutationObserver | undefined;
let timer: number | undefined;
let indicator: HTMLButtonElement | undefined;
let lastSignature = "";
let pendingSignature = "";
let pendingSince = 0;
let delivery: "unknown" | "delivered" | "queued" = "unknown";
let queuedCount = 0;

if (adapter) {
  chrome.runtime.sendMessage({
    type: "TOPO_CAPTURE_STATUS",
    product: adapter.product,
  }).then((response) => {
    queuedCount = Number(response?.queued ?? 0);
    delivery = queuedCount > 0 ? "queued" : "unknown";
    setEnabled(Boolean(response?.enabled));
  }).catch(() => undefined);

  chrome.runtime.onMessage.addListener((message) => {
    if (
      message?.type === "TOPO_CAPTURE_CHANGED" &&
      message.product === adapter.product
    ) {
      setEnabled(Boolean(message.enabled));
    }
  });
}

function setEnabled(next: boolean): void {
  enabled = next;
  renderIndicator();
  if (enabled) start();
  else stop();
}

function start(): void {
  if (!adapter || observer) return;
  scheduleCapture(250);
  observer = new MutationObserver(() => scheduleCapture(MUTATION_SETTLE_MS));
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function stop(): void {
  observer?.disconnect();
  observer = undefined;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  pendingSignature = "";
  pendingSince = 0;
}

function scheduleCapture(delay: number): void {
  if (!enabled) return;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(captureSnapshot, delay);
}

function transientAssistantContent(content: string): boolean {
  const normalised = content.replace(/\s+/g, " ").trim();
  return [
    /^thinking(?:\.{3}|…)?$/i,
    /^generating(?:\.{3}|…)?$/i,
    /^retry$/i,
    /^message delivery timed out\.? please try again\.? retry$/i,
  ].some((pattern) => pattern.test(normalised));
}

function captureSnapshot(): void {
  if (!adapter || !enabled) return;

  const parsed = adapter.parseTurns();
  const filtered = parsed.filter((turn, index) => {
    const isLast = index === parsed.length - 1;
    return !(
      isLast &&
      turn.role === "assistant" &&
      transientAssistantContent(turn.content)
    );
  });
  const firstUser = filtered.find((turn) => turn.role === "user");
  if (!firstUser) return;

  // Do not publish a snapshot while the conversation is visibly waiting for an
  // assistant response. A later DOM mutation will schedule another attempt.
  if (filtered.at(-1)?.role === "user") return;

  const url = new URL(location.href);
  const externalId =
    adapter.conversationId(url) ??
    fallbackConversationId(
      adapter.product,
      adapter.conversationTitle(),
      firstUser.content,
    );

  const turns = filtered.map((turn, index) => ({
    id: turnId(turn.role, turn.content, index, turn.providerTurnId),
    role: turn.role,
    content: turn.content,
  }));

  // Provider message IDs are intentionally stable while an assistant response
  // streams. Include content in the snapshot signature so TOPO can observe the
  // completed response rather than treating an early partial response as final.
  const signature = turns
    .map((turn) => `${turn.id}:${fnv1a(turn.content)}`)
    .join("|");
  if (!signature || signature === lastSignature) return;

  const now = Date.now();
  if (signature !== pendingSignature) {
    pendingSignature = signature;
    pendingSince = now;
    scheduleCapture(SNAPSHOT_STABLE_MS);
    return;
  }
  if (now - pendingSince < SNAPSHOT_STABLE_MS) {
    scheduleCapture(SNAPSHOT_STABLE_MS - (now - pendingSince));
    return;
  }

  lastSignature = signature;
  pendingSignature = "";
  pendingSince = 0;

  const interaction: CapturedInteraction = {
    id: `${adapter.product}-web-${externalId}`,
    kind: "conversation",
    product: adapter.product,
    client: "web",
    mode: adapter.detectMode(),
    captureMethod: "browser-extension",
    fidelity: "conversation-turns",
    provider: adapter.provider,
    subject: "self",
    ...(adapter.conversationTitle() === undefined
      ? {}
      : { title: adapter.conversationTitle() }),
    externalId,
    sourceUrl: url.href,
    capturedAt: new Date().toISOString(),
    turns,
    retention: "review-window",
    metadata: {
      captureClientVersion: chrome.runtime.getManifest().version,
    },
  };

  chrome.runtime.sendMessage({
    type: "TOPO_CAPTURE_SNAPSHOT",
    interaction,
  }).then((response) => {
    if (response?.delivery === "delivered" || response?.delivery === "queued") {
      delivery = response.delivery;
      queuedCount = Number(response.queued ?? 0);
      renderIndicator();
    }
  }).catch(() => {
    delivery = "queued";
    renderIndicator();
  });
}

function renderIndicator(): void {
  if (!adapter) return;
  if (!indicator) {
    indicator = document.createElement("button");
    indicator.type = "button";
    Object.assign(indicator.style, {
      position: "fixed",
      right: "14px",
      bottom: "14px",
      zIndex: "2147483647",
      border: "1px solid rgba(127,127,127,.35)",
      borderRadius: "999px",
      padding: "6px 10px",
      font: "12px/1.2 system-ui, sans-serif",
      boxShadow: "0 2px 10px rgba(0,0,0,.15)",
      cursor: "pointer",
    });
    indicator.addEventListener("click", () => {
      chrome.runtime.sendMessage({
        type: "TOPO_TOGGLE_CAPTURE",
        product: adapter.product,
      }).catch(() => undefined);
    });
    document.documentElement.appendChild(indicator);
  }

  indicator.textContent = !enabled
    ? "TOPO capture paused"
    : delivery === "queued"
      ? `TOPO capture on · ${queuedCount || 1} queued`
      : delivery === "delivered"
        ? "TOPO capture on · local"
        : "TOPO capture on";
  indicator.title = !enabled
    ? "Click to enable TOPO capture for this AI"
    : delivery === "queued"
      ? "Capture is enabled but the native TOPO bridge is unavailable; interaction snapshots are queued in the extension."
      : "Capture is enabled and stable interaction snapshots are being handed to local TOPO.";
  indicator.style.opacity = enabled ? "0.92" : "0.65";
}
