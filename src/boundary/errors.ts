export type ApplicationErrorCode =
  | "invalid_input"
  | "invalid_json"
  | "not_found"
  | "payload_too_large";

export interface ApplicationError {
  code: ApplicationErrorCode;
  kind: "application";
  message: string;
  status: 400 | 404 | 413;
}

export interface TransportError {
  cause: unknown;
  code: "collect_transport_failure";
  kind: "transport";
  message: string;
  status: 502;
}

export interface UnexpectedError {
  cause: unknown;
  code: "unexpected_error";
  kind: "unexpected";
  message: "internal server error";
  status: 500;
}

export type BoundaryError = ApplicationError | TransportError | UnexpectedError;

export interface ValidationFailure {
  error: ApplicationError;
  ok: false;
}

export interface ValidationSuccess<T> {
  ok: true;
  value: T;
}

export type ValidationResult<T> = ValidationFailure | ValidationSuccess<T>;

export function applicationError(
  message: string,
  status: 400 | 404 | 413 = 400,
  code: ApplicationErrorCode = "invalid_input"
): ApplicationError {
  return { code, kind: "application", message, status };
}

export function transportError(
  message: string,
  cause: unknown
): TransportError {
  return {
    cause,
    code: "collect_transport_failure",
    kind: "transport",
    message,
    status: 502,
  };
}

export function isBoundaryError(
  error: unknown
): error is ApplicationError | TransportError {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  if (candidate.kind === "application") {
    const expectedStatus: Partial<Record<ApplicationErrorCode, number>> = {
      invalid_input: 400,
      invalid_json: 400,
      not_found: 404,
      payload_too_large: 413,
    };
    return (
      expectedStatus[candidate.code as ApplicationErrorCode] ===
        candidate.status && typeof candidate.message === "string"
    );
  }
  return (
    candidate.kind === "transport" &&
    candidate.code === "collect_transport_failure" &&
    candidate.status === 502 &&
    typeof candidate.message === "string" &&
    "cause" in candidate
  );
}

function isJsonSyntaxError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.type === "entity.parse.failed" && candidate.status === 400;
}

function isPayloadTooLarge(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Record<string, unknown>;
  return candidate.type === "entity.too.large" && candidate.status === 413;
}

export function classifyBoundaryError(error: unknown): BoundaryError {
  if (isBoundaryError(error)) return error;
  if (isJsonSyntaxError(error)) {
    return applicationError("invalid JSON", 400, "invalid_json");
  }
  if (isPayloadTooLarge(error)) {
    return applicationError("payload too large", 413, "payload_too_large");
  }
  return {
    cause: error,
    code: "unexpected_error",
    kind: "unexpected",
    message: "internal server error",
    status: 500,
  };
}
