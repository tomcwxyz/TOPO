import test from "node:test";
import assert from "node:assert/strict";
import { runRelayDeviceSession } from "../dist/remote-relay-session.js";

const now = Date.parse("2026-09-17T08:00:00.000Z");
const workerBase = {
  relayBaseUrl: "https://relay.example",
  deviceToken: "device-token-that-is-longer-than-thirty-two-characters",
  resolver: {
    async context() {
      return {};
    },
  },
};

test("managed relay session stays online across idle polls and processed tasks", async () => {
  const controller = new AbortController();
  const states = [];
  const results = [];
  let calls = 0;

  const summary = await runRelayDeviceSession({
    ...workerBase,
    signal: controller.signal,
    now: () => now,
    serviceOnce: async (options) => {
      assert.equal(options.signal, controller.signal);
      calls += 1;
      if (calls === 1) return { processed: false };
      controller.abort();
      return {
        processed: true,
        requestId: "relay-1",
        status: "completed",
      };
    },
    onState(state) {
      states.push(state);
    },
    onResult(result) {
      results.push(result);
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(results, [
    { processed: true, requestId: "relay-1", status: "completed" },
  ]);
  assert.deepEqual(states.map((state) => state.phase), [
    "connecting",
    "online",
    "stopped",
  ]);
  assert.deepEqual(summary, {
    polls: 2,
    completed: 1,
    failed: 0,
    reconnects: 0,
    stoppedAt: "2026-09-17T08:00:00.000Z",
  });
});

test("managed relay session backs off exponentially and reconnects", async () => {
  const controller = new AbortController();
  const states = [];
  const sleeps = [];
  let calls = 0;

  const summary = await runRelayDeviceSession({
    ...workerBase,
    signal: controller.signal,
    now: () => now,
    minRetryMs: 100,
    maxRetryMs: 1_000,
    random: () => 0.5,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
    },
    serviceOnce: async () => {
      calls += 1;
      if (calls <= 2) throw new Error(`relay offline ${calls}`);
      controller.abort();
      return { processed: false };
    },
    onState(state) {
      states.push(state);
    },
  });

  assert.deepEqual(sleeps, [100, 200]);
  assert.deepEqual(
    states.filter((state) => state.phase === "backoff").map((state) => ({
      failures: state.consecutiveFailures,
      retryInMs: state.retryInMs,
      error: state.error,
    })),
    [
      { failures: 1, retryInMs: 100, error: "relay offline 1" },
      { failures: 2, retryInMs: 200, error: "relay offline 2" },
    ],
  );
  assert.equal(states.some((state) => state.phase === "online"), true);
  assert.deepEqual(summary, {
    polls: 1,
    completed: 0,
    failed: 0,
    reconnects: 2,
    stoppedAt: "2026-09-17T08:00:00.000Z",
  });
});

test("task-level local resolver failure does not tear down the relay session", async () => {
  const controller = new AbortController();
  const results = [];
  let calls = 0;

  const summary = await runRelayDeviceSession({
    ...workerBase,
    signal: controller.signal,
    now: () => now,
    serviceOnce: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          processed: true,
          requestId: "relay-failed",
          status: "failed",
        };
      }
      controller.abort();
      return { processed: false };
    },
    onResult(result) {
      results.push(result);
    },
  });

  assert.equal(calls, 2);
  assert.deepEqual(results, [
    { processed: true, requestId: "relay-failed", status: "failed" },
  ]);
  assert.equal(summary.failed, 1);
  assert.equal(summary.reconnects, 0);
});

test("aborting during reconnect sleep stops without another poll", async () => {
  const controller = new AbortController();
  let calls = 0;
  const states = [];

  const summary = await runRelayDeviceSession({
    ...workerBase,
    signal: controller.signal,
    now: () => now,
    minRetryMs: 100,
    random: () => 0.5,
    serviceOnce: async () => {
      calls += 1;
      throw new Error("relay unreachable");
    },
    sleep: async () => {
      controller.abort();
    },
    onState(state) {
      states.push(state.phase);
    },
  });

  assert.equal(calls, 1);
  assert.deepEqual(states, ["connecting", "backoff", "stopped"]);
  assert.equal(summary.reconnects, 1);
});

test("session rejects an inverted retry window before making network calls", async () => {
  const controller = new AbortController();
  let called = false;

  await assert.rejects(
    runRelayDeviceSession({
      ...workerBase,
      signal: controller.signal,
      minRetryMs: 1_000,
      maxRetryMs: 100,
      serviceOnce: async () => {
        called = true;
        return { processed: false };
      },
    }),
    /maxRetryMs must be greater than or equal to minRetryMs/,
  );
  assert.equal(called, false);
});
