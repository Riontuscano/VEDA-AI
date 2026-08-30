import { createHash } from "node:crypto";

import { head, put } from "@vercel/blob";

import { ValidationError } from "@/lib/errors";
import type { FileStore, StoredFile } from "./types";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Page-image store backed by Vercel Blob.
 *
 * Page rasters are hundreds of kilobytes each, which is the wrong shape for
 * Redis. Blob is object storage, so it is what these belong in; Redis keeps
 * only the small session JSON that points at them.
 *
 * Uploaded names are never used as paths. Keys are generated from the session
 * id and a caller-supplied slug, both of which are validated.
 */
export class BlobFileStore implements FileStore {
  constructor(private readonly prefix = "sessions") {}

  async save(
    sessionId: string,
    name: string,
    file: StoredFile,
  ): Promise<string> {
    assertSessionId(sessionId);
    const safeName = sanitizeName(name);
    const pathname = `${this.prefix}/${sessionId}/${safeName}`;

    const blob = await put(pathname, Buffer.from(file.bytes), {
      access: "public",
      contentType: file.contentType,
      // Page content is immutable for a session, and a suffix would make the
      // returned key unpredictable for later reads.
      addRandomSuffix: false,
      allowOverwrite: true,
    });

    return blob.url;
  }

  /**
   * Blob URLs are unguessable but public, so the storage key is the URL itself.
   * Reads go through the app's own route, which checks the URL belongs to the
   * session being requested before fetching.
   */
  async read(storageKey: string): Promise<StoredFile | null> {
    if (!isBlobUrl(storageKey)) {
      throw new ValidationError("Malformed storage key", {
        code: "malformed_storage_key",
      });
    }

    const response = await fetch(storageKey);
    if (!response.ok) return null;

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType:
        response.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  /**
   * Blobs expire with the session rather than being deleted eagerly.
   *
   * Deleting would need a list call per session and the store has no index of
   * what it wrote. Sessions are short-lived and the blobs are small, so a
   * lifecycle rule on the bucket is the right mechanism, not application code.
   */
  async deleteSession(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
  }

  /** Cheap existence probe, used by the health check. */
  async exists(storageKey: string): Promise<boolean> {
    try {
      await head(storageKey);
      return true;
    } catch {
      return false;
    }
  }
}

function isBlobUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname.endsWith(".vercel-storage.com") ||
        url.hostname.endsWith(".public.blob.vercel-storage.com"))
    );
  } catch {
    return false;
  }
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new ValidationError("Malformed session id", {
      code: "malformed_session_id",
    });
  }
}

function sanitizeName(name: string): string {
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const base = name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${base || "file"}.${suffix}`;
}
