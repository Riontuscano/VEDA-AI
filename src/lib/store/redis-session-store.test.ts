import type { Redis } from "@upstash/redis";
import { describe, expect, it } from "vitest";

import type { SessionResult } from "@/lib/types";
import { RedisSessionStore } from "./redis-session-store";

/**
 * In-memory stand-in for Upstash Redis.
 *
 * Implements only what the store uses, with the same semantics that matter:
 * `eval` runs the compare-and-set atomically with respect to other calls,
 * because JavaScript will not interleave it. That is what lets the concurrency
 * test below be meaningful rather than decorative.
 */
class FakeRedis {
  private readonly values = new Map<string, string>();
  evalCalls = 0;

  async set(key: string, value: string): Promise<"OK"> {
    this.values.set(key, value);
    return "OK";
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = this.values.get(key);
    return raw === undefined ? null : (raw as T);
  }

  async del(key: string): Promise<number> {
    return this.values.delete(key) ? 1 : 0;
  }

  async eval(
    _script: string,
    keys: string[],
    args: string[],
  ): Promise<number> {
    this.evalCalls += 1;
    const [key] = keys;
    const [expected, next] = args;
    if (key === undefined || expected === undefined || next === undefined) {
      return 0;
    }
    if (this.values.get(key) !== expected) return 0;
    this.values.set(key, next);
    return 1;
  }

  /** Simulates another instance writing between our read and our write. */
  async clobber(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

const asRedis = (fake: FakeRedis): Redis => fake as unknown as Redis;

function session(overrides: Partial<SessionResult> = {}): SessionResult {
  return {
    sessionId: "s1",
    status: "uploading",
    createdAt: Date.now(),
    questionPages: [],
    answerPages: [],
    questions: [],
    answers: [],
    mappings: [],
    errors: [],
    ...overrides,
  };
}

describe("RedisSessionStore", () => {
  it("round-trips a session", async () => {
    const fake = new FakeRedis();
    const store = new RedisSessionStore(asRedis(fake), 60);

    await store.create(session());
    expect((await store.get("s1"))?.sessionId).toBe("s1");
  });

  it("returns null for a session that is not there", async () => {
    const store = new RedisSessionStore(asRedis(new FakeRedis()), 60);
    expect(await store.get("missing")).toBeNull();
  });

  it("parses a value that came back as a raw string", async () => {
    // Upstash deserializes JSON itself, but not every value it returns has been
    // through that path. Both shapes must work.
    const fake = new FakeRedis();
    await fake.set("session:s1", JSON.stringify(session({ status: "done" })));
    const store = new RedisSessionStore(asRedis(fake), 60);
    expect((await store.get("s1"))?.status).toBe("done");
  });

  it("applies an update", async () => {
    const fake = new FakeRedis();
    const store = new RedisSessionStore(asRedis(fake), 60);
    await store.create(session());

    const updated = await store.update("s1", (current) => ({
      ...current,
      status: "mapping",
    }));

    expect(updated.status).toBe("mapping");
    expect((await store.get("s1"))?.status).toBe("mapping");
  });

  it("re-reads and retries when another writer got in first", async () => {
    const fake = new FakeRedis();
    const store = new RedisSessionStore(asRedis(fake), 60);
    await store.create(session());

    let firstPass = true;
    const result = await store.update("s1", (current) => {
      if (firstPass) {
        firstPass = false;
        // Land a competing write after this read but before our set, which is
        // exactly the lost-update window a plain get-then-set would have.
        void fake.clobber(
          "session:s1",
          JSON.stringify(session({ status: "extracting_answers" })),
        );
      }
      return { ...current, questions: [...current.questions] };
    });

    // The retry observed the other writer's value rather than overwriting it.
    expect(result.status).toBe("extracting_answers");
    expect(fake.evalCalls).toBe(2);
  });

  it("throws rather than looping forever when contention never clears", async () => {
    const fake = new FakeRedis();
    const store = new RedisSessionStore(asRedis(fake), 60, 3);
    await store.create(session());

    await expect(
      store.update("s1", (current) => {
        void fake.clobber(
          "session:s1",
          JSON.stringify(session({ createdAt: Math.random() })),
        );
        return current;
      }),
    ).rejects.toThrow(/after 3 attempts/);
  });

  it("reports a missing session as not found", async () => {
    const store = new RedisSessionStore(asRedis(new FakeRedis()), 60);
    await expect(store.update("nope", (c) => c)).rejects.toThrow(/not found/);
  });

  it("deletes", async () => {
    const fake = new FakeRedis();
    const store = new RedisSessionStore(asRedis(fake), 60);
    await store.create(session());
    await store.delete("s1");
    expect(await store.get("s1")).toBeNull();
  });
});
