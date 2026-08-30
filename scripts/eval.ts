/**
 * Accuracy evaluation against hand-written ground truth.
 *
 *   npm run eval                 # all cases, cached where possible
 *   npm run eval -- --no-cache   # force live model calls
 *   npm run eval -- synthetic    # one case by name
 *
 * Runs the real pipeline end to end and scores the result, so prompt changes
 * can be judged by numbers rather than by re-reading one document and forming
 * an impression. Exits non-zero if any metric regresses below its threshold,
 * which makes it usable as a gate.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { getAiProvider } from "@/lib/ai";
import {
  overallScore,
  scoreRun,
  type GroundTruth,
  type Metric,
} from "@/lib/eval/score";
import { sniffImageType } from "@/lib/ingest/validate";
import { logger } from "@/lib/logger";
import { runPipeline } from "@/lib/pipeline/run";
import { MemorySessionStore } from "@/lib/store/memory-session-store";
import type { FileStore, StoredFile } from "@/lib/store/types";
import type { PageRef } from "@/lib/types";

/** Below this, the run is treated as a regression. */
const THRESHOLD = 0.9;

const FIXTURES = path.resolve("fixtures");
const TRUTH_DIR = path.join(FIXTURES, "ground-truth");

/** Keeps fixture pages in memory; nothing here needs to touch disk. */
class MemoryFileStore implements FileStore {
  private readonly files = new Map<string, StoredFile>();

  async save(sessionId: string, name: string, file: StoredFile) {
    const key = `${sessionId}/${name}`;
    this.files.set(key, file);
    return key;
  }
  async read(key: string) {
    return this.files.get(key) ?? null;
  }
  async deleteSession() {}
}

async function loadPages(
  files: MemoryFileStore,
  sessionId: string,
  prefix: string,
  names: string[],
): Promise<PageRef[]> {
  const refs: PageRef[] = [];
  for (const [index, name] of names.entries()) {
    const bytes = new Uint8Array(await readFile(path.join(FIXTURES, name)));
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new Error(`${name} is not a PNG or JPEG`);
    const storageKey = await files.save(sessionId, `${prefix}-${index}`, {
      bytes,
      contentType,
    });
    // Dimensions are irrelevant to scoring; boxes are already normalized.
    refs.push({ index, width: 1000, height: 1414, storageKey });
  }
  return refs;
}

async function evaluate(truth: GroundTruth): Promise<Metric[]> {
  const sessions = new MemorySessionStore(10 * 60_000);
  const files = new MemoryFileStore();
  const sessionId = `eval-${truth.name}`;

  const [questionPages, answerPages] = await Promise.all([
    loadPages(files, sessionId, "q", truth.questionPages),
    loadPages(files, sessionId, "a", truth.answerPages),
  ]);

  await sessions.create({
    sessionId,
    status: "uploading",
    createdAt: Date.now(),
    questionPages,
    answerPages,
    questions: [],
    answers: [],
    mappings: [],
    errors: [],
  });

  await runPipeline(sessionId, {
    provider: getAiProvider(),
    sessions,
    files,
  });

  const result = await sessions.get(sessionId);
  if (!result) throw new Error("session vanished during evaluation");
  if (result.status !== "done") {
    throw new Error(
      `pipeline did not finish: ${result.errors.map((e) => e.message).join("; ")}`,
    );
  }

  return scoreRun(truth, result);
}

function bar(score: number): string {
  const filled = Math.round(score * 10);
  return `${"█".repeat(filled)}${"·".repeat(10 - filled)}`;
}

const pct = (score: number): string =>
  `${(score * 100).toFixed(0).padStart(3)}%`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--no-cache")) process.env.AI_CACHE_ENABLED = "false";
  const only = argv.filter((arg) => !arg.startsWith("--"));

  const names = (await readdir(TRUTH_DIR))
    .filter((file) => file.endsWith(".json"))
    .filter((file) => only.length === 0 || only.includes(path.parse(file).name));

  if (names.length === 0) {
    console.error(`No ground-truth files matched in ${TRUTH_DIR}`);
    process.exitCode = 1;
    return;
  }

  let failed = false;

  for (const file of names) {
    const truth = JSON.parse(
      await readFile(path.join(TRUTH_DIR, file), "utf8"),
    ) as GroundTruth;

    console.log(`\n\x1b[1m${truth.name}\x1b[0m`);
    console.log("─".repeat(64));

    const startedAt = Date.now();
    let metrics: Metric[];
    try {
      metrics = await evaluate(truth);
    } catch (error) {
      failed = true;
      console.log(
        `  FAILED TO RUN: ${error instanceof Error ? error.message : error}`,
      );
      continue;
    }

    for (const metric of metrics) {
      const ok = metric.score >= THRESHOLD;
      if (!ok) failed = true;
      console.log(
        `  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${bar(metric.score)} ${pct(metric.score)}  ${metric.name.padEnd(22)} ${metric.detail}`,
      );
      for (const failure of metric.failures) {
        console.log(`          \x1b[33m·\x1b[0m ${failure}`);
      }
    }

    const overall = overallScore(metrics);
    if (overall < THRESHOLD) failed = true;
    console.log("─".repeat(64));
    console.log(
      `  OVERALL ${pct(overall)}   ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );
  }

  console.log(
    failed
      ? `\n\x1b[31mAt least one metric is below ${THRESHOLD * 100}%.\x1b[0m\n`
      : `\n\x1b[32mAll metrics at or above ${THRESHOLD * 100}%.\x1b[0m\n`,
  );
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  logger.error("Evaluation crashed", { err: error });
  process.exitCode = 1;
});
