import type { AiProvider, PageImage } from "@/lib/ai/provider";
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
 * Stages are sequential rather than parallel so the reported status always
 * names exactly one thing in progress — the upload UI shows real per-stage
 * progress, and a failure points at one stage instead of two.
 *
 * Only extraction failures are fatal. Match inference is a refinement on top of
 * label matching, so when it fails the run continues with what the cheap passes
 * resolved and records a recovered error.
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

    const questions = await stage(
      deps,
      sessionId,
      "extracting_questions",
      () => deps.provider.extractQuestions(questionImages, log),
    );
    await patch(deps.sessions, sessionId, (current) => ({
      ...current,
      questions,
    }));
    log.info("Questions extracted", { count: questions.length });

    const answers = await stage(
      deps,
      sessionId,
      "extracting_answers",
      async () => {
        const pageBlocks = await deps.provider.extractAnswers(
          answerImages,
          log,
        );
        return mergeAnswerBlocks(pageBlocks);
      },
    );
    await patch(deps.sessions, sessionId, (current) => ({
      ...current,
      answers,
    }));
    log.info("Answers extracted", { count: answers.length });

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

    // Best-effort: if the session is already gone there is nobody to tell.
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
      // Degrading to "these answers are unmatched" is far better than failing
      // the whole run, and the user still sees every label-matched answer.
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
      stage: appError.stage === "unknown" ? statusToStage(status) : appError.stage,
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
