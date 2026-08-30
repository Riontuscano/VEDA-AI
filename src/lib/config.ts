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
  geminiApiKey: z.string().min(1, "GEMINI_API_KEY is required"),
  geminiModel: z.string().min(1).default("gemini-2.5-flash"),

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

  /** Root directory for rasterized page images. */
  fileStoreDir: z.string().default(".data/files"),
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

export function getConfig(): Config {
  if (cached) return cached;

  const parsed = ConfigSchema.safeParse({
    geminiApiKey: process.env.GEMINI_API_KEY,
    geminiModel: process.env.GEMINI_MODEL,
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

/** Test seam: forces the next `getConfig()` to re-read `process.env`. */
export function resetConfigForTests(): void {
  cached = null;
}

export { PUBLIC_LIMITS } from "./limits";
