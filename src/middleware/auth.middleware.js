const { verifyAccessToken } = require("../utils/jwt");
const { error } = require("../utils/apiResponse");

/**
 * AUTH MIDDLEWARE
 *
 * Runs on every protected route.
 * - Reads the access token from the "Authorization: Bearer <token>" header
 * - Verifies the token's signature and expiry
 * - If valid, attaches the decoded payload to req.user
 *   so later middleware/controllers can access req.user.userId, .role, .schoolId
 * - If invalid/missing, blocks the request with 401
 */
function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;

  // Header must look like: "Authorization: Bearer <token>"
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return error(res, 401, "No access token provided");
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = verifyAccessToken(token);

    // Attach decoded user info to the request for use in later middleware/controllers
    req.user = {
      userId: Number(decoded.userId),
      role: decoded.role,
      schoolId: Number(decoded.schoolId),
    };

    next();
  } catch (err) {
    // Covers both invalid signature and expired tokens.
    // Frontend should catch this 401 and call /auth/refresh automatically.
    if (err.name === "TokenExpiredError") {
      return error(res, 401, "Access token expired");
    }
    return error(res, 401, "Invalid access token");
  }
}

module.exports = authenticate;
