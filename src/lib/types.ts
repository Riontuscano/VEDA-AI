// Every stage, route and component is written against these types, never
// against raw model output. Coercion happens at the adapter boundary.

/** Which of the two uploaded documents something belongs to. */
export type DocumentKind = "question_paper" | "answer_sheet";

/**
 * Normalized to 0..1 of the page, so the viewer can scale freely without
 * coordinate math leaking out of the render layer.
 */
export type BoundingBox = {
  /** 0-indexed page within its source document. */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** Drives the "approximate location" badge and the fallback logging. */
export type BoxSource = "model" | "page_fallback";

export type LocatedBox = BoundingBox & { source: BoxSource };

/** One rasterized page, as uploaded by the client. */
export type PageRef = {
  index: number;
  /** Pixel dimensions of the uploaded raster, kept for aspect-ratio layout. */
  width: number;
  height: number;
  /** Opaque key into the FileStore. */
  storageKey: string;
};

export type Question = {
  /** Stable id derived from `labelPath`, e.g. "q-11-a-ii". */
  id: string;
  /** Outermost first: `["11","a","ii"]`. Real papers nest arbitrarily deep. */
  labelPath: string[];
  /** Display form of `labelPath`, e.g. "11(a)(ii)". */
  label: string;
  text: string;
  /** Derived from (page, box.y). Model-assigned order isn't consistent. */
  order: number;
  page: number;
  box: LocatedBox;
};

export type AnswerBlock = {
  id: string;
  /** What the student wrote. Null when unlabelled, common on continuations. */
  rawLabel: string | null;
  /** Transcribed handwriting. */
  text: string;
  /** More than one when the answer spans pages or columns. */
  boxes: LocatedBox[];
  /** Model's self-reported transcription confidence, 0..1. */
  confidence: number;
};

export type MatchType = "labelled" | "inferred" | "positional" | "unmatched";

export type Mapping = {
  /** Null means this answer matches no question on the paper. */
  questionId: string | null;
  /** Empty means this question was not answered. */
  answerBlockIds: string[];
  matchType: MatchType;
  confidence: number;
};

export type SessionStatus =
  | "uploading"
  | "extracting_questions"
  | "extracting_answers"
  | "mapping"
  | "done"
  | "failed";

export type PipelineError = {
  stage: string;
  message: string;
  /** True when the pipeline recovered and continued past this error. */
  recovered: boolean;
};

export type SessionResult = {
  sessionId: string;
  status: SessionStatus;
  createdAt: number;
  questionPages: PageRef[];
  answerPages: PageRef[];
  questions: Question[];
  answers: AnswerBlock[];
  mappings: Mapping[];
  errors: PipelineError[];
};

/** Status payload polled by the client; excludes the heavy result arrays. */
export type SessionStatusPayload = {
  sessionId: string;
  status: SessionStatus;
  errors: PipelineError[];
};

/** What the viewer needs. Storage keys never leave the server. */
export type PageView = {
  index: number;
  width: number;
  height: number;
  url: string;
};

/** Response shape of `GET /api/sessions/:id/result`. */
export type SessionResultPayload = {
  sessionId: string;
  status: SessionStatus;
  questionPages: PageView[];
  answerPages: PageView[];
  questions: Question[];
  answers: AnswerBlock[];
  mappings: Mapping[];
  errors: PipelineError[];
};
