import { describe, expect, it } from "vitest";

import type {
  AiProvider,
  InferredMatch,
  PageAnswerBlock,
  PageImage,
} from "@/lib/ai/provider";
import { MemorySessionStore } from "@/lib/store/memory-session-store";
import type { FileStore, StoredFile } from "@/lib/store/types";
import { labelToId, parseLabel } from "@/lib/pipeline/labels";
import type { Question, SessionResult } from "@/lib/types";

import { runPipeline } from "./run";

/**
 * End-to-end pipeline test against a fake provider.
 *
 * Exercises the orchestrator, the merge and all three matching passes together
 * — including every edge case the brief calls out — without an API key, a
 * network call, or any model quota.
 */

class FakeFileStore implements FileStore {
  private readonly files = new Map<string, StoredFile>();

  async save(sessionId: string, name: string, file: StoredFile) {
    const key = `${sessionId}/${name}`;
    this.files.set(key, file);
    return key;
  }
  async read(key: string) {
    return this.files.get(key) ?? null;
  }
  async deleteSession() {}
}

function makeQuestion(label: string, order: number): Question {
  const path = parseLabel(label) ?? [];
  return {
    id: labelToId(path),
    labelPath: path,
    label,
    text: `Question ${label}`,
    order,
    page: 0,
    box: { page: 0, x: 0, y: order / 10, w: 1, h: 0.05, source: "model" },
  };
}

function makeAnswerBlock(
  id: string,
  page: number,
  rawLabel: string | null,
  overrides: Partial<PageAnswerBlock> = {},
): PageAnswerBlock {
  return {
    id,
    page,
    rawLabel,
    text: `text of ${id}`,
    boxes: [{ page, x: 0.1, y: 0.2, w: 0.8, h: 0.2, source: "model" }],
    confidence: 0.9,
    continuesPreviousPage: false,
    ...overrides,
  };
}

class FakeProvider implements AiProvider {
  inferCalls = 0;

  constructor(
    private readonly questions: Question[],
    private readonly answers: PageAnswerBlock[],
    private readonly options: {
      inferResult?: InferredMatch[];
      failOn?: "questions" | "answers" | "infer";
    } = {},
  ) {}

  async extractQuestions(_pages: PageImage[]): Promise<Question[]> {
    if (this.options.failOn === "questions") {
      throw new Error("question extraction exploded");
    }
    return this.questions;
  }

  async extractAnswers(_pages: PageImage[]): Promise<PageAnswerBlock[]> {
    if (this.options.failOn === "answers") {
      throw new Error("answer extraction exploded");
    }
    return this.answers;
  }

  async inferMatches(): Promise<InferredMatch[]> {
    this.inferCalls += 1;
    if (this.options.failOn === "infer") {
      throw new Error("inference exploded");
    }
    return this.options.inferResult ?? [];
  }
}

async function setup(provider: AiProvider): Promise<SessionResult> {
  const sessions = new MemorySessionStore(60_000);
  const files = new FakeFileStore();
  const sessionId = "test-session";

  const key = await files.save(sessionId, "page-0", {
    bytes: new Uint8Array([1, 2, 3]),
    contentType: "image/png",
  });
  const pageRef = { index: 0, width: 100, height: 100, storageKey: key };

  await sessions.create({
    sessionId,
    status: "uploading",
    createdAt: Date.now(),
    questionPages: [pageRef],
    answerPages: [pageRef],
    questions: [],
    answers: [],
    mappings: [],
    errors: [],
  });

  await runPipeline(sessionId, { provider, sessions, files });

  const result = await sessions.get(sessionId);
  if (!result) throw new Error("session disappeared");
  return result;
}

describe("runPipeline", () => {
  it("handles out-of-order, unanswered, unmatched and multi-page answers together", async () => {
    const questions = [
      makeQuestion("1", 0),
      makeQuestion("2", 1),
      makeQuestion("3", 2),
    ];

    const answers = [
      // Answered out of order: 3 before 1.
      makeAnswerBlock("a-3", 0, "Q3"),
      makeAnswerBlock("a-1", 0, "Q1", {
        boxes: [{ page: 0, x: 0.1, y: 0.6, w: 0.8, h: 0.2, source: "model" }],
      }),
      // Continuation of answer 1 onto the next page, unlabelled.
      makeAnswerBlock("a-1-cont", 1, null, { continuesPreviousPage: true }),
      // An answer to a question that is not on this paper.
      makeAnswerBlock("a-orphan", 1, "Q9", {
        boxes: [{ page: 1, x: 0.1, y: 0.6, w: 0.8, h: 0.2, source: "model" }],
      }),
      // Question 2 is never answered.
    ];

    const provider = new FakeProvider(questions, answers);
    const result = await setup(provider);

    expect(result.status).toBe("done");

    // Multi-page: the continuation merged into the answer it continues, and
    // carries a box on both pages so the highlight spans them.
    const merged = result.answers.find((answer) => answer.id === "a-1");
    expect(merged?.text).toBe("text of a-1\ntext of a-1-cont");
    expect(merged?.boxes.map((box) => box.page)).toEqual([0, 1]);

    const byQuestion = new Map(
      result.mappings.map((mapping) => [mapping.questionId, mapping]),
    );

    // Out of order: both labelled answers still land on the right questions.
    expect(byQuestion.get("q-1")?.answerBlockIds).toEqual(["a-1"]);
    expect(byQuestion.get("q-3")?.answerBlockIds).toEqual(["a-3"]);
    expect(byQuestion.get("q-1")?.matchType).toBe("labelled");

    // Unanswered.
    expect(byQuestion.get("q-2")?.answerBlockIds).toEqual([]);
    expect(byQuestion.get("q-2")?.matchType).toBe("unmatched");

    // Unmatched answer, surfaced rather than dropped or forced onto question 2.
    const orphan = result.mappings.find(
      (mapping) => mapping.questionId === null,
    );
    expect(orphan?.answerBlockIds).toEqual(["a-orphan"]);
  });

  it("uses content inference only for answers the cheap passes could not resolve", async () => {
    const questions = [makeQuestion("1", 0), makeQuestion("2", 1)];
    const answers = [
      makeAnswerBlock("a-1", 0, "Q1"),
      makeAnswerBlock("a-2", 0, null, {
        boxes: [{ page: 0, x: 0.1, y: 0.6, w: 0.8, h: 0.2, source: "model" }],
      }),
    ];

    const provider = new FakeProvider(questions, answers, {
      inferResult: [
        { answerBlockId: "a-2", questionId: "q-2", confidence: 0.8 },
      ],
    });
    const result = await setup(provider);

    expect(provider.inferCalls).toBe(1);
    const byQuestion = new Map(
      result.mappings.map((mapping) => [mapping.questionId, mapping]),
    );
    expect(byQuestion.get("q-2")?.matchType).toBe("inferred");
    expect(byQuestion.get("q-2")?.confidence).toBe(0.8);
  });

  it("does not call inference when every answer is already resolved", async () => {
    const provider = new FakeProvider(
      [makeQuestion("1", 0)],
      [makeAnswerBlock("a-1", 0, "Q1")],
    );
    await setup(provider);
    expect(provider.inferCalls).toBe(0);
  });

  it("completes with a recovered error when inference fails", async () => {
    const questions = [makeQuestion("1", 0)];
    const answers = [makeAnswerBlock("a-1", 0, null)];

    const result = await setup(
      new FakeProvider(questions, answers, { failOn: "infer" }),
    );

    // Losing inference must not lose the run — label-matched answers still show.
    expect(result.status).toBe("done");
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.recovered).toBe(true);
    expect(result.mappings.find((m) => m.questionId === null)?.answerBlockIds)
      .toEqual(["a-1"]);
  });

  it("fails the session when extraction fails", async () => {
    const result = await setup(
      new FakeProvider([], [], { failOn: "answers" }),
    );

    expect(result.status).toBe("failed");
    expect(result.errors[0]?.recovered).toBe(false);
    expect(result.errors[0]?.stage).toBe("extract_answers");
  });
});
