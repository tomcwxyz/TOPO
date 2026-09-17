import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryContextRelay } from "../dist/remote-relay.js";

const start = Date.parse("2026-09-17T08:00:00.000Z");

function relay(options = {}) {
  let sequence = 0;
  return new InMemoryContextRelay({
    deviceId: "device-home",
    requestTtlMs: 10_000,
    now: () => start,
    requestId: () => `relay-test-${++sequence}`,
    ...options,
  });
}

function request() {
  return {
    subject: "project:topo",
    purpose: "continue implementation",
    query: "online device relay",
    maxItems: 6,
    requestedBy: "remote:grant-1",
  };
}

test("online device relay resolves a remote request without persisting a packet", async () => {
  const broker = relay();
  const pending = broker.context(request());

  assert.equal(broker.pendingCount(), 1);
  const task = broker.claimNext("device-home");
  assert.ok(task);
  assert.equal(task.version, "topo.remote-relay-task/0.1");
  assert.equal(task.action, "context");
  assert.equal(task.deviceId, "device-home");
  assert.equal(task.request.subject, "project:topo");
  assert.equal(task.request.requestedBy, "remote:grant-1");

  const packet = {
    specversion: "0.1-draft",
    id: "packet-1",
    objects: [{ id: "page-1", type: "topo.memory_page" }],
  };
  broker.complete("device-home", task.id, packet);

  assert.deepEqual(await pending, packet);
  assert.equal(broker.pendingCount(), 0);
  assert.equal(broker.claimNext("device-home"), undefined);
  broker.close();
});

test("relay tasks can only be claimed and completed by the registered device", async () => {
  const broker = relay();
  const pending = broker.context(request());

  assert.throws(
    () => broker.claimNext("device-other"),
    /device identity does not match/,
  );

  const task = broker.claimNext("device-home");
  assert.ok(task);
  assert.throws(
    () => broker.complete("device-other", task.id, {}),
    /device identity does not match/,
  );

  broker.complete("device-home", task.id, { ok: true });
  assert.deepEqual(await pending, { ok: true });
  broker.close();
});

test("relay completion is one-time and requires a prior claim", async () => {
  const broker = relay();
  const pending = broker.context(request());

  assert.throws(
    () => broker.complete("device-home", "relay-test-1", { ok: true }),
    /has not been claimed/,
  );

  const task = broker.claimNext("device-home");
  assert.ok(task);
  broker.complete("device-home", task.id, { ok: true });
  assert.deepEqual(await pending, { ok: true });

  assert.throws(
    () => broker.complete("device-home", task.id, { ok: true }),
    /missing or expired/,
  );
  broker.close();
});

test("expired relay requests reject even when the device later polls", async () => {
  let current = start;
  const broker = relay({ now: () => current, requestTtlMs: 10_000 });
  const pending = broker.context(request());
  const rejected = assert.rejects(pending, /expired before the device responded/);

  current += 10_001;
  assert.equal(broker.claimNext("device-home"), undefined);
  await rejected;
  assert.equal(broker.pendingCount(), 0);
  broker.close();
});

test("oversized relay responses are rejected and never delivered", async () => {
  const broker = relay({ maxResponseBytes: 80 });
  const pending = broker.context(request());
  const rejected = assert.rejects(pending, /response exceeds 80 bytes/);
  const task = broker.claimNext("device-home");
  assert.ok(task);

  assert.throws(
    () =>
      broker.complete("device-home", task.id, {
        content: "x".repeat(200),
      }),
    /response exceeds 80 bytes/,
  );
  await rejected;
  assert.equal(broker.pendingCount(), 0);
  broker.close();
});
