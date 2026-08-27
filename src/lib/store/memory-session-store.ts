import { NotFoundError } from "@/lib/errors";
import type { SessionResult } from "@/lib/types";
import type { SessionStore } from "./types";

/**
 * In-memory session store.
 *
 * Correct because the app is deployed as a single long-lived Node process
 * (see README — this is why the deploy target is not serverless). Sessions are
 * evicted after a TTL so a long-running instance does not grow unbounded.
 */
export class MemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionResult>();
  /** Per-session promise chain, serializing read-modify-write. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(private readonly ttlMs: number) {}

  async create(result: SessionResult): Promise<void> {
    this.evictExpired();
    this.sessions.set(result.sessionId, result);
  }

  async get(sessionId: string): Promise<SessionResult | null> {
    const found = this.sessions.get(sessionId);
    if (!found) return null;
    if (this.isExpired(found)) {
      this.sessions.delete(sessionId);
      return null;
    }
    return found;
  }

  async update(
    sessionId: string,
    mutate: (current: SessionResult) => SessionResult,
  ): Promise<SessionResult> {
    const previous = this.locks.get(sessionId) ?? Promise.resolve();

    const next = previous.then(async () => {
      const current = await this.get(sessionId);
      if (!current) {
        throw new NotFoundError(`Session ${sessionId} not found or expired`);
      }
      const updated = mutate(current);
      this.sessions.set(sessionId, updated);
      return updated;
    });

    // Keep the chain alive even if this link rejects, so a failed update does
    // not permanently poison every later update for the same session.
    this.locks.set(
      sessionId,
      next.catch(() => undefined),
    );

    return next;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    this.locks.delete(sessionId);
  }

  private isExpired(result: SessionResult): boolean {
    return Date.now() - result.createdAt > this.ttlMs;
  }

  private evictExpired(): void {
    for (const [id, result] of this.sessions) {
      if (this.isExpired(result)) {
        this.sessions.delete(id);
        this.locks.delete(id);
      }
    }
  }
}
