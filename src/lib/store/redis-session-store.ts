import { Redis } from "@upstash/redis";

import { NotFoundError } from "@/lib/errors";
import type { SessionResult } from "@/lib/types";
import type { SessionStore } from "./types";

/**
 * Session store backed by Upstash Redis.
 *
 * Exists because serverless deployment breaks the in-memory store: each request
 * may land on a different instance, so a session written by the upload handler
 * would be missing from the next status poll. This is the same interface, so no
 * pipeline code changes.
 *
 * Updates use optimistic concurrency rather than a lock. Instances cannot share
 * an in-process mutex, and a session is only ever written by its own pipeline
 * plus the occasional status read, so contention is low and a retry loop is
 * cheaper and simpler than a distributed lock.
 */
export class RedisSessionStore implements SessionStore {
  constructor(
    private readonly redis: Redis,
    private readonly ttlSeconds: number,
    private readonly maxUpdateAttempts = 5,
  ) {}

  private key(sessionId: string): string {
    return `session:${sessionId}`;
  }

  async create(result: SessionResult): Promise<void> {
    await this.redis.set(this.key(result.sessionId), JSON.stringify(result), {
      ex: this.ttlSeconds,
    });
  }

  async get(sessionId: string): Promise<SessionResult | null> {
    const raw = await this.redis.get<SessionResult | string>(
      this.key(sessionId),
    );
    if (raw === null || raw === undefined) return null;
    // Upstash deserializes JSON automatically, but returns a string when the
    // value was stored by something that did not. Handle both.
    return typeof raw === "string"
      ? (JSON.parse(raw) as SessionResult)
      : raw;
  }

  async update(
    sessionId: string,
    mutate: (current: SessionResult) => SessionResult,
  ): Promise<SessionResult> {
    for (let attempt = 0; attempt < this.maxUpdateAttempts; attempt += 1) {
      const current = await this.get(sessionId);
      if (!current) {
        throw new NotFoundError(`Session ${sessionId} not found or expired`);
      }

      const next = mutate(current);

      // Guard on the value we read. If another writer got in first, the stored
      // JSON no longer matches and we re-read rather than clobbering it.
      const applied = await this.compareAndSet(
        this.key(sessionId),
        JSON.stringify(current),
        JSON.stringify(next),
      );
      if (applied) return next;
    }

    throw new Error(
      `Could not update session ${sessionId} after ${this.maxUpdateAttempts} attempts`,
    );
  }

  async delete(sessionId: string): Promise<void> {
    await this.redis.del(this.key(sessionId));
  }

  /**
   * Set only if the current value is unchanged, refreshing the TTL.
   *
   * Done as a Lua script so the check and the write are one atomic operation;
   * a get-then-set from the client would leave a window for a lost update.
   *
   * Note this is Redis `EVAL`, which runs Lua inside the Redis server, not
   * JavaScript `eval`. The script is a fixed constant and never built from
   * input: the key and both values are passed as `KEYS` and `ARGV`, which is
   * the mechanism that makes Redis scripting injection-safe.
   */
  private async compareAndSet(
    key: string,
    expected: string,
    next: string,
  ): Promise<boolean> {
    const script = `
      local current = redis.call('GET', KEYS[1])
      if current == ARGV[1] then
        redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
        return 1
      end
      return 0
    `;
    const result = await this.redis.eval(
      script,
      [key],
      [expected, next, String(this.ttlSeconds)],
    );
    return result === 1;
  }
}
