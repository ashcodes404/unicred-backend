/**
 * TENANT MIDDLEWARE
 *
 * Must run AFTER auth.middleware.js (req.user must already exist).
 *
 * Purpose: makes req.schoolId available so repository functions can
 * easily filter all queries by the user's school — enforcing multi-tenancy.
 *
 * IMPORTANT: schoolId always comes from the JWT (req.user.schoolId),
 * NEVER from req.body or req.query/params. Otherwise a malicious user
 * could pass a different school's ID and access another school's data.
 */
function attachTenant(req, res, next) {
  if (!req.user || !req.user.schoolId) {
    // This should never happen if auth.middleware ran first,
    // but fail safely just in case.
    return res.status(401).json({
      success: false,
      message: "Tenant context missing — authentication required",
    });
  }

  req.schoolId = Number(req.user.schoolId);
  next();
}

module.exports = attachTenant;
