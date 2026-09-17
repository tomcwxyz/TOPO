import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type {
  RelayDeviceAuthorizer,
  RelayDeviceIdentity,
} from "./remote-relay-http.js";

export interface RelayDeviceCredentialMetadata {
  credentialId: string;
  deviceId: string;
  label?: string;
  createdAt: string;
  rotatedFrom?: string;
  revokedAt?: string;
}

export interface RelayDeviceEnrolment {
  device: RelayDeviceCredentialMetadata;
  token: string;
}

export interface RelayDeviceRegistryOptions {
  now?: () => string;
  credentialId?: () => string;
  secret?: () => string;
}

type StoredCredential = RelayDeviceCredentialMetadata & {
  secretDigest: Buffer;
};

const TOKEN_PREFIX = "topo-device-v1";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function validTimestamp(value: string): string {
  if (Number.isNaN(Date.parse(value))) {
    throw new Error("TOPO device registry clock returned an invalid timestamp");
  }
  return value;
}

function cloneMetadata(record: StoredCredential): RelayDeviceCredentialMetadata {
  return {
    credentialId: record.credentialId,
    deviceId: record.deviceId,
    ...(record.label === undefined ? {} : { label: record.label }),
    createdAt: record.createdAt,
    ...(record.rotatedFrom === undefined
      ? {}
      : { rotatedFrom: record.rotatedFrom }),
    ...(record.revokedAt === undefined ? {} : { revokedAt: record.revokedAt }),
  };
}

function encodeToken(credentialId: string, secret: string): string {
  return `${TOKEN_PREFIX}.${credentialId}.${secret}`;
}

function parseToken(token: string): { credentialId: string; secret: string } | undefined {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return undefined;
  const credentialId = parts[1]?.trim() ?? "";
  const secret = parts[2]?.trim() ?? "";
  if (credentialId.length === 0 || secret.length < 32) return undefined;
  return { credentialId, secret };
}

/**
 * In-memory credential registry for the CE3 relay prototype.
 *
 * The registry stores a digest of each device secret, never the bearer token.
 * Production can replace this with a durable credential service without
 * changing the RelayDeviceAuthorizer contract.
 */
export class InMemoryRelayDeviceRegistry implements RelayDeviceAuthorizer {
  private readonly now: () => string;
  private readonly nextCredentialId: () => string;
  private readonly nextSecret: () => string;
  private readonly credentials = new Map<string, StoredCredential>();

  constructor(options: RelayDeviceRegistryOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.nextCredentialId =
      options.credentialId ?? (() => `cred-${randomUUID()}`);
    this.nextSecret =
      options.secret ?? (() => randomBytes(32).toString("base64url"));
  }

  enrol(deviceId: string, label?: string): RelayDeviceEnrolment {
    return this.issue(deviceId, label, undefined);
  }

  rotate(credentialId: string): RelayDeviceEnrolment {
    const current = this.credentials.get(credentialId);
    if (current === undefined) {
      throw new Error("TOPO relay device credential was not found");
    }
    if (current.revokedAt !== undefined) {
      throw new Error("TOPO relay device credential is already revoked");
    }

    const revokedAt = validTimestamp(this.now());
    current.revokedAt = revokedAt;
    return this.issue(current.deviceId, current.label, current.credentialId);
  }

  revokeCredential(credentialId: string): RelayDeviceCredentialMetadata {
    const current = this.credentials.get(credentialId);
    if (current === undefined) {
      throw new Error("TOPO relay device credential was not found");
    }
    if (current.revokedAt === undefined) {
      current.revokedAt = validTimestamp(this.now());
    }
    return cloneMetadata(current);
  }

  revokeDevice(deviceId: string): RelayDeviceCredentialMetadata[] {
    const id = deviceId.trim();
    if (id.length === 0) throw new Error("deviceId is required");
    const revoked = [];
    for (const record of this.credentials.values()) {
      if (record.deviceId !== id) continue;
      if (record.revokedAt === undefined) {
        record.revokedAt = validTimestamp(this.now());
      }
      revoked.push(cloneMetadata(record));
    }
    return revoked;
  }

  list(): RelayDeviceCredentialMetadata[] {
    return [...this.credentials.values()]
      .map(cloneMetadata)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async authorise(
    authorization: string | null,
  ): Promise<RelayDeviceIdentity | undefined> {
    if (authorization === null || !authorization.startsWith("Bearer ")) {
      return undefined;
    }
    const parsed = parseToken(authorization.slice("Bearer ".length));
    if (parsed === undefined) return undefined;

    const record = this.credentials.get(parsed.credentialId);
    if (record === undefined || record.revokedAt !== undefined) return undefined;

    const candidate = digest(parsed.secret);
    if (
      candidate.length !== record.secretDigest.length ||
      !timingSafeEqual(candidate, record.secretDigest)
    ) {
      return undefined;
    }

    return { deviceId: record.deviceId };
  }

  private issue(
    deviceId: string,
    label: string | undefined,
    rotatedFrom: string | undefined,
  ): RelayDeviceEnrolment {
    const id = deviceId.trim();
    if (id.length === 0) throw new Error("deviceId is required");
    const credentialId = this.nextCredentialId().trim();
    if (credentialId.length === 0 || this.credentials.has(credentialId)) {
      throw new Error("TOPO relay generated an invalid device credential id");
    }
    const secret = this.nextSecret().trim();
    if (secret.length < 32) {
      throw new Error("TOPO relay device secrets must contain at least 32 characters");
    }

    const createdAt = validTimestamp(this.now());
    const record: StoredCredential = {
      credentialId,
      deviceId: id,
      ...(label === undefined || label.trim().length === 0
        ? {}
        : { label: label.trim() }),
      createdAt,
      ...(rotatedFrom === undefined ? {} : { rotatedFrom }),
      secretDigest: digest(secret),
    };
    this.credentials.set(credentialId, record);

    return {
      device: cloneMetadata(record),
      token: encodeToken(credentialId, secret),
    };
  }
}
