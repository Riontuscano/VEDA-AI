import { z } from "zod";

/**
 * Server-side configuration, validated once on first access.
 *
 * Lazy rather than module-load eager so that `next build` and unit tests do
 * not require a real API key — but any code path that actually needs config
 * fails loudly and immediately rather than passing `undefined` downstream.
 */

const intFromEnv = (fallback: number) =>
  z.coerce.number().int().positive().default(fallback);

const ConfigSchema = z.object({
  /**
   * One or more API keys. Several keys are pooled and rotated, which raises the
   * effective free-tier quota and makes a per-key exhaustion recoverable rather
   * than fatal.
   */
  geminiApiKeys: z.array(z.string().min(1)).min(1, "At least one Gemini API key is required"),
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
   * Thinking tokens per call. Zero by default: extraction is transcription and
   * layout work, not reasoning, and the extra latency was causing upstream 503
   * timeouts on multi-page sheets. Raise it if extraction quality needs it.
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

  /*
   * Optional managed backends.
   *
   * Present in a serverless deployment, absent locally. Their absence is not an
   * error: the in-memory and on-disk implementations are correct for a single
   * long-lived process, and requiring cloud credentials to run the app locally
   * would be a worse default.
   */
  redisUrl: z.string().url().optional(),
  redisToken: z.string().min(1).optional(),
  blobToken: z.string().min(1).optional(),
  /**
   * Private by default: page images are photographs of someone's exam script,
   * and a public store makes every page readable by anyone with the URL.
   * Override only if the connected store is configured for public access.
   */
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
 * Finds Redis credentials under either name Vercel might inject.
 *
 * The Marketplace Upstash integration sets `UPSTASH_REDIS_REST_*`, while the
 * older Vercel KV product sets `KV_REST_API_*`. Which one you get depends on
 * how the store was added, and discovering that during a deploy is a waste of
 * an afternoon, so both are accepted.
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
 * Gathers API keys from the three shapes people actually use, in order:
 *
 *   GEMINI_API_KEY          a single key
 *   GEMINI_API_KEYS         comma-separated list
 *   GEMINI_API_KEY_1..N     one per line, which is how they arrive from the
 *                           AI Studio console
 *
 * Duplicates are removed so a key listed twice does not get double the share of
 * traffic and hit its quota twice as fast.
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
