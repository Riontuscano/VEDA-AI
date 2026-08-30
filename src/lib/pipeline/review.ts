import type { AnswerBlock, Mapping, Question } from "@/lib/types";

/**
 * Review prioritisation.
 *
 * The mapper is accurate but not perfect, so the useful question is not "is it
 * right?" but "where is it most likely wrong?". This ranks every row by how
 * much it deserves a human look, which turns checking 40 questions into
 * checking the 6 the system is least sure about.
 *
 * Each risk carries its own reason string. A score with no explanation would
 * just be a number the user has to trust; the reason is what makes it
 * actionable.
 *
 * Pure, so the ranking is unit-testable without a model call.
 */

export type ReviewRisk = {
  /** 0 (confident) to 1 (needs a look). */
  score: number;
  /** Human-readable causes, strongest first. Empty when nothing is suspect. */
  reasons: string[];
};

export type ReviewItem = {
  /** Question id, or the answer id for an answer that matched no question. */
  id: string;
  kind: "question" | "orphan";
  risk: ReviewRisk;
};

/**
 * Weights are ordered by how often each case turns out to be a genuine
 * mistake, judged from the failure modes seen in testing: content inference is
 * the least reliable step, an orphan answer is usually either a real orphan or
 * a mapping miss, and a labelled match with a clean box is almost always right.
 */
const RISK = {
  orphanAnswer: 0.75,
  positionalMatch: 0.55,
  unanswered: 0.4,
  approximateBox: 0.3,
} as const;

/** Ranks every question and unmatched answer, most suspect first. */
export function buildReviewQueue(
  questions: readonly Question[],
  answers: readonly AnswerBlock[],
  mappings: readonly Mapping[],
): ReviewItem[] {
  const answersById = new Map(answers.map((answer) => [answer.id, answer]));
  const items: ReviewItem[] = [];

  for (const question of questions) {
    const mapping = mappings.find((m) => m.questionId === question.id);
    items.push({
      id: question.id,
      kind: "question",
      risk: assessQuestion(mapping, answersById),
    });
  }

  for (const mapping of mappings) {
    if (mapping.questionId !== null) continue;
    for (const answerId of mapping.answerBlockIds) {
      items.push({
        id: answerId,
        kind: "orphan",
        risk: {
          score: RISK.orphanAnswer,
          reasons: ["Answer matched no question on the paper"],
        },
      });
    }
  }

  // Stable within equal scores: the underlying arrays are already in printed
  // order, so equally-risky rows stay in document order rather than shuffling
  // between renders.
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) =>
      b.item.risk.score === a.item.risk.score
        ? a.index - b.index
        : b.item.risk.score - a.item.risk.score,
    )
    .map(({ item }) => item);
}

function assessQuestion(
  mapping: Mapping | undefined,
  answersById: ReadonlyMap<string, AnswerBlock>,
): ReviewRisk {
  const linked = (mapping?.answerBlockIds ?? [])
    .map((id) => answersById.get(id))
    .filter((answer): answer is AnswerBlock => answer !== undefined);

  if (linked.length === 0) {
    return {
      score: RISK.unanswered,
      reasons: ["No answer found for this question"],
    };
  }

  const risks: { score: number; reason: string }[] = [];

  if (mapping?.matchType === "inferred") {
    // Inference read the answer's content rather than a label the student
    // wrote, so its own confidence is the best signal available.
    risks.push({
      score: 0.5 + (1 - mapping.confidence) * 0.45,
      reason: `Matched by reading the answer, ${Math.round(mapping.confidence * 100)}% confident`,
    });
  }

  if (mapping?.matchType === "positional") {
    risks.push({
      score: RISK.positionalMatch,
      reason: "Matched by position between two labelled answers",
    });
  }

  if (linked.some((a) => a.boxes.some((b) => b.source === "page_fallback"))) {
    risks.push({
      score: RISK.approximateBox,
      reason: "Highlight is approximate; the exact region was not returned",
    });
  }

  const weakest = Math.min(...linked.map((a) => a.confidence));
  if (weakest < 0.75) {
    risks.push({
      score: (1 - weakest) * 0.7,
      reason: `Handwriting was hard to read, ${Math.round(weakest * 100)}% confident`,
    });
  }

  if (risks.length === 0) return { score: 0, reasons: [] };

  risks.sort((a, b) => b.score - a.score);
  return {
    // Max rather than sum: two moderate doubts about the same row do not make
    // it worse than one severe one, and summing would push ordinary rows above
    // genuinely broken ones.
    score: Math.min(1, risks[0]?.score ?? 0),
    reasons: risks.map((risk) => risk.reason),
  };
}

/** Rows worth a human look, used for the "N need review" count. */
export const NEEDS_REVIEW_THRESHOLD = 0.3;

export function countNeedingReview(items: readonly ReviewItem[]): number {
  return items.filter((item) => item.risk.score >= NEEDS_REVIEW_THRESHOLD)
    .length;
}
