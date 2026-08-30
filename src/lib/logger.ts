/**
 * One JSON object per line, tagged with `sessionId` via `logger.child()`, so a
 * failed extraction can be reconstructed from logs rather than re-run.
 */

type Level = "debug" | "info" | "warn" | "error";
type Fields = Record<string, unknown>;

const LEVEL_ORDER: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const minLevel: Level =
  (process.env.LOG_LEVEL as Level | undefined) ??
  (process.env.NODE_ENV === "production" ? "info" : "debug");

function serializeError(value: unknown): Fields {
  if (!(value instanceof Error)) return { error: String(value) };
  return {
    error: value.message,
    errorName: value.name,
    ...(value.cause ? { errorCause: String(value.cause) } : {}),
    ...(process.env.NODE_ENV === "production" ? {} : { stack: value.stack }),
  };
}

function emit(bound: Fields, level: Level, message: string, fields?: Fields) {
  if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;

  const { err, ...rest } = fields ?? {};
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    message,
    ...bound,
    ...rest,
    ...(err === undefined ? {} : serializeError(err)),
  });

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export type Logger = {
  debug(message: string, fields?: Fields): void;
  info(message: string, fields?: Fields): void;
  warn(message: string, fields?: Fields): void;
  error(message: string, fields?: Fields): void;
  child(fields: Fields): Logger;
};

function make(bound: Fields): Logger {
  return {
    debug: (m, f) => emit(bound, "debug", m, f),
    info: (m, f) => emit(bound, "info", m, f),
    warn: (m, f) => emit(bound, "warn", m, f),
    error: (m, f) => emit(bound, "error", m, f),
    child: (fields) => make({ ...bound, ...fields }),
  };
}

export const logger = make({});
