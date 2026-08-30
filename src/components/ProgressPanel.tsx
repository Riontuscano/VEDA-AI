"use client";

import { Check, CircleNotch, Warning } from "@phosphor-icons/react";

import type { PipelineError, SessionStatus } from "@/lib/types";
import { FieldLabel } from "./ui/primitives";

const STAGES: { status: SessionStatus; label: string; note: string }[] = [
  {
    status: "uploading",
    label: "Receiving pages",
    note: "Validating and storing the uploaded images",
  },
  {
    status: "extracting_questions",
    label: "Reading the question paper",
    note: "Finding each question and its printed position",
  },
  {
    status: "extracting_answers",
    label: "Reading the handwriting",
    note: "Transcribing each answer block. This is the slow step",
  },
  {
    status: "mapping",
    label: "Matching answers to questions",
    note: "Labels first, then content for anything unlabelled",
  },
];

export type ProgressPanelProps = {
  status: SessionStatus;
  errors: PipelineError[];
};

/**
 * Per-stage progress for a running pipeline.
 *
 * Names the stage actually in progress and says what it is doing. Reading
 * handwriting takes most of the wall time, and saying so is the difference
 * between "working" and "stuck".
 */
export function ProgressPanel({ status, errors }: ProgressPanelProps) {
  const currentIndex = STAGES.findIndex((stage) => stage.status === status);
  const failed = status === "failed";
  const fatal = errors.filter((error) => !error.recovered);

  return (
    <div className="w-full max-w-md text-left">
      <FieldLabel>{failed ? "Failed" : "Processing"}</FieldLabel>

      <ol className="mt-4 flex flex-col">
        {STAGES.map((stage, index) => {
          const done = index < currentIndex;
          const active = !failed && index === currentIndex;

          return (
            <li
              key={stage.status}
              className="flex gap-3 border-t border-[var(--border-subtle)] py-3 first:border-t-0 first:pt-0"
            >
              <span aria-hidden className="mt-0.5 shrink-0">
                {done ? (
                  <Check size={15} weight="bold" className="text-[var(--positive)]" />
                ) : active ? (
                  <CircleNotch
                    size={15}
                    weight="bold"
                    className="animate-spin text-[var(--accent)]"
                  />
                ) : (
                  <span className="block h-[15px] w-[15px] rounded-full border border-[var(--border-strong)]" />
                )}
              </span>

              <span className="min-w-0">
                <span
                  className={`block text-[13px] ${
                    done || active
                      ? "font-medium text-[var(--text-primary)]"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {stage.label}
                </span>
                {active && (
                  <span className="mt-0.5 block text-[12px] text-[var(--text-secondary)]">
                    {stage.note}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {fatal.length > 0 && (
        <div
          role="alert"
          className="mt-5 rounded-[var(--radius)] border border-[var(--danger)]/30 bg-[var(--danger-wash)] p-3"
        >
          <span className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--danger)]">
            <Warning size={14} weight="fill" />
            Could not finish
          </span>
          {fatal.map((error, index) => (
            <p
              key={index}
              className="mt-1 text-[12.5px] leading-relaxed text-[var(--text-secondary)]"
            >
              {error.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
