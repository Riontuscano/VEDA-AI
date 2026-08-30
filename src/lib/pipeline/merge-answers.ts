import type { PageAnswerBlock } from "@/lib/ai/provider";
import { readingOrderCompare } from "@/lib/ai/geometry";
import type { AnswerBlock } from "@/lib/types";
import { labelPathsEqual, parseLabel } from "./labels";

/**
 * Joins an answer split across a page break.
 *
 * The common case is a student who just keeps writing with no label, so that
 * is the primary rule. Repeating the label on the next page is rarer and
 * handled second.
 */
export function mergeAnswerBlocks(blocks: PageAnswerBlock[]): AnswerBlock[] {
  const ordered = [...blocks].sort((a, b) => {
    if (a.page !== b.page) return a.page - b.page;
    const [boxA] = a.boxes;
    const [boxB] = b.boxes;
    if (!boxA || !boxB) return 0;
    return readingOrderCompare(boxA, boxB);
  });

  const merged: AnswerBlock[] = [];
  /** Page of the block currently at the tail of `merged`. */
  let tailPage: number | null = null;
  let previousPage: number | null = null;

  for (const block of ordered) {
    const isFirstOnPage = block.page !== previousPage;
    previousPage = block.page;

    const tail = merged[merged.length - 1];
    const continues =
      tail !== undefined &&
      tailPage !== null &&
      // Must continue an answer from an earlier page. Without this, a stray
      // flag on a mid-page block swallows a separate answer.
      tailPage < block.page &&
      (continuesUnlabelled(block, isFirstOnPage) || repeatsLabel(block, tail));

    if (!continues || !tail) {
      merged.push(toAnswerBlock(block));
      tailPage = block.page;
      continue;
    }

    merged[merged.length - 1] = {
      ...tail,
      text: [tail.text, block.text].filter(Boolean).join("\n"),
      boxes: [...tail.boxes, ...block.boxes],
      // A merged answer is only as legible as its worst part.
      confidence: Math.min(tail.confidence, block.confidence),
    };
    tailPage = block.page;
  }

  return merged;
}

/** Primary rule: unlabelled writing at the top of the next page. */
function continuesUnlabelled(
  block: PageAnswerBlock,
  isFirstOnPage: boolean,
): boolean {
  return (
    isFirstOnPage && block.rawLabel === null && block.continuesPreviousPage
  );
}

/** Secondary rule: the student re-wrote the same label on the next page. */
function repeatsLabel(block: PageAnswerBlock, tail: AnswerBlock): boolean {
  if (block.rawLabel === null || tail.rawLabel === null) return false;
  const blockPath = parseLabel(block.rawLabel);
  const tailPath = parseLabel(tail.rawLabel);
  if (!blockPath || !tailPath) return false;
  return labelPathsEqual(blockPath, tailPath);
}

function toAnswerBlock(block: PageAnswerBlock): AnswerBlock {
  return {
    id: block.id,
    rawLabel: block.rawLabel,
    text: block.text,
    boxes: block.boxes,
    confidence: block.confidence,
  };
}
