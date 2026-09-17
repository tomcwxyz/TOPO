import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander";
import { resolveOosContext } from "@topo/oos";
import {
  TopoLocalClient,
  type TopoLocalCaptureRequest,
  type TopoLocalContextRequest,
} from "@topo/oos/local-client";
import {
  capturedInteractionSchema,
  sensitivitySchema,
  type Sensitivity,
} from "@topo/schemas";
import type { MemoryStore } from "@topo/store";

export type DesktopContextClient = {
  context(request: TopoLocalContextRequest): Promise<unknown>;
  captureInteraction?(request: TopoLocalCaptureRequest): Promise<unknown>;
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

type CaptureCommandOptions = {
  requester: string;
};

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

function readCapturedInteraction(path: string) {
  const source = path === "-" ? 0 : resolve(path);
  const raw = readFileSync(source, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `Capture input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return capturedInteractionSchema.parse(value);
}

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
  const desktopContext = dependencies.desktopContext ?? new TopoLocalClient();

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
          requestedBy: options.requester,
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

  program
    .command("capture <file>")
    .description(
      "Queue a CapturedInteraction JSON file in the running TOPO Desktop capture inbox; use - for stdin",
    )
    .option("--requester <node>", "requesting tool or agent", "topo-cli")
    .action(async (file: string, options: CaptureCommandOptions) => {
      try {
        if (desktopContext.captureInteraction === undefined) {
          throw new Error("The configured TOPO Desktop client does not support capture.");
        }
        const interaction = readCapturedInteraction(file);
        const response = await desktopContext.captureInteraction({
          interaction,
          requestedBy: options.requester,
        });
        write(`${JSON.stringify(response, null, 2)}\n`);
      } catch (error) {
        writeError(
          `TOPO capture: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        process.exitCode = 1;
      }
    });

  const oos = program
    .command("oos")
    .description("Organisational OS interoperability commands");

  oos
    .command("context")
    .description(
      "Resolve a purpose-bound OOS Context Packet from legacy structured claims",
    )
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
