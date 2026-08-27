import type { Logger } from "@/lib/logger";
import type { AnswerBlock, Question } from "@/lib/types";

/** One rasterized page handed to the model. */
export type PageImage = {
  /** 0-indexed page within its document. */
  index: number;
  bytes: Uint8Array;
  mimeType: string;
};

/**
 * An answer block as seen on a single page, before multi-page merging.
 *
 * The provider returns these rather than finished `AnswerBlock`s so the merge
 * heuristic stays a pure function in the pipeline, unit-testable without a
 * model call.
 */
export type PageAnswerBlock = AnswerBlock & {
  /** Page this block was found on. */
  page: number;
  /** Model's judgement that this block continues an answer from the page before. */
  continuesPreviousPage: boolean;
};

export type InferredMatch = {
  answerBlockId: string;
  /** Null when no question on the paper plausibly matches. */
  questionId: string | null;
  confidence: number;
};

/**
 * The AI seam.
 *
 * The pipeline depends only on this interface, so the provider is a config
 * choice rather than a hard-wired dependency. `GeminiProvider` is the shipped
 * implementation; a fake implementing the same interface backs the pipeline
 * tests without spending quota.
 */
export interface AiProvider {
  extractQuestions(pages: PageImage[], log: Logger): Promise<Question[]>;
  extractAnswers(pages: PageImage[], log: Logger): Promise<PageAnswerBlock[]>;
  /**
   * Content-based fallback for answers whose written label is missing or does
   * not parse. Only called for blocks that label matching could not resolve.
   */
  inferMatches(
    questions: Question[],
    answers: AnswerBlock[],
    log: Logger,
  ): Promise<InferredMatch[]>;
}
