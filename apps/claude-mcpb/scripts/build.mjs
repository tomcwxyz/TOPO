import { build } from "esbuild";
import {
  copyFileSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const bundle = resolve(root, "bundle");
const server = resolve(bundle, "server");

rmSync(bundle, { recursive: true, force: true });
mkdirSync(server, { recursive: true });

await build({
  entryPoints: [resolve(root, "src/index.ts")],
  outfile: resolve(server, "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: ["node18"],
  sourcemap: false,
  legalComments: "none",
  banner: {
    js: "#!/usr/bin/env node",
  },
});

copyFileSync(resolve(root, "manifest.json"), resolve(bundle, "manifest.json"));
writeFileSync(
  resolve(bundle, "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
);
