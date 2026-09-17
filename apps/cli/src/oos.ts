import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { resolveOosContext } from "@topo/oos";
import {
  sensitivitySchema,
  type Sensitivity,
} from "@topo/schemas";
import type { MemoryStore } from "@topo/store";

export type DesktopContextRequest = {
  subject: string;
  purpose: string;
  requester: string;
  query?: string;
  maxItems?: number;
};

export type DesktopContextClient = {
  context(request: DesktopContextRequest): Promise<unknown>;
};

export type OosCommandDependencies = {
  openStore: () => MemoryStore;
  now?: () => string;
  packetId?: () => string;
  write?: (value: string) => void;
  writeError?: (value: string) => void;
  desktopContext?: DesktopContextClient;
};

type ContextCommandOptions = {
  subject: string;
  purpose: string;
  requester: string;
  maxItems: string;
  query?: string;
  sensitivity?: string[];
  key?: string[];
  category?: string[];
};

interface DiscoveryFile {
  protocol: string;
  endpoint: string;
  token: string;
}

const parsePositiveInteger = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 200) {
    throw new Error("--max-items must be an integer between 1 and 200.");
  }
  return parsed;
};

const parseSensitivities = (
  values: string[] | undefined,
): Sensitivity[] | undefined => {
  if (values === undefined) return undefined;
  return values.map((value) => sensitivitySchema.parse(value));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const assertLoopback = (endpoint: URL): void => {
  const host = endpoint.hostname.toLowerCase();
  if (
    host !== "127.0.0.1" &&
    host !== "localhost" &&
    host !== "[::1]" &&
    host !== "::1"
  ) {
    throw new Error(
      `TOPO Desktop discovery resolved to non-loopback host ${endpoint.hostname}; refusing connection`,
    );
  }
};

const desktopContextClient = (): DesktopContextClient => {
  const discoveryPath = resolve(
    process.env.TOPO_LOCAL_DISCOVERY ??
      join(homedir(), ".topo", "oos-local.json"),
  );

  const discovery = (): DiscoveryFile => {
    let raw: string;
    try {
      raw = readFileSync(discoveryPath, "utf8");
    } catch {
      throw new Error(
        `TOPO Desktop is not discoverable at ${discoveryPath}. Open TOPO Desktop and enable Share context.`,
      );
    }

    const value: unknown = JSON.parse(raw);
    if (
      !isRecord(value) ||
      typeof value.protocol !== "string" ||
      typeof value.endpoint !== "string" ||
      typeof value.token !== "string"
    ) {
      throw new Error("TOPO Desktop discovery file is invalid");
    }
    if (value.protocol !== "oos-local/0.1") {
      throw new Error(`Unsupported TOPO Desktop protocol: ${value.protocol}`);
    }
    return {
      protocol: value.protocol,
      endpoint: value.endpoint,
      token: value.token,
    };
  };

  return {
    async context(request: DesktopContextRequest): Promise<unknown> {
      const local = discovery();
      const base = new URL(local.endpoint);
      assertLoopback(base);
      const url = new URL(
        "/v0/context",
        `${base.toString().replace(/\/$/, "")}/`,
      );
      assertLoopback(url);

      let response: Response;
      try {
        response = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${local.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            subject: request.subject,
            purpose: request.purpose,
            requested_by: request.requester,
            wanted: {
              ...(request.query === undefined ? {} : { query: request.query }),
              ...(request.maxItems === undefined
                ? {}
                : { max_items: request.maxItems }),
            },
          }),
        });
      } catch (error) {
        throw new Error(
          `Could not reach TOPO Desktop: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const text = await response.text();
      let value: unknown = {};
      if (text.trim().length > 0) {
        try {
          value = JSON.parse(text);
        } catch {
          throw new Error(
            `TOPO Desktop returned invalid JSON (${response.status})`,
          );
        }
      }

      if (!response.ok) {
        const detail =
          isRecord(value) && typeof value.error === "string"
            ? value.error
            : `HTTP ${response.status}`;
        throw new Error(`TOPO Desktop context request failed: ${detail}`);
      }
      return value;
    },
  };
};

export const registerOosCommands = (
  program: Command,
  dependencies: OosCommandDependencies,
): void => {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const packetId = dependencies.packetId ?? (() => `ctx-${randomUUID()}`);
  const write =
    dependencies.write ?? ((value: string) => process.stdout.write(value));
  const writeError =
    dependencies.writeError ?? ((value: string) => process.stderr.write(value));
  const desktopContext = dependencies.desktopContext ?? desktopContextClient();

  program
    .command("context")
    .description("Resolve Memory Page context from the running TOPO Desktop app")
    .requiredOption("--purpose <purpose>", "why this context is being requested")
    .option("--subject <subject>", "context subject", "self")
    .option("--query <query>", "extra retrieval terms")
    .option("--requester <node>", "requesting tool or agent", "topo-cli")
    .option("--max-items <number>", "maximum context objects", "20")
    .action(async (options: ContextCommandOptions) => {
      try {
        const packet = await desktopContext.context({
          subject: options.subject,
          purpose: options.purpose,
          requester: options.requester,
          ...(options.query === undefined ? {} : { query: options.query }),
          maxItems: parsePositiveInteger(options.maxItems),
        });
        write(`${JSON.stringify(packet, null, 2)}\n`);
      } catch (error) {
        writeError(
          `TOPO context: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });

  const oos = program
    .command("oos")
    .description("Organisational OS interoperability commands");

  oos
    .command("context")
    .description("Resolve a purpose-bound OOS Context Packet from legacy structured claims")
    .requiredOption("--subject <subject>", "context subject")
    .requiredOption("--purpose <purpose>", "why this context is being requested")
    .option("--requester <node>", "requesting OOS node", "rack")
    .option("--max-items <number>", "maximum context objects", "20")
    .option(
      "--sensitivity <levels...>",
      "allowed sensitivity levels; defaults to ordinary and personal",
    )
    .option("--key <keys...>", "limit memory claims to keys")
    .option("--category <categories...>", "limit memory claims to categories")
    .action((options: ContextCommandOptions) => {
      const store = dependencies.openStore();
      try {
        const allowedSensitivity = parseSensitivities(options.sensitivity);
        const timestamp = now();
        const packet = resolveOosContext(
          store,
          {
            subject: options.subject,
            purpose: options.purpose,
            requestedBy: options.requester,
            ...(options.key === undefined ? {} : { keys: options.key }),
            ...(options.category === undefined
              ? {}
              : { categories: options.category }),
          },
          {
            packetId: packetId(),
            now: timestamp,
            maxItems: parsePositiveInteger(options.maxItems),
            ...(allowedSensitivity === undefined
              ? {}
              : { allowedSensitivity }),
          },
        );

        // Protocol output is always JSON, independently of the CLI --json flag.
        write(`${JSON.stringify(packet, null, 2)}\n`);
      } finally {
        store.close();
      }
    });
};
