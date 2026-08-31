import fs from "node:fs";

const expected = process.argv[2];
if (!expected) {
  console.error("Usage: node scripts/check-desktop-version.mjs <version>");
  process.exit(2);
}

const desktop = JSON.parse(fs.readFileSync("apps/desktop/package.json", "utf8"));
const tauri = JSON.parse(fs.readFileSync("apps/desktop/src-tauri/tauri.conf.json", "utf8"));
const cargo = fs.readFileSync("apps/desktop/src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

const versions = {
  "apps/desktop/package.json": desktop.version,
  "apps/desktop/src-tauri/tauri.conf.json": tauri.version,
  "apps/desktop/src-tauri/Cargo.toml": cargoVersion,
};

let failed = false;
for (const [file, actual] of Object.entries(versions)) {
  if (actual !== expected) {
    console.error(`${file}: expected ${expected}, found ${actual ?? "<missing>"}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`TOPO desktop version ${expected} is consistent.`);
