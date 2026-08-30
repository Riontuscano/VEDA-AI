import type { Logger } from "@/lib/logger";

/**
 * Round-robin key pool with per-key cooldown, so one exhausted key doesn't
 * stop the run.
 *
 * Only quota and auth failures sideline a key. A 503 means the model is busy,
 * which every key shares, so rotating on it would burn the pool for nothing.
 */
export interface KeyPool {
  /** Next usable key. Falls back to the least-recently-cooled when all are cooling. */
  next(): string;
  /** Sideline a key that reported quota exhaustion or bad credentials. */
  penalize(key: string, reason: string, log: Logger): void;
  readonly size: number;
}

/** Long enough for a per-minute quota to recover. */
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

    // All cooling. Try the one that recovers soonest rather than failing:
    // the quota window may already have rolled over.
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

/** Safe to log. Key material must never reach a log line. */
export function describeKey(key: string): string {
  return `…${key.slice(-4)}`;
}
