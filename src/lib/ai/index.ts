import { GoogleGenAI } from "@google/genai";

import { getConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { DiskResponseCache, NullResponseCache } from "./cache";
import { GeminiProvider } from "./gemini";
import { RoundRobinKeyPool } from "./key-pool";
import { createLimiter } from "./limiter";
import type { AiProvider } from "./provider";

export type {
  AiProvider,
  InferredMatch,
  PageAnswerBlock,
  PageImage,
} from "./provider";

/**
 * Provider wiring — the only place that names a concrete model vendor.
 *
 * Pinned to `globalThis` so the limiter's concurrency budget and the client's
 * connection pool are shared process-wide rather than reset on each hot reload.
 */

const GLOBAL_KEY = Symbol.for("veda-ai.provider");
type GlobalWithProvider = typeof globalThis & { [GLOBAL_KEY]?: AiProvider };

function build(): AiProvider {
  const config = getConfig();

  logger.info("AI provider configured", {
    model: config.geminiModel,
    keyPoolSize: config.geminiApiKeys.length,
  });

  return new GeminiProvider({
    createClient: (apiKey) => new GoogleGenAI({ apiKey }),
    keys: new RoundRobinKeyPool(
      config.geminiApiKeys,
      config.geminiKeyCooldownMs,
    ),
    model: config.geminiModel,
    cache: config.cacheEnabled
      ? new DiskResponseCache(config.cacheDir)
      : new NullResponseCache(),
    limiter: createLimiter(config.aiConcurrency),
    maxRetries: config.aiMaxRetries,
    thinkingBudget: config.aiThinkingBudget,
  });
}

export function getAiProvider(): AiProvider {
  const globalRef = globalThis as GlobalWithProvider;
  globalRef[GLOBAL_KEY] ??= build();
  return globalRef[GLOBAL_KEY];
}
