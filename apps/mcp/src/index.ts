#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createTopoMcpServer, TopoMcpService } from "@topo/mcp";
import { sensitivitySchema, type Sensitivity } from "@topo/schemas";
import { SqliteMemoryStore } from "@topo/store-node";

interface Options {
  store: string;
  maxSensitivity: Sensitivity;
  allowReviewDecisions: boolean;
}

function usage(): string {
  return [
    "TOPO MCP server",
    "",
    "Usage: topo-mcp [options]",
    "",
    "Options:",
    "  --store <path>                 SQLite store path",
    "  --max-sensitivity <level>      ordinary|personal|sensitive|restricted",
    "  --allow-review-decisions       Delegate user review authority to this connection",
    "  --help                         Show this help",
    "",
    "Environment:",
    "  TOPO_DB",
    "  TOPO_MCP_MAX_SENSITIVITY",
    "  TOPO_MCP_ALLOW_REVIEW_DECISIONS=1",
  ].join("\n");
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function options(args: string[]): Options {
  if (args.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    process.exit(0);
  }

  const store =
    valueAfter(args, "--store") ??
    process.env.TOPO_DB ??
    join(homedir(), ".topo", "topo.sqlite");

  const rawSensitivity =
    valueAfter(args, "--max-sensitivity") ??
    process.env.TOPO_MCP_MAX_SENSITIVITY ??
    "personal";

  return {
    store: resolve(store),
    maxSensitivity: sensitivitySchema.parse(rawSensitivity),
    allowReviewDecisions:
      args.includes("--allow-review-decisions") ||
      process.env.TOPO_MCP_ALLOW_REVIEW_DECISIONS === "1",
  };
}

try {
  const config = options(process.argv.slice(2));
  mkdirSync(dirname(config.store), { recursive: true });

  const store = new SqliteMemoryStore(config.store);
  const service = new TopoMcpService(store, {
    maxSensitivity: config.maxSensitivity,
    allowReviewDecisions: config.allowReviewDecisions,
  });

  const close = (): void => {
    try {
      store.close();
    } catch {
      // Process teardown should not mask the original exit condition.
    }
  };
  process.once("exit", close);
  process.once("SIGINT", () => {
    close();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    close();
    process.exit(143);
  });

  serveStdio(() => createTopoMcpServer(service));
} catch (error) {
  process.stderr.write(
    `TOPO MCP: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
}
