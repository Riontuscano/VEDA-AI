import type { Logger } from "@/lib/logger";
import type { AnswerBlock, Question } from "@/lib/types";

/** One rasterized page handed to the model. */
export type PageImage = {
  /** 0-indexed page within its document. */
  index: number;
  bytes: Uint8Array;
  mimeType: string;
};

export type InferredMatch = {
  answerBlockId: string;
  /** Null when no question on the paper plausibly matches. */
  questionId: string | null;
  confidence: number;
};

/** A page the model could not read, after its retries were exhausted. */
export type PageFailure = {
  page: number;
  message: string;
};

/**
 * Pages are independent calls, so one 503 must not discard the pages that
 * succeeded. Callers get what was extracted plus what was lost.
 */
export type ExtractionResult<T> = {
  items: T[];
  failedPages: PageFailure[];
};

/**
 * An answer block as seen on one page, before multi-page merging. Keeps the
 * merge heuristic a pure function in the pipeline rather than in the adapter.
 */
export type PageAnswerBlock = AnswerBlock & {
  page: number;
  /** Model's judgement that this continues an answer from the page before. */
  continuesPreviousPage: boolean;
};

/**
 * The AI seam. The pipeline depends only on this, so the provider is a config
 * choice, and a fake implementing it backs the tests without spending quota.
 */
export interface AiProvider {
  extractQuestions(
    pages: PageImage[],
    log: Logger,
  ): Promise<ExtractionResult<Question>>;
  extractAnswers(
    pages: PageImage[],
    log: Logger,
  ): Promise<ExtractionResult<PageAnswerBlock>>;
  /** Only called for answers whose written label was missing or unparseable. */
  inferMatches(
    questions: Question[],
    answers: AnswerBlock[],
    log: Logger,
  ): Promise<InferredMatch[]>;
}
