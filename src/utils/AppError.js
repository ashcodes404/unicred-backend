/**
 * =====================================================
 * CUSTOM APPLICATION ERROR
 * =====================================================
 *
 * Used by services to throw
 * meaningful HTTP errors.
 *
 * Examples:
 *
 * throw new AppError(
 *   404,
 *   "Notification not found"
 * );
 *
 * throw new AppError(
 *   403,
 *   "Access denied"
 * );
 *
 */

class AppError extends Error {
  constructor(statusCode, message) {
    super(message);

    this.statusCode = statusCode;

    Error.captureStackTrace(
      this,
      this.constructor
    );
  }
}

module.exports = AppError;