import test from "node:test";
import assert from "node:assert/strict";
import {
  createRemoteContextHandler,
  StaticBearerGrantAuthorizer,
} from "../dist/remote-gateway.js";
import {
  InMemoryRemoteContextAuditSink,
  remoteResponseMetrics,
} from "../dist/remote-audit.js";

const token = "remote-audit-token-that-is-longer-than-thirty-two-characters";
const now = "2026-09-17T08:00:00.000Z";

function grant() {
  return {
    version: "topo.remote-grant/0.1",
    id: "grant-audit",
    audience: "topo-audit-test",
    subjects: ["project:topo"],
    actions: ["context"],
    maxSensitivity: "ordinary",
    issuedAt: "2026-09-17T07:00:00.000Z",
    expiresAt: "2026-09-17T09:00:00.000Z",
  };
}

test("remote context audit records use metadata without prompt or Memory Page contents", async () => {
  const audit = new InMemoryRemoteContextAuditSink();
  const handler = createRemoteContextHandler({
    audience: "topo-audit-test",
    authorizer: new StaticBearerGrantAuthorizer(token, grant()),
    now: () => now,
    requestId: () => "request-audit-1",
    audit,
    resolver: {
      async context() {
        return {
          specversion: "0.1-draft",
          id: "packet-secret",
          objects: [
            {
              id: "page-secret-id",
              type: "topo.memory_page",
              value: {
                title: "Highly distinctive private page title",
                content: "Highly distinctive private page body",
                sensitivity: "ordinary",
                source_refs: [],
              },
            },
          ],
          evidence_refs: [],
          provenance: { derived_from: [], extensions: {} },
          extensions: {},
        };
      },
    },
  });

  const response = await handler(
    new Request("https://relay.example/v0/context", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: "project:topo",
        purpose: "Highly distinctive private purpose text",
        query: "Highly distinctive private query text",
        maxItems: 4,
      }),
    }),
  );
  assert.equal(response.status, 200);

  const events = audit.list();
  assert.deepEqual(events.map((event) => event.outcome), [
    "requested",
    "completed",
  ]);
  assert.equal(events[0].requestId, "request-audit-1");
  assert.equal(events[0].grantId, "grant-audit");
  assert.equal(events[0].subject, "project:topo");
  assert.equal(events[1].objectCount, 1);
  assert.equal(typeof events[1].responseBytes, "number");

  const serialised = JSON.stringify(events);
  assert.equal(serialised.includes("private purpose text"), false);
  assert.equal(serialised.includes("private query text"), false);
  assert.equal(serialised.includes("page-secret-id"), false);
  assert.equal(serialised.includes("private page title"), false);
  assert.equal(serialised.includes("private page body"), false);
});

test("authorisation denial is auditable without parsing or recording request content", async () => {
  const audit = new InMemoryRemoteContextAuditSink();
  const handler = createRemoteContextHandler({
    audience: "topo-audit-test",
    authorizer: new StaticBearerGrantAuthorizer(token, grant()),
    now: () => now,
    requestId: () => "request-denied-1",
    audit,
    resolver: {
      async context() {
        throw new Error("resolver must not run");
      },
    },
  });

  const response = await handler(
    new Request("https://relay.example/v0/context", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: "private:subject-that-must-not-be-read",
        purpose: "private purpose that must not be read",
      }),
    }),
  );
  assert.equal(response.status, 401);
  assert.deepEqual(audit.list(), [
    {
      version: "topo.remote-audit/0.1",
      requestId: "request-denied-1",
      at: now,
      audience: "topo-audit-test",
      action: "context",
      outcome: "denied",
      code: "TOPO_REMOTE_UNAUTHORISED",
    },
  ]);
});

test("audit sink failure never blocks an otherwise authorised context response", async () => {
  const handler = createRemoteContextHandler({
    audience: "topo-audit-test",
    authorizer: new StaticBearerGrantAuthorizer(token, grant()),
    now: () => now,
    requestId: () => "request-audit-failure",
    audit: {
      record() {
        throw new Error("audit backend unavailable");
      },
    },
    resolver: {
      async context() {
        return {
          objects: [],
          provenance: { derived_from: [], extensions: {} },
          extensions: {},
        };
      },
    },
  });

  const response = await handler(
    new Request("https://relay.example/v0/context", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: "project:topo",
        purpose: "test audit independence",
      }),
    }),
  );
  assert.equal(response.status, 200);
});

test("bounded in-memory audit sink drops the oldest metadata event", () => {
  const audit = new InMemoryRemoteContextAuditSink({ maxEntries: 2 });
  for (let index = 1; index <= 3; index += 1) {
    audit.record({
      version: "topo.remote-audit/0.1",
      requestId: `request-${index}`,
      at: now,
      audience: "test",
      action: "context",
      outcome: "requested",
    });
  }
  assert.deepEqual(audit.list().map((event) => event.requestId), [
    "request-2",
    "request-3",
  ]);
  audit.clear();
  assert.deepEqual(audit.list(), []);
});

test("response metrics expose count and bytes only", () => {
  const metrics = remoteResponseMetrics({
    objects: [{ secret: "do not expose me through metrics" }],
  });
  assert.deepEqual(Object.keys(metrics).sort(), ["objectCount", "responseBytes"]);
  assert.equal(metrics.objectCount, 1);
  assert.equal(metrics.responseBytes > 0, true);
});
