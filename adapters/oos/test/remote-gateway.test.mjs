import test from "node:test";
import assert from "node:assert/strict";
import {
  createRemoteContextHandler,
  StaticBearerGrantAuthorizer,
} from "../dist/remote-gateway.js";

const now = "2026-09-17T08:00:00.000Z";
const token = "remote-test-token-that-is-definitely-longer-than-32-characters";

function grant(overrides = {}) {
  return {
    version: "topo.remote-grant/0.1",
    id: "grant-1",
    audience: "topo-remote-test",
    subjects: ["project:topo"],
    actions: ["context"],
    maxSensitivity: "ordinary",
    issuedAt: "2026-09-17T07:00:00.000Z",
    expiresAt: "2026-09-17T09:00:00.000Z",
    ...overrides,
  };
}

function packet() {
  return {
    specversion: "0.1-draft",
    id: "packet-1",
    subject: "project:topo",
    purpose: "continue implementation",
    objects: [
      {
        type: "topo.memory_page",
        id: "ordinary-page",
        value: {
          title: "Ordinary",
          content: "Allowed by the remote grant.",
          sensitivity: "ordinary",
          source_refs: [{ source_id: "source-ordinary" }],
        },
      },
      {
        type: "topo.memory_page",
        id: "personal-page",
        value: {
          title: "Personal",
          content: "Must be narrowed out.",
          sensitivity: "personal",
          source_refs: [{ source_id: "source-personal" }],
        },
      },
    ],
    evidence_refs: ["source-ordinary", "source-personal"],
    provenance: {
      derived_from: ["ordinary-page", "personal-page"],
      extensions: {
        page_revisions: {
          "ordinary-page": 1,
          "personal-page": 2,
        },
      },
    },
    extensions: {
      "topo.relevance": {
        "ordinary-page": { score: 2 },
        "personal-page": { score: 8 },
      },
    },
  };
}

function build(options = {}) {
  const requests = [];
  const activeGrant = grant(options.grant);
  const handler = createRemoteContextHandler({
    audience: "topo-remote-test",
    authorizer: new StaticBearerGrantAuthorizer(token, activeGrant),
    now: () => options.now ?? now,
    resolver: {
      async context(request) {
        requests.push(request);
        return packet();
      },
    },
  });
  return { handler, requests };
}

async function post(handler, body, authorization = `Bearer ${token}`) {
  return handler(
    new Request("https://gateway.example/v0/context", {
      method: "POST",
      headers: {
        ...(typeof authorization === "string"
          ? { Authorization: authorization }
          : {}),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

test("remote gateway requires a scoped grant and narrows returned sensitivity", async () => {
  const { handler, requests } = build();
  const response = await post(handler, {
    subject: "project:topo",
    purpose: "continue implementation",
    query: "remote context",
    maxItems: 5,
  });

  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.objects.length, 1);
  assert.equal(value.objects[0].id, "ordinary-page");
  assert.deepEqual(value.evidence_refs, ["source-ordinary"]);
  assert.deepEqual(value.provenance.derived_from, ["ordinary-page"]);
  assert.equal(
    value.extensions["topo.remote_grant_sensitivity_ceiling"],
    "ordinary",
  );
  assert.deepEqual(requests, [
    {
      subject: "project:topo",
      purpose: "continue implementation",
      query: "remote context",
      maxItems: 5,
      requestedBy: "remote:grant-1",
    },
  ]);
});

test("remote gateway rejects missing, wrong and expired authorisation", async () => {
  const missing = build();
  const missingResponse = await post(
    missing.handler,
    { subject: "project:topo", purpose: "test" },
    null,
  );
  assert.equal(missingResponse.status, 401);
  assert.equal(missing.requests.length, 0);

  const wrong = build();
  const wrongResponse = await post(
    wrong.handler,
    { subject: "project:topo", purpose: "test" },
    "Bearer wrong-token-that-is-also-long-enough-to-hash-safely",
  );
  assert.equal(wrongResponse.status, 401);
  assert.equal(wrong.requests.length, 0);

  const expired = build({ now: "2026-09-17T10:00:00.000Z" });
  const expiredResponse = await post(expired.handler, {
    subject: "project:topo",
    purpose: "test",
  });
  assert.equal(expiredResponse.status, 401);
  assert.equal(expired.requests.length, 0);
});

test("remote grant uses exact subject scope and audience", async () => {
  const scoped = build();
  const response = await post(scoped.handler, {
    subject: "project:other",
    purpose: "test",
  });
  assert.equal(response.status, 403);
  assert.equal(scoped.requests.length, 0);

  const audience = build({ grant: { audience: "another-gateway" } });
  const audienceResponse = await post(audience.handler, {
    subject: "project:topo",
    purpose: "test",
  });
  assert.equal(audienceResponse.status, 403);
  assert.equal(audience.requests.length, 0);
});

test("remote capabilities are explicitly read-only", async () => {
  const { handler } = build();
  const response = await handler(
    new Request("https://gateway.example/v0/capabilities"),
  );
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.mode, "read-only");
  assert.deepEqual(value.actions, ["context"]);
  assert.equal(value.captureAuthority, false);
  assert.equal(value.contributionAuthority, false);
  assert.equal(value.reviewAuthority, false);
});
