import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";

import { ModelError, SchemaError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { formatLabel, labelToId, parseLabel } from "@/lib/pipeline/labels";
import type { Question } from "@/lib/types";

import { computeCacheKey, type ResponseCache } from "./cache";
import {
  fromGeminiBox,
  pageFallbackBox,
  readingOrderCompare,
} from "./geometry";
import type { KeyPool } from "./key-pool";
import type { Limiter } from "./limiter";
import {
  ANSWER_EXTRACTION_PROMPT,
  correctiveSuffix,
  MATCH_INFERENCE_PROMPT,
  PROMPT_VERSION,
  QUESTION_EXTRACTION_PROMPT,
} from "./prompts";
import {
  RawAnswerPageSchema,
  RawMatchListSchema,
  RawQuestionPageSchema,
  toModelSchema,
} from "./schemas";
import type {
  AiProvider,
  ExtractionResult,
  InferredMatch,
  PageAnswerBlock,
  PageFailure,
  PageImage,
} from "./provider";

/** Keeps the inference prompt inside a sane token budget. */
const QUESTION_TEXT_BUDGET = 400;
const ANSWER_TEXT_BUDGET = 800;

export type GeminiProviderDeps = {
  /** Builds (or returns a cached) client for one API key. */
  createClient: (apiKey: string) => GoogleGenAI;
  keys: KeyPool;
  model: string;
  cache: ResponseCache;
  limiter: Limiter;
  maxRetries: number;
  thinkingBudget: number;
};

export class GeminiProvider implements AiProvider {
  /** One client per key, built on first use and reused thereafter. */
  private readonly clients = new Map<string, GoogleGenAI>();

  constructor(private readonly deps: GeminiProviderDeps) {}

  private clientFor(apiKey: string): GoogleGenAI {
    let client = this.clients.get(apiKey);
    if (!client) {
      client = this.deps.createClient(apiKey);
      this.clients.set(apiKey, client);
    }
    return client;
  }

  async extractQuestions(
    pages: PageImage[],
    log: Logger,
  ): Promise<ExtractionResult<Question>> {
    const perPage = await this.mapPages(pages, log, async (page) => {
      const result = await this.callJson({
        prompt: QUESTION_EXTRACTION_PROMPT,
        images: [page],
        schema: RawQuestionPageSchema,
        operation: "extract_questions",
        log: log.child({ page: page.index }),
      });

      return result.questions.map((raw, indexOnPage) => {
        const box = fromGeminiBox(raw.box_2d, page.index);
        if (!box) {
          log.warn("Question box unusable, falling back to full page", {
            page: page.index,
            label: raw.label,
            rawBox: raw.box_2d,
          });
        }

        const path = parseLabel(raw.label);
        return {
          // Still a real question, so keep it with a positional id.
          id: path ? labelToId(path) : `q-p${page.index}-${indexOnPage}`,
          labelPath: path ?? [],
          label: path ? formatLabel(path) : raw.label.trim() || "(unlabelled)",
          text: raw.text.trim(),
          order: 0,
          page: page.index,
          box: box ?? pageFallbackBox(page.index),
        } satisfies Question;
      });
    });

    return {
      items: finalizeQuestions(perPage.items.flat(), log),
      failedPages: perPage.failedPages,
    };
  }

  async extractAnswers(
    pages: PageImage[],
    log: Logger,
  ): Promise<ExtractionResult<PageAnswerBlock>> {
    const perPage = await this.mapPages(pages, log, async (page) => {
      const result = await this.callJson({
        prompt: ANSWER_EXTRACTION_PROMPT,
        images: [page],
        schema: RawAnswerPageSchema,
        operation: "extract_answers",
        log: log.child({ page: page.index }),
      });

      return result.answers.map((raw, indexOnPage) => {
        const box = fromGeminiBox(raw.box_2d, page.index);
        if (!box) {
          log.warn("Answer box unusable, falling back to full page", {
            page: page.index,
            rawLabel: raw.raw_label,
            rawBox: raw.box_2d,
          });
        }

        const label = raw.raw_label.trim();
        return {
          id: `a-p${page.index}-${indexOnPage}`,
          rawLabel: label === "" ? null : label,
          text: raw.text.trim(),
          boxes: [box ?? pageFallbackBox(page.index)],
          confidence: clamp01(raw.confidence),
          page: page.index,
          continuesPreviousPage: raw.continues_previous_page,
        } satisfies PageAnswerBlock;
      });
    });

    return { items: perPage.items.flat(), failedPages: perPage.failedPages };
  }

  /**
   * `allSettled`, not `all`: pages are independent calls, and one page hitting
   * an overloaded server must not discard the pages that succeeded.
   */
  private async mapPages<T>(
    pages: PageImage[],
    log: Logger,
    extract: (page: PageImage) => Promise<T[]>,
  ): Promise<ExtractionResult<T[]>> {
    const settled = await Promise.allSettled(
      pages.map(async (page) => extract(page)),
    );

    const items: T[][] = [];
    const failedPages: PageFailure[] = [];

    settled.forEach((outcome, index) => {
      const pageNumber = pages[index]?.index ?? index;
      if (outcome.status === "fulfilled") {
        items.push(outcome.value);
        return;
      }
      const message =
        outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason);
      log.error("Page extraction failed after retries", {
        page: pageNumber,
        err: outcome.reason,
      });
      failedPages.push({ page: pageNumber, message });
    });

    return { items, failedPages };
  }

  async inferMatches(
    questions: Question[],
    answers: { id: string; text: string }[],
    log: Logger,
  ): Promise<InferredMatch[]> {
    if (questions.length === 0 || answers.length === 0) return [];

    const payload = {
      questions: questions.map((q) => ({
        id: q.id,
        label: q.label,
        text: truncate(q.text, QUESTION_TEXT_BUDGET),
      })),
      answers: answers.map((a) => ({
        id: a.id,
        text: truncate(a.text, ANSWER_TEXT_BUDGET),
      })),
    };

    const result = await this.callJson({
      prompt: `${MATCH_INFERENCE_PROMPT}\n\nInput:\n${JSON.stringify(payload)}`,
      images: [],
      schema: RawMatchListSchema,
      operation: "infer_matches",
      log,
    });

    const questionIds = new Set(questions.map((q) => q.id));
    const answerIds = new Set(answers.map((a) => a.id));

    return (
      result.matches
        // The model occasionally echoes ids it was not given; those would create
        // mappings pointing at nothing, so they are dropped rather than trusted.
        .filter((match) => answerIds.has(match.answer_id))
        .map((match) => ({
          answerBlockId: match.answer_id,
          questionId: questionIds.has(match.question_id)
            ? match.question_id
            : null,
          confidence: clamp01(match.confidence),
        }))
    );
  }

  /**
   * One model call returning schema-validated JSON. Layers outermost first:
   * cache, concurrency limiter, backoff retry, and one corrective retry when
   * the payload parses but fails the schema.
   */
  private async callJson<T>(args: {
    prompt: string;
    images: PageImage[];
    schema: z.ZodType<T>;
    operation: string;
    log: Logger;
  }): Promise<T> {
    const { prompt, images, schema, operation, log } = args;
    const modelSchema = toModelSchema(schema);

    const cacheKey = computeCacheKey([
      this.deps.model,
      PROMPT_VERSION,
      operation,
      prompt,
      JSON.stringify(modelSchema),
      ...images.map((image) => image.bytes),
    ]);

    const cached = await this.deps.cache.get(cacheKey);
    if (cached) {
      const parsed = safeParseJson(schema, cached);
      if (parsed.ok) {
        log.debug("Model cache hit", { operation });
        return parsed.value;
      }
      // Schema changed since this was cached. Overwrite it.
      log.warn("Discarding stale cache entry", { operation });
    }

    let corrective = "";
    let attempt = 0;
    // Rotations get their own budget. Moving to a different key isn't a retry
    // of the same call, and charging it as one made a pool of ten give up
    // after two.
    let rotations = 0;
    const maxRotations = this.deps.keys.size;

    for (;;) {
      const startedAt = Date.now();
      try {
        const text = await this.deps.limiter(() =>
          this.generate(prompt + corrective, images, modelSchema),
        );

        const parsed = safeParseJson(schema, text);
        if (!parsed.ok) {
          throw new SchemaError(
            `Model response failed validation: ${parsed.error}`,
          );
        }

        await this.deps.cache.set(cacheKey, text);
        log.info("Model call succeeded", {
          operation,
          attempt,
          durationMs: Date.now() - startedAt,
        });
        return parsed.value;
      } catch (error) {
        // Checked before the retry budget: a spent budget says nothing about
        // whether a different key would work. Quota and credential failures
        // belong to one key, so waiting doesn't help.
        if (
          error instanceof ModelError &&
          error.isKeyExhausted &&
          error.apiKey
        ) {
          this.deps.keys.penalize(
            error.apiKey,
            `status ${error.upstreamStatus}`,
            log,
          );
          if (this.deps.keys.size > 1 && rotations < maxRotations) {
            rotations += 1;
            log.info("Rotating to another API key", {
              operation,
              rotations,
              maxRotations,
            });
            continue;
          }
        }

        const isRetryable =
          error instanceof ModelError || error instanceof SchemaError;

        if (!isRetryable || attempt >= this.deps.maxRetries) {
          log.error("Model call failed", {
            operation,
            attempt,
            rotations,
            err: error,
          });
          throw error;
        }

        if (error instanceof SchemaError) {
          corrective = correctiveSuffix(error.message);
        }

        attempt += 1;
        const overloaded =
          error instanceof ModelError && error.isUpstreamOverloaded;
        const delayMs = backoffMs(attempt, overloaded);
        log.warn("Model call failed, retrying", {
          operation,
          attempt,
          delayMs,
          overloaded,
          err: error,
        });
        await sleep(delayMs);
      }
    }
  }

  private async generate(
    prompt: string,
    images: PageImage[],
    responseJsonSchema: Record<string, unknown>,
  ): Promise<string> {
    const apiKey = this.deps.keys.next();

    let response;
    try {
      response = await this.clientFor(apiKey).models.generateContent({
        model: this.deps.model,
        contents: [
          {
            role: "user",
            parts: [
              ...images.map((image) => ({
                inlineData: {
                  mimeType: image.mimeType,
                  data: Buffer.from(image.bytes).toString("base64"),
                },
              })),
              { text: prompt },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema,
          // Extraction is a transcription task; sampling variation is pure
          // downside, and it also makes the response cache far more effective.
          temperature: 0,
          thinkingConfig: { thinkingBudget: this.deps.thinkingBudget },
        },
      });
    } catch (error) {
      throw new ModelError(
        error instanceof Error ? error.message : String(error),
        {
          cause: error,
          upstreamStatus: extractUpstreamStatus(error),
          // Carried so the retry loop knows which key to sideline.
          apiKey,
        },
      );
    }

    const text = response.text;
    if (!text) {
      // Usually a safety block or truncation. Both are worth a retry.
      throw new ModelError("Model returned an empty response");
    }
    return text;
  }
}

/**
 * Assigns printed reading order and drops duplicate ids. Order comes from box
 * position: per-page calls have no shared view of the document.
 */
function finalizeQuestions(questions: Question[], log: Logger): Question[] {
  const sorted = [...questions].sort((a, b) =>
    readingOrderCompare(a.box, b.box),
  );

  const seen = new Set<string>();
  const unique: Question[] = [];

  for (const question of sorted) {
    if (seen.has(question.id)) {
      log.warn("Dropped duplicate question label", {
        id: question.id,
        page: question.page,
      });
      continue;
    }
    seen.add(question.id);
    unique.push({ ...question, order: unique.length });
  }

  return unique;
}

type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

function safeParseJson<T>(schema: z.ZodType<T>, text: string): ParseOutcome<T> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `not valid JSON (${error instanceof Error ? error.message : error})`,
    };
  }

  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return { ok: false, error: detail };
  }
  return { ok: true, value: parsed.data };
}

const clamp01 = (value: number): number =>
  Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

/**
 * Jittered backoff so parallel pages don't retry in lockstep. An overloaded
 * upstream waits far longer: retrying a busy server after half a second just
 * produces three fast failures.
 */
function backoffMs(attempt: number, overloaded = false): number {
  const base = overloaded ? 4000 : 500;
  const jitter = Math.floor(Math.random() * base * 0.5);
  return 2 ** attempt * base + jitter;
}

/** The SDK stringifies a JSON body into the message. */
function extractUpstreamStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return status;

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  return match?.[1] ? Number(match[1]) : undefined;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
