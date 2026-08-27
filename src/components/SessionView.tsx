"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchResult, fetchStatus } from "@/lib/client/api";
import type {
  LocatedBox,
  SessionResultPayload,
  SessionStatusPayload,
} from "@/lib/types";

import { AnswerSheetView } from "./AnswerSheetView";
import { ProgressPanel } from "./ProgressPanel";
import { QuestionList, type Selection } from "./QuestionList";

const POLL_INTERVAL_MS = 1000;

/**
 * Owns one session: polls it while the pipeline runs, then shows the viewer.
 *
 * Polling rather than SSE — the status payload is tiny, and polling needs no
 * reconnect handling and survives proxies that buffer streamed responses.
 */
export function SessionView({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<SessionStatusPayload | null>(null);
  const [result, setResult] = useState<SessionResultPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    async function poll(): Promise<void> {
      try {
        const next = await fetchStatus(sessionId, controller.signal);
        if (cancelled) return;
        setStatus(next);

        if (next.status === "done") {
          const full = await fetchResult(sessionId, controller.signal);
          if (!cancelled) setResult(full);
          return;
        }
        if (next.status === "failed") return;

        timer = setTimeout(poll, POLL_INTERVAL_MS);
      } catch (caught) {
        if (cancelled || controller.signal.aborted) return;
        setError(
          caught instanceof Error
            ? caught.message
            : "Lost contact with the server.",
        );
      }
    }

    void poll();

    return () => {
      cancelled = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId]);

  const highlights = useMemo<LocatedBox[]>(
    () => resolveHighlights(result, selection),
    [result, selection],
  );

  const selectionKey = useMemo(() => {
    if (!selection) return null;
    return selection.kind === "question"
      ? `q:${selection.id}`
      : `a:${selection.answerId}`;
  }, [selection]);

  const handleSelect = useCallback(
    (next: Selection) => setSelection(next),
    [],
  );

  if (error) {
    return (
      <Centered>
        <p role="alert" className="text-sm text-red-800">
          {error}
        </p>
        <Link href="/" className="mt-3 inline-block text-sm text-blue-600">
          Start over
        </Link>
      </Centered>
    );
  }

  if (!result) {
    return (
      <Centered>
        <ProgressPanel
          status={status?.status ?? "uploading"}
          errors={status?.errors ?? []}
        />
        {status?.status === "failed" && (
          <Link href="/" className="mt-4 inline-block text-sm text-blue-600">
            Start over
          </Link>
        )}
      </Centered>
    );
  }

  const answered = result.mappings.filter(
    (mapping) => mapping.questionId !== null && mapping.answerBlockIds.length > 0,
  ).length;
  const orphans = result.mappings.filter(
    (mapping) => mapping.questionId === null,
  ).length;
  const recovered = result.errors.filter((entry) => entry.recovered);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-200 bg-white px-4 py-3">
        <h1 className="text-sm font-semibold text-slate-900">
          {result.questions.length} questions · {answered} answered
          {orphans > 0 && ` · ${orphans} unmatched`}
        </h1>
        <p className="text-xs text-slate-500">
          Select a question to highlight its answer.
        </p>
        <Link href="/" className="ml-auto text-xs text-blue-600">
          New upload
        </Link>
      </header>

      {recovered.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          {recovered.map((entry, index) => (
            <p key={index}>{entry.message}</p>
          ))}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="w-full max-w-md shrink-0 border-r border-slate-200 bg-white">
          <QuestionList
            questions={result.questions}
            answers={result.answers}
            mappings={result.mappings}
            selection={selection}
            onSelect={handleSelect}
          />
        </aside>

        <main className="min-w-0 flex-1">
          <AnswerSheetView
            pages={result.answerPages}
            highlights={highlights}
            selectionKey={selectionKey}
          />
        </main>
      </div>
    </div>
  );
}

/** Boxes to highlight for the current selection, or none when nothing is selected. */
function resolveHighlights(
  result: SessionResultPayload | null,
  selection: Selection,
): LocatedBox[] {
  if (!result || !selection) return [];

  const answersById = new Map(
    result.answers.map((answer) => [answer.id, answer]),
  );

  if (selection.kind === "orphan") {
    return answersById.get(selection.answerId)?.boxes ?? [];
  }

  const mapping = result.mappings.find(
    (candidate) => candidate.questionId === selection.id,
  );
  if (!mapping) return [];

  return mapping.answerBlockIds.flatMap(
    (id) => answersById.get(id)?.boxes ?? [],
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div>{children}</div>
    </div>
  );
}
