import { describe, expect, it } from "vitest";

import type { BoundingBox, BoxSource } from "@/lib/types";
import {
  fromGeminiBox,
  pageFallbackBox,
  readingOrderCompare,
  unionBoxes,
} from "./geometry";

/**
 * Compares boxes field-wise with a tolerance. Coordinates come out of float
 * subtraction (`0.6 - 0.2`), so exact structural equality is not a meaningful
 * assertion here.
 */
function expectBox(
  actual: (BoundingBox & { source?: BoxSource }) | null | undefined,
  expected: BoundingBox & { source?: BoxSource },
): void {
  expect(actual).not.toBeNull();
  if (!actual) return;
  expect(actual.page).toBe(expected.page);
  expect(actual.x).toBeCloseTo(expected.x, 6);
  expect(actual.y).toBeCloseTo(expected.y, 6);
  expect(actual.w).toBeCloseTo(expected.w, 6);
  expect(actual.h).toBeCloseTo(expected.h, 6);
  expect(actual.source).toBe(expected.source);
}

describe("fromGeminiBox", () => {
  it("converts [ymin, xmin, ymax, xmax] on a 0-1000 grid to normalized x/y/w/h", () => {
    expectBox(fromGeminiBox([100, 200, 300, 600], 0), {
      page: 0,
      x: 0.2,
      y: 0.1,
      w: 0.4,
      h: 0.2,
      source: "model",
    });
  });

  it("clamps out-of-range coordinates instead of discarding the box", () => {
    const box = fromGeminiBox([-50, -50, 1200, 1200], 1);
    expect(box).toEqual({
      page: 1,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      source: "model",
    });
  });

  it("repairs transposed corners", () => {
    const transposed = fromGeminiBox([300, 600, 100, 200], 0);
    expect(transposed).toEqual(fromGeminiBox([100, 200, 300, 600], 0));
  });

  it("rejects degenerate boxes so they can fall back explicitly", () => {
    expect(fromGeminiBox([500, 500, 500, 500], 0)).toBeNull();
    expect(fromGeminiBox([500, 200, 502, 600], 0)).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(fromGeminiBox([1, 2, 3], 0)).toBeNull();
    expect(fromGeminiBox([1, 2, 3, 4, 5], 0)).toBeNull();
    expect(fromGeminiBox([Number.NaN, 0, 100, 100], 0)).toBeNull();
  });
});

describe("pageFallbackBox", () => {
  it("covers the whole page and is marked as a fallback", () => {
    expect(pageFallbackBox(2)).toEqual({
      page: 2,
      x: 0,
      y: 0,
      w: 1,
      h: 1,
      source: "page_fallback",
    });
  });
});

describe("unionBoxes", () => {
  it("returns the smallest enclosing box", () => {
    const union = unionBoxes([
      { page: 0, x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
      { page: 0, x: 0.5, y: 0.4, w: 0.2, h: 0.2 },
    ]);
    expectBox(union, { page: 0, x: 0.1, y: 0.1, w: 0.6, h: 0.5 });
  });

  it("is undefined for no boxes", () => {
    expect(unionBoxes([])).toBeUndefined();
  });
});

describe("readingOrderCompare", () => {
  const box = (page: number, y: number, x = 0) => ({
    page,
    x,
    y,
    w: 0.1,
    h: 0.1,
  });

  it("orders by page before position", () => {
    expect(readingOrderCompare(box(0, 0.9), box(1, 0.1))).toBeLessThan(0);
  });

  it("orders top to bottom within a page", () => {
    expect(readingOrderCompare(box(0, 0.2), box(0, 0.7))).toBeLessThan(0);
  });

  it("orders left to right for boxes on the same visual line", () => {
    // Two-column layouts put side-by-side questions at near-identical y; a
    // pure y sort would interleave the columns.
    expect(
      readingOrderCompare(box(0, 0.305, 0.6), box(0, 0.3, 0.1)),
    ).toBeGreaterThan(0);
  });
});
