import { describe, expect, it } from "vitest";

import type { AnswerBlock, Mapping, Question } from "@/lib/types";
import { labelToId, parseLabel } from "./labels";
import { buildReviewQueue, countNeedingReview } from "./review";

function question(label: string, order: number): Question {
  const path = parseLabel(label) ?? [];
  return {
    id: labelToId(path),
    labelPath: path,
    label,
    text: `text of ${label}`,
    order,
    page: 0,
    box: { page: 0, x: 0, y: order / 10, w: 1, h: 0.05, source: "model" },
  };
}

function answer(id: string, overrides: Partial<AnswerBlock> = {}): AnswerBlock {
  return {
    id,
    rawLabel: null,
    text: `answer ${id}`,
    boxes: [{ page: 0, x: 0, y: 0.1, w: 1, h: 0.1, source: "model" }],
    confidence: 0.95,
    ...overrides,
  };
}

const mapping = (over: Partial<Mapping> = {}): Mapping => ({
  questionId: "q-1",
  answerBlockIds: ["a1"],
  matchType: "labelled",
  confidence: 1,
  ...over,
});

const riskOf = (
  items: ReturnType<typeof buildReviewQueue>,
  id: string,
): number => items.find((item) => item.id === id)?.risk.score ?? -1;

describe("buildReviewQueue", () => {
  it("treats a clean labelled match as needing no review", () => {
    const items = buildReviewQueue(
      [question("1", 0)],
      [answer("a1")],
      [mapping()],
    );
    expect(riskOf(items, "q-1")).toBe(0);
    expect(items[0]?.risk.reasons).toEqual([]);
  });

  it("ranks an unmatched answer above everything routine", () => {
    const questions = [question("1", 0), question("2", 1)];
    const answers = [answer("a1"), answer("a9")];
    const mappings: Mapping[] = [
      mapping(),
      {
        questionId: "q-2",
        answerBlockIds: [],
        matchType: "unmatched",
        confidence: 0,
      },
      {
        questionId: null,
        answerBlockIds: ["a9"],
        matchType: "unmatched",
        confidence: 0,
      },
    ];

    const items = buildReviewQueue(questions, answers, mappings);
    expect(items[0]?.id).toBe("a9");
    expect(items[0]?.kind).toBe("orphan");
  });

  it("scores a low-confidence inferred match above a confident one", () => {
    const shaky = buildReviewQueue(
      [question("1", 0)],
      [answer("a1")],
      [mapping({ matchType: "inferred", confidence: 0.3 })],
    );
    const solid = buildReviewQueue(
      [question("1", 0)],
      [answer("a1")],
      [mapping({ matchType: "inferred", confidence: 0.95 })],
    );

    expect(riskOf(shaky, "q-1")).toBeGreaterThan(riskOf(solid, "q-1"));
  });

  it("explains why a row is flagged", () => {
    const items = buildReviewQueue(
      [question("1", 0)],
      [answer("a1", { confidence: 0.35 })],
      [mapping()],
    );
    expect(items[0]?.risk.reasons.join(" ")).toContain("hard to read");
  });

  it("flags an approximate highlight", () => {
    const items = buildReviewQueue(
      [question("1", 0)],
      [
        answer("a1", {
          boxes: [{ page: 0, x: 0, y: 0, w: 1, h: 1, source: "page_fallback" }],
        }),
      ],
      [mapping()],
    );
    expect(items[0]?.risk.reasons.join(" ")).toContain("approximate");
  });

  it("takes the worst risk rather than adding them up", () => {
    // Two moderate doubts about one row must not outrank a single severe one,
    // which is what summing would do.
    const combined = buildReviewQueue(
      [question("1", 0)],
      [
        answer("a1", {
          confidence: 0.6,
          boxes: [{ page: 0, x: 0, y: 0, w: 1, h: 1, source: "page_fallback" }],
        }),
      ],
      [mapping()],
    );
    const orphanOnly = buildReviewQueue(
      [],
      [answer("a9")],
      [
        {
          questionId: null,
          answerBlockIds: ["a9"],
          matchType: "unmatched",
          confidence: 0,
        },
      ],
    );

    expect(riskOf(combined, "q-1")).toBeLessThan(riskOf(orphanOnly, "a9"));
    expect(combined[0]?.risk.reasons).toHaveLength(2);
  });

  it("keeps equally-risky rows in printed order", () => {
    const questions = [question("1", 0), question("2", 1), question("3", 2)];
    const mappings: Mapping[] = questions.map((q) => ({
      questionId: q.id,
      answerBlockIds: [],
      matchType: "unmatched" as const,
      confidence: 0,
    }));

    const items = buildReviewQueue(questions, [], mappings);
    expect(items.map((item) => item.id)).toEqual(["q-1", "q-2", "q-3"]);
  });

  it("counts only the rows worth looking at", () => {
    const questions = [question("1", 0), question("2", 1)];
    const answers = [answer("a1")];
    const mappings: Mapping[] = [
      mapping(),
      {
        questionId: "q-2",
        answerBlockIds: [],
        matchType: "unmatched",
        confidence: 0,
      },
    ];

    const items = buildReviewQueue(questions, answers, mappings);
    expect(countNeedingReview(items)).toBe(1);
  });
});
