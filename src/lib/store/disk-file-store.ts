import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { ValidationError } from "@/lib/errors";
import type { FileStore, StoredFile } from "./types";

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const STORAGE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9._-]{1,128}$/;
const CONTENT_TYPE_FILE = ".content-type";

/**
 * Local-filesystem file store, holding rasterized page images for the lifetime
 * of a session.
 *
 * Uploaded names are never used as paths directly: they are sanitized to a
 * fixed character class and every resolved path is asserted to stay inside the
 * root directory, so a crafted name cannot escape via `../` or an absolute
 * path.
 */
export class DiskFileStore implements FileStore {
  constructor(private readonly rootDir: string) {}

  async save(
    sessionId: string,
    name: string,
    file: StoredFile,
  ): Promise<string> {
    assertSessionId(sessionId);
    const safeName = sanitizeName(name);
    const storageKey = `${sessionId}/${safeName}`;
    const filePath = this.resolveKey(storageKey);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, file.bytes);
    await writeFile(filePath + CONTENT_TYPE_FILE, file.contentType, "utf8");

    return storageKey;
  }

  async read(storageKey: string): Promise<StoredFile | null> {
    const filePath = this.resolveKey(storageKey);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(filePath),
        readFile(filePath + CONTENT_TYPE_FILE, "utf8"),
      ]);
      return { bytes: new Uint8Array(bytes), contentType: contentType.trim() };
    } catch {
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    assertSessionId(sessionId);
    const dir = this.resolveInsideRoot(sessionId);
    await rm(dir, { recursive: true, force: true });
  }

  private resolveKey(storageKey: string): string {
    if (!STORAGE_KEY_PATTERN.test(storageKey)) {
      throw new ValidationError("Malformed storage key", {
        code: "malformed_storage_key",
      });
    }
    return this.resolveInsideRoot(storageKey);
  }

  /** Resolves under `rootDir` and rejects anything that escapes it. */
  private resolveInsideRoot(relative: string): string {
    const root = path.resolve(this.rootDir);
    const resolved = path.resolve(root, relative);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) {
      throw new ValidationError("Storage path escapes root directory", {
        code: "path_traversal_blocked",
      });
    }
    return resolved;
  }
}

function assertSessionId(sessionId: string): void {
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new ValidationError("Malformed session id", {
      code: "malformed_session_id",
    });
  }
}

/**
 * Reduces an arbitrary uploaded name to a safe filename. A hash suffix keeps
 * names that collapse to the same characters (or get truncated) distinct.
 */
function sanitizeName(name: string): string {
  const suffix = createHash("sha256").update(name).digest("hex").slice(0, 8);
  const base = name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 80);
  return `${base || "file"}.${suffix}`;
}
