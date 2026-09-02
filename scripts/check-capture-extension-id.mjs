import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const expected = "akckfofkebcbpbkcpcnemeaegpkbnpgd";
const manifest = JSON.parse(readFileSync(new URL("../apps/extension/manifest.json", import.meta.url), "utf8"));
if (!manifest.key) throw new Error("TOPO capture extension manifest must declare a stable alpha key.");

const publicKey = Buffer.from(manifest.key, "base64");
const digest = createHash("sha256").update(publicKey).digest().subarray(0, 16);
const alphabet = "abcdefghijklmnop";
const actual = [...digest]
  .map((byte) => alphabet[byte >> 4] + alphabet[byte & 0x0f])
  .join("");

if (actual !== expected) {
  throw new Error(`TOPO capture extension id drifted: expected ${expected}, got ${actual}`);
}

const rust = readFileSync(
  new URL("../apps/desktop/src-tauri/src/capture_setup.rs", import.meta.url),
  "utf8",
);
if (!rust.includes(`CAPTURE_EXTENSION_ID: &str = "${expected}"`)) {
  throw new Error("Desktop native-host registration does not match the browser extension id.");
}

console.log(`TOPO capture extension id verified: ${actual}`);
