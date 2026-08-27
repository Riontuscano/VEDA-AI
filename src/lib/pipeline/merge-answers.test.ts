import { describe, expect, it } from "vitest";

import type { PageAnswerBlock } from "@/lib/ai/provider";
import { mergeAnswerBlocks } from "./merge-answers";

function block(
  overrides: Partial<PageAnswerBlock> & { id: string; page: number },
): PageAnswerBlock {
  const { id, page, ...rest } = overrides;
  return {
    id,
    page,
    rawLabel: null,
    text: id,
    boxes: [{ page, x: 0.1, y: 0.1, w: 0.8, h: 0.2, source: "model" }],
    confidence: 0.9,
    continuesPreviousPage: false,
    ...rest,
  };
}

describe("mergeAnswerBlocks", () => {
  it("merges an unlabelled continuation at the top of the next page", () => {
    const merged = mergeAnswerBlocks([
      block({ id: "a1", page: 0, rawLabel: "Q1", text: "first half" }),
      block({
        id: "a2",
        page: 1,
        text: "second half",
        continuesPreviousPage: true,
      }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("a1");
    expect(merged[0]?.rawLabel).toBe("Q1");
    expect(merged[0]?.text).toBe("first half\nsecond half");
  });

  it("carries boxes from every page so the answer highlights across pages", () => {
    const merged = mergeAnswerBlocks([
      block({ id: "a1", page: 0, rawLabel: "Q1" }),
      block({ id: "a2", page: 1, continuesPreviousPage: true }),
    ]);

    expect(merged[0]?.boxes).toHaveLength(2);
    expect(merged[0]?.boxes.map((b) => b.page)).toEqual([0, 1]);
  });

  it("takes the lowest confidence of the merged parts", () => {
    const merged = mergeAnswerBlocks([
      block({ id: "a1", page: 0, rawLabel: "Q1", confidence: 0.9 }),
      block({
        id: "a2",
        page: 1,
        confidence: 0.4,
        continuesPreviousPage: true,
      }),
    ]);

    expect(merged[0]?.confidence).toBe(0.4);
  });

  it("merges when the student repeats the label on the next page", () => {
    const merged = mergeAnswerBlocks([
      block({ id: "a1", page: 0, rawLabel: "Q11(a)" }),
      block({ id: "a2", page: 1, rawLabel: "11 a) contd" }),
    ]);

    expect(merged).toHaveLength(1);
  });

  it("keeps separately labelled answers apart", () => {
    const merged = mergeAnswerBlocks([
      block({ id: "a1", page: 0, rawLabel: "Q1" }),
      block({ id: "a2", page: 1, rawLabel: "Q2" }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it("ignores a continuation flag on a mid-page block", () => {
    // A model that sets the flag on a block halfway down a page would
    // otherwise swallow a genuinely separate answer.
    const merged = mergeAnswerBlocks([
      block({
        id: "a1",
        page: 0,
        rawLabel: "Q1",
        boxes: [{ page: 0, x: 0.1, y: 0.1, w: 0.8, h: 0.2, source: "model" }],
      }),
      block({
        id: "a2",
        page: 0,
        continuesPreviousPage: true,
        boxes: [{ page: 0, x: 0.1, y: 0.6, w: 0.8, h: 0.2, source: "model" }],
      }),
    ]);

    expect(merged).toHaveLength(2);
  });

  it("keeps a continuation with nothing before it as its own block", () => {
    const merged = mergeAnswerBlocks([
      block({ id: "a1", page: 0, continuesPreviousPage: true }),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.id).toBe("a1");
  });

  it("orders blocks by page then position before merging", () => {
    const merged = mergeAnswerBlocks([
      block({
        id: "later",
        page: 0,
        rawLabel: "Q2",
        boxes: [{ page: 0, x: 0.1, y: 0.7, w: 0.8, h: 0.2, source: "model" }],
      }),
      block({
        id: "earlier",
        page: 0,
        rawLabel: "Q1",
        boxes: [{ page: 0, x: 0.1, y: 0.2, w: 0.8, h: 0.2, source: "model" }],
      }),
    ]);

    expect(merged.map((b) => b.id)).toEqual(["earlier", "later"]);
  });
});
