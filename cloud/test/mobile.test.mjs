import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { GET } from "../app/manifest.webmanifest/route.js";

test("PWA advertises POST share target and not a query-string share", async () => {
  const response = GET();
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.equal(manifest.share_target.action, "/share-target");
  assert.equal(manifest.share_target.method, "POST");
  assert.equal(manifest.share_target.enctype, "multipart/form-data");
  assert.equal(manifest.share_target.params.text, "text");
});
test("share worker redirects with an absolute URL and does not fetch remote content", () => {
  const path = new URL("../public/sw.js", import.meta.url);
  execFileSync(process.execPath, ["--check", path.pathname]);
  const code = readFileSync(path, "utf8");
  assert.match(code, /Response\.redirect\(new URL\("\/capture\?shared=1", self\.location\.origin\)\.href, 303\)/);
  assert.doesNotMatch(code, /fetch\(/);
});
