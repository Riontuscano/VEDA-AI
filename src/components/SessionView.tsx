"use client";

import { ArrowLeft, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchResult, fetchStatus } from "@/lib/client/api";
import type {
  LocatedBox,
  SessionResultPayload,
  SessionStatusPayload,
} from "@/lib/types";

import { AnswerSheetView } from "./AnswerSheetView";
import { AppHeader } from "./AppHeader";
import { ProgressPanel } from "./ProgressPanel";
import { QuestionList, type Selection } from "./QuestionList";

const POLL_INTERVAL_MS = 1000;

/**
 * Owns one session: polls it while the pipeline runs, then shows the viewer.
 *
 * Polling rather than SSE. The status payload is tiny, and polling needs no
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

  const handleSelect = useCallback((next: Selection) => setSelection(next), []);

  if (error) {
    return (
      <>
        <AppHeader />
        <div className="grid flex-1 place-items-center p-6">
          <div className="max-w-sm text-center">
            <p role="alert" className="text-[13px] text-[var(--danger)]">
              {error}
            </p>
            <Link
              href="/"
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] text-[var(--accent)]"
            >
              <ArrowLeft size={13} weight="bold" />
              Start over
            </Link>
          </div>
        </div>
      </>
    );
  }

  if (!result) {
    return (
      <>
        <AppHeader />
        <div className="grid flex-1 place-items-center p-6">
          <div className="flex flex-col items-center">
            <ProgressPanel
              status={status?.status ?? "uploading"}
              errors={status?.errors ?? []}
            />
            {status?.status === "failed" && (
              <Link
                href="/"
                className="mt-6 inline-flex items-center gap-1.5 self-start text-[13px] text-[var(--accent)]"
              >
                <ArrowLeft size={13} weight="bold" />
                Start over
              </Link>
            )}
          </div>
        </div>
      </>
    );
  }

  const answered = result.mappings.filter(
    (mapping) =>
      mapping.questionId !== null && mapping.answerBlockIds.length > 0,
  ).length;
  const orphans = result.mappings.filter(
    (mapping) => mapping.questionId === null,
  ).length;
  const recovered = result.errors.filter((entry) => entry.recovered);

  return (
    <>
      <AppHeader>
        <dl className="flex items-center gap-4 font-mono text-[11px] text-[var(--text-tertiary)]">
          <Stat label="questions" value={result.questions.length} />
          <Stat label="answered" value={answered} />
          {orphans > 0 && <Stat label="unmatched" value={orphans} />}
        </dl>
        <Link
          href="/"
          className="text-[12.5px] text-[var(--accent)] hover:underline"
        >
          New upload
        </Link>
      </AppHeader>

      {recovered.length > 0 && (
        <div
          role="status"
          className="flex items-start gap-2 border-b border-[var(--highlight)]/25 bg-[var(--highlight-wash)] px-4 py-2"
        >
          <Warning
            size={14}
            weight="fill"
            className="mt-px shrink-0 text-[var(--highlight)]"
          />
          <div className="min-w-0 text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            {recovered.map((entry, index) => (
              <p key={index}>{entry.message}</p>
            ))}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex min-h-0 w-full shrink-0 flex-col border-b border-[var(--border-subtle)] bg-[var(--surface-raised)] lg:h-auto lg:w-[26rem] lg:border-b-0 lg:border-r">
          <QuestionList
            questions={result.questions}
            answers={result.answers}
            mappings={result.mappings}
            selection={selection}
            onSelect={handleSelect}
          />
        </aside>

        <main className="min-h-[60vh] min-w-0 flex-1 lg:min-h-0">
          <AnswerSheetView
            pages={result.answerPages}
            highlights={highlights}
            selectionKey={selectionKey}
          />
        </main>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="uppercase tracking-[0.04em]">{label}</dt>
      <dd className="font-medium text-[var(--text-primary)]">{value}</dd>
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
