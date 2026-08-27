/**
 * Model connectivity smoke check.
 *
 * Runs one cheap text-only call through the real adapter to confirm three
 * things before spending time on page images:
 *
 *   1. the API key authenticates,
 *   2. Gemini accepts the Zod-derived JSON Schema we send as `responseJsonSchema`,
 *   3. the response validates against that schema on the way back.
 *
 *   npm run smoke:gemini
 */
import { getAiProvider } from "@/lib/ai";
import { getConfig } from "@/lib/config";
import { labelToId, parseLabel } from "@/lib/pipeline/labels";
import { logger } from "@/lib/logger";
import type { AnswerBlock, Question } from "@/lib/types";

function question(label: string, text: string): Question {
  const path = parseLabel(label) ?? [];
  return {
    id: labelToId(path),
    labelPath: path,
    label,
    text,
    order: 0,
    page: 0,
    box: { page: 0, x: 0, y: 0, w: 1, h: 0.1, source: "model" },
  };
}

function answer(id: string, text: string): AnswerBlock {
  return {
    id,
    rawLabel: null,
    text,
    boxes: [{ page: 0, x: 0, y: 0, w: 1, h: 0.1, source: "model" }],
    confidence: 0.9,
  };
}

async function main(): Promise<void> {
  const config = getConfig();
  console.log(`Model: ${config.geminiModel}`);

  const questions = [
    question("1", "Define photosynthesis."),
    question("2", "State Newton's second law of motion."),
    question("3", "What is the capital of France?"),
  ];

  const answers = [
    answer("a1", "Force equals mass times acceleration."),
    answer("a2", "Plants convert sunlight into chemical energy using chlorophyll."),
    answer("a3", "The mitochondria produces ATP in the cell."),
  ];

  const matches = await getAiProvider().inferMatches(
    questions,
    answers,
    logger.child({ smoke: true }),
  );

  console.log("\nContent-based matches returned:");
  for (const match of matches) {
    const target = match.questionId
      ? questions.find((q) => q.id === match.questionId)?.label
      : "(no match)";
    const source = answers.find((a) => a.id === match.answerBlockId)?.text;
    console.log(
      `  ${match.answerBlockId} -> Q${target}  (${match.confidence.toFixed(2)})  "${source?.slice(0, 45)}…"`,
    );
  }

  // a1 answers question 2, a2 answers question 1, and a3 answers nothing on
  // this paper. Getting that right means the matcher works end to end.
  const byAnswer = new Map(matches.map((m) => [m.answerBlockId, m.questionId]));
  const expected: Array<[string, string | null]> = [
    ["a1", "q-2"],
    ["a2", "q-1"],
    ["a3", null],
  ];

  console.log("");
  let allCorrect = true;
  for (const [answerId, want] of expected) {
    const got = byAnswer.get(answerId) ?? null;
    const ok = got === want;
    allCorrect &&= ok;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${answerId}: expected ${want ?? "unmatched"}, got ${got ?? "unmatched"}`,
    );
  }

  console.log(
    allCorrect
      ? "\nSmoke check passed: auth, structured output and matching all work.\n"
      : "\nCalls worked, but the matching was not what was expected — check the prompt.\n",
  );
}

main().catch((error: unknown) => {
  console.error("\nSmoke check FAILED\n");
  console.error(error);
  process.exitCode = 1;
});
