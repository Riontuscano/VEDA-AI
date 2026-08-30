"use client";

import { useMemo } from "react";

import type { AnswerBlock, Mapping, Question } from "@/lib/types";
import { Chip, FieldLabel } from "./ui/primitives";

export type Selection =
  | { kind: "question"; id: string }
  | { kind: "orphan"; answerId: string }
  | null;

export type QuestionListProps = {
  questions: Question[];
  answers: AnswerBlock[];
  mappings: Mapping[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
};

/**
 * The question paper in printed order, with each question's answer status.
 *
 * Rows are separated by hairlines rather than boxed as cards: at this density
 * cards add chrome without adding hierarchy. Unanswered questions and unmatched
 * answers are shown as prominently as successful matches, because both are real
 * outcomes a teacher needs to see.
 */
export function QuestionList({
  questions,
  answers,
  mappings,
  selection,
  onSelect,
}: QuestionListProps) {
  const { byQuestionId, answersById, orphans } = useMemo(() => {
    return {
      byQuestionId: new Map(
        mappings
          .filter((mapping) => mapping.questionId !== null)
          .map((mapping) => [mapping.questionId as string, mapping]),
      ),
      answersById: new Map(answers.map((answer) => [answer.id, answer])),
      orphans: mappings.filter((mapping) => mapping.questionId === null),
    };
  }, [answers, mappings]);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ol>
        {questions.map((question) => {
          const mapping = byQuestionId.get(question.id);
          const answered = (mapping?.answerBlockIds.length ?? 0) > 0;
          const isSelected =
            selection?.kind === "question" && selection.id === question.id;

          const linked = (mapping?.answerBlockIds ?? [])
            .map((id) => answersById.get(id))
            .filter((answer): answer is AnswerBlock => answer !== undefined);
          const approximate = linked.some((answer) =>
            answer.boxes.some((box) => box.source === "page_fallback"),
          );

          return (
            <li key={question.id}>
              <button
                type="button"
                onClick={() => onSelect({ kind: "question", id: question.id })}
                aria-current={isSelected}
                className={`relative flex w-full cursor-pointer gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors duration-150 ${
                  isSelected
                    ? "bg-[var(--accent-wash)]"
                    : "hover:bg-[var(--surface-sunken)]"
                }`}
              >
                {/* Selection is carried by a solid rail, not only by the wash,
                    so it survives at low contrast and in dark mode. */}
                {isSelected && (
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[2px] bg-[var(--accent)]"
                  />
                )}

                <span
                  className={`mt-px w-11 shrink-0 font-mono text-[11.5px] font-medium ${
                    isSelected
                      ? "text-[var(--accent)]"
                      : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {question.label}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] leading-snug">
                    {question.text || (
                      <span className="text-[var(--text-tertiary)]">
                        No question text read
                      </span>
                    )}
                  </span>

                  <span className="mt-1.5 flex flex-wrap items-center gap-1">
                    {answered ? (
                      <Chip tone="positive">
                        Answered
                        {mapping && mapping.answerBlockIds.length > 1
                          ? ` ${mapping.answerBlockIds.length} blocks`
                          : ""}
                      </Chip>
                    ) : (
                      <Chip tone="neutral">Not answered</Chip>
                    )}

                    {answered && mapping && mapping.matchType !== "labelled" && (
                      <Chip tone="accent">
                        {mapping.matchType === "inferred"
                          ? "By content"
                          : "By position"}
                        {` ${Math.round(mapping.confidence * 100)}%`}
                      </Chip>
                    )}

                    {approximate && <Chip tone="highlight">Approximate</Chip>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>

      {orphans.length > 0 && (
        <section className="mt-2">
          <h2 className="sticky top-0 z-10 border-y border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-2">
            <FieldLabel>
              No matching question · {orphans.length}
            </FieldLabel>
          </h2>

          <ol>
            {orphans.map((mapping) => {
              const answerId = mapping.answerBlockIds[0];
              if (!answerId) return null;
              const answer = answersById.get(answerId);
              const isSelected =
                selection?.kind === "orphan" && selection.answerId === answerId;

              return (
                <li key={answerId}>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "orphan", answerId })}
                    aria-current={isSelected}
                    className={`relative flex w-full cursor-pointer gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors duration-150 ${
                      isSelected
                        ? "bg-[var(--highlight-wash)]"
                        : "hover:bg-[var(--surface-sunken)]"
                    }`}
                  >
                    {isSelected && (
                      <span
                        aria-hidden
                        className="absolute inset-y-0 left-0 w-[2px] bg-[var(--highlight)]"
                      />
                    )}
                    <span className="mt-px w-11 shrink-0 font-mono text-[11.5px] font-medium text-[var(--highlight)]">
                      {answer?.rawLabel ?? "no label"}
                    </span>
                    <span className="min-w-0 flex-1 text-[13px] leading-snug text-[var(--text-secondary)]">
                      <span className="line-clamp-3">{answer?.text}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}
