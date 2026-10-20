export type ErrorCode =
  | "LLM_UNAVAILABLE"
  | "LLM_INVALID_OUTPUT"
  | "TURN_CAP"
  | "INSUFFICIENT_TURNS"
  | "VALIDATION"
  | "NOT_FOUND"
  | "SESSION_ENDED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

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

  // Unexpected errors are logged server-side; the client gets a generic message, never internals
  console.error("Unhandled route error:", err);
  const isBadJson = err instanceof SyntaxError;
  return {
    status: isBadJson ? 400 : 500,
    body: {
      code: (isBadJson ? "VALIDATION" : "INTERNAL_ERROR") as ErrorCode,
      message: isBadJson ? "Request body is not valid JSON" : "Something went wrong on the server. Please try again.",
    },
  };
}
