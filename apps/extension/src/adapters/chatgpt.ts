import type { SiteAdapter, ParsedTurn } from "./types.js";
import { activeModeLabel, cleanText } from "./types.js";

export const chatgptAdapter: SiteAdapter = {
  product: "chatgpt",
  provider: "openai",

  matches(url) {
    return url.hostname === "chatgpt.com" || url.hostname === "chat.openai.com";
  },

  detectMode() {
    const active = activeModeLabel();
    if (active === "Work") return "work";
    if (/\bwork\b/i.test(location.pathname)) return "work";
    return "chat";
  },

  conversationId(url) {
    const match = url.pathname.match(/\/c\/([^/?#]+)/);
    return match?.[1];
  },

  conversationTitle() {
    const title = cleanText(document.title).replace(/\s*[-–—]\s*ChatGPT\s*$/i, "");
    return title || undefined;
  },

  parseTurns() {
    const turns: ParsedTurn[] = [];
    const nodes = document.querySelectorAll("[data-message-author-role]");

    for (const node of nodes) {
      const author = node.getAttribute("data-message-author-role");
      if (author !== "user" && author !== "assistant") continue;
      const content = cleanText(node.textContent);
      if (!content) continue;
      const providerTurnId =
        node.getAttribute("data-message-id") ??
        node.closest("[data-message-id]")?.getAttribute("data-message-id") ??
        undefined;
      turns.push({
        role: author,
        content,
        ...(providerTurnId === undefined ? {} : { providerTurnId }),
      });
    }

    return turns;
  },
};
