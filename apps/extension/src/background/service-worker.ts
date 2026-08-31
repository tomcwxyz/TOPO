import type {
  CapturedInteraction,
  CaptureProduct,
} from "@topo/schemas";

const NATIVE_HOST = "uk.co.goodship.topo.capture";
const QUEUE_KEY = "topo.capture.queue";
const MAX_QUEUE = 100;

type QueueEntry = {
  interaction: CapturedInteraction;
  queuedAt: string;
};

chrome.action.onClicked.addListener(async (tab) => {
  const product = productFromUrl(tab.url);
  if (!product || tab.id === undefined) return;
  const enabled = !(await captureEnabled(product));
  await setCaptureEnabled(product, enabled);
  await chrome.tabs.sendMessage(tab.id, {
    type: "TOPO_CAPTURE_CHANGED",
    product,
    enabled,
  }).catch(() => undefined);
  await chrome.action.setBadgeText({
    tabId: tab.id,
    text: enabled ? "ON" : "",
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    if (message?.type === "TOPO_CAPTURE_STATUS") {
      return {
        enabled: await captureEnabled(message.product),
        queued: (await readQueue()).length,
      };
    }

    if (message?.type === "TOPO_TOGGLE_CAPTURE") {
      const product = message.product as CaptureProduct;
      const enabled = !(await captureEnabled(product));
      await setCaptureEnabled(product, enabled);
      if (sender.tab?.id !== undefined) {
        await chrome.tabs.sendMessage(sender.tab.id, {
          type: "TOPO_CAPTURE_CHANGED",
          product,
          enabled,
        }).catch(() => undefined);
      }
      return { enabled };
    }

    if (message?.type === "TOPO_CAPTURE_SNAPSHOT") {
      const result = await deliverOrQueue(message.interaction as CapturedInteraction);
      if (sender.tab?.id !== undefined) {
        await chrome.action.setBadgeText({
          tabId: sender.tab.id,
          text: result.delivery === "queued" ? "Q" : "ON",
        });
      }
      return { ok: true, ...result };
    }

    return { ok: false };
  };

  run().then(sendResponse).catch((error) => {
    sendResponse({ ok: false, error: String(error) });
  });
  return true;
});

chrome.runtime.onStartup.addListener(() => {
  flushQueue().catch(() => undefined);
});

chrome.runtime.onInstalled.addListener(() => {
  flushQueue().catch(() => undefined);
});

async function captureEnabled(product: CaptureProduct): Promise<boolean> {
  const key = `capture.${product}.enabled`;
  const value = await chrome.storage.local.get(key);
  return value[key] === true;
}

async function setCaptureEnabled(
  product: CaptureProduct,
  enabled: boolean,
): Promise<void> {
  await chrome.storage.local.set({
    [`capture.${product}.enabled`]: enabled,
  });
}

async function deliverOrQueue(
  interaction: CapturedInteraction,
): Promise<{ delivery: "delivered" | "queued"; queued: number }> {
  try {
    const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
      type: "capture.interaction",
      interaction,
    });
    if (!response || response.ok !== true) {
      throw new Error(response?.error ?? "TOPO native host did not accept capture");
    }
    await flushQueue();
    return { delivery: "delivered", queued: (await readQueue()).length };
  } catch {
    await queue(interaction);
    return { delivery: "queued", queued: (await readQueue()).length };
  }
}

async function queue(interaction: CapturedInteraction): Promise<void> {
  const existing = await readQueue();
  const withoutSameInteraction = existing.filter(
    (entry) => entry.interaction.id !== interaction.id,
  );
  withoutSameInteraction.push({
    interaction,
    queuedAt: new Date().toISOString(),
  });
  await chrome.storage.local.set({
    [QUEUE_KEY]: withoutSameInteraction.slice(-MAX_QUEUE),
  });
}

async function flushQueue(): Promise<void> {
  const entries = await readQueue();
  if (entries.length === 0) return;

  const remaining: QueueEntry[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (!entry) continue;

    try {
      const response = await chrome.runtime.sendNativeMessage(NATIVE_HOST, {
        type: "capture.interaction",
        interaction: entry.interaction,
      });
      if (!response || response.ok !== true) {
        remaining.push(entry);
      }
    } catch {
      remaining.push(...entries.slice(index));
      break;
    }
  }

  await chrome.storage.local.set({ [QUEUE_KEY]: remaining });
}

async function readQueue(): Promise<QueueEntry[]> {
  const value = await chrome.storage.local.get(QUEUE_KEY);
  return Array.isArray(value[QUEUE_KEY]) ? value[QUEUE_KEY] : [];
}

function productFromUrl(url: string | undefined): CaptureProduct | undefined {
  if (!url) return undefined;
  try {
    const host = new URL(url).hostname;
    if (host === "chatgpt.com" || host === "chat.openai.com") return "chatgpt";
    if (host === "claude.ai") return "claude";
    if (host === "gemini.google.com") return "gemini";
    return undefined;
  } catch {
    return undefined;
  }
}
