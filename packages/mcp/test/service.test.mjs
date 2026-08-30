import test from "node:test";
import assert from "node:assert/strict";
import { SqliteMemoryStore } from "../../store-node/dist/index.js";
import {
  McpAuthorityError,
  McpDisclosureError,
  TopoMcpService,
} from "../dist/index.js";

const timestamp = "2026-08-30T19:00:00.000Z";

function idFactory() {
  let sequence = 0;
  return (prefix) => `${prefix}-${++sequence}`;
}

function service(store, options = {}) {
  return new TopoMcpService(store, {
    now: () => timestamp,
    createId: idFactory(),
    ...options,
  });
}

test("normal MCP clients can propose candidates but cannot confirm them", () => {
  const store = new SqliteMemoryStore(":memory:");
  const mcp = service(store);

  const proposal = mcp.proposeClaims({
    sourceProvider: "test-host",
    claims: [
      {
        key: "writing.locale",
        value: "en-GB",
        epistemicType: "preference",
        confidence: 0.95,
        evidence: "Please use British English.",
      },
    ],
  });

  assert.equal(proposal.claims[0].status, "candidate");
  assert.equal(proposal.claims[0].provenance.sourceType, "mcp");
  assert.equal(store.listSources().length, 1);
  assert.equal(store.listEvents().length, 2);
  assert.throws(
    () => mcp.confirmCandidate(proposal.claims[0].id),
    McpAuthorityError,
  );

  store.close();
});

test("review authority must be explicitly delegated and is auditable", () => {
  const store = new SqliteMemoryStore(":memory:");
  const normal = service(store);
  const proposal = normal.proposeClaims({
    claims: [
      {
        key: "writing.locale",
        value: "en-GB",
        epistemicType: "preference",
      },
    ],
  });

  const trusted = service(store, {
    allowReviewDecisions: true,
    reviewActorId: "trusted-test-client",
  });
  const confirmed = trusted.confirmCandidate(proposal.claims[0].id);

  assert.equal(confirmed.status, "confirmed");
  const history = trusted.claimHistory(confirmed.id);
  assert.equal(history.at(-1).type, "claim.confirmed");
  assert.deepEqual(history.at(-1).actor, {
    type: "user",
    id: "trusted-test-client",
  });

  store.close();
});

test("MCP sensitivity ceiling blocks both proposals and reads above scope", () => {
  const store = new SqliteMemoryStore(":memory:");
  const personal = service(store, {
    maxSensitivity: "personal",
    allowReviewDecisions: true,
  });

  assert.throws(
    () =>
      personal.proposeClaims({
        claims: [
          {
            key: "private.secret",
            value: "not for this client",
            epistemicType: "assertion",
            sensitivity: "sensitive",
          },
        ],
      }),
    McpDisclosureError,
  );

  const proposal = personal.proposeClaims({
    claims: [
      {
        key: "work.preference",
        value: "local-first",
        epistemicType: "preference",
        sensitivity: "personal",
      },
    ],
  });
  personal.confirmCandidate(proposal.claims[0].id);

  const ordinary = service(store, { maxSensitivity: "ordinary" });
  assert.equal(ordinary.search({ query: "local-first" }).length, 0);
  assert.equal(ordinary.getClaim(proposal.claims[0].id), undefined);

  store.close();
});

test("search returns only confirmed claims that are currently valid", () => {
  const store = new SqliteMemoryStore(":memory:");
  const mcp = service(store, { allowReviewDecisions: true });

  const active = mcp.proposeClaims({
    claims: [
      {
        key: "tools.database",
        value: "Neon",
        epistemicType: "preference",
        category: "technical",
      },
    ],
  });
  mcp.confirmCandidate(active.claims[0].id);

  const future = mcp.proposeClaims({
    claims: [
      {
        key: "tools.future",
        value: "Neon",
        epistemicType: "assertion",
        validFrom: "2027-01-01T00:00:00.000Z",
      },
    ],
  });
  mcp.confirmCandidate(future.claims[0].id);

  const results = mcp.search({ query: "Neon" });
  assert.equal(results.length, 1);
  assert.equal(results[0].claim.id, active.claims[0].id);

  store.close();
});
