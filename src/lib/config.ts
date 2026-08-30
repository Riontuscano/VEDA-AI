import { z } from "zod";

// Validated once, lazily: `next build` and unit tests shouldn't need a real
// API key, but anything that actually reads config fails loudly.

const intFromEnv = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const ConfigSchema = z.object({
  /** Pooled and rotated, so one key hitting its quota isn't fatal. */
  geminiApiKeys: z
    .array(z.string().min(1))
    .min(1, "At least one Gemini API key is required"),
  geminiModel: z.string().min(1).default("gemini-2.5-flash"),
  /** How long an exhausted key sits out before being retried. */
  geminiKeyCooldownMs: intFromEnv(65_000),

  /** Rejected above this many pages per uploaded document. */
  maxPagesPerDocument: intFromEnv(20),
  /** Rejected above this size, per uploaded page image. */
  maxPageBytes: intFromEnv(8 * 1024 * 1024),
  /** Decompression-bomb guard: total pixels in a single page raster. */
  maxPagePixels: intFromEnv(40_000_000),

  /** Max simultaneous in-flight model calls. Free tiers have low RPM. */
  aiConcurrency: intFromEnv(2),
  /** Model calls are retried this many times after the first attempt. */
  aiMaxRetries: z.coerce.number().int().min(0).default(2),
  /**
   * Zero by default. Extraction is transcription, not reasoning, and the extra
   * latency was causing upstream 503s on multi-page sheets.
   */
  aiThinkingBudget: z.coerce.number().int().min(0).default(0),

  /** Disk cache of model responses, keyed by input hash. */
  cacheEnabled: z
    .string()
    .optional()
    .transform((v) => v !== "false")
    .pipe(z.boolean()),
  cacheDir: z.string().default(".cache/ai"),

  /** Sessions older than this are evicted from the in-memory store. */
  sessionTtlMs: intFromEnv(60 * 60 * 1000),

  /** Root directory for rasterized page images, when using local disk. */
  fileStoreDir: z.string().default(".data/files"),

  // Present on serverless, absent locally. Absence is not an error: in-memory
  // and on-disk are correct for a single long-lived process.
  redisUrl: z.string().url().optional(),
  redisToken: z.string().min(1).optional(),
  blobToken: z.string().min(1).optional(),
  /** Private: these are photos of someone's exam script. */
  blobAccess: z.enum(["private", "public"]).default("private"),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;

  const parsed = ConfigSchema.safeParse({
    geminiApiKeys: collectApiKeys(process.env),
    geminiModel: process.env.GEMINI_MODEL,
    geminiKeyCooldownMs: process.env.GEMINI_KEY_COOLDOWN_MS,
    maxPagesPerDocument: process.env.MAX_PAGES_PER_DOCUMENT,
    maxPageBytes: process.env.MAX_PAGE_BYTES,
    maxPagePixels: process.env.MAX_PAGE_PIXELS,
    aiConcurrency: process.env.AI_CONCURRENCY,
    aiMaxRetries: process.env.AI_MAX_RETRIES,
    aiThinkingBudget: process.env.AI_THINKING_BUDGET,
    cacheEnabled: process.env.AI_CACHE_ENABLED,
    cacheDir: process.env.AI_CACHE_DIR,
    sessionTtlMs: process.env.SESSION_TTL_MS,
    fileStoreDir: process.env.FILE_STORE_DIR,
    ...resolveRedisCredentials(process.env),
    blobToken: process.env.BLOB_READ_WRITE_TOKEN || undefined,
    blobAccess: process.env.BLOB_ACCESS,
  });

  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid server configuration — ${detail}`);
  }

  cached = parsed.data;
  return cached;
}

/**
 * Vercel injects `UPSTASH_REDIS_REST_*` via the Marketplace integration and
 * `KV_REST_API_*` via the older KV product, depending on how the store was
 * added. Accept both rather than find out mid-deploy.
 */
export function resolveRedisCredentials(
  env: Record<string, string | undefined>,
): { redisUrl: string | undefined; redisToken: string | undefined } {
  const pairs: [string | undefined, string | undefined][] = [
    [env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN],
    [env.KV_REST_API_URL, env.KV_REST_API_TOKEN],
    [env.REDIS_REST_URL, env.REDIS_REST_TOKEN],
  ];

  for (const [url, token] of pairs) {
    // Both halves are required; a URL without its token is not usable and
    // should not shadow a complete pair further down the list.
    if (url?.trim() && token?.trim()) {
      return { redisUrl: url.trim(), redisToken: token.trim() };
    }
  }

  return { redisUrl: undefined, redisToken: undefined };
}

/**
 * Reads keys from `GEMINI_API_KEY`, `GEMINI_API_KEYS` (comma-separated) or
 * `GEMINI_API_KEY_1..N`. Deduplicated, so a key listed twice doesn't take a
 * double share of traffic.
 */
export function collectApiKeys(
  env: Record<string, string | undefined>,
): string[] {
  const found: string[] = [];

  const single = env.GEMINI_API_KEY?.trim();
  if (single) found.push(single);

  for (const part of (env.GEMINI_API_KEYS ?? "").split(",")) {
    const key = part.trim();
    if (key) found.push(key);
  }

  // Numbered keys are sorted numerically so KEY_10 does not sort before KEY_2.
  const numbered = Object.keys(env)
    .map((name) => /^GEMINI_API_KEY_(\d+)$/.exec(name))
    .filter((match): match is RegExpExecArray => match !== null)
    .sort((a, b) => Number(a[1]) - Number(b[1]));

  for (const match of numbered) {
    const key = env[match[0]]?.trim();
    if (key) found.push(key);
  }

  return [...new Set(found)];
}

/** Test seam: forces the next `getConfig()` to re-read `process.env`. */
export function resetConfigForTests(): void {
  cached = null;
}

export { PUBLIC_LIMITS } from "./limits";
