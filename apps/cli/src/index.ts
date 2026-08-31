#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import {
  confirmClaim,
  editCandidateClaim,
  expireClaim,
  proposeClaim,
  rejectClaim,
  supersedeClaim,
} from "@topo/core";
import {
  BUNDLE_FILES,
  exportBundle,
  importBundle,
  parseBundle,
  serializeBundle,
  type TopoBundleFiles,
} from "@topo/formats";
import {
  claimStatusSchema,
  epistemicTypeSchema,
  sensitivitySchema,
  type EpistemicType,
  type JsonValue,
  type MemoryClaim,
  type MemorySource,
  type Sensitivity,
} from "@topo/schemas";
import { SqliteMemoryStore } from "@topo/store-node";
import { registerOosCommands } from "./oos.js";

const program = new Command();

program
  .name("topo")
  .description("Portable, user-owned context for AI.")
  .version("0.1.0")
  .option(
    "--store <path>",
    "SQLite store path",
    process.env.TOPO_DB ?? join(homedir(), ".topo", "topo.sqlite"),
  )
  .option("--json", "emit machine-readable JSON");

function storePath(): string {
  return resolve(String(program.opts().store));
}

function openStore(): SqliteMemoryStore {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  return new SqliteMemoryStore(path);
}

function now(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

function parseValue(input: string): JsonValue {
  try {
    const value: unknown = JSON.parse(input);
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      Array.isArray(value) ||
      typeof value === "object"
    ) {
      return value as JsonValue;
    }
  } catch {
    // Plain command-line strings are valid memory values.
  }
  return input;
}

function parseSensitivity(value: string): Sensitivity {
  return sensitivitySchema.parse(value);
}

function parseEpistemicType(value: string): EpistemicType {
  return epistemicTypeSchema.parse(value);
}

function print(value: unknown, fallback: string): void {
  if (program.opts().json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else {
    process.stdout.write(`${fallback}\n`);
  }
}

function manualSource(
  capturedAt: string,
  sensitivity: Sensitivity,
): MemorySource {
  return {
    id: id("source"),
    type: "manual",
    title: "TOPO CLI entry",
    capturedAt,
    createdAt: capturedAt,
    sensitivity,
  };
}

function recordSource(
  store: SqliteMemoryStore,
  source: MemorySource,
): void {
  store.putSource(source);
  store.appendEvent({
    id: id("event"),
    type: "source.captured",
    entityType: "source",
    entityId: source.id,
    occurredAt: source.createdAt,
    actor: { type: "user" },
  });
}

interface ClaimOptions {
  subject: string;
  category?: string;
  tag?: string[];
  type: string;
  confidence: string;
  sensitivity: string;
}

interface CandidateEditOptions {
  subject?: string;
  key?: string;
  value?: string;
  category?: string;
  clearCategory?: boolean;
  tag?: string[];
  type?: string;
  confidence?: string;
  sensitivity?: string;
}

function proposalInput(
  key: string,
  rawValue: string,
  options: ClaimOptions,
  source: MemorySource,
  supersedes: string[] = [],
) {
  return {
    id: id("claim"),
    subject: options.subject,
    key,
    value: parseValue(rawValue),
    ...(options.category === undefined ? {} : { category: options.category }),
    tags: options.tag ?? [],
    epistemicType: parseEpistemicType(options.type),
    confidence: Number(options.confidence),
    provenance: {
      sourceType: "manual" as const,
      sourceId: source.id,
      capturedAt: source.capturedAt,
    },
    sensitivity: parseSensitivity(options.sensitivity),
    supersedes,
  };
}

function addClaimOptions(command: Command): Command {
  return command
    .option("--subject <subject>", "claim subject", "self")
    .option("--category <category>", "claim category")
    .option("--tag <tags...>", "claim tags")
    .option(
      "--type <type>",
      "assertion, observation, inference, preference or derived-pattern",
      "assertion",
    )
    .option("--confidence <number>", "confidence between 0 and 1", "1")
    .option(
      "--sensitivity <level>",
      "ordinary, personal, sensitive or restricted",
      "ordinary",
    );
}

program
  .command("init")
  .description("Initialise the local TOPO store")
  .action(() => {
    const store = openStore();
    const version = store.schemaVersion();
    store.close();
    print({ store: storePath(), schemaVersion: version }, `Initialised TOPO at ${storePath()}`);
  });

program
  .command("status")
  .description("Show local memory counts")
  .action(() => {
    const store = openStore();
    const counts = {
      candidates: countAll((offset) =>
        store.listClaims({ status: "candidate", offset, limit: 1000 }),
      ),
      confirmed: countAll((offset) =>
        store.listClaims({ status: "confirmed", offset, limit: 1000 }),
      ),
      sources: countAll((offset) => store.listSources({ offset, limit: 1000 })),
      events: countAll((offset) => store.listEvents({ offset, limit: 1000 })),
    };
    store.close();
    print(counts, `${counts.confirmed} confirmed · ${counts.candidates} candidates · ${counts.sources} sources`);
  });

const claim = program.command("claim").description("Manage memory claims");

addClaimOptions(
  claim
    .command("add <key> <value>")
    .description("Add and immediately confirm a manual claim"),
).action((key: string, value: string, options: ClaimOptions) => {
  const store = openStore();
  const timestamp = now();
  const source = manualSource(timestamp, parseSensitivity(options.sensitivity));
  const proposed = proposeClaim(
    proposalInput(key, value, options, source),
    {
      now: timestamp,
      eventId: id("event"),
      actor: { type: "user" },
    },
  );
  const confirmed = confirmClaim(proposed.claim, {
    now: timestamp,
    eventId: id("event"),
    actor: { type: "user" },
  });

  store.transaction(() => {
    recordSource(store, source);
    store.applyTransition(proposed);
    store.applyTransition(confirmed);
  });
  store.close();

  print(confirmed.claim, `Confirmed ${confirmed.claim.id}: ${key}`);
});

addClaimOptions(
  claim
    .command("propose <key> <value>")
    .description("Create a candidate claim for review"),
).action((key: string, value: string, options: ClaimOptions) => {
  const store = openStore();
  const timestamp = now();
  const source = manualSource(timestamp, parseSensitivity(options.sensitivity));
  const proposed = proposeClaim(
    proposalInput(key, value, options, source),
    {
      now: timestamp,
      eventId: id("event"),
      actor: { type: "user" },
    },
  );

  store.transaction(() => {
    recordSource(store, source);
    store.applyTransition(proposed);
  });
  store.close();

  print(proposed.claim, `Proposed ${proposed.claim.id}: ${key}`);
});

claim
  .command("list")
  .description("List claims")
  .option("--status <status>", "filter by claim status")
  .option("--category <category>", "filter by category")
  .action((options: { status?: string; category?: string }) => {
    const store = openStore();
    const status =
      options.status === undefined
        ? undefined
        : claimStatusSchema.parse(options.status);
    const claims = readAllClaims(store, {
      ...(status === undefined ? {} : { status }),
      ...(options.category === undefined ? {} : { category: options.category }),
    });
    store.close();

    if (program.opts().json) {
      print(claims, "");
      return;
    }

    if (claims.length === 0) {
      process.stdout.write("No claims.\n");
      return;
    }
    for (const item of claims) {
      process.stdout.write(
        `${item.id}\t${item.status}\t${item.epistemicType}\t${item.key}\t${JSON.stringify(item.value)}\n`,
      );
    }
  });

claim
  .command("expire <id>")
  .description("Expire a confirmed claim")
  .action((claimId: string) => {
    const store = openStore();
    const existing = requireClaim(store, claimId);
    const transition = expireClaim(existing, {
      now: now(),
      eventId: id("event"),
      actor: { type: "user" },
    });
    store.applyTransition(transition);
    store.close();
    print(transition.claim, `Expired ${claimId}`);
  });

addClaimOptions(
  claim
    .command("supersede <id> <key> <value>")
    .description("Replace a confirmed claim while preserving its history"),
).action(
  (
    oldId: string,
    key: string,
    value: string,
    options: ClaimOptions,
  ) => {
    const store = openStore();
    const existing = requireClaim(store, oldId);
    const timestamp = now();
    const source = manualSource(
      timestamp,
      parseSensitivity(options.sensitivity),
    );
    const proposed = proposeClaim(
      proposalInput(key, value, options, source, [oldId]),
      {
        now: timestamp,
        eventId: id("event"),
        actor: { type: "user" },
      },
    );
    const confirmed = confirmClaim(proposed.claim, {
      now: timestamp,
      eventId: id("event"),
      actor: { type: "user" },
    });
    const superseded = supersedeClaim(existing, confirmed.claim, {
      now: timestamp,
      eventId: id("event"),
      actor: { type: "user" },
    });

    store.transaction(() => {
      recordSource(store, source);
      store.applyTransition(proposed);
      store.applyTransition(confirmed);
      store.applyTransition(superseded);
    });
    store.close();

    print(
      { replacement: confirmed.claim, superseded: superseded.claim },
      `Superseded ${oldId} with ${confirmed.claim.id}`,
    );
  },
);

const candidate = program
  .command("candidate")
  .description("Review candidate claims");

candidate
  .command("list")
  .description("List candidate claims")
  .action(() => {
    const store = openStore();
    const candidates = readAllClaims(store, { status: "candidate" });
    store.close();

    if (program.opts().json) {
      print(candidates, "");
      return;
    }
    if (candidates.length === 0) {
      process.stdout.write("No candidates.\n");
      return;
    }
    for (const item of candidates) {
      process.stdout.write(
        `${item.id}\t${item.epistemicType}\t${item.key}\t${JSON.stringify(item.value)}\n`,
      );
    }
  });

candidate
  .command("edit <id>")
  .description("Edit a candidate claim before confirmation")
  .option("--subject <subject>", "replace claim subject")
  .option("--key <key>", "replace claim key")
  .option("--value <value>", "replace claim value")
  .option("--category <category>", "replace claim category")
  .option("--clear-category", "remove the claim category")
  .option("--tag <tags...>", "replace claim tags")
  .option("--type <type>", "replace epistemic type")
  .option("--confidence <number>", "replace confidence")
  .option("--sensitivity <level>", "replace sensitivity")
  .action((claimId: string, options: CandidateEditOptions) => {
    if (options.category !== undefined && options.clearCategory === true) {
      throw new Error("Use either --category or --clear-category, not both.");
    }

    const store = openStore();
    const existing = requireClaim(store, claimId);
    const patch = {
      ...(options.subject === undefined ? {} : { subject: options.subject }),
      ...(options.key === undefined ? {} : { key: options.key }),
      ...(options.value === undefined ? {} : { value: parseValue(options.value) }),
      ...(options.clearCategory === true
        ? { category: null }
        : options.category === undefined
          ? {}
          : { category: options.category }),
      ...(options.tag === undefined ? {} : { tags: options.tag }),
      ...(options.type === undefined
        ? {}
        : { epistemicType: parseEpistemicType(options.type) }),
      ...(options.confidence === undefined
        ? {}
        : { confidence: Number(options.confidence) }),
      ...(options.sensitivity === undefined
        ? {}
        : { sensitivity: parseSensitivity(options.sensitivity) }),
    };

    const transition = editCandidateClaim(existing, patch, {
      now: now(),
      eventId: id("event"),
      actor: { type: "user" },
    });
    store.applyTransition(transition);
    store.close();

    print(transition.claim, `Edited ${claimId}`);
  });

candidate
  .command("confirm <id>")
  .description("Confirm a candidate claim")
  .action((claimId: string) => {
    const store = openStore();
    const existing = requireClaim(store, claimId);
    const transition = confirmClaim(existing, {
      now: now(),
      eventId: id("event"),
      actor: { type: "user" },
    });
    store.applyTransition(transition);
    store.close();
    print(transition.claim, `Confirmed ${claimId}`);
  });

candidate
  .command("reject <id>")
  .description("Reject a candidate claim")
  .action((claimId: string) => {
    const store = openStore();
    const existing = requireClaim(store, claimId);
    const transition = rejectClaim(existing, {
      now: now(),
      eventId: id("event"),
      actor: { type: "user" },
    });
    store.applyTransition(transition);
    store.close();
    print(transition.claim, `Rejected ${claimId}`);
  });

program
  .command("search <query>")
  .description("Search claim keys, values, categories and tags")
  .option("--status <status>", "claim status", "confirmed")
  .action((query: string, options: { status: string }) => {
    const store = openStore();
    const status = claimStatusSchema.parse(options.status);
    const needle = query.toLocaleLowerCase();
    const matches = readAllClaims(store, { status }).filter((item) => {
      const haystack = [
        item.key,
        JSON.stringify(item.value),
        item.category ?? "",
        ...item.tags,
      ]
        .join("\n")
        .toLocaleLowerCase();
      return haystack.includes(needle);
    });
    store.close();

    if (program.opts().json) {
      print(matches, "");
      return;
    }
    for (const item of matches) {
      process.stdout.write(
        `${item.id}\t${item.key}\t${JSON.stringify(item.value)}\n`,
      );
    }
    if (matches.length === 0) process.stdout.write("No matches.\n");
  });

program
  .command("export <directory>")
  .description("Export a complete native TOPO bundle")
  .option("--force", "allow writing into an existing empty directory")
  .action((directory: string, options: { force?: boolean }) => {
    const destination = resolve(directory);
    if (existsSync(destination)) {
      if (!statSync(destination).isDirectory()) {
        throw new Error("Export destination exists and is not a directory.");
      }
      const entries = readdirSync(destination);
      if (entries.length > 0 || !options.force) {
        throw new Error(
          "Export destination already exists. Use a new path (or --force for an existing empty directory).",
        );
      }
    } else {
      mkdirSync(destination, { recursive: true });
    }

    const store = openStore();
    const bundle = exportBundle(store, now());
    store.close();
    const files = serializeBundle(bundle);

    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(destination, name), content, "utf8");
    }

    print(
      { directory: destination, manifest: bundle.manifest },
      `Exported ${bundle.manifest.counts.claims} claims to ${destination}`,
    );
  });

program
  .command("import <directory>")
  .description("Import a native TOPO bundle without overwriting existing IDs")
  .action((directory: string) => {
    const sourceDirectory = resolve(directory);
    const files = Object.fromEntries(
      Object.values(BUNDLE_FILES).map((name) => [
        name,
        readFileSync(join(sourceDirectory, name), "utf8"),
      ]),
    ) as TopoBundleFiles;
    const bundle = parseBundle(files);

    const store = openStore();
    importBundle(store, bundle);
    store.close();

    print(
      { directory: sourceDirectory, manifest: bundle.manifest },
      `Imported ${bundle.manifest.counts.claims} claims from ${sourceDirectory}`,
    );
  });

registerOosCommands(program, { openStore });

function countAll<T>(read: (offset: number) => T[]): number {
  let count = 0;
  for (let offset = 0; ; offset += 1000) {
    const page = read(offset);
    count += page.length;
    if (page.length < 1000) return count;
  }
}

function readAllClaims(
  store: SqliteMemoryStore,
  filter: { status?: MemoryClaim["status"]; category?: string },
): MemoryClaim[] {
  const claims: MemoryClaim[] = [];
  for (let offset = 0; ; offset += 1000) {
    const page = store.listClaims({ ...filter, offset, limit: 1000 });
    claims.push(...page);
    if (page.length < 1000) return claims;
  }
}

function requireClaim(
  store: SqliteMemoryStore,
  claimId: string,
): MemoryClaim {
  const claim = store.getClaim(claimId);
  if (claim === undefined) {
    store.close();
    throw new Error(`Claim not found: ${claimId}`);
  }
  return claim;
}

try {
  program.parse();
} catch (error) {
  process.stderr.write(
    `TOPO: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
