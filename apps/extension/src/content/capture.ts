import type { CapturedInteraction } from "@topo/schemas";
import { detectAdapter } from "../adapters/index.js";
import { fallbackConversationId, turnId } from "../core/identity.js";

const adapter = detectAdapter();
let enabled = false;
let observer: MutationObserver | undefined;
let timer: number | undefined;
let indicator: HTMLButtonElement | undefined;
let lastSignature = "";
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
  observer = new MutationObserver(() => scheduleCapture(1200));
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
}

function scheduleCapture(delay: number): void {
  if (!enabled) return;
  if (timer !== undefined) window.clearTimeout(timer);
  timer = window.setTimeout(captureSnapshot, delay);
}

function captureSnapshot(): void {
  if (!adapter || !enabled) return;

  const parsed = adapter.parseTurns();
  const firstUser = parsed.find((turn) => turn.role === "user");
  if (!firstUser) return;

  const url = new URL(location.href);
  const externalId =
    adapter.conversationId(url) ??
    fallbackConversationId(
      adapter.product,
      adapter.conversationTitle(),
      firstUser.content,
    );

  const turns = parsed.map((turn, index) => ({
    id: turnId(turn.role, turn.content, index, turn.providerTurnId),
    role: turn.role,
    content: turn.content,
  }));

  const signature = turns.map((turn) => turn.id).join("|");
  if (!signature || signature === lastSignature) return;
  lastSignature = signature;

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
      : "Capture is enabled and interaction snapshots are being handed to local TOPO.";
  indicator.style.opacity = enabled ? "0.92" : "0.65";
}
