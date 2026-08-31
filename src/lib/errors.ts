export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_ACCOUNT_DISABLED"
  | "AUTH_REFRESH_REUSED"
  | "AUTH_RESET_TOKEN_INVALID"
  | "AUTH_RESET_TOKEN_EXPIRED"
  | "AUTH_RESET_TOKEN_USED"
  | "AUTH_REAUTHENTICATION_REQUIRED"
  | "AUTH_PASSWORD_UNAVAILABLE"
  | "GOOGLE_AUTH_NOT_CONFIGURED"
  | "GOOGLE_TOKEN_INVALID"
  | "APPLE_AUTH_NOT_CONFIGURED"
  | "APPLE_TOKEN_INVALID"
  | "APPLE_CODE_INVALID"
  | "APPLE_CHALLENGE_INVALID"
  | "APPLE_CHALLENGE_EXPIRED"
  | "APPLE_CHALLENGE_USED"
  | "APPLE_REVOCATION_FAILED"
  | "ACCOUNT_LINK_REQUIRED"
  | "AUTH_IDENTITY_CONFLICT"
  | "AUTH_PROVIDER_ALREADY_LINKED"
  | "LIMIT_REACHED"
  | "PLAN_REQUIRED"
  | "FEATURE_NOT_AVAILABLE"
  | "PROVIDER_SEND_FAILED";

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

  static forbidden(message = "Forbidden", details?: unknown) {
    return new ApiError(403, "FORBIDDEN", message, details);
  }

  static notFound(message = "Not found") {
    return new ApiError(404, "NOT_FOUND", message);
  }

  static conflict(message: string) {
    return new ApiError(409, "CONFLICT", message);
  }

  static serviceUnavailable(message = "Service unavailable") {
    return new ApiError(503, "SERVICE_UNAVAILABLE", message);
  }

  static limitReached(
    resource: string,
    label: string,
    details: { limit: number; current: number; plan: string; periodResetsAt?: Date },
  ) {
    return new ApiError(403, "LIMIT_REACHED", `Free plan limit reached for ${label}`, {
      resource,
      limit: details.limit,
      current: details.current,
      plan: details.plan,
      requiredPlan: "PRO",
      ...(details.periodResetsAt ? { periodResetsAt: details.periodResetsAt.toISOString() } : {}),
    });
  }

  static featureNotAvailable(feature: string, label: string, plan: string) {
    return new ApiError(403, "FEATURE_NOT_AVAILABLE", `${label} is available on the Pro plan`, {
      feature,
      plan,
      requiredPlan: "PRO",
    });
  }

  static planRequired(message: string, details?: unknown) {
    return new ApiError(403, "PLAN_REQUIRED", message, details);
  }

  /** The messaging provider (e.g. Twilio) did not accept the message — a real send attempt was made and it failed. */
  static providerSendFailed(details: { provider: string; errorCode?: string; permanentFailure: boolean; messageId: string }) {
    return new ApiError(502, "PROVIDER_SEND_FAILED", "The messaging provider did not accept this message", details);
  }
}
