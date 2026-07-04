/**
 * COUPON SERVICE — PHASE 8B
 * ===========================
 * Business logic for coupons: the discount math, validity checks, and the
 * admin CRUD operations. coupon.controller.js calls these functions; this
 * file calls coupon.repository.js — it never touches Prisma directly (same
 * layering as every other module in this app).
 *
 * MONEY FLOW (see registration.service.js's createOrder() and
 * completeRegistrationForPayment() for where this plugs in):
 *   base → apply coupon → discountedBase → calculateGst(discountedBase)
 *        → total = discountedBase + gst
 * GST is always computed on the DISCOUNTED base, never the original price —
 * that's the correct Indian GST treatment (tax applies to the actual
 * taxable value the customer pays, after any discount).
 */

const couponRepository = require("./coupon.repository");

/**
 * WHAT: Uppercases and trims a raw coupon code string.
 * WHY: Coupon codes are case-insensitive on input but always stored/looked
 *      up UPPERCASE — this is the one place that normalization happens, so
 *      every caller (apply-coupon, createOrder, admin create) treats
 *      "save20" and "SAVE20" as the exact same coupon.
 * RETURNS: string
 */
function normalizeCode(code) {
  return String(code).trim().toUpperCase();
}

/**
 * WHAT: Pure math — given a coupon row and a base rupee amount, computes how
 *       much discount applies and what the discounted base becomes. Does
 *       NOT check isActive/expiry/usedCount — see validateAndApplyCoupon()
 *       below for that; this function is also reused later (at actual
 *       payment-completion time) to re-derive the same numbers for the
 *       Invoice without re-running validity checks against money that
 *       already moved.
 * WHY: One shared formula so "preview" (apply-coupon), "charge" (createOrder),
 *      and "record" (invoice) can never drift out of sync on the math.
 *
 * @param {object} coupon - a Coupon row (needs type, value, maxDiscount)
 * @param {number} baseAmount - pre-discount rupee amount, e.g. 8999
 * RETURNS: { discountAmount: number, discountedBase: number }
 */
function computeDiscount(coupon, baseAmount) {
  let discountAmount;

  if (coupon.type === "percentage") {
    discountAmount = baseAmount * (coupon.value / 100);

    // maxDiscount only applies to percentage coupons (e.g. "20% off up to
    // ₹2000") — a fixed-rupee coupon's value already IS its own cap.
    if (coupon.maxDiscount != null && discountAmount > coupon.maxDiscount) {
      discountAmount = coupon.maxDiscount;
    }
  } else {
    // "fixed" — a flat rupee amount off, e.g. value=1000 means ₹1000 off.
    discountAmount = coupon.value;
  }

  // Never let the discount exceed the base itself — clamp discountedBase at
  // 0 rather than letting GST get computed on a negative number. We then
  // recompute discountAmount from the clamped base so
  // discountAmount + discountedBase always exactly equals baseAmount (kept
  // consistent for what the Invoice records).
  const discountedBase = Math.max(baseAmount - discountAmount, 0);
  discountAmount = baseAmount - discountedBase;

  return { discountAmount, discountedBase };
}

/**
 * WHAT: Looks up a coupon by code, checks every validity rule, and — only if
 *       all of them pass — returns the computed discount for a given base
 *       amount. Does NOT increment usedCount (that only happens once a
 *       payment actually completes — see registration.repository.js's
 *       createSchoolAndAdmin()).
 * WHY: The ONE reusable validation entry point — used by both
 *      POST /apply-coupon (preview, before payment) and createOrder()
 *      (re-validation, right before charging Razorpay). Keeping the rules in
 *      one place means a coupon can never be "valid" in one spot and
 *      "invalid" in another.
 *
 * Rejects (all thrown errors carry a statusCode, same convention as
 * registration.service.js) when:
 *   - the coupon doesn't exist for that code
 *   - isActive is false
 *   - now is before validFrom
 *   - now is after validUntil
 *   - usedCount has already reached maxUses
 *
 * @param {string} code - raw coupon code as typed by the user
 * @param {number} baseAmount - the plan's true base price (server-side, never client-sent)
 * RETURNS: Promise<{ discountAmount: number, discountedBase: number, coupon: Coupon }>
 */
async function validateAndApplyCoupon(code, baseAmount) {
  const normalizedCode = normalizeCode(code);
  const coupon = await couponRepository.findByCode(normalizedCode);

  if (!coupon) {
    const err = new Error(`Coupon "${normalizedCode}" does not exist.`);
    err.statusCode = 404;
    throw err;
  }

  if (!coupon.isActive) {
    const err = new Error(`Coupon "${normalizedCode}" is no longer active.`);
    err.statusCode = 400;
    throw err;
  }

  const now = new Date();

  if (coupon.validFrom && now < coupon.validFrom) {
    const err = new Error(`Coupon "${normalizedCode}" is not valid yet.`);
    err.statusCode = 400;
    throw err;
  }

  if (coupon.validUntil && now > coupon.validUntil) {
    const err = new Error(`Coupon "${normalizedCode}" has expired.`);
    err.statusCode = 400;
    throw err;
  }

  if (coupon.maxUses != null && coupon.usedCount >= coupon.maxUses) {
    const err = new Error(`Coupon "${normalizedCode}" has reached its usage limit.`);
    err.statusCode = 400;
    throw err;
  }

  const { discountAmount, discountedBase } = computeDiscount(coupon, baseAmount);

  return { discountAmount, discountedBase, coupon };
}

// ─────────────────────────────────────────────
// ADMIN CRUD — reuses the existing admin auth middleware in the router
// (authenticate + requireRole("admin")); no new auth logic here.
// ─────────────────────────────────────────────

/**
 * WHAT: Creates a new coupon.
 * WHY: Powers POST /api/admin/coupons.
 * RETURNS: Promise<Coupon>
 */
async function createCoupon(input) {
  const {
    code,
    description,
    type,
    value,
    maxUses,
    maxDiscount,
    validFrom,
    validUntil,
  } = input;

  if (!code || !type || value == null) {
    const err = new Error("code, type, and value are required.");
    err.statusCode = 400;
    throw err;
  }

  if (type !== "percentage" && type !== "fixed") {
    const err = new Error('type must be either "percentage" or "fixed".');
    err.statusCode = 400;
    throw err;
  }

  return couponRepository.create({
    code: normalizeCode(code),
    description: description ?? null,
    type,
    value,
    maxUses: maxUses ?? null,
    maxDiscount: maxDiscount ?? null,
    validFrom: validFrom ? new Date(validFrom) : null,
    validUntil: validUntil ? new Date(validUntil) : null,
  });
}

/**
 * WHAT: Lists every coupon.
 * WHY: Powers GET /api/admin/coupons.
 * RETURNS: Promise<Coupon[]>
 */
async function listCoupons() {
  return couponRepository.findAll();
}

/**
 * WHAT: Partially updates a coupon (e.g. deactivate, change limits/dates).
 * WHY: Powers PATCH /api/admin/coupons/:id. `code`/`usedCount` are
 *      deliberately never editable here — the code is the coupon's stable
 *      identity, and usedCount must only ever move via the atomic
 *      redemption path (coupon.repository.js's incrementUsedCountAtomic),
 *      never a manual admin edit that could silently defeat the maxUses guard.
 * RETURNS: Promise<Coupon>
 */
async function updateCoupon(id, input) {
  const existing = await couponRepository.findById(id);
  if (!existing) {
    const err = new Error(`Coupon ${id} not found.`);
    err.statusCode = 404;
    throw err;
  }

  const {
    description,
    type,
    value,
    maxUses,
    maxDiscount,
    validFrom,
    validUntil,
    isActive,
  } = input;

  const data = {};
  if (description !== undefined) data.description = description;
  if (type !== undefined) data.type = type;
  if (value !== undefined) data.value = value;
  if (maxUses !== undefined) data.maxUses = maxUses;
  if (maxDiscount !== undefined) data.maxDiscount = maxDiscount;
  if (validFrom !== undefined) data.validFrom = validFrom ? new Date(validFrom) : null;
  if (validUntil !== undefined) data.validUntil = validUntil ? new Date(validUntil) : null;
  if (isActive !== undefined) data.isActive = isActive;

  return couponRepository.update(id, data);
}

/**
 * WHAT: Soft-deactivates a coupon (isActive = false) rather than deleting
 *       the row outright.
 * WHY: Powers DELETE /api/admin/coupons/:id. A hard delete would erase the
 *      usedCount/redemption history for a coupon that may still be
 *      referenced (by code, as plain text) on past Invoices — deactivating
 *      keeps that audit trail intact while making the coupon unusable for
 *      any new order.
 * RETURNS: Promise<Coupon>
 */
async function deleteCoupon(id) {
  const existing = await couponRepository.findById(id);
  if (!existing) {
    const err = new Error(`Coupon ${id} not found.`);
    err.statusCode = 404;
    throw err;
  }

  return couponRepository.deactivate(id);
}

module.exports = {
  normalizeCode,
  computeDiscount,
  validateAndApplyCoupon,
  createCoupon,
  listCoupons,
  updateCoupon,
  deleteCoupon,
};
