import { getConfig } from "@/lib/config";
import { DiskFileStore } from "./disk-file-store";
import { MemorySessionStore } from "./memory-session-store";
import type { FileStore, SessionStore } from "./types";

export type { FileStore, SessionStore, StoredFile } from "./types";

/**
 * Store wiring — the one place that decides which implementation is in play.
 * Swapping to Redis + object storage means editing this file only.
 *
 * Pinned to `globalThis` because Next's dev server re-evaluates modules on hot
 * reload, which would otherwise drop every in-flight session on each edit.
 */

type Stores = { sessions: SessionStore; files: FileStore };

const GLOBAL_KEY = Symbol.for("veda-ai.stores");
type GlobalWithStores = typeof globalThis & { [GLOBAL_KEY]?: Stores };

function build(): Stores {
  const config = getConfig();
  return {
    sessions: new MemorySessionStore(config.sessionTtlMs),
    files: new DiskFileStore(config.fileStoreDir),
  };
}

function stores(): Stores {
  const globalRef = globalThis as GlobalWithStores;
  globalRef[GLOBAL_KEY] ??= build();
  return globalRef[GLOBAL_KEY];
}

export const getSessionStore = (): SessionStore => stores().sessions;
export const getFileStore = (): FileStore => stores().files;
