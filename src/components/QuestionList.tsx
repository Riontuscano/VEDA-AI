"use client";

import { useMemo } from "react";

import {
  buildReviewQueue,
  NEEDS_REVIEW_THRESHOLD,
  type ReviewRisk,
} from "@/lib/pipeline/review";
import type { AnswerBlock, Mapping, Question } from "@/lib/types";
import { Chip, FieldLabel } from "./ui/primitives";

export type Selection =
  | { kind: "question"; id: string }
  | { kind: "orphan"; answerId: string }
  | null;

export type SortMode = "paper" | "review";

export type QuestionListProps = {
  questions: Question[];
  answers: AnswerBlock[];
  mappings: Mapping[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  sortMode: SortMode;
};

type Row =
  | {
      kind: "question";
      key: string;
      question: Question;
      mapping: Mapping | undefined;
      linked: AnswerBlock[];
      risk: ReviewRisk;
    }
  | { kind: "orphan"; key: string; answer: AnswerBlock; risk: ReviewRisk };

/**
 * The question paper with each question's answer status.
 *
 * Printed order by default, because that's how a teacher reads a paper. Review
 * order ranks by how likely the mapping is wrong. Rows use hairlines rather
 * than cards: at this density cards add chrome without adding hierarchy.
 */
export function QuestionList({
  questions,
  answers,
  mappings,
  selection,
  onSelect,
  sortMode,
}: QuestionListProps) {
  const { paperRows, orphanRows, reviewRows } = useMemo(() => {
    const answersById = new Map(answers.map((answer) => [answer.id, answer]));
    const riskById = new Map(
      buildReviewQueue(questions, answers, mappings).map((item) => [
        item.id,
        item.risk,
      ]),
    );

    const questionRows: Row[] = questions.map((question) => {
      const mapping = mappings.find((m) => m.questionId === question.id);
      return {
        kind: "question",
        key: question.id,
        question,
        mapping,
        linked: (mapping?.answerBlockIds ?? [])
          .map((id) => answersById.get(id))
          .filter((a): a is AnswerBlock => a !== undefined),
        risk: riskById.get(question.id) ?? { score: 0, reasons: [] },
      };
    });

    const orphans: Row[] = mappings
      .filter((m) => m.questionId === null)
      .flatMap((m) => m.answerBlockIds)
      .map((id) => answersById.get(id))
      .filter((a): a is AnswerBlock => a !== undefined)
      .map((answer) => ({
        kind: "orphan",
        key: answer.id,
        answer,
        risk: riskById.get(answer.id) ?? { score: 0, reasons: [] },
      }));

    // Reuses the queue's ranking rather than re-sorting, so the list and the
    // "needs review" count can't disagree.
    const order = [...riskById.keys()];
    const byKey = new Map([...questionRows, ...orphans].map((r) => [r.key, r]));
    const ranked = order
      .map((key) => byKey.get(key))
      .filter((row): row is Row => row !== undefined);

    return { paperRows: questionRows, orphanRows: orphans, reviewRows: ranked };
  }, [answers, mappings, questions]);

  if (sortMode === "review") {
    return (
      <div className="flex h-full flex-col overflow-y-auto">
        <ol>
          {reviewRows.map((row) => (
            <RowItem
              key={row.key}
              row={row}
              selection={selection}
              onSelect={onSelect}
              showRisk
            />
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ol>
        {paperRows.map((row) => (
          <RowItem
            key={row.key}
            row={row}
            selection={selection}
            onSelect={onSelect}
            showRisk={false}
          />
        ))}
      </ol>

      {orphanRows.length > 0 && (
        <section className="mt-2">
          <h2 className="sticky top-0 z-10 border-y border-[var(--border-subtle)] bg-[var(--surface-sunken)] px-4 py-2">
            <FieldLabel>No matching question · {orphanRows.length}</FieldLabel>
          </h2>
          <ol>
            {orphanRows.map((row) => (
              <RowItem
                key={row.key}
                row={row}
                selection={selection}
                onSelect={onSelect}
                showRisk={false}
              />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function RowItem({
  row,
  selection,
  onSelect,
  showRisk,
}: {
  row: Row;
  selection: Selection;
  onSelect: (selection: Selection) => void;
  showRisk: boolean;
}) {
  const isOrphan = row.kind === "orphan";
  const isSelected = isOrphan
    ? selection?.kind === "orphan" && selection.answerId === row.answer.id
    : selection?.kind === "question" && selection.id === row.question.id;

  const flagged = row.risk.score >= NEEDS_REVIEW_THRESHOLD;

  return (
    <li>
      <button
        type="button"
        onClick={() =>
          onSelect(
            isOrphan
              ? { kind: "orphan", answerId: row.answer.id }
              : { kind: "question", id: row.question.id },
          )
        }
        aria-current={isSelected}
        className={`relative flex w-full cursor-pointer gap-3 border-b border-[var(--border-subtle)] px-4 py-3 text-left transition-colors duration-150 ${
          isSelected
            ? isOrphan
              ? "bg-[var(--highlight-wash)]"
              : "bg-[var(--accent-wash)]"
            : "hover:bg-[var(--surface-sunken)]"
        }`}
      >
        {/* A solid rail, not just the wash, so selection survives low contrast
            and dark mode. */}
        {isSelected && (
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 w-[2px] ${
              isOrphan ? "bg-[var(--highlight)]" : "bg-[var(--accent)]"
            }`}
          />
        )}

        <span
          className={`mt-px w-11 shrink-0 font-mono text-[11.5px] font-medium ${
            isOrphan
              ? "text-[var(--highlight)]"
              : isSelected
                ? "text-[var(--accent)]"
                : "text-[var(--text-tertiary)]"
          }`}
        >
          {isOrphan ? (row.answer.rawLabel ?? "no label") : row.question.label}
        </span>

        <span className="min-w-0 flex-1">
          {isOrphan ? (
            <span className="line-clamp-3 block text-[13px] leading-snug text-[var(--text-secondary)]">
              {row.answer.text}
            </span>
          ) : (
            <span className="block text-[13px] leading-snug">
              {row.question.text || (
                <span className="text-[var(--text-tertiary)]">
                  No question text read
                </span>
              )}
            </span>
          )}

          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {isOrphan ? (
              <Chip tone="highlight">Unmatched answer</Chip>
            ) : (
              <QuestionChips row={row} />
            )}
          </span>

          {/* In review order the reason is the point: a rank with no
              explanation is a number the user has to trust. */}
          {showRisk && flagged && row.risk.reasons.length > 0 && (
            <span className="mt-1.5 block text-[11.5px] leading-relaxed text-[var(--text-tertiary)]">
              {row.risk.reasons[0]}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

function QuestionChips({ row }: { row: Extract<Row, { kind: "question" }> }) {
  const { mapping, linked } = row;
  const answered = (mapping?.answerBlockIds.length ?? 0) > 0;
  const approximate = linked.some((answer) =>
    answer.boxes.some((box) => box.source === "page_fallback"),
  );

  return (
    <>
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
          {mapping.matchType === "inferred" ? "By content" : "By position"}
          {` ${Math.round(mapping.confidence * 100)}%`}
        </Chip>
      )}

      {approximate && <Chip tone="highlight">Approximate</Chip>}
    </>
  );
}
