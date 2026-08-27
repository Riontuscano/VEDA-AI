import type { SessionResult } from "@/lib/types";

/**
 * Storage seams.
 *
 * The assignment needs no database, so the shipped implementations are an
 * in-memory Map and the local filesystem. They sit behind these interfaces so
 * swapping in Redis + object storage later is a wiring change in
 * `src/lib/store/index.ts`, not a change to any pipeline stage.
 */

export interface SessionStore {
  create(result: SessionResult): Promise<void>;
  get(sessionId: string): Promise<SessionResult | null>;
  /**
   * Read-modify-write under the store's own lock.
   *
   * Pipeline stages run concurrently with status polls, so callers must never
   * `get`, mutate, then `create` — that races. `mutate` must be pure and
   * return the next value.
   */
  update(
    sessionId: string,
    mutate: (current: SessionResult) => SessionResult,
  ): Promise<SessionResult>;
  delete(sessionId: string): Promise<void>;
}

export type StoredFile = {
  bytes: Uint8Array;
  contentType: string;
};

export interface FileStore {
  /** Returns an opaque storage key. `name` is sanitized, never trusted. */
  save(
    sessionId: string,
    name: string,
    file: StoredFile,
  ): Promise<string>;
  read(storageKey: string): Promise<StoredFile | null>;
  deleteSession(sessionId: string): Promise<void>;
}
