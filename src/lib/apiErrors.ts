/** Client-side mapping from API error codes to copy a user can act on. */
export interface ApiErrorBody {
  code?: string;
  message?: string;
}

export interface FriendlyError {
  code: string;
  message: string;
  retryable: boolean;
}

export function describeApiError(body: ApiErrorBody | null | undefined, fallback: string): FriendlyError {
  const code = body?.code || "UNKNOWN";
  switch (code) {
    case "LLM_UNAVAILABLE":
      return {
        code,
        retryable: true,
        message:
          body?.message ||
          "All AI providers failed to respond (usually a free-tier rate limit). Nothing was faked; please retry in a moment.",
      };
    case "LLM_INVALID_OUTPUT":
      return { code, retryable: true, message: "The AI returned a malformed response twice. Please retry." };
    case "TURN_CAP":
      return { code, retryable: false, message: "You've reached this session's turn limit. End the simulation to see your report." };
    case "INSUFFICIENT_TURNS":
      return { code, retryable: false, message: "Reply to the persona at least twice before ending, so there is enough to evaluate." };
    case "RATE_LIMITED":
      return {
        code,
        retryable: true,
        message: body?.message || "Too many requests. Please wait a few minutes and try again.",
      };
    case "SESSION_ENDED":
      return { code, retryable: false, message: "This simulation has already ended." };
    case "NOT_FOUND":
      return { code, retryable: false, message: body?.message || "That session no longer exists." };
    case "VALIDATION":
      return { code, retryable: false, message: body?.message || "Some inputs are invalid." };
    default:
      return { code, retryable: true, message: body?.message || fallback };
  }
}

/** Parses a fetch Response as JSON without throwing on an empty or non-JSON body. */
export async function readJson<T = Record<string, unknown>>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
