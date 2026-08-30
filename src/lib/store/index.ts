import { Redis } from "@upstash/redis";

import { getConfig } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { BlobFileStore } from "./blob-file-store";
import { DiskFileStore } from "./disk-file-store";
import { MemorySessionStore } from "./memory-session-store";
import { RedisSessionStore } from "./redis-session-store";
import type { FileStore, SessionStore } from "./types";

export type { FileStore, SessionStore, StoredFile } from "./types";

/**
 * Store wiring: the one place that decides which implementation is in play.
 *
 * Each backend is chosen from whether its credentials are present, so the same
 * build runs correctly in both targets:
 *
 *   local / single server   in-memory sessions, page images on disk
 *   serverless (Vercel)     Redis sessions, page images in Blob storage
 *
 * This is the payoff for putting storage behind an interface. Moving to
 * serverless changed this file and added two implementations; no pipeline,
 * route or component code was touched.
 */

type Stores = { sessions: SessionStore; files: FileStore };

const GLOBAL_KEY = Symbol.for("veda-ai.stores");
type GlobalWithStores = typeof globalThis & { [GLOBAL_KEY]?: Stores };

function build(): Stores {
  const config = getConfig();

  // Fail loudly rather than subtly. On serverless without shared storage the
  // app appears to work whenever two requests happen to hit the same instance
  // and 404s when they do not, which is far harder to diagnose than a refusal
  // to start.
  if (process.env.VERCEL && !(config.redisUrl && config.redisToken)) {
    throw new AppError(
      "Running on Vercel without Redis. Sessions would not survive between requests. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.",
      { stage: "config", code: "missing_shared_storage" },
    );
  }

  const sessions: SessionStore =
    config.redisUrl && config.redisToken
      ? new RedisSessionStore(
          new Redis({ url: config.redisUrl, token: config.redisToken }),
          Math.ceil(config.sessionTtlMs / 1000),
        )
      : new MemorySessionStore(config.sessionTtlMs);

  const files: FileStore = config.blobToken
    ? new BlobFileStore()
    : new DiskFileStore(config.fileStoreDir);

  logger.info("Storage configured", {
    sessions: sessions.constructor.name,
    files: files.constructor.name,
  });

  return { sessions, files };
}

function stores(): Stores {
  const globalRef = globalThis as GlobalWithStores;
  globalRef[GLOBAL_KEY] ??= build();
  return globalRef[GLOBAL_KEY];
}

export const getSessionStore = (): SessionStore => stores().sessions;
export const getFileStore = (): FileStore => stores().files;

/**
 * True when sessions survive beyond a single process.
 *
 * The upload route uses this to decide whether the pipeline may run after the
 * response: on serverless it must be handed to the platform, and without shared
 * storage there would be nothing for a later request to read anyway.
 */
export function hasSharedStorage(): boolean {
  const config = getConfig();
  return Boolean(config.redisUrl && config.redisToken);
}
