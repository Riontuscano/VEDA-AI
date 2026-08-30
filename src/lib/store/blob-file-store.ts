import { createHash } from "node:crypto";

import { get, put, type BlobAccessType } from "@vercel/blob";

import { ValidationError } from "@/lib/errors";
import type { FileStore, StoredFile } from "./types";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PATHNAME_PATTERN =
  /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,128}$/;

/**
 * Page images in Vercel Blob. Rasters are hundreds of KB each, the wrong shape
 * for Redis, which holds only the session JSON pointing at them.
 *
 * Private by default: these are photos of someone's exam script. Reads go
 * through the authenticated get(), and keys are blob pathnames rather than
 * URLs, since private blobs aren't URL-addressable.
 */
export class BlobFileStore implements FileStore {
  constructor(
    private readonly access: BlobAccessType = "private",
    private readonly prefix = "sessions",
  ) {}

  async save(
    sessionId: string,
    name: string,
    file: StoredFile,
  ): Promise<string> {
    assertSessionId(sessionId);
    const pathname = `${this.prefix}/${sessionId}/${sanitizeName(name)}`;

    await put(pathname, Buffer.from(file.bytes), {
      access: this.access,
      contentType: file.contentType,
      // Content is immutable within a session, and a random suffix would make
      // the key unpredictable for the read that follows.
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return pathname;
  }

  async read(storageKey: string): Promise<StoredFile | null> {
    if (!PATHNAME_PATTERN.test(storageKey)) {
      throw new ValidationError("Malformed storage key", {
        code: "malformed_storage_key",
      });
    }

    const result = await get(storageKey, { access: this.access });
    if (!result || result.stream === null) return null;

    return {
      bytes: new Uint8Array(await new Response(result.stream).arrayBuffer()),
      contentType:
        result.headers?.get("content-type") ?? "application/octet-stream",
    };
  }

  /**
   * Blobs expire with the session. Eager deletion would need a list call per
   * session; a store lifecycle rule is the right mechanism, not request code.
   */
  async deleteSession(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
  }
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new ValidationError("Malformed session id", {
      code: "malformed_session_id",
    });
  }
}

/** Reduces a caller-supplied name to a safe path segment. */
function sanitizeName(name: string): string {
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const base = name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${base || "file"}.${suffix}`;
}
