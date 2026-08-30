import { createHash } from "node:crypto";

import { get, put, type BlobAccessType } from "@vercel/blob";

import { ValidationError } from "@/lib/errors";
import type { FileStore, StoredFile } from "./types";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PATHNAME_PATTERN =
  /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,128}$/;

/**
 * Page-image store backed by Vercel Blob.
 *
 * Page rasters are hundreds of kilobytes each, which is the wrong shape for
 * Redis. Blob is object storage, so it is where these belong; Redis holds only
 * the small session JSON that points at them.
 *
 * Defaults to private access. These are photographs of someone's exam script,
 * and a public store would make every page readable by anyone holding the URL,
 * which is not a property worth having for the sake of a slightly simpler read
 * path. Reads therefore go through the authenticated `get()` rather than a
 * plain fetch.
 *
 * The storage key is the blob pathname, not a URL: private blobs are not
 * addressable by URL, and a pathname is also stable and easy to validate.
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
      // Page content is immutable within a session, and a random suffix would
      // make the key unpredictable for the read that follows.
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
   * Blobs expire with the session rather than being deleted eagerly.
   *
   * Deleting would need a list call per session, and sessions are short-lived
   * and small. A store lifecycle rule is the right mechanism for this, not
   * application code on a request path.
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
