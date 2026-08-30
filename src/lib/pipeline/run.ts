import type { AiProvider, PageFailure, PageImage } from "@/lib/ai/provider";
import { AppError, type ErrorStage, toAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type { FileStore, SessionStore } from "@/lib/store";
import type {
  AnswerBlock,
  PageRef,
  Question,
  SessionResult,
  SessionStatus,
} from "@/lib/types";

import { mergeAnswerBlocks } from "./merge-answers";
import {
  answersNeedingInference,
  buildMappings,
  matchByLabel,
  matchByPosition,
} from "./mapping";

export type PipelineDeps = {
  provider: AiProvider;
  sessions: SessionStore;
  files: FileStore;
};

/**
 * Runs a session end to end.
 *
 * Stages are sequential so the reported status names exactly one thing in
 * progress and a failure points at one stage. Only extraction is fatal:
 * inference is a refinement, so its failure is recorded and the run continues.
 */
export async function runPipeline(
  sessionId: string,
  deps: PipelineDeps,
): Promise<void> {
  const log = logger.child({ sessionId });
  const startedAt = Date.now();

  try {
    const session = await deps.sessions.get(sessionId);
    if (!session) {
      log.warn("Session vanished before the pipeline started");
      return;
    }

    log.info("Pipeline started", {
      questionPages: session.questionPages.length,
      answerPages: session.answerPages.length,
    });

    const [questionImages, answerImages] = await Promise.all([
      loadPages(deps.files, session.questionPages),
      loadPages(deps.files, session.answerPages),
    ]);

    const questionResult = await stage(
      deps,
      sessionId,
      "extracting_questions",
      () => deps.provider.extractQuestions(questionImages, log),
    );
    assertNotTotalFailure(
      questionResult.failedPages,
      questionImages.length,
      "extract_questions",
      "the question paper",
    );
    await recordPageFailures(
      deps,
      sessionId,
      "extract_questions",
      "question paper",
      questionResult.failedPages,
    );

    const questions = questionResult.items;
    await patch(deps.sessions, sessionId, (current) => ({
      ...current,
      questions,
    }));
    log.info("Questions extracted", {
      count: questions.length,
      failedPages: questionResult.failedPages.length,
    });

    const answerResult = await stage(
      deps,
      sessionId,
      "extracting_answers",
      () => deps.provider.extractAnswers(answerImages, log),
    );
    assertNotTotalFailure(
      answerResult.failedPages,
      answerImages.length,
      "extract_answers",
      "the answer sheet",
    );
    await recordPageFailures(
      deps,
      sessionId,
      "extract_answers",
      "answer sheet",
      answerResult.failedPages,
    );

    // After the failure check, so a dropped page can't look like an answer
    // that simply ended early.
    const answers = mergeAnswerBlocks(answerResult.items);
    await patch(deps.sessions, sessionId, (current) => ({
      ...current,
      answers,
    }));
    log.info("Answers extracted", {
      count: answers.length,
      failedPages: answerResult.failedPages.length,
    });

    const mappings = await stage(deps, sessionId, "mapping", () =>
      mapAnswers(deps, sessionId, questions, answers, log),
    );

    await patch(deps.sessions, sessionId, (current) => ({
      ...current,
      mappings,
      status: "done",
    }));

    log.info("Pipeline finished", {
      durationMs: Date.now() - startedAt,
      questions: questions.length,
      answers: answers.length,
      unanswered: mappings.filter(
        (m) => m.questionId !== null && m.answerBlockIds.length === 0,
      ).length,
      unmatchedAnswers: mappings.filter((m) => m.questionId === null).length,
    });
  } catch (error) {
    const appError = toAppError(error, "unknown");
    log.error("Pipeline failed", {
      err: appError,
      durationMs: Date.now() - startedAt,
    });

    // Best effort: if the session is gone there's nobody to tell.
    await patch(deps.sessions, sessionId, (current) => ({
      ...current,
      status: "failed",
      errors: [
        ...current.errors,
        {
          stage: appError.stage,
          message: appError.message,
          recovered: false,
        },
      ],
    })).catch(() => undefined);
  }
}

async function mapAnswers(
  deps: PipelineDeps,
  sessionId: string,
  questions: Question[],
  answers: AnswerBlock[],
  log: ReturnType<typeof logger.child>,
) {
  const { assignments: labelled } = matchByLabel(questions, answers);
  const positional = matchByPosition(questions, answers, labelled);
  const remaining = answersNeedingInference(answers, labelled, positional);

  log.info("Cheap matching passes complete", {
    labelled: labelled.size,
    positional: positional.size,
    needingInference: remaining.length,
  });

  let inferred: Awaited<ReturnType<AiProvider["inferMatches"]>> = [];
  if (remaining.length > 0) {
    try {
      inferred = await deps.provider.inferMatches(questions, remaining, log);
    } catch (error) {
      // Better to leave these unmatched than to fail the whole run.
      const appError = toAppError(error, "mapping");
      log.warn("Match inference failed, continuing without it", {
        err: appError,
      });
      await patch(deps.sessions, sessionId, (current) => ({
        ...current,
        errors: [
          ...current.errors,
          {
            stage: "mapping",
            message: `Could not infer matches for ${remaining.length} unlabelled answer(s): ${appError.message}`,
            recovered: true,
          },
        ],
      })).catch(() => undefined);
    }
  }

  return buildMappings({
    questions,
    answers,
    labelled,
    positional,
    inferred,
  });
}

/**
 * Losing one page of ten is a degraded result worth showing. Losing every page
 * means there is no result, and showing an empty paper would be a lie.
 */
function assertNotTotalFailure(
  failures: PageFailure[],
  pageCount: number,
  stageName: ErrorStage,
  documentLabel: string,
): void {
  if (pageCount === 0 || failures.length < pageCount) return;
  throw new AppError(
    `Could not read any page of ${documentLabel}. ${failures[0]?.message ?? ""}`.trim(),
    { stage: stageName, code: "all_pages_failed" },
  );
}

/** Unreadable pages become recovered errors the UI surfaces. */
async function recordPageFailures(
  deps: PipelineDeps,
  sessionId: string,
  stageName: ErrorStage,
  documentLabel: string,
  failures: PageFailure[],
): Promise<void> {
  if (failures.length === 0) return;

  const pages = failures.map((failure) => failure.page + 1).join(", ");
  await patch(deps.sessions, sessionId, (current) => ({
    ...current,
    errors: [
      ...current.errors,
      {
        stage: stageName,
        message: `Could not read ${documentLabel} page ${pages}. Results below are missing whatever was on ${failures.length > 1 ? "those pages" : "that page"}.`,
        recovered: true,
      },
    ],
  })).catch(() => undefined);
}

/** Sets the session status, runs the stage, and tags failures with it. */
async function stage<T>(
  deps: PipelineDeps,
  sessionId: string,
  status: SessionStatus,
  work: () => Promise<T>,
): Promise<T> {
  await patch(deps.sessions, sessionId, (current) => ({ ...current, status }));
  try {
    return await work();
  } catch (error) {
    const appError = toAppError(error, "unknown");
    throw new AppError(appError.message, {
      stage:
        appError.stage === "unknown" ? statusToStage(status) : appError.stage,
      code: appError.code,
      httpStatus: appError.httpStatus,
      cause: appError,
    });
  }
}

const patch = (
  sessions: SessionStore,
  sessionId: string,
  mutate: (current: SessionResult) => SessionResult,
) => sessions.update(sessionId, mutate);

function statusToStage(status: SessionStatus): ErrorStage {
  switch (status) {
    case "extracting_questions":
      return "extract_questions";
    case "extracting_answers":
      return "extract_answers";
    case "mapping":
      return "mapping";
    default:
      return "unknown";
  }
}

async function loadPages(
  files: FileStore,
  refs: PageRef[],
): Promise<PageImage[]> {
  return Promise.all(
    refs.map(async (ref) => {
      const stored = await files.read(ref.storageKey);
      if (!stored) {
        throw new AppError(`Page ${ref.index} is missing from storage`, {
          stage: "ingest",
          code: "page_missing",
        });
      }
      return {
        index: ref.index,
        bytes: stored.bytes,
        mimeType: stored.contentType,
      };
    }),
  );
}
