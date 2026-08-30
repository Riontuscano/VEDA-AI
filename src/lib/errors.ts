/**
 * Typed errors.
 *
 * Every failure crossing a boundary (upload, model call, pipeline stage)
 * becomes one of these, so route handlers can map to an HTTP status and the
 * UI can show a real message instead of a stuck spinner or a raw 500.
 */

export type ErrorStage =
  | "config"
  | "ingest"
  | "extract_questions"
  | "extract_answers"
  | "mapping"
  | "unknown";

export type AppErrorOptions = {
  stage?: ErrorStage;
  /** Machine-readable discriminator, e.g. "page_limit_exceeded". */
  code?: string;
  httpStatus?: number;
  /** Whether retrying the same call could plausibly succeed. */
  retryable?: boolean;
  /**
   * HTTP status reported by an upstream service. 429 and 503 mean "overloaded,
   * come back later" and deserve a much longer backoff than a generic failure.
   */
  upstreamStatus?: number;
  cause?: unknown;
};

export class AppError extends Error {
  readonly stage: ErrorStage;
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly upstreamStatus: number | undefined;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.stage = options.stage ?? "unknown";
    this.code = options.code ?? "internal_error";
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? false;
    this.upstreamStatus = options.upstreamStatus;
  }

  /** True when the upstream said it was overloaded rather than broken. */
  get isUpstreamOverloaded(): boolean {
    return this.upstreamStatus === 429 || this.upstreamStatus === 503;
  }
}

/** Bad client input — file type, size, page count. Never retryable. */
export class ValidationError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: "validation_failed",
      httpStatus: 400,
      retryable: false,
      ...options,
    });
  }
}

export class NotFoundError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: "not_found",
      httpStatus: 404,
      retryable: false,
      ...options,
    });
  }
}

/** The model API itself failed — network, rate limit, 5xx. Usually retryable. */
export class ModelError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: "model_call_failed",
      httpStatus: 502,
      retryable: true,
      ...options,
    });
  }
}

/**
 * The model responded, but the payload did not match the expected schema.
 * Retryable exactly once with a corrective prompt — see `src/lib/ai/client.ts`.
 */
export class SchemaError extends AppError {
  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, {
      code: "model_schema_mismatch",
      httpStatus: 502,
      retryable: true,
      ...options,
    });
  }
}

export function toAppError(error: unknown, stage: ErrorStage): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError(message, { stage, cause: error });
}
