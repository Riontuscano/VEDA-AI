import type { BoundingBox, LocatedBox } from "@/lib/types";

/**
 * Gemini emits boxes as `[ymin, xmin, ymax, xmax]` on a 0..1000 grid.
 * Everything downstream works in 0..1 `{x, y, w, h}` and may assume boxes are
 * in-bounds and non-degenerate.
 */

export const GEMINI_BOX_SCALE = 1000;

/**
 * Boxes thinner than this are model noise. Real answer regions are at least a
 * line tall, and highlighting a sliver renders as nothing.
 */
const MIN_SIDE = 0.005;

/** Used when the model gives nothing usable for a region. */
export function pageFallbackBox(page: number): LocatedBox {
  return { page, x: 0, y: 0, w: 1, h: 1, source: "page_fallback" };
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Returns null rather than throwing, so callers can fall back and log it. */
export function fromGeminiBox(
  raw: readonly number[],
  page: number,
): LocatedBox | null {
  if (raw.length !== 4) return null;
  if (!raw.every((n) => Number.isFinite(n))) return null;

  const [rawYMin, rawXMin, rawYMax, rawXMax] = raw as [
    number,
    number,
    number,
    number,
  ];

  // Some responses transpose the corners; reordering is cheaper than
  // discarding an otherwise plausible box.
  const yMin = clamp01(Math.min(rawYMin, rawYMax) / GEMINI_BOX_SCALE);
  const yMax = clamp01(Math.max(rawYMin, rawYMax) / GEMINI_BOX_SCALE);
  const xMin = clamp01(Math.min(rawXMin, rawXMax) / GEMINI_BOX_SCALE);
  const xMax = clamp01(Math.max(rawXMin, rawXMax) / GEMINI_BOX_SCALE);

  const w = xMax - xMin;
  const h = yMax - yMin;
  if (w < MIN_SIDE || h < MIN_SIDE) return null;

  return { page, x: xMin, y: yMin, w, h, source: "model" };
}

/** Smallest box containing all inputs. Undefined for an empty list. */
export function unionBoxes(
  boxes: readonly BoundingBox[],
): BoundingBox | undefined {
  const first = boxes[0];
  if (!first) return undefined;

  let x = first.x;
  let y = first.y;
  let right = first.x + first.w;
  let bottom = first.y + first.h;

  for (const box of boxes.slice(1)) {
    x = Math.min(x, box.x);
    y = Math.min(y, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }

  return { page: first.page, x, y, w: right - x, h: bottom - y };
}

/**
 * Printed reading order, derived from geometry because model-assigned ordering
 * is not consistent across per-page calls.
 */
export function readingOrderCompare(a: BoundingBox, b: BoundingBox): number {
  if (a.page !== b.page) return a.page - b.page;
  // Treat near-equal tops as one line so side-by-side columns don't interleave.
  const sameLine = Math.abs(a.y - b.y) < 0.02;
  if (!sameLine) return a.y - b.y;
  return a.x - b.x;
}
