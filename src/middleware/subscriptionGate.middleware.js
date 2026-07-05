/**
 * SUBSCRIPTION GATE MIDDLEWARE — PHASE 8C
 * ===========================================
 * Restricts an ADMIN whose school's subscription has expired to only the
 * subscription-status/renewal/logout routes — everything else 403s until
 * they renew. Students/faculty/hod never reach this far while expired
 * anyway (auth.service.js's login() already refuses to issue them a token
 * at all — see the PHASE 8C block in login()), so this middleware only
 * ever has to think about the "admin" case.
 *
 * WHY THIS IS MOUNTED GLOBALLY IN app.js (not added to every route file):
 * This app applies `authenticate` per-route, not globally — there's no
 * single spot where every authenticated request already passes through one
 * shared middleware. Bolting a check onto every existing admin route file
 * would mean editing dozens of files just to add one line each — the
 * opposite of an additive change. Instead, this middleware does its OWN
 * lightweight token read (reusing utils/jwt's verifyAccessToken — the exact
 * same verification `authenticate` uses) and is mounted ONCE, globally,
 * before the /api routes. It never replaces or weakens `authenticate`:
 *   - No/invalid/expired token → just calls next() and lets the route's
 *     own `authenticate` middleware (further down the chain) reject it
 *     with the proper 401 — this gate is not an auth check.
 *   - Valid token but not an admin, or admin but school not expired → next().
 *   - Valid token, admin, school expired, route not allowlisted → 403.
 */

const { verifyAccessToken } = require("../utils/jwt");
const prisma = require("../config/db");
const { isSchoolExpired } = require("../utils/schoolSubscription");
const { error } = require("../utils/apiResponse");

// The ONLY routes an admin of an expired school may still reach.
// Exact method+path matches — deliberately not prefix-based, so this list
// can never accidentally "widen" to cover a route we didn't mean to allow.
const ALLOWLIST = [
  { method: "GET", path: "/api/admin/subscription" },
  { method: "GET", path: "/api/admin/subscription/history" }, // PHASE 8E — read-only, same subscription area as the status check above
  { method: "POST", path: "/api/admin/subscription/renew-order" },
  { method: "POST", path: "/api/admin/subscription/renew-verify" },
  { method: "POST", path: "/api/auth/logout" },
  { method: "POST", path: "/api/auth/logout-all" },
];

/**
 * WHAT: Checks whether a given method+path pair is on the allowlist above.
 * WHY: Small helper so the main middleware function stays readable.
 * RETURNS: boolean
 */
function isAllowlisted(method, path) {
  return ALLOWLIST.some((entry) => entry.method === method && entry.path === path);
}

/**
 * WHAT: The Express middleware itself — see the file header for the full
 *       reasoning on when it blocks vs. passes through.
 * RETURNS: void (calls next() or sends a 403 JSON response)
 */
async function subscriptionGate(req, res, next) {
  const authHeader = req.headers.authorization;

  // No bearer token at all — nothing for this gate to check; let whatever
  // the route actually requires (public, or `authenticate` → 401) handle it.
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return next();
  }

  const token = authHeader.split(" ")[1];

  let decoded;
  try {
    // jwt.verify() (wrapped by verifyAccessToken) throws on a missing/
    // invalid/expired signature — if it throws, this ISN'T this gate's job
    // to report; the route's own `authenticate` middleware will run next
    // and produce the correct 401 with the right message.
    decoded = verifyAccessToken(token);
  } catch {
    return next();
  }

  // This gate only ever restricts admins — every other role was already
  // refused a token at login if their school was expired (see auth.service.js).
  if (decoded.role !== "admin") {
    return next();
  }

  const school = await prisma.school.findUnique({ where: { id: Number(decoded.schoolId) } });

  if (!isSchoolExpired(school)) {
    return next();
  }

  if (isAllowlisted(req.method, req.path)) {
    return next();
  }

  return error(res, 403, "Subscription expired. Please renew.");
}

module.exports = subscriptionGate;
