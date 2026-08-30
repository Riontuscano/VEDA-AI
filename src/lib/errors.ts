/**
 * Every failure crossing a boundary becomes one of these, so routes can map to
 * a status and the UI can show a real message instead of a stuck spinner.
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
  /** Upstream HTTP status. Drives whether we rotate keys or back off. */
  upstreamStatus?: number;
  /** Which key the failed call used, so quota failures sideline just that one. */
  apiKey?: string;
  cause?: unknown;
};

export class AppError extends Error {
  readonly stage: ErrorStage;
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly upstreamStatus: number | undefined;
  readonly apiKey: string | undefined;

  constructor(message: string, options: AppErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.stage = options.stage ?? "unknown";
    this.code = options.code ?? "internal_error";
    this.httpStatus = options.httpStatus ?? 500;
    this.retryable = options.retryable ?? false;
    this.upstreamStatus = options.upstreamStatus;
    this.apiKey = options.apiKey;
  }

  /** Specific to the key used, so another key may succeed right now. */
  get isKeyExhausted(): boolean {
    return this.upstreamStatus === 429 || this.upstreamStatus === 403;
  }

  /** Every key shares this, so rotating won't help. Wait instead. */
  get isUpstreamOverloaded(): boolean {
    return this.upstreamStatus === 503 || this.upstreamStatus === 500;
  }
}

/** Bad client input: file type, size, page count. Never retryable. */
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

/** The model API failed: network, rate limit, 5xx. Usually retryable. */
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

/** Responded, but the payload failed validation. Worth one corrective retry. */
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
