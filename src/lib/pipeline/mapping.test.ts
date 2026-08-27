import { describe, expect, it } from "vitest";

import type { AnswerBlock, Question } from "@/lib/types";
import {
  answersNeedingInference,
  buildMappings,
  matchByLabel,
  matchByPosition,
} from "./mapping";
import { labelToId, parseLabel } from "./labels";

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

function answer(id: string, rawLabel: string | null): AnswerBlock {
  return {
    id,
    rawLabel,
    text: `answer ${id}`,
    boxes: [{ page: 0, x: 0, y: 0.1, w: 1, h: 0.1, source: "model" }],
    confidence: 0.8,
  };
}

const questions = [
  question("1", 0),
  question("2", 1),
  question("3", 2),
  question("4", 3),
];

describe("matchByLabel", () => {
  it("matches answers whose written label parses to a question", () => {
    const { assignments, unresolved } = matchByLabel(questions, [
      answer("a1", "Q1"),
      answer("a2", "2."),
    ]);

    expect(assignments.get("a1")).toBe("q-1");
    expect(assignments.get("a2")).toBe("q-2");
    expect(unresolved).toHaveLength(0);
  });

  it("matches out-of-order answers to the right questions", () => {
    // The student answered 3 before 1; label matching must not care about the
    // order answers appear in.
    const { assignments } = matchByLabel(questions, [
      answer("a1", "Q3"),
      answer("a2", "Q1"),
    ]);

    expect(assignments.get("a1")).toBe("q-3");
    expect(assignments.get("a2")).toBe("q-1");
  });

  it("leaves unlabelled answers unresolved", () => {
    const { unresolved } = matchByLabel(questions, [answer("a1", null)]);
    expect(unresolved.map((a) => a.id)).toEqual(["a1"]);
  });

  it("leaves an answer labelled for a question not on the paper unresolved", () => {
    const { assignments, unresolved } = matchByLabel(questions, [
      answer("a1", "Q9"),
    ]);

    expect(assignments.size).toBe(0);
    expect(unresolved.map((a) => a.id)).toEqual(["a1"]);
  });
});

describe("matchByPosition", () => {
  it("fills a single-question gap between two anchored answers", () => {
    const answers = [answer("a1", "Q1"), answer("a2", null), answer("a3", "Q3")];
    const labelled = new Map([
      ["a1", "q-1"],
      ["a3", "q-3"],
    ]);

    expect(matchByPosition(questions, answers, labelled).get("a2")).toBe("q-2");
  });

  it("does not fire when the gap spans more than one question", () => {
    const answers = [answer("a1", "Q1"), answer("a2", null), answer("a3", "Q4")];
    const labelled = new Map([
      ["a1", "q-1"],
      ["a3", "q-4"],
    ]);

    expect(matchByPosition(questions, answers, labelled).size).toBe(0);
  });

  it("does not fire without an anchor on both sides", () => {
    const answers = [answer("a1", null), answer("a2", null), answer("a3", "Q3")];
    const labelled = new Map([["a3", "q-3"]]);

    expect(matchByPosition(questions, answers, labelled).size).toBe(0);
  });

  it("does not steal a question that already has an answer", () => {
    const answers = [
      answer("a1", "Q1"),
      answer("a2", null),
      answer("a3", "Q3"),
      answer("a4", "Q2"),
    ];
    const labelled = new Map([
      ["a1", "q-1"],
      ["a3", "q-3"],
      ["a4", "q-2"],
    ]);

    expect(matchByPosition(questions, answers, labelled).size).toBe(0);
  });
});

describe("answersNeedingInference", () => {
  it("returns only answers no cheap pass resolved", () => {
    const answers = [answer("a1", "Q1"), answer("a2", null), answer("a3", null)];
    const remaining = answersNeedingInference(
      answers,
      new Map([["a1", "q-1"]]),
      new Map([["a2", "q-2"]]),
    );

    expect(remaining.map((a) => a.id)).toEqual(["a3"]);
  });
});

describe("buildMappings", () => {
  const empty = new Map<string, string>();

  it("emits one mapping per question, in question order", () => {
    const mappings = buildMappings({
      questions,
      answers: [],
      labelled: empty,
      positional: empty,
      inferred: [],
    });

    expect(mappings.map((m) => m.questionId)).toEqual([
      "q-1",
      "q-2",
      "q-3",
      "q-4",
    ]);
  });

  it("marks an unanswered question with no answer blocks", () => {
    const mappings = buildMappings({
      questions,
      answers: [answer("a1", "Q1")],
      labelled: new Map([["a1", "q-1"]]),
      positional: empty,
      inferred: [],
    });

    const q2 = mappings.find((m) => m.questionId === "q-2");
    expect(q2?.answerBlockIds).toEqual([]);
    expect(q2?.matchType).toBe("unmatched");
    expect(q2?.confidence).toBe(0);
  });

  it("emits an unmatched entry for an answer with no question", () => {
    const mappings = buildMappings({
      questions,
      answers: [answer("a1", "Q9")],
      labelled: empty,
      positional: empty,
      inferred: [{ answerBlockId: "a1", questionId: null, confidence: 0 }],
    });

    const orphan = mappings.find((m) => m.questionId === null);
    expect(orphan?.answerBlockIds).toEqual(["a1"]);
    expect(orphan?.matchType).toBe("unmatched");
  });

  it("records how each question was matched", () => {
    const mappings = buildMappings({
      questions,
      answers: [answer("a1", "Q1"), answer("a2", null), answer("a3", null)],
      labelled: new Map([["a1", "q-1"]]),
      positional: new Map([["a2", "q-2"]]),
      inferred: [{ answerBlockId: "a3", questionId: "q-3", confidence: 0.7 }],
    });

    const byId = new Map(mappings.map((m) => [m.questionId, m]));
    expect(byId.get("q-1")?.matchType).toBe("labelled");
    expect(byId.get("q-1")?.confidence).toBe(1);
    expect(byId.get("q-2")?.matchType).toBe("positional");
    expect(byId.get("q-3")?.matchType).toBe("inferred");
    expect(byId.get("q-3")?.confidence).toBe(0.7);
  });

  it("prefers a stronger earlier pass over a weaker later one", () => {
    // Inference must never override a label the student wrote themselves.
    const mappings = buildMappings({
      questions,
      answers: [answer("a1", "Q1")],
      labelled: new Map([["a1", "q-1"]]),
      positional: empty,
      inferred: [{ answerBlockId: "a1", questionId: "q-4", confidence: 0.9 }],
    });

    expect(mappings.find((m) => m.questionId === "q-1")?.answerBlockIds).toEqual(
      ["a1"],
    );
    expect(mappings.find((m) => m.questionId === "q-4")?.answerBlockIds).toEqual(
      [],
    );
  });

  it("links several answer blocks to one question in document order", () => {
    const mappings = buildMappings({
      questions,
      answers: [answer("a1", "Q1"), answer("a2", "Q1")],
      labelled: new Map([
        ["a1", "q-1"],
        ["a2", "q-1"],
      ]),
      positional: empty,
      inferred: [],
    });

    expect(mappings.find((m) => m.questionId === "q-1")?.answerBlockIds).toEqual(
      ["a1", "a2"],
    );
  });

  it("ignores inferred matches naming a question that does not exist", () => {
    const mappings = buildMappings({
      questions,
      answers: [answer("a1", null)],
      labelled: empty,
      positional: empty,
      inferred: [
        { answerBlockId: "a1", questionId: "q-does-not-exist", confidence: 1 },
      ],
    });

    expect(mappings.find((m) => m.questionId === null)?.answerBlockIds).toEqual([
      "a1",
    ]);
  });
});
