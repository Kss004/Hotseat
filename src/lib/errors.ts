export type ErrorCode =
  | "LLM_UNAVAILABLE"
  | "LLM_INVALID_OUTPUT"
  | "TURN_CAP"
  | "INSUFFICIENT_TURNS"
  | "INGEST_BLOCKED"
  | "VALIDATION"
  | "NOT_FOUND";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number = 400, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toErrorResponse(err: unknown) {
  if (isAppError(err)) {
    return {
      status: err.status,
      body: err.toJSON(),
    };
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  return {
    status: 500,
    body: {
      code: "INTERNAL_ERROR" as ErrorCode,
      message,
    },
  };
}
