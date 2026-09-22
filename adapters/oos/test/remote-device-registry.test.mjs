import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryRelayDeviceRegistry } from "../dist/remote-device-registry.js";

function registry() {
  let credential = 0;
  let secret = 0;
  let now = Date.parse("2026-09-17T08:00:00.000Z");
  return {
    registry: new InMemoryRelayDeviceRegistry({
      now: () => new Date(now).toISOString(),
      credentialId: () => `cred-${++credential}`,
      secret: () => `secret-${++secret}-${"x".repeat(40)}`,
    }),
    advance(ms) {
      now += ms;
    },
  };
}

test("device enrolment returns a bearer once while registry stores only metadata", async () => {
  const harness = registry();
  const enrolled = harness.registry.enrol("device-home", "Home desktop");

  assert.match(enrolled.token, /^topo-device-v1\.cred-1\./);
  assert.deepEqual(enrolled.device, {
    credentialId: "cred-1",
    deviceId: "device-home",
    label: "Home desktop",
    createdAt: "2026-09-17T08:00:00.000Z",
  });
  assert.deepEqual(harness.registry.list(), [enrolled.device]);
  assert.equal(JSON.stringify(harness.registry.list()).includes("secret-1"), false);

  assert.deepEqual(
    await harness.registry.authorise(`Bearer ${enrolled.token}`),
    { deviceId: "device-home" },
  );
  assert.equal(
    await harness.registry.authorise("Bearer topo-device-v1.cred-1.wrong-secret-that-is-long-enough-to-parse"),
    undefined,
  );
});

test("rotating a device credential immediately invalidates the old bearer", async () => {
  const harness = registry();
  const first = harness.registry.enrol("device-home", "Home desktop");
  harness.advance(1_000);
  const rotated = harness.registry.rotate(first.device.credentialId);

  assert.equal(
    await harness.registry.authorise(`Bearer ${first.token}`),
    undefined,
  );
  assert.deepEqual(
    await harness.registry.authorise(`Bearer ${rotated.token}`),
    { deviceId: "device-home" },
  );
  assert.equal(rotated.device.rotatedFrom, "cred-1");

  const records = harness.registry.list();
  assert.equal(records[0].revokedAt, "2026-09-17T08:00:01.000Z");
  assert.equal(records[1].credentialId, "cred-2");
});

test("lost-device revocation invalidates every active credential for that device only", async () => {
  const harness = registry();
  const homeA = harness.registry.enrol("device-home", "Home A");
  const homeB = harness.registry.enrol("device-home", "Home B");
  const laptop = harness.registry.enrol("device-laptop", "Laptop");

  harness.advance(2_000);
  const revoked = harness.registry.revokeDevice("device-home");
  assert.equal(revoked.length, 2);
  assert.equal(
    revoked.every((record) => record.revokedAt === "2026-09-17T08:00:02.000Z"),
    true,
  );

  assert.equal(await harness.registry.authorise(`Bearer ${homeA.token}`), undefined);
  assert.equal(await harness.registry.authorise(`Bearer ${homeB.token}`), undefined);
  assert.deepEqual(
    await harness.registry.authorise(`Bearer ${laptop.token}`),
    { deviceId: "device-laptop" },
  );
});

test("credential revocation is idempotent and rotating a revoked credential fails", async () => {
  const harness = registry();
  const enrolled = harness.registry.enrol("device-home");
  harness.advance(500);
  const first = harness.registry.revokeCredential(enrolled.device.credentialId);
  harness.advance(500);
  const second = harness.registry.revokeCredential(enrolled.device.credentialId);

  assert.equal(first.revokedAt, "2026-09-17T08:00:00.500Z");
  assert.equal(second.revokedAt, first.revokedAt);
  assert.throws(
    () => harness.registry.rotate(enrolled.device.credentialId),
    /already revoked/,
  );
});
