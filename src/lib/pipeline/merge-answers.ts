import type { PageAnswerBlock } from "@/lib/ai/provider";
import { readingOrderCompare } from "@/lib/ai/geometry";
import type { AnswerBlock } from "@/lib/types";
import { labelPathsEqual, parseLabel } from "./labels";

/**
 * Joins answer blocks that are one answer split across a page break.
 *
 * The dominant real case is a student who simply keeps writing on the next
 * page with no label at all — so the primary signal is "first block on its
 * page, unlabelled, and the model judged it a continuation". Repeating the
 * label on the continuation page is the rarer case and is handled as a
 * secondary rule.
 *
 * Pure, so every branch is covered by fixtures rather than by re-running the
 * model on a multi-page sheet.
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
      // A continuation belongs to an answer started on an *earlier* page.
      // Without this, a model that sets the flag on a mid-page block would
      // swallow a genuinely separate answer.
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
      // A merged answer is only as legible as its least legible part; taking
      // the max would overstate confidence in the joined transcription.
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
