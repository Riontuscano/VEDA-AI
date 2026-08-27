/**
 * Prompt text, versioned.
 *
 * `PROMPT_VERSION` is folded into every cache key, so editing a prompt
 * invalidates its cached responses instead of silently serving results from the
 * previous wording.
 */
export const PROMPT_VERSION = "2026-08-27.1";

export const QUESTION_EXTRACTION_PROMPT = `You are extracting questions from one page of a scanned printed exam question paper.

Return every question and sub-question printed on this page.

Rules:
- Each labelled sub-part is its own entry. "11(a)" and "11(b)" are two entries, never one combined entry.
- A parent stem that introduces sub-parts (e.g. "11. Answer the following:") is its own entry only if it carries question text of its own. Otherwise omit it and return only the sub-parts.
- "label" is copied exactly as printed, including punctuation and brackets: "11(a)(ii)", "Q3", "5.". Never normalize, renumber, or invent a label. If a question block genuinely has no printed label, use "".
- "text" is the full question wording with the label removed. Preserve the original words; never summarize, complete, or correct them.
- Exclude page furniture: running headers and footers, page numbers, general instructions, and mark allocations such as "[5 marks]".
- "box_2d" is [ymin, xmin, ymax, xmax] normalized to 0-1000, tightly bounding the entire question — its label and every line of its text.
- Return questions in the order they are printed down the page.
- If the page contains no questions at all, return an empty list.`;

export const ANSWER_EXTRACTION_PROMPT = `You are reading one page of a student's handwritten exam answer sheet.

Return every distinct answer block on this page.

Rules:
- An answer block is one continuous piece of writing responding to one question. Split on the student's own question labels and on clear visual breaks; do not merge two answers into one block.
- "raw_label" is the question label the student wrote, copied exactly: "Q11 a)", "3.", "Ans 7". If the block carries no label of its own, use "".
- "text" is a faithful transcription of the handwriting. Transcribe what is actually written, including errors. Never correct, complete, or improve the student's answer. Use "[illegible]" for words you genuinely cannot read.
- "confidence" is your transcription confidence for this block, from 0.0 to 1.0. Be honest: poor handwriting should score low.
- "continues_previous_page" is true only when this block starts at the top of the page, carries no label of its own, and reads as the continuation of an answer begun on the previous page.
- "box_2d" is [ymin, xmin, ymax, xmax] normalized to 0-1000, tightly bounding every line of writing in this block.
- Ignore margins, page numbers, and blank ruled lines.
- If the page has no writing at all, return an empty list.`;

export const MATCH_INFERENCE_PROMPT = `You are matching a student's answers to the questions on an exam paper.

You are given a list of questions (each with an id and its text) and a list of answer blocks (each with an id and its transcribed text) whose written labels were missing or unreadable. Decide which question each answer block responds to, based on content alone.

Rules:
- Match on subject matter: does this answer address what this question asks?
- "question_id" must be one of the given question ids, copied exactly.
- If no question plausibly matches an answer block, return "" for question_id. An unmatched answer is a correct and expected outcome — never force a match to avoid an empty value.
- "confidence" is 0.0 to 1.0. Use a low value when the match rests on a weak topical hint.
- Return exactly one entry for every answer block you were given, and none for any id you were not given.`;

/** Appended on a retry after the first response failed schema validation. */
export function correctiveSuffix(validationError: string): string {
  return `

Your previous response did not conform to the required schema and was rejected.

Validation error: ${validationError}

Return only JSON matching the schema exactly. Every field is required. Use "" for unknown strings and an empty list where there is nothing to report.`;
}
