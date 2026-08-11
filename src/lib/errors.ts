export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_REFRESH_REUSED"
  | "AUTH_RESET_TOKEN_INVALID"
  | "AUTH_RESET_TOKEN_EXPIRED"
  | "AUTH_RESET_TOKEN_USED"
  | "AUTH_REAUTHENTICATION_REQUIRED"
  | "AUTH_PASSWORD_UNAVAILABLE";

export class ApiError extends Error {
  statusCode: number;
  code: ApiErrorCode;
  details?: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: unknown) {
    return new ApiError(400, "VALIDATION_ERROR", message, details);
  }

  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, "UNAUTHORIZED", message);
  }

  static auth(
    statusCode: number,
    code: Exclude<
      ApiErrorCode,
      "VALIDATION_ERROR" | "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "RATE_LIMITED" | "INTERNAL_ERROR"
    >,
    message: string,
  ) {
    return new ApiError(statusCode, code, message);
  }

  static forbidden(message = "Forbidden") {
    return new ApiError(403, "FORBIDDEN", message);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message: string) {
    return new ApiError(409, "CONFLICT", message);
  }
}
