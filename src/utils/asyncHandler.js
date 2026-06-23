/**
 * =====================================================
 * ASYNC HANDLER
 * =====================================================
 *
 * Express does not automatically catch
 * errors thrown inside async functions.
 *
 * Without asyncHandler:
 *
 * try {
 *   await something();
 * } catch(err) {
 *   next(err);
 * }
 *
 * must be written inside every controller.
 *
 * This utility wraps async controllers
 * and automatically forwards errors to
 * Express error middleware.
 *
 * Usage:
 *
 * const getProfile = asyncHandler(
 *   async (req, res) => {
 *      ...
 *   }
 * );
 *
 */

function asyncHandler(fn) {
  return function (req, res, next) {
    Promise.resolve(
      fn(req, res, next)
    ).catch(next);
  };
}

module.exports = asyncHandler;