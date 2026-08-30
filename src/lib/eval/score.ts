import {
  labelPathsEqual,
  parseLabel,
} from "@/lib/pipeline/labels";
import type { AnswerBlock, Mapping, Question } from "@/lib/types";

/**
 * Accuracy scoring against hand-written ground truth.
 *
 * Pure, so the metric definitions are unit-testable and cannot drift depending
 * on which document happened to be run. Everything here compares *normalized
 * label paths*, never raw strings, so "3(a)" and "3 a)" count as the same
 * question.
 */

export type ExpectedQuestion = {
  label: string;
  answered: boolean;
  /** Substring the matched answer must contain, case-insensitive. */
  answerContains?: string;
  /** Pages the matched answer is expected to span. */
  answerSpansPages?: number[];
};

export type GroundTruth = {
  name: string;
  questionPages: string[];
  answerPages: string[];
  questions: ExpectedQuestion[];
  orphanAnswers: { contains: string }[];
};

export type Metric = {
  name: string;
  /** 0..1 */
  score: number;
  detail: string;
  /** Individual misses, for the report. */
  failures: string[];
};

export type ActualResult = {
  questions: Question[];
  answers: AnswerBlock[];
  mappings: Mapping[];
};

const normalize = (label: string): string[] | null => parseLabel(label);

const sameLabel = (a: string, b: string): boolean => {
  const pathA = normalize(a);
  const pathB = normalize(b);
  return pathA !== null && pathB !== null && labelPathsEqual(pathA, pathB);
};

const ratio = (hit: number, total: number): number =>
  total === 0 ? 1 : hit / total;

export function scoreRun(
  truth: GroundTruth,
  actual: ActualResult,
): Metric[] {
  return [
    questionRecall(truth, actual),
    questionPrecision(truth, actual),
    orderingAccuracy(truth, actual),
    answeredClassification(truth, actual),
    mappingCorrectness(truth, actual),
    multiPageMerging(truth, actual),
    orphanDetection(truth, actual),
  ];
}

/** Did we find every question that is really on the paper? */
function questionRecall(truth: GroundTruth, actual: ActualResult): Metric {
  const failures = truth.questions
    .filter(
      (expected) =>
        !actual.questions.some((q) => sameLabel(q.label, expected.label)),
    )
    .map((expected) => `missed question ${expected.label}`);

  const found = truth.questions.length - failures.length;
  return {
    name: "Question recall",
    score: ratio(found, truth.questions.length),
    detail: `${found}/${truth.questions.length} found`,
    failures,
  };
}

/**
 * Did we invent questions that are not on the paper?
 *
 * Worth measuring separately from recall: a parent stem like "3. Answer both
 * parts:" emitted as a question shows up as a phantom unanswered row, which
 * recall alone would never catch.
 */
function questionPrecision(truth: GroundTruth, actual: ActualResult): Metric {
  const failures = actual.questions
    .filter(
      (q) => !truth.questions.some((expected) => sameLabel(q.label, expected.label)),
    )
    .map((q) => `extra question "${q.label}"`);

  const real = actual.questions.length - failures.length;
  return {
    name: "Question precision",
    score: ratio(real, actual.questions.length),
    detail: `${real}/${actual.questions.length} are real`,
    failures,
  };
}

/** Are the questions in printed order? Compared over the ones we did find. */
function orderingAccuracy(truth: GroundTruth, actual: ActualResult): Metric {
  const expectedOrder = truth.questions
    .map((expected) => expected.label)
    .filter((label) => actual.questions.some((q) => sameLabel(q.label, label)));

  const actualOrder = [...actual.questions]
    .sort((a, b) => a.order - b.order)
    .map((q) => q.label)
    .filter((label) =>
      truth.questions.some((expected) => sameLabel(expected.label, label)),
    );

  const failures: string[] = [];
  let correct = 0;
  expectedOrder.forEach((label, index) => {
    const at = actualOrder[index];
    if (at !== undefined && sameLabel(at, label)) correct += 1;
    else failures.push(`position ${index + 1}: expected ${label}, got ${at ?? "nothing"}`);
  });

  return {
    name: "Printed order",
    score: ratio(correct, expectedOrder.length),
    detail: `${correct}/${expectedOrder.length} in position`,
    failures,
  };
}

/** Answered vs unanswered, per question. Both directions matter equally. */
function answeredClassification(
  truth: GroundTruth,
  actual: ActualResult,
): Metric {
  const failures: string[] = [];
  let correct = 0;

  for (const expected of truth.questions) {
    const question = actual.questions.find((q) =>
      sameLabel(q.label, expected.label),
    );
    if (!question) continue;

    const mapping = actual.mappings.find((m) => m.questionId === question.id);
    const isAnswered = (mapping?.answerBlockIds.length ?? 0) > 0;

    if (isAnswered === expected.answered) correct += 1;
    else if (expected.answered) {
      failures.push(`${expected.label} should be answered but was not matched`);
    } else {
      failures.push(`${expected.label} should be unanswered but got an answer`);
    }
  }

  const scored = truth.questions.filter((expected) =>
    actual.questions.some((q) => sameLabel(q.label, expected.label)),
  ).length;

  return {
    name: "Answered / unanswered",
    score: ratio(correct, scored),
    detail: `${correct}/${scored} classified`,
    failures,
  };
}

/** For questions we marked answered, is it the RIGHT answer? */
function mappingCorrectness(truth: GroundTruth, actual: ActualResult): Metric {
  const expectedAnswered = truth.questions.filter(
    (expected) => expected.answered && expected.answerContains,
  );

  const answersById = new Map(actual.answers.map((a) => [a.id, a]));
  const failures: string[] = [];
  let correct = 0;

  for (const expected of expectedAnswered) {
    const question = actual.questions.find((q) =>
      sameLabel(q.label, expected.label),
    );
    const mapping = question
      ? actual.mappings.find((m) => m.questionId === question.id)
      : undefined;

    const text = (mapping?.answerBlockIds ?? [])
      .map((id) => answersById.get(id)?.text ?? "")
      .join(" ")
      .toLowerCase();

    const needle = expected.answerContains!.toLowerCase();
    if (text.includes(needle)) correct += 1;
    else {
      failures.push(
        `${expected.label} mapped to text not containing "${expected.answerContains}"`,
      );
    }
  }

  return {
    name: "Mapping correctness",
    score: ratio(correct, expectedAnswered.length),
    detail: `${correct}/${expectedAnswered.length} matched right answer`,
    failures,
  };
}

/** Did answers running across a page break get joined back together? */
function multiPageMerging(truth: GroundTruth, actual: ActualResult): Metric {
  const expected = truth.questions.filter((q) => q.answerSpansPages?.length);
  const answersById = new Map(actual.answers.map((a) => [a.id, a]));
  const failures: string[] = [];
  let correct = 0;

  for (const item of expected) {
    const question = actual.questions.find((q) =>
      sameLabel(q.label, item.label),
    );
    const mapping = question
      ? actual.mappings.find((m) => m.questionId === question.id)
      : undefined;

    const pages = new Set(
      (mapping?.answerBlockIds ?? []).flatMap((id) =>
        (answersById.get(id)?.boxes ?? []).map((box) => box.page),
      ),
    );

    const wanted = item.answerSpansPages ?? [];
    if (wanted.every((page) => pages.has(page))) correct += 1;
    else {
      failures.push(
        `${item.label} should span pages ${wanted.join(",")} but covers ${[...pages].join(",") || "none"}`,
      );
    }
  }

  return {
    name: "Multi-page merging",
    score: ratio(correct, expected.length),
    detail: `${correct}/${expected.length} spanned correctly`,
    failures,
  };
}

/** Answers to questions that are not on the paper must be surfaced, not absorbed. */
function orphanDetection(truth: GroundTruth, actual: ActualResult): Metric {
  const orphanIds = actual.mappings
    .filter((m) => m.questionId === null)
    .flatMap((m) => m.answerBlockIds);
  const answersById = new Map(actual.answers.map((a) => [a.id, a]));
  const orphanText = orphanIds
    .map((id) => answersById.get(id)?.text ?? "")
    .join(" ")
    .toLowerCase();

  const failures: string[] = [];
  let correct = 0;

  for (const expected of truth.orphanAnswers) {
    if (orphanText.includes(expected.contains.toLowerCase())) correct += 1;
    else {
      failures.push(
        `expected an unmatched answer containing "${expected.contains}"`,
      );
    }
  }

  // A forced match is as wrong as a missed one, so count extras too.
  const extra = orphanIds.length - truth.orphanAnswers.length;
  if (extra > 0) failures.push(`${extra} more unmatched answer(s) than expected`);

  return {
    name: "Unmatched answers",
    score: ratio(correct, truth.orphanAnswers.length),
    detail: `${correct}/${truth.orphanAnswers.length} surfaced`,
    failures,
  };
}

/** Unweighted mean, so no single metric can hide a failure in another. */
export function overallScore(metrics: Metric[]): number {
  if (metrics.length === 0) return 0;
  return metrics.reduce((sum, m) => sum + m.score, 0) / metrics.length;
}
