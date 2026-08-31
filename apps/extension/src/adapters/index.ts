import type { SiteAdapter } from "./types.js";
import { chatgptAdapter } from "./chatgpt.js";
import { claudeAdapter } from "./claude.js";
import { geminiAdapter } from "./gemini.js";

const adapters: SiteAdapter[] = [
  chatgptAdapter,
  claudeAdapter,
  geminiAdapter,
];

export function detectAdapter(url = new URL(location.href)): SiteAdapter | undefined {
  return adapters.find((adapter) => adapter.matches(url));
}
