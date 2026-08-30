import { describe, expect, it, vi } from "vitest";

import { collectApiKeys, resolveRedisCredentials } from "@/lib/config";
import type { Logger } from "@/lib/logger";
import { RoundRobinKeyPool, describeKey } from "./key-pool";

const silentLog = (): Logger => {
  const log: Logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: () => log,
  };
  return log;
};

describe("RoundRobinKeyPool", () => {
  it("cycles through every key before repeating", () => {
    const pool = new RoundRobinKeyPool(["a", "b", "c"]);
    expect([pool.next(), pool.next(), pool.next(), pool.next()]).toEqual([
      "a",
      "b",
      "c",
      "a",
    ]);
  });

  it("skips a key that was sidelined", () => {
    const pool = new RoundRobinKeyPool(["a", "b", "c"]);
    pool.penalize("b", "quota", silentLog());

    // Three draws should never include the cooling key.
    const drawn = [pool.next(), pool.next(), pool.next()];
    expect(drawn).not.toContain("b");
  });

  it("returns a key even when all of them are cooling", () => {
    // Better to try an expired-quota key than to fail the request outright:
    // the quota window may have rolled over since it was sidelined.
    const pool = new RoundRobinKeyPool(["a", "b"]);
    pool.penalize("a", "quota", silentLog());
    pool.penalize("b", "quota", silentLog());

    expect(["a", "b"]).toContain(pool.next());
  });

  it("brings a key back once its cooldown elapses", () => {
    vi.useFakeTimers();
    try {
      const pool = new RoundRobinKeyPool(["a", "b"], 1000);
      pool.penalize("a", "quota", silentLog());
      expect(pool.next()).toBe("b");

      vi.advanceTimersByTime(1001);
      const drawn = [pool.next(), pool.next()];
      expect(drawn).toContain("a");
    } finally {
      vi.useRealTimers();
    }
  });

  it("refuses to construct with no keys", () => {
    expect(() => new RoundRobinKeyPool([])).toThrow();
  });

  it("never exposes key material in its log reference", () => {
    // Deliberately not shaped like a real vendor key, so secret scanners have
    // nothing to flag here.
    const key = "not-a-real-key-DO-NOT-SCAN-1234";
    expect(describeKey(key)).toBe("…1234");
    expect(describeKey(key)).not.toContain("DO-NOT-SCAN");
  });
});

describe("collectApiKeys", () => {
  it("reads a single key", () => {
    expect(collectApiKeys({ GEMINI_API_KEY: "solo" })).toEqual(["solo"]);
  });

  it("reads a comma-separated list", () => {
    expect(collectApiKeys({ GEMINI_API_KEYS: "a, b ,c" })).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("orders numbered keys numerically, not lexically", () => {
    // Plain string sorting puts KEY_10 between KEY_1 and KEY_2.
    expect(
      collectApiKeys({
        GEMINI_API_KEY_1: "one",
        GEMINI_API_KEY_2: "two",
        GEMINI_API_KEY_10: "ten",
      }),
    ).toEqual(["one", "two", "ten"]);
  });

  it("removes duplicates so one key does not take a double share", () => {
    expect(
      collectApiKeys({ GEMINI_API_KEY: "same", GEMINI_API_KEY_1: "same" }),
    ).toEqual(["same"]);
  });

  it("ignores blank and unrelated variables", () => {
    expect(
      collectApiKeys({
        GEMINI_API_KEY: "  ",
        GEMINI_API_KEY_FOO: "not-numbered",
        GROQ_API_KEY: "other-provider",
      }),
    ).toEqual([]);
  });
});

describe("resolveRedisCredentials", () => {
  it("prefers the Marketplace Upstash variables", () => {
    expect(
      resolveRedisCredentials({
        UPSTASH_REDIS_REST_URL: "https://a.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "token-a",
        KV_REST_API_URL: "https://b.upstash.io",
        KV_REST_API_TOKEN: "token-b",
      }),
    ).toEqual({ redisUrl: "https://a.upstash.io", redisToken: "token-a" });
  });

  it("falls back to the older Vercel KV variables", () => {
    expect(
      resolveRedisCredentials({
        KV_REST_API_URL: "https://b.upstash.io",
        KV_REST_API_TOKEN: "token-b",
      }),
    ).toEqual({ redisUrl: "https://b.upstash.io", redisToken: "token-b" });
  });

  it("ignores a half-configured pair rather than letting it shadow a complete one", () => {
    // A URL with no token is unusable, and treating it as configured would
    // hide the working pair below it.
    expect(
      resolveRedisCredentials({
        UPSTASH_REDIS_REST_URL: "https://a.upstash.io",
        KV_REST_API_URL: "https://b.upstash.io",
        KV_REST_API_TOKEN: "token-b",
      }),
    ).toEqual({ redisUrl: "https://b.upstash.io", redisToken: "token-b" });
  });

  it("reports nothing configured when neither pair is complete", () => {
    expect(resolveRedisCredentials({ UPSTASH_REDIS_REST_URL: "  " })).toEqual({
      redisUrl: undefined,
      redisToken: undefined,
    });
  });
});
