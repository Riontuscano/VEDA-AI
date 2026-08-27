import { describe, expect, it } from "vitest";

import {
  formatLabel,
  labelPathsEqual,
  labelToId,
  parseLabel,
} from "./labels";

describe("parseLabel", () => {
  it("parses a plain number", () => {
    expect(parseLabel("3")).toEqual(["3"]);
    expect(parseLabel("5.")).toEqual(["5"]);
  });

  it("parses nested sub-parts in the printed bracket form", () => {
    expect(parseLabel("11(a)(ii)")).toEqual(["11", "a", "ii"]);
  });

  it("normalizes the many ways the same label gets written", () => {
    const expected = ["11", "a", "ii"];
    for (const variant of [
      "11(a)(ii)",
      "11 a) ii)",
      "Q11 a ii",
      "q11.a.ii",
      "Ans 11 (a) (ii)",
      "  11(A)(II)  ",
    ]) {
      expect(parseLabel(variant), variant).toEqual(expected);
    }
  });

  it("strips stacked prefixes", () => {
    expect(parseLabel("Answer no. 4")).toEqual(["4"]);
    expect(parseLabel("Q.7")).toEqual(["7"]);
    expect(parseLabel("#12")).toEqual(["12"]);
  });

  it("returns null when there is nothing label-like", () => {
    expect(parseLabel("")).toBeNull();
    expect(parseLabel("   ")).toBeNull();
    expect(parseLabel("...")).toBeNull();
  });

  it("rejects prose so a sentence is never matched as a label", () => {
    // Five-plus tokens is a sentence, not a label; matching it would silently
    // attach an answer to the wrong question.
    expect(
      parseLabel("The mitochondria is the powerhouse of the cell"),
    ).toBeNull();
  });

  it("keeps a bare roman or alpha sub-part", () => {
    expect(parseLabel("(iii)")).toEqual(["iii"]);
    expect(parseLabel("b)")).toEqual(["b"]);
  });
});

describe("formatLabel", () => {
  it("renders the first level plain and deeper levels bracketed", () => {
    expect(formatLabel(["11", "a", "ii"])).toBe("11(a)(ii)");
    expect(formatLabel(["7"])).toBe("7");
    expect(formatLabel([])).toBe("");
  });
});

describe("labelToId", () => {
  it("produces a stable url-safe id", () => {
    expect(labelToId(["11", "a", "ii"])).toBe("q-11-a-ii");
  });

  it("gives different labels different ids", () => {
    expect(labelToId(["11", "a"])).not.toBe(labelToId(["11", "b"]));
  });
});

describe("labelPathsEqual", () => {
  it("compares element-wise", () => {
    expect(labelPathsEqual(["11", "a"], ["11", "a"])).toBe(true);
    expect(labelPathsEqual(["11", "a"], ["11", "b"])).toBe(false);
  });

  it("does not treat a parent as equal to its child", () => {
    expect(labelPathsEqual(["11"], ["11", "a"])).toBe(false);
  });
});
