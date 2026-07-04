/**
 * PAGINATION UTILITY — PHASE 8E
 * ================================
 * One shared, reusable page/limit pattern — extracted from the pattern
 * already used inline in notification.service.js (page/limit query params,
 * clamped, skip = (page-1)*limit, {page, limit, total, totalPages} response
 * shape), so the new invoice/payment/subscription-history list endpoints
 * don't each re-implement the same clamping logic.
 */

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100; // hard ceiling — stops a client asking for ?limit=999999 and forcing a huge query

/**
 * WHAT: Turns raw (possibly missing/invalid) `page`/`limit` query-string
 *       values into safe, clamped numbers, plus the `skip` offset Prisma's
 *       findMany() needs.
 * WHY: Query params arrive as strings (or undefined) and can't be trusted —
 *      a client could send "page=-5" or "limit=abc". This is the one place
 *      that sanitizes them, the same defaults notification.service.js already used.
 *
 * @param {object} query - typically req.query, e.g. { page: "2", limit: "10" }
 * RETURNS: { page: number, limit: number, skip: number }
 */
function parsePagination(query = {}) {
  let page = Number(query.page);
  let limit = Number(query.limit);

  // Number("") / Number(undefined) / Number("abc") all produce NaN — fall
  // back to sane defaults instead of letting NaN leak into a Prisma query.
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  return { page, limit, skip: (page - 1) * limit };
}

/**
 * WHAT: Builds the standard pagination metadata object returned alongside
 *       every paginated list in this app.
 * WHY: One shared shape so every dashboard list endpoint (invoices,
 *      payments, subscription history) looks identical to the frontend.
 *
 * @param {number} page
 * @param {number} limit
 * @param {number} total - total matching row count (from a separate COUNT query)
 * RETURNS: { page, limit, total, totalPages }
 */
function buildPaginationMeta(page, limit, total) {
  return {
    page,
    limit,
    total,
    // Math.ceil() rounds the division UP — e.g. 41 rows at limit=20 is 3
    // pages (2 full pages + 1 partial), not 2.
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = { parsePagination, buildPaginationMeta };
