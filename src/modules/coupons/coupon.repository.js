/**
 * COUPON REPOSITORY — PHASE 8B
 * ==============================
 * All direct Prisma calls for the Coupon model live here. coupon.service.js
 * calls these functions — it never talks to Prisma directly (same
 * service/repository split used everywhere else in this app, e.g.
 * registration.service.js / registration.repository.js).
 */

const prisma = require("../../config/db");

/**
 * WHAT: Finds a coupon by its code (case-insensitive — the caller is
 *       expected to have already uppercased `code` before calling this,
 *       since codes are always stored UPPERCASE).
 * WHY: Every coupon lookup (apply-coupon preview, createOrder re-validation,
 *      admin views) needs to find the same row the same way.
 * RETURNS: Promise<Coupon|null>
 */
async function findByCode(code) {
  return prisma.coupon.findUnique({ where: { code } });
}

/**
 * WHAT: Finds a coupon by its internal numeric id.
 * WHY: Admin PATCH/DELETE routes address a coupon by id (from the URL),
 *      not by code.
 * RETURNS: Promise<Coupon|null>
 */
async function findById(id) {
  return prisma.coupon.findUnique({ where: { id } });
}

/**
 * WHAT: Lists every coupon, newest first.
 * WHY: Powers GET /api/admin/coupons — the admin dashboard's coupon table.
 * RETURNS: Promise<Coupon[]>
 */
async function findAll() {
  return prisma.coupon.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * WHAT: Creates a new coupon row.
 * WHY: Powers POST /api/admin/coupons.
 * RETURNS: Promise<Coupon>
 */
async function create(data) {
  return prisma.coupon.create({ data });
}

/**
 * WHAT: Updates an existing coupon row (partial update — only the fields
 *       present in `data` are changed).
 * WHY: Powers PATCH /api/admin/coupons/:id — e.g. deactivating a coupon or
 *      changing its maxUses/validUntil without touching anything else.
 * RETURNS: Promise<Coupon>
 */
async function update(id, data) {
  return prisma.coupon.update({ where: { id }, data });
}

/**
 * WHAT: Sets a coupon's isActive flag to false.
 * WHY: Powers DELETE /api/admin/coupons/:id — we soft-deactivate rather
 *      than hard-delete so usedCount/redemption history is never lost for
 *      auditing, even after a coupon is retired.
 * RETURNS: Promise<Coupon>
 */
async function deactivate(id) {
  return prisma.coupon.update({ where: { id }, data: { isActive: false } });
}

/**
 * WHAT: Atomically increments a coupon's usedCount by 1, but ONLY if doing
 *       so wouldn't push it past maxUses.
 * WHY: This is the race-safety guard described in coupon.service.js's
 *      applyCouponUsage() — see that function for the full explanation of
 *      why a plain "read usedCount, check < maxUses, then write +1" would be
 *      unsafe under concurrent redemptions, and why this conditional
 *      updateMany() is safe instead.
 *
 * @param {object} client - a Prisma client OR an active transaction client
 *        (`tx` from prisma.$transaction(async (tx) => ...)). Passing `tx`
 *        here is what makes the increment happen INSIDE the same
 *        transaction that creates the School — see registration.repository.js.
 * @param {number} couponId
 * @param {number|null} maxUses
 * RETURNS: Promise<boolean> — true if the increment happened, false if the
 *          limit was already reached (by this call or a concurrent one).
 */
async function incrementUsedCountAtomic(client, couponId, maxUses) {
  // Unlimited coupon (maxUses null) — no capacity check needed, just increment.
  // Written as a plain `where: { id }` (rather than folding `maxUses: null`
  // into the query) so we never rely on Prisma's undefined-stripping
  // behavior for a `lt: undefined` filter, which is easy to get wrong.
  const where =
    maxUses == null
      ? { id: couponId }
      : {
          id: couponId,
          // Evaluated by the database at the same instant it locks the row
          // for the UPDATE, so two simultaneous "last redemption" attempts
          // can never both pass this check (see coupon.service.js for the
          // full race explanation).
          usedCount: { lt: maxUses },
        };

  const result = await client.coupon.updateMany({
    where,
    data: { usedCount: { increment: 1 } },
  });

  return result.count > 0;
}

module.exports = {
  findByCode,
  findById,
  findAll,
  create,
  update,
  deactivate,
  incrementUsedCountAtomic,
};
