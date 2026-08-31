import { randomUUID } from "node:crypto";
import { Command } from "commander";
import { resolveOosContext } from "@topo/oos";
import {
  sensitivitySchema,
  type Sensitivity,
} from "@topo/schemas";
import type { MemoryStore } from "@topo/store";

export type OosCommandDependencies = {
  openStore: () => MemoryStore;
  now?: () => string;
  packetId?: () => string;
  write?: (value: string) => void;
};

type ContextCommandOptions = {
  subject: string;
  purpose: string;
  requester: string;
  maxItems: string;
  sensitivity?: string[];
  key?: string[];
  category?: string[];
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

export const registerOosCommands = (
  program: Command,
  dependencies: OosCommandDependencies,
): void => {
  const now = dependencies.now ?? (() => new Date().toISOString());
  const packetId =
    dependencies.packetId ?? (() => `ctx-${randomUUID()}`);
  const write =
    dependencies.write ?? ((value: string) => process.stdout.write(value));

  const oos = program
    .command("oos")
    .description("Organisational OS interoperability commands");

  oos
    .command("context")
    .description("Resolve a purpose-bound OOS Context Packet")
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
