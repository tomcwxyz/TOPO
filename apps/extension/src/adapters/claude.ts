import type { SiteAdapter, ParsedTurn } from "./types.js";
import { activeModeLabel, cleanText } from "./types.js";

const selectors = [
  '[data-testid*="human-turn"], [data-testid*="ai-turn"]',
  '[data-testid*="user-message"], [data-testid*="assistant-message"]',
  '[data-role="user"], [data-role="assistant"]',
  '[class*="human-turn"], [class*="ai-turn"]',
  '[class*="UserMessage"], [class*="AssistantMessage"]',
];

export const claudeAdapter: SiteAdapter = {
  product: "claude",
  provider: "anthropic",

  matches(url) {
    return url.hostname === "claude.ai";
  },

  detectMode() {
    const active = activeModeLabel();
    if (active === "Cowork") return "cowork";
    if (/\bcowork\b/i.test(location.pathname)) return "cowork";
    return "chat";
  },

  conversationId(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    return last && last.length > 8 ? last : undefined;
  },

  conversationTitle() {
    const title = cleanText(document.title).replace(/\s*[-–—]\s*Claude\s*$/i, "");
    return title || undefined;
  },

  parseTurns() {
    for (const selector of selectors) {
      const nodes = document.querySelectorAll(selector);
      if (nodes.length < 2) continue;

      const turns: ParsedTurn[] = [];
      for (const node of nodes) {
        const descriptor = [
          node.getAttribute("data-testid") ?? "",
          node.getAttribute("data-role") ?? "",
          typeof node.className === "string" ? node.className : "",
        ].join(" ");
        const role = /human|user/i.test(descriptor) ? "user" : "assistant";
        const content = cleanText(node.textContent);
        if (!content) continue;
        turns.push({ role, content });
      }
      if (turns.some((turn) => turn.role === "user")) return turns;
    }

    return [];
  },
};
