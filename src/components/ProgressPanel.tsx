"use client";

import type { PipelineError, SessionStatus } from "@/lib/types";

const STAGES: { status: SessionStatus; label: string }[] = [
  { status: "uploading", label: "Receiving pages" },
  { status: "extracting_questions", label: "Reading the question paper" },
  { status: "extracting_answers", label: "Reading the handwriting" },
  { status: "mapping", label: "Matching answers to questions" },
];

export type ProgressPanelProps = {
  status: SessionStatus;
  errors: PipelineError[];
};

/**
 * Per-stage progress for a running pipeline.
 *
 * Names the stage actually in progress rather than showing an undifferentiated
 * spinner — reading handwriting is the slow step, and saying so is the
 * difference between "working" and "stuck".
 */
export function ProgressPanel({ status, errors }: ProgressPanelProps) {
  const currentIndex = STAGES.findIndex((stage) => stage.status === status);
  const failed = status === "failed";
  const fatal = errors.filter((error) => !error.recovered);

  return (
    <div className="mx-auto max-w-lg rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-base font-semibold text-slate-900">
        {failed ? "Processing failed" : "Processing your upload"}
      </h2>

      <ol className="mt-4 space-y-3">
        {STAGES.map((stage, index) => {
          const state = failed
            ? index < currentIndex
              ? "done"
              : "pending"
            : index < currentIndex
              ? "done"
              : index === currentIndex
                ? "active"
                : "pending";

          return (
            <li key={stage.status} className="flex items-center gap-3">
              <span
                aria-hidden
                className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${
                  state === "done"
                    ? "bg-emerald-600"
                    : state === "active"
                      ? "animate-pulse bg-blue-600"
                      : "bg-slate-300"
                }`}
              >
                {state === "done" ? "✓" : index + 1}
              </span>
              <span
                className={`text-sm ${
                  state === "pending" ? "text-slate-400" : "text-slate-800"
                }`}
              >
                {stage.label}
                {state === "active" && "…"}
              </span>
            </li>
          );
        })}
      </ol>

      {fatal.length > 0 && (
        <div
          role="alert"
          className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800"
        >
          {fatal.map((error, index) => (
            <p key={index}>{error.message}</p>
          ))}
          <p className="mt-2 text-xs text-red-700">
            Try again, or upload clearer scans if the problem repeats.
          </p>
        </div>
      )}
    </div>
  );
}
