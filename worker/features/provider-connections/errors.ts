import { AppError } from "../../lib/errors";
import { ProviderError } from "../../providers/errors";
import { ImapClientError } from "../../providers/imap/ports";
import { SmtpSubmitError } from "../../providers/imap/transport";

export function connectionAppError(error: unknown): AppError {
  if (!(error instanceof ProviderError)) {
    return new AppError(
      "PROVIDER_CONNECTION_FAILED",
      "The provider connection could not be saved.",
      500
    );
  }
  if (error.code === "PROVIDER_ALREADY_REGISTERED") {
    return new AppError(error.code, error.message, 409);
  }
  if (error.code === "PROVIDER_NOT_REGISTERED") {
    return new AppError(error.code, error.message, 404);
  }
  if (error.code === "PROVIDER_CREDENTIAL_UNAVAILABLE") {
    return new AppError(error.code, "Provider credential storage is not configured.", 503);
  }
  return new AppError(error.code, error.message, 400);
}

export function protocolAppError(error: unknown): AppError {
  if (error instanceof ImapClientError) {
    if (error.reason === "auth") {
      return new AppError(
        "PROVIDER_AUTH_FAILED",
        "The mail provider rejected the connection credentials.",
        422
      );
    }
    if (error.reason === "unavailable" || error.reason === "timeout") {
      return new AppError(
        "PROVIDER_UNAVAILABLE",
        "The mail provider is temporarily unavailable.",
        503
      );
    }
    return new AppError(
      "PROVIDER_MALFORMED_RESPONSE",
      "The mail provider returned a malformed response.",
      502
    );
  }
  if (error instanceof SmtpSubmitError) {
    if (error.reason === "auth") {
      return new AppError(
        "PROVIDER_AUTH_FAILED",
        "The mail provider rejected the connection credentials.",
        422
      );
    }
    return new AppError(
      "PROVIDER_UNAVAILABLE",
      "The mail provider is temporarily unavailable.",
      503
    );
  }
  return connectionAppError(error);
}

export function providerFailureCode(error: unknown): string {
  if (error instanceof ProviderError || error instanceof AppError) return error.code;
  if (error instanceof ImapClientError) return `IMAP_${error.reason.toUpperCase()}`;
  if (error instanceof SmtpSubmitError) return `SMTP_${error.reason.toUpperCase()}`;
  return "PROVIDER_VERIFICATION_FAILED";
}
