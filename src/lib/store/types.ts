import type { SessionResult } from "@/lib/types";

/**
 * Storage seams. Shipped implementations are in-memory + disk locally, Redis +
 * Blob on serverless; swapping them is a change to `store/index.ts` only.
 */

export interface SessionStore {
  create(result: SessionResult): Promise<void>;
  get(sessionId: string): Promise<SessionResult | null>;
  /**
   * Read-modify-write. Callers must never get, mutate, then create: pipeline
   * stages run concurrently with status polls and that races. `mutate` must be
   * pure and return the next value.
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
  save(sessionId: string, name: string, file: StoredFile): Promise<string>;
  read(storageKey: string): Promise<StoredFile | null>;
  deleteSession(sessionId: string): Promise<void>;
}
