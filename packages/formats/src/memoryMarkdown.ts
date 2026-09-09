import {
  memoryPageSchema,
  type MemoryPage,
} from "@topo/schemas/memory-page";

export const MEMORY_PAGE_MARKDOWN_FORMAT = "topo.memory-page/0.1" as const;

const FRONTMATTER_KEYS = [
  "topo",
  "id",
  "subject",
  "title",
  "summary",
  "category",
  "tags",
  "status",
  "sensitivity",
  "horizon",
  "origin",
  "source_refs",
  "annotation_ids",
  "valid_from",
  "valid_until",
  "supersedes",
  "revision",
  "created_at",
  "updated_at",
] as const;

type FrontmatterKey = (typeof FRONTMATTER_KEYS)[number];
type Frontmatter = Partial<Record<FrontmatterKey, unknown>>;

export class MemoryMarkdownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MemoryMarkdownError";
  }
}

function line(key: FrontmatterKey, value: unknown): string {
  return `${key}: ${JSON.stringify(value)}`;
}

/**
 * Render a Memory Page as ordinary Markdown with YAML-compatible frontmatter.
 *
 * Frontmatter values deliberately use JSON scalar/array/object syntax. JSON is
 * valid YAML 1.2, which keeps the file readable by ordinary Markdown/YAML tools
 * while making TOPO's own serialisation deterministic and dependency-free.
 */
export function renderMemoryPageMarkdown(page: MemoryPage): string {
  const parsed = memoryPageSchema.parse(page);
  const frontmatter: string[] = [
    line("topo", MEMORY_PAGE_MARKDOWN_FORMAT),
    line("id", parsed.id),
    line("subject", parsed.subject),
    line("title", parsed.title),
  ];

  if (parsed.summary !== undefined) frontmatter.push(line("summary", parsed.summary));
  if (parsed.category !== undefined) frontmatter.push(line("category", parsed.category));

  frontmatter.push(
    line("tags", parsed.tags),
    line("status", parsed.status),
    line("sensitivity", parsed.sensitivity),
    line("horizon", parsed.horizon),
    line("origin", parsed.origin),
    line("source_refs", parsed.sourceRefs),
    line("annotation_ids", parsed.annotationIds),
  );

  if (parsed.validFrom !== undefined) frontmatter.push(line("valid_from", parsed.validFrom));
  if (parsed.validUntil !== undefined) frontmatter.push(line("valid_until", parsed.validUntil));

  frontmatter.push(
    line("supersedes", parsed.supersedes),
    line("revision", parsed.revision),
    line("created_at", parsed.createdAt),
    line("updated_at", parsed.updatedAt),
  );

  return `---\n${frontmatter.join("\n")}\n---\n\n${parsed.body.trim()}\n`;
}

function parseFrontmatter(content: string): {
  frontmatter: Frontmatter;
  body: string;
} {
  const normalised = content.replace(/\r\n/g, "\n");
  if (!normalised.startsWith("---\n")) {
    throw new MemoryMarkdownError("Memory Page Markdown must start with frontmatter");
  }

  const end = normalised.indexOf("\n---\n", 4);
  if (end < 0) {
    throw new MemoryMarkdownError("Memory Page Markdown frontmatter is not closed");
  }

  const header = normalised.slice(4, end);
  const body = normalised.slice(end + 5).replace(/^\n/, "").trim();
  if (body.length === 0) {
    throw new MemoryMarkdownError("Memory Page Markdown body cannot be empty");
  }

  const allowedKeys = new Set<string>(FRONTMATTER_KEYS);
  const frontmatter: Frontmatter = {};

  for (const [index, rawLine] of header.split("\n").entries()) {
    if (rawLine.trim().length === 0) continue;
    const separator = rawLine.indexOf(":");
    if (separator <= 0) {
      throw new MemoryMarkdownError(
        `Invalid frontmatter line ${index + 1}: expected key: JSON-value`,
      );
    }

    const key = rawLine.slice(0, separator).trim();
    if (!allowedKeys.has(key)) {
      throw new MemoryMarkdownError(`Unknown Memory Page frontmatter key: ${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(frontmatter, key)) {
      throw new MemoryMarkdownError(`Duplicate Memory Page frontmatter key: ${key}`);
    }

    const rawValue = rawLine.slice(separator + 1).trim();
    try {
      (frontmatter as Record<string, unknown>)[key] = JSON.parse(rawValue);
    } catch (error) {
      throw new MemoryMarkdownError(
        `Invalid JSON-compatible YAML value for ${key}: ${String(error)}`,
      );
    }
  }

  return { frontmatter, body };
}

function required(frontmatter: Frontmatter, key: FrontmatterKey): unknown {
  if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
    throw new MemoryMarkdownError(`Missing Memory Page frontmatter key: ${key}`);
  }
  return frontmatter[key];
}

export function parseMemoryPageMarkdown(content: string): MemoryPage {
  const { frontmatter, body } = parseFrontmatter(content);

  if (required(frontmatter, "topo") !== MEMORY_PAGE_MARKDOWN_FORMAT) {
    throw new MemoryMarkdownError(
      `Unsupported Memory Page Markdown format: ${String(frontmatter.topo)}`,
    );
  }

  const candidate = {
    id: required(frontmatter, "id"),
    subject: required(frontmatter, "subject"),
    title: required(frontmatter, "title"),
    ...(frontmatter.summary === undefined ? {} : { summary: frontmatter.summary }),
    body,
    ...(frontmatter.category === undefined ? {} : { category: frontmatter.category }),
    tags: required(frontmatter, "tags"),
    status: required(frontmatter, "status"),
    sensitivity: required(frontmatter, "sensitivity"),
    horizon: required(frontmatter, "horizon"),
    origin: required(frontmatter, "origin"),
    sourceRefs: required(frontmatter, "source_refs"),
    annotationIds: required(frontmatter, "annotation_ids"),
    ...(frontmatter.valid_from === undefined ? {} : { validFrom: frontmatter.valid_from }),
    ...(frontmatter.valid_until === undefined ? {} : { validUntil: frontmatter.valid_until }),
    supersedes: required(frontmatter, "supersedes"),
    revision: required(frontmatter, "revision"),
    createdAt: required(frontmatter, "created_at"),
    updatedAt: required(frontmatter, "updated_at"),
  };

  try {
    return memoryPageSchema.parse(candidate);
  } catch (error) {
    throw new MemoryMarkdownError(
      `Memory Page frontmatter does not match the TOPO contract: ${String(error)}`,
    );
  }
}

export function memoryPageFilename(page: Pick<MemoryPage, "id" | "title">): string {
  const slug = page.title
    .normalize("NFKD")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  const safeId = page.id.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 48);
  return `${slug || "memory"}--${safeId}.md`;
}
