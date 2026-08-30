"use client";

import type { SessionResultPayload, SessionStatusPayload } from "@/lib/types";
import { rasterizeFiles, type RasterizedPage } from "./rasterize";

/** Typed client for the session API. */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export type UploadStage =
  | { kind: "rasterizing"; label: string; completed: number; total: number }
  | { kind: "uploading" };

export async function createSession(
  questionFiles: File[],
  answerFiles: File[],
  onStage?: (stage: UploadStage) => void,
): Promise<string> {
  const questionPages = await rasterizeFiles(questionFiles, (progress) =>
    onStage?.({ kind: "rasterizing", label: "question paper", ...progress }),
  );
  const answerPages = await rasterizeFiles(answerFiles, (progress) =>
    onStage?.({ kind: "rasterizing", label: "answer sheet", ...progress }),
  );

  onStage?.({ kind: "uploading" });

  const form = new FormData();
  form.set(
    "meta",
    JSON.stringify({
      questionPages: questionPages.map(toMeta),
      answerPages: answerPages.map(toMeta),
    }),
  );
  appendPages(form, "questionPages", questionPages);
  appendPages(form, "answerPages", answerPages);

  const response = await fetch("/api/sessions", {
    method: "POST",
    body: form,
  });
  const body = await readJson<{ sessionId: string }>(response);
  return body.sessionId;
}

export async function fetchStatus(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionStatusPayload> {
  const response = await fetch(`/api/sessions/${sessionId}/status`, {
    signal: signal ?? null,
  });
  return readJson<SessionStatusPayload>(response);
}

export async function fetchResult(
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionResultPayload> {
  const response = await fetch(`/api/sessions/${sessionId}/result`, {
    signal: signal ?? null,
  });
  return readJson<SessionResultPayload>(response);
}

const toMeta = (page: RasterizedPage) => ({
  width: page.width,
  height: page.height,
});

function appendPages(
  form: FormData,
  field: string,
  pages: RasterizedPage[],
): void {
  pages.forEach((page, index) => {
    form.append(field, page.blob, `${field}-${index}.png`);
  });
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();

  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(
      `Server returned an unreadable response (${response.status}).`,
      "bad_response",
    );
  }

  if (!response.ok) {
    const error = (parsed as { error?: { message?: string; code?: string } })
      ?.error;
    throw new ApiError(
      error?.message ?? `Request failed (${response.status}).`,
      error?.code ?? "request_failed",
    );
  }

  return parsed as T;
}
