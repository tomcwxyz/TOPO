import type { SiteAdapter, ParsedTurn } from "./types.js";
import { cleanText } from "./types.js";

export const geminiAdapter: SiteAdapter = {
  product: "gemini",
  provider: "google",

  matches(url) {
    return url.hostname === "gemini.google.com";
  },

  detectMode() {
    return "chat";
  },

  conversationId(url) {
    const parts = url.pathname.split("/").filter(Boolean);
    const last = parts.at(-1);
    return last && last.length > 8 ? last : undefined;
  },

  conversationTitle() {
    const title = cleanText(document.title).replace(/\s*[-–—]\s*Gemini\s*$/i, "");
    return title || undefined;
  },

  parseTurns() {
    const turns: ParsedTurn[] = [];
    const nodes = document.querySelectorAll(
      '[class*="query-content"], [class*="response-content"], [class*="model-response"], [class*="user-query"], message-content',
    );

    for (const node of nodes) {
      const isUser =
        node.matches('[class*="query"]') ||
        node.matches('[class*="user"]') ||
        node.closest('[class*="query"]') !== null ||
        node.closest('[class*="user-query"]') !== null;
      const content = cleanText(node.textContent);
      if (!content) continue;
      turns.push({ role: isUser ? "user" : "assistant", content });
    }

    return turns;
  },
};
