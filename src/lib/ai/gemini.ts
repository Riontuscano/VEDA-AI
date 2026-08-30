import { GoogleGenAI } from "@google/genai";
import type { z } from "zod";

import { ModelError, SchemaError } from "@/lib/errors";
import type { Logger } from "@/lib/logger";
import { formatLabel, labelToId, parseLabel } from "@/lib/pipeline/labels";
import type { Question } from "@/lib/types";

import { computeCacheKey, type ResponseCache } from "./cache";
import { fromGeminiBox, pageFallbackBox, readingOrderCompare } from "./geometry";
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

/** Keeps the match-inference prompt well inside a sane token budget. */
const QUESTION_TEXT_BUDGET = 400;
const ANSWER_TEXT_BUDGET = 800;

export type GeminiProviderDeps = {
  client: GoogleGenAI;
  model: string;
  cache: ResponseCache;
  limiter: Limiter;
  maxRetries: number;
  thinkingBudget: number;
};

export class GeminiProvider implements AiProvider {
  constructor(private readonly deps: GeminiProviderDeps) {}

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
            // Unparseable labels still describe a real question, so they are
            // kept with a positional id rather than dropped.
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
   * Runs a per-page extraction, isolating failures.
   *
   * Uses `allSettled` rather than `all`: pages are independent calls, and one
   * page hitting an overloaded server must not throw away every page that
   * succeeded. A page that exhausts its retries becomes a reported failure, not
   * a dead run.
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

    return result.matches
      // The model occasionally echoes ids it was not given; those would create
      // mappings pointing at nothing, so they are dropped rather than trusted.
      .filter((match) => answerIds.has(match.answer_id))
      .map((match) => ({
        answerBlockId: match.answer_id,
        questionId: questionIds.has(match.question_id)
          ? match.question_id
          : null,
        confidence: clamp01(match.confidence),
      }));
  }

  /**
   * Single model call returning schema-validated JSON.
   *
   * Layers, outermost first: response cache, concurrency limiter, retry with
   * backoff for transport failures, and one corrective retry when the payload
   * parses as JSON but fails the schema.
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
      // A cache entry that no longer validates means the schema changed; fall
      // through to a live call and overwrite it.
      log.warn("Discarding stale cache entry", { operation });
    }

    let corrective = "";

    for (let attempt = 0; ; attempt += 1) {
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
        const isRetryable =
          error instanceof ModelError || error instanceof SchemaError;

        if (!isRetryable || attempt >= this.deps.maxRetries) {
          log.error("Model call failed", { operation, attempt, err: error });
          throw error;
        }

        if (error instanceof SchemaError) {
          corrective = correctiveSuffix(error.message);
        }

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
    let response;
    try {
      response = await this.deps.client.models.generateContent({
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
        { cause: error, upstreamStatus: extractUpstreamStatus(error) },
      );
    }

    const text = response.text;
    if (!text) {
      // Usually a safety block or a truncated response; both are worth one
      // retry, so this is a ModelError rather than a hard failure.
      throw new ModelError("Model returned an empty response");
    }
    return text;
  }
}

/**
 * Assigns printed reading order and removes duplicate ids.
 *
 * Order comes from page and box position, never from the model — per-page calls
 * have no shared view of the document and their own ordering is not consistent.
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

type ParseOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

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
 * Exponential backoff with jitter, so parallel pages do not retry in lockstep.
 *
 * An overloaded upstream (429/503) gets a much longer base delay. Retrying a
 * busy server after half a second just produces three fast failures — which is
 * exactly what a 503 on this pipeline used to look like.
 */
function backoffMs(attempt: number, overloaded = false): number {
  const base = overloaded ? 4000 : 500;
  const jitter = Math.floor(Math.random() * base * 0.5);
  return 2 ** attempt * base + jitter;
}

/** Digs the HTTP status out of the SDK's error, which stringifies a JSON body. */
function extractUpstreamStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  if (typeof status === "number") return status;

  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/"code"\s*:\s*(\d{3})/);
  return match?.[1] ? Number(match[1]) : undefined;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
