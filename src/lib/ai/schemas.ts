import { z } from "zod";

/**
 * Schemas for *raw* model output — deliberately separate from the domain types
 * in `src/lib/types.ts`.
 *
 * These describe what the model is asked to emit; the adapter validates against
 * them and then coerces into domain shapes. Two rules keep the schemas
 * compatible with Gemini's structured-output dialect:
 *
 *  1. No optional fields and no nullable types. Every field is required, and
 *     the prompt states the sentinel value to use when something is unknown
 *     (empty string). Union types are the most common cause of a rejected
 *     response schema.
 *  2. Fixed-length arrays use `.length()` rather than tuples, which serialize
 *     to `minItems`/`maxItems` instead of `prefixItems`.
 */

/** `[ymin, xmin, ymax, xmax]`, normalized to 0..1000. See `geometry.ts`. */
const Box2d = z.array(z.number()).length(4);

export const RawQuestionSchema = z.object({
  /** Label exactly as printed, e.g. "11(a)(ii)" or "Q3". */
  label: z.string(),
  text: z.string(),
  box_2d: Box2d,
});

export const RawQuestionPageSchema = z.object({
  questions: z.array(RawQuestionSchema),
});

export const RawAnswerSchema = z.object({
  /** Label the student wrote, or "" when the block is unlabelled. */
  raw_label: z.string(),
  text: z.string(),
  box_2d: Box2d,
  confidence: z.number(),
  /**
   * True when this block visually continues an answer from the previous page:
   * it starts at the top of the page and carries no label of its own. Drives
   * the multi-page merge, which is why the model is asked directly rather than
   * having the merge infer it from position alone.
   */
  continues_previous_page: z.boolean(),
});

export const RawAnswerPageSchema = z.object({
  answers: z.array(RawAnswerSchema),
});

export const RawMatchSchema = z.object({
  answer_id: z.string(),
  /** Question id, or "" when no question on the paper plausibly matches. */
  question_id: z.string(),
  confidence: z.number(),
});

export const RawMatchListSchema = z.object({
  matches: z.array(RawMatchSchema),
});

export type RawQuestion = z.infer<typeof RawQuestionSchema>;
export type RawAnswer = z.infer<typeof RawAnswerSchema>;
export type RawMatch = z.infer<typeof RawMatchSchema>;

/**
 * Gemini rejects the JSON Schema metadata that Zod emits by default, so strip
 * it before sending. Kept here beside the schemas it applies to.
 */
export function toModelSchema(schema: z.ZodType): Record<string, unknown> {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  return stripUnsupported(jsonSchema);
}

function stripUnsupported(node: unknown): Record<string, unknown> {
  if (Array.isArray(node)) {
    return node.map(stripUnsupported) as unknown as Record<string, unknown>;
  }
  if (node === null || typeof node !== "object") {
    return node as Record<string, unknown>;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "$schema" || key === "additionalProperties") continue;
    output[key] = stripUnsupported(value);
  }
  return output;
}
