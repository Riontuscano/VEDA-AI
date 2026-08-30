import { Redis } from "@upstash/redis";

import { NotFoundError } from "@/lib/errors";
import type { SessionResult } from "@/lib/types";
import type { SessionStore } from "./types";

/**
 * Sessions in Redis, for serverless where each request may land on a different
 * instance.
 *
 * Updates use optimistic concurrency, not a lock: instances can't share a
 * mutex, and contention here is low enough that a retry loop beats a
 * distributed lock.
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
    // Upstash usually deserializes JSON, but not always. Handle both.
    return typeof raw === "string" ? (JSON.parse(raw) as SessionResult) : raw;
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

      // If another writer got in first the stored JSON won't match, so we
      // re-read instead of clobbering.
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
   * Set only if unchanged, refreshing the TTL. One Lua script so the check and
   * write are atomic; a client-side get-then-set leaves a lost-update window.
   *
   * This is Redis EVAL (server-side Lua), not JavaScript eval. The script is a
   * fixed constant and all data goes through KEYS/ARGV, which is what makes
   * Redis scripting injection-safe.
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
