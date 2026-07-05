/**
 * SCHOOL SUBSCRIPTION STATUS UTILITY — PHASE 8C
 * ================================================
 * One shared, pure function for answering "is this school locked out for
 * an expired subscription?" — used in THREE places that must never drift
 * out of sync on the definition of "expired":
 *   1. auth.service.js's login() — blocks student/faculty/hod login entirely.
 *   2. subscriptionGate.middleware.js — restricts an already-logged-in admin
 *      to only the subscription/renewal/logout routes.
 *   3. subscription.service.js — decides whether a renewal is "early" or
 *      "after expiry" for the date math.
 *
 * There is no cron job in this app that flips School.subscriptionStatus to
 * "EXPIRED" automatically — so the LIVE source of truth is always
 * subscriptionExpiryDate vs. the current time. subscriptionStatus is checked
 * too (in case it was ever set to EXPIRED/CANCELLED directly), but the date
 * comparison is what actually catches an expiry the moment it happens.
 */

/**
 * WHAT: Returns true if a school should be treated as "expired" — i.e. its
 *       subscriptionExpiryDate has passed, OR its subscriptionStatus was
 *       explicitly set to EXPIRED or CANCELLED.
 * WHY: CANCELLED is treated the same as EXPIRED here — a cancelled school
 *      has no active subscription either, and should be locked down the
 *      same way (this is a judgment call, not explicitly in the original
 *      spec, since only "EXPIRED" was described in detail).
 *
 * @param {object} school - needs subscriptionExpiryDate and subscriptionStatus
 * RETURNS: boolean
 */
function isSchoolExpired(school) {
  if (!school) return false;

  if (school.subscriptionStatus === "EXPIRED" || school.subscriptionStatus === "CANCELLED") {
    return true;
  }

  if (school.subscriptionExpiryDate && school.subscriptionExpiryDate < new Date()) {
    return true;
  }

  return false;
}

module.exports = { isSchoolExpired };
