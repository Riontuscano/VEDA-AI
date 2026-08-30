import { z } from "zod";

/**
 * Schemas for raw model output, separate from the domain types.
 *
 * Two rules keep these compatible with Gemini's structured-output dialect:
 * no optional or nullable fields (unions are the usual cause of a rejected
 * schema; the prompt states a sentinel instead), and fixed-length arrays use
 * `.length()` so they serialize to minItems/maxItems, not prefixItems.
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
  /** Drives the multi-page merge. Asked directly rather than inferred. */
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

/** Gemini rejects the metadata Zod emits by default, so strip it. */
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
