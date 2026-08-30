import { describe, expect, it } from "vitest";

import { labelToId, parseLabel } from "@/lib/pipeline/labels";
import type { AnswerBlock, Mapping, Question } from "@/lib/types";
import { overallScore, scoreRun, type GroundTruth } from "./score";

/**
 * These tests exist because a metric that cannot fail is worse than no metric:
 * it reports confidence it has not earned. Each case injects exactly one
 * regression and asserts that the matching metric, and only it, drops.
 */

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

function answer(id: string, text: string, pages = [0]): AnswerBlock {
  return {
    id,
    rawLabel: null,
    text,
    boxes: pages.map((page) => ({
      page,
      x: 0,
      y: 0.1,
      w: 1,
      h: 0.1,
      source: "model" as const,
    })),
    confidence: 0.9,
  };
}

const truth: GroundTruth = {
  name: "case",
  questionPages: [],
  answerPages: [],
  questions: [
    {
      label: "1",
      answered: true,
      answerContains: "chlorophyll",
      answerSpansPages: [0, 1],
    },
    { label: "2", answered: false },
    { label: "3(a)", answered: true, answerContains: "newton" },
  ],
  orphanAnswers: [{ contains: "Paris" }],
};

/** A run that matches the ground truth exactly. */
function perfectRun() {
  const questions = [question("1", 0), question("2", 1), question("3(a)", 2)];
  const answers = [
    answer("a1", "photosynthesis uses chlorophyll", [0, 1]),
    answer("a2", "the newton is the SI unit"),
    answer("a3", "the capital is Paris"),
  ];
  const mappings: Mapping[] = [
    {
      questionId: "q-1",
      answerBlockIds: ["a1"],
      matchType: "labelled",
      confidence: 1,
    },
    {
      questionId: "q-2",
      answerBlockIds: [],
      matchType: "unmatched",
      confidence: 0,
    },
    {
      questionId: "q-3-a",
      answerBlockIds: ["a2"],
      matchType: "labelled",
      confidence: 1,
    },
    {
      questionId: null,
      answerBlockIds: ["a3"],
      matchType: "unmatched",
      confidence: 0,
    },
  ];
  return { questions, answers, mappings };
}

const scoreOf = (metrics: ReturnType<typeof scoreRun>, name: string): number =>
  metrics.find((metric) => metric.name === name)?.score ?? -1;

describe("scoreRun", () => {
  it("gives a perfect run full marks on every metric", () => {
    const metrics = scoreRun(truth, perfectRun());
    expect(overallScore(metrics)).toBe(1);
  });

  it("normalizes labels, so 3 a) and 3(a) are the same question", () => {
    const run = perfectRun();
    const third = run.questions[2];
    if (third) third.label = "3 a)";
    expect(scoreOf(scoreRun(truth, run), "Question recall")).toBe(1);
  });

  it("drops recall when a question is missed", () => {
    const run = perfectRun();
    run.questions = run.questions.slice(0, 2);
    expect(scoreOf(scoreRun(truth, run), "Question recall")).toBeCloseTo(2 / 3);
  });

  it("drops precision when a phantom question is invented", () => {
    // The real regression this caught: a parent stem emitted as a question.
    const run = perfectRun();
    run.questions.push(question("9", 3));
    const metrics = scoreRun(truth, run);
    expect(scoreOf(metrics, "Question precision")).toBeCloseTo(3 / 4);
    expect(scoreOf(metrics, "Question recall")).toBe(1);
  });

  it("drops ordering when questions come back out of printed order", () => {
    const run = perfectRun();
    const [first, second] = [run.questions[0], run.questions[1]];
    if (first && second) {
      first.order = 1;
      second.order = 0;
    }
    expect(scoreOf(scoreRun(truth, run), "Printed order")).toBeLessThan(1);
  });

  it("drops classification when an unanswered question gets an answer", () => {
    const run = perfectRun();
    const q2 = run.mappings.find((m) => m.questionId === "q-2");
    if (q2) q2.answerBlockIds = ["a3"];
    expect(scoreOf(scoreRun(truth, run), "Answered / unanswered")).toBeCloseTo(
      2 / 3,
    );
  });

  it("drops mapping correctness when an answer lands on the wrong question", () => {
    // Both questions still look answered, so only this metric catches it.
    const run = perfectRun();
    const q1 = run.mappings.find((m) => m.questionId === "q-1");
    const q3 = run.mappings.find((m) => m.questionId === "q-3-a");
    if (q1 && q3) {
      q1.answerBlockIds = ["a2"];
      q3.answerBlockIds = ["a1"];
    }
    const metrics = scoreRun(truth, run);
    expect(scoreOf(metrics, "Mapping correctness")).toBe(0);
    expect(scoreOf(metrics, "Answered / unanswered")).toBe(1);
  });

  it("drops multi-page merging when the continuation is lost", () => {
    // The exact defect found in live testing: answer truncated at the page break.
    const run = perfectRun();
    const a1 = run.answers.find((a) => a.id === "a1");
    if (a1) a1.boxes = a1.boxes.slice(0, 1);
    expect(scoreOf(scoreRun(truth, run), "Multi-page merging")).toBe(0);
  });

  it("drops orphan detection when an unmatched answer is forced onto a question", () => {
    const run = perfectRun();
    run.mappings = run.mappings.filter((m) => m.questionId !== null);
    expect(scoreOf(scoreRun(truth, run), "Unmatched answers")).toBe(0);
  });

  it("flags more unmatched answers than expected", () => {
    const run = perfectRun();
    run.mappings.push({
      questionId: null,
      answerBlockIds: ["a4"],
      matchType: "unmatched",
      confidence: 0,
    });
    const metric = scoreRun(truth, run).find(
      (m) => m.name === "Unmatched answers",
    );
    expect(metric?.failures.join(" ")).toContain("more unmatched");
  });
});
