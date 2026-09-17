import test from "node:test";
import assert from "node:assert/strict";
import {
  createRemoteContextHandler,
  StaticBearerGrantAuthorizer,
} from "../dist/remote-gateway.js";
import { InMemoryContextRelay } from "../dist/remote-relay.js";
import {
  createRelayDeviceHandler,
  StaticRelayDeviceAuthorizer,
} from "../dist/remote-relay-http.js";
import { serviceRelayOnce } from "../dist/remote-relay-device.js";

const remoteToken = "remote-client-token-that-is-longer-than-thirty-two-characters";
const deviceToken = "enrolled-device-token-that-is-longer-than-thirty-two-characters";
const now = Date.parse("2026-09-17T08:00:00.000Z");

function grant() {
  return {
    version: "topo.remote-grant/0.1",
    id: "grant-relay",
    audience: "topo-relay-test",
    subjects: ["project:topo"],
    actions: ["context"],
    maxSensitivity: "ordinary",
    issuedAt: "2026-09-17T07:00:00.000Z",
    expiresAt: "2026-09-17T09:00:00.000Z",
  };
}

function setup() {
  const relay = new InMemoryContextRelay({
    deviceId: "device-home",
    now: () => now,
    requestId: () => "relay-e2e-1",
  });
  const deviceHandler = createRelayDeviceHandler({
    relay,
    authorizer: new StaticRelayDeviceAuthorizer("device-home", deviceToken),
  });
  const gateway = createRemoteContextHandler({
    audience: "topo-relay-test",
    authorizer: new StaticBearerGrantAuthorizer(remoteToken, grant()),
    now: () => "2026-09-17T08:00:00.000Z",
    resolver: relay,
  });
  const relayFetch = (url, init) =>
    deviceHandler(new Request(typeof url === "string" ? url : url.toString(), init));
  return { relay, deviceHandler, gateway, relayFetch };
}

test("remote request is resolved on the enrolled TOPO device over outbound long-polling", async () => {
  const { relay, gateway, relayFetch } = setup();
  const remoteResponse = gateway(
    new Request("https://relay.example/v0/context", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${remoteToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: "project:topo",
        purpose: "continue implementation",
        query: "mobile relay",
        maxItems: 5,
      }),
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(relay.pendingCount(), 1);

  const localRequests = [];
  const work = await serviceRelayOnce({
    relayBaseUrl: "https://relay.example",
    deviceToken,
    fetchImpl: relayFetch,
    now: () => now,
    resolver: {
      async context(request) {
        localRequests.push(request);
        return {
          specversion: "0.1-draft",
          id: "packet-local",
          objects: [
            {
              type: "topo.memory_page",
              id: "page-ordinary",
              value: {
                title: "Relay architecture",
                content: "Canonical memory remains local.",
                sensitivity: "ordinary",
                source_refs: [],
              },
            },
            {
              type: "topo.memory_page",
              id: "page-personal",
              value: {
                title: "Private detail",
                content: "Should be narrowed by the remote grant.",
                sensitivity: "personal",
                source_refs: [],
              },
            },
          ],
          evidence_refs: [],
          provenance: {
            derived_from: ["page-ordinary", "page-personal"],
            extensions: {
              page_revisions: {
                "page-ordinary": 1,
                "page-personal": 1,
              },
            },
          },
          extensions: {
            "topo.relevance": {
              "page-ordinary": { score: 7 },
              "page-personal": { score: 6 },
            },
          },
        };
      },
    },
  });

  assert.deepEqual(work, {
    processed: true,
    requestId: "relay-e2e-1",
    status: "completed",
  });
  assert.deepEqual(localRequests, [
    {
      subject: "project:topo",
      purpose: "continue implementation",
      query: "mobile relay",
      maxItems: 5,
      requestedBy: "remote:grant-relay",
    },
  ]);

  const response = await remoteResponse;
  assert.equal(response.status, 200);
  const packet = await response.json();
  assert.deepEqual(packet.objects.map((item) => item.id), ["page-ordinary"]);
  assert.equal(
    packet.extensions["topo.remote_grant_sensitivity_ceiling"],
    "ordinary",
  );
  assert.equal(relay.pendingCount(), 0);
  relay.close();
});

test("authenticated long-poll waits and wakes when remote work arrives", async () => {
  const { relay, deviceHandler } = setup();
  const waiting = deviceHandler(
    new Request("https://relay.example/v0/device/next?waitMs=200", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  const pending = relay.context({
    subject: "project:topo",
    purpose: "wake the device",
    requestedBy: "remote:grant-relay",
  });

  const response = await waiting;
  assert.equal(response.status, 200);
  const task = await response.json();
  assert.equal(task.id, "relay-e2e-1");
  assert.equal(task.request.purpose, "wake the device");

  relay.complete("device-home", task.id, { ok: true });
  assert.deepEqual(await pending, { ok: true });
  relay.close();
});

test("invalid long-poll windows are rejected before claiming work", async () => {
  const { relay, deviceHandler } = setup();
  const response = await deviceHandler(
    new Request("https://relay.example/v0/device/next?waitMs=30000", {
      headers: { Authorization: `Bearer ${deviceToken}` },
    }),
  );
  assert.equal(response.status, 400);
  assert.equal(relay.pendingCount(), 0);
  relay.close();
});

test("device resolver failures are returned to the waiting remote request", async () => {
  const { relay, gateway, relayFetch } = setup();
  const remoteResponse = gateway(
    new Request("https://relay.example/v0/context", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${remoteToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: "project:topo",
        purpose: "test local sharing disabled",
      }),
    }),
  );

  await new Promise((resolve) => setImmediate(resolve));
  const work = await serviceRelayOnce({
    relayBaseUrl: "https://relay.example",
    deviceToken,
    fetchImpl: relayFetch,
    now: () => now,
    resolver: {
      async context() {
        throw new Error("local context sharing is disabled in TOPO");
      },
    },
  });
  assert.equal(work.status, "failed");

  const response = await remoteResponse;
  assert.equal(response.status, 502);
  const value = await response.json();
  assert.match(value.error, /local context sharing is disabled/);
  assert.equal(relay.pendingCount(), 0);
  relay.close();
});

test("device relay endpoints reject an unenrolled device token", async () => {
  const { relay, deviceHandler } = setup();
  const response = await deviceHandler(
    new Request("https://relay.example/v0/device/next", {
      headers: { Authorization: "Bearer definitely-not-the-device-token" },
    }),
  );
  assert.equal(response.status, 401);
  assert.equal(relay.pendingCount(), 0);
  relay.close();
});
