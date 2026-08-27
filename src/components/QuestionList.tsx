"use client";

import type { AnswerBlock, Mapping, Question } from "@/lib/types";

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
 * The question paper, in printed order, with each question's answer status.
 *
 * Unanswered questions and unmatched answers are shown as prominently as
 * successful matches. Both are real outcomes a teacher needs to see, and
 * hiding them would make the mapping look more confident than it is.
 */
export function QuestionList({
  questions,
  answers,
  mappings,
  selection,
  onSelect,
}: QuestionListProps) {
  const byQuestionId = new Map(
    mappings
      .filter((mapping) => mapping.questionId !== null)
      .map((mapping) => [mapping.questionId as string, mapping]),
  );
  const answersById = new Map(answers.map((answer) => [answer.id, answer]));
  const orphans = mappings.filter((mapping) => mapping.questionId === null);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <ol className="divide-y divide-slate-200">
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
                className={`w-full px-4 py-3 text-left transition-colors ${
                  isSelected ? "bg-blue-50" : "hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 shrink-0 font-mono text-xs font-bold text-slate-500">
                    {question.label}
                  </span>
                  <span className="text-sm text-slate-800">
                    {question.text || (
                      <em className="text-slate-400">no question text read</em>
                    )}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5 pl-8">
                  {answered ? (
                    <Badge tone="ok">
                      Answered
                      {mapping && mapping.answerBlockIds.length > 1
                        ? ` · ${mapping.answerBlockIds.length} blocks`
                        : ""}
                    </Badge>
                  ) : (
                    <Badge tone="muted">Not answered</Badge>
                  )}

                  {answered && mapping && mapping.matchType !== "labelled" && (
                    <Badge tone="warn">
                      {mapping.matchType === "inferred"
                        ? "Matched by content"
                        : "Matched by position"}
                      {` · ${Math.round(mapping.confidence * 100)}%`}
                    </Badge>
                  )}

                  {approximate && (
                    <Badge tone="warn">Approximate location</Badge>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ol>

      {orphans.length > 0 && (
        <div className="mt-4 border-t-4 border-slate-100">
          <h2 className="px-4 pt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Answers with no matching question ({orphans.length})
          </h2>
          <ol className="mt-2 divide-y divide-slate-200">
            {orphans.map((mapping) => {
              const answerId = mapping.answerBlockIds[0];
              if (!answerId) return null;
              const answer = answersById.get(answerId);
              const isSelected =
                selection?.kind === "orphan" &&
                selection.answerId === answerId;

              return (
                <li key={answerId}>
                  <button
                    type="button"
                    onClick={() => onSelect({ kind: "orphan", answerId })}
                    aria-current={isSelected}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      isSelected ? "bg-amber-50" : "hover:bg-slate-50"
                    }`}
                  >
                    <span className="font-mono text-xs font-bold text-amber-700">
                      {answer?.rawLabel ?? "unlabelled"}
                    </span>
                    <p className="mt-1 line-clamp-3 text-sm text-slate-700">
                      {answer?.text}
                    </p>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

function Badge({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  children: React.ReactNode;
}) {
  const styles = {
    ok: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
    muted: "bg-slate-100 text-slate-500 ring-slate-200",
  }[tone];

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${styles}`}
    >
      {children}
    </span>
  );
}
