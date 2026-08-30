import type { Logger } from "@/lib/logger";

/**
 * Round-robin pool of API keys with per-key cooldown.
 *
 * Free-tier Gemini keys have low per-minute and per-day quotas. Spreading calls
 * across several keys raises the effective ceiling, and more importantly makes
 * a quota failure recoverable: an exhausted key is sidelined and the next call
 * goes out on a different one immediately.
 *
 * Only quota and auth failures should sideline a key. A 503 means the model
 * itself is busy, which every key shares, so rotating on it would burn the pool
 * for nothing.
 */
export interface KeyPool {
  /** Next usable key. Falls back to the least-recently-cooled when all are cooling. */
  next(): string;
  /** Sideline a key that reported quota exhaustion or bad credentials. */
  penalize(key: string, reason: string, log: Logger): void;
  readonly size: number;
}

/** How long an exhausted key sits out. Per-minute quotas recover inside this. */
const DEFAULT_COOLDOWN_MS = 65_000;

export class RoundRobinKeyPool implements KeyPool {
  private cursor = 0;
  /** key -> timestamp before which the key should not be used. */
  private readonly coolingUntil = new Map<string, number>();

  constructor(
    private readonly keys: string[],
    private readonly cooldownMs: number = DEFAULT_COOLDOWN_MS,
  ) {
    if (keys.length === 0) {
      throw new Error("Key pool requires at least one API key");
    }
  }

  get size(): number {
    return this.keys.length;
  }

  next(): string {
    const now = Date.now();

    // One full lap looking for a key that is not cooling down.
    for (let offset = 0; offset < this.keys.length; offset += 1) {
      const index = (this.cursor + offset) % this.keys.length;
      const key = this.keys[index];
      if (!key) continue;
      if ((this.coolingUntil.get(key) ?? 0) <= now) {
        this.cursor = (index + 1) % this.keys.length;
        return key;
      }
    }

    // Everything is cooling. Use whichever recovers soonest rather than
    // failing outright: the quota window may already have rolled over.
    let soonestKey = this.keys[0] as string;
    let soonest = Number.POSITIVE_INFINITY;
    for (const key of this.keys) {
      const until = this.coolingUntil.get(key) ?? 0;
      if (until < soonest) {
        soonest = until;
        soonestKey = key;
      }
    }
    return soonestKey;
  }

  penalize(key: string, reason: string, log: Logger): void {
    this.coolingUntil.set(key, Date.now() + this.cooldownMs);
    log.warn("API key sidelined", {
      reason,
      cooldownMs: this.cooldownMs,
      // Never log key material, only enough to tell them apart in a trace.
      keyRef: describeKey(key),
      poolSize: this.keys.length,
      cooling: this.countCooling(),
    });
  }

  private countCooling(): number {
    const now = Date.now();
    let cooling = 0;
    for (const until of this.coolingUntil.values()) {
      if (until > now) cooling += 1;
    }
    return cooling;
  }
}

/**
 * Short, non-reversible reference to a key, safe to put in logs.
 *
 * Logs get shipped, pasted into issues and shared in demos, so key material
 * must never appear in them.
 */
export function describeKey(key: string): string {
  return `…${key.slice(-4)}`;
}
