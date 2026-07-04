// src/jobs/subscription-reminder.processor.js
//
// PHASE 8D — runs on a recurring BullMQ schedule (see
// src/queues/subscription-reminder.queue.js), same pattern as Phase 7's
// pending-registration-cleanup job. Each run: finds schools whose
// subscriptionExpiryDate falls 7/3/1 days from now, or that expired
// recently, and emails the school's ADMIN a reminder — each of the 4
// reminders (DAYS_7/DAYS_3/DAYS_1/EXPIRED) fires exactly once per
// subscription cycle, guarded by SubscriptionReminder's @@unique constraint.

const prisma = require("../config/db");
const { LOGIN_URL } = require("../config/env");
const { sendSubscriptionReminderEmail } = require("../utils/email");

// How far back the EXPIRED bucket looks. NOT unbounded ("< now") — that
// would re-scan every school that has EVER expired, forever, growing daily.
// A short lookback tolerates the job missing a day (e.g. worker was down)
// while keeping the query a small, indexed range scan.
const EXPIRED_LOOKBACK_DAYS = 3;

/**
 * WHAT: Returns "today at 00:00:00.000" — the calendar-day anchor every
 *       window below is computed from.
 * WHY: Reminders are day-granularity ("7 days before") not
 *      minute-granularity — anchoring to midnight means a school whose
 *      expiry is later today still correctly falls in "today's" bucket,
 *      no matter what time of day this job happens to run.
 * RETURNS: Date
 */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * WHAT: Builds a half-open date range [start, end) covering exactly one
 *       calendar day, `daysFromNow` days from today.
 * WHY: Shared by the three "N days before expiry" queries below — e.g.
 *      dayWindow(7) means "any subscriptionExpiryDate that falls on the
 *      calendar day 7 days from today," regardless of exact time-of-day.
 * RETURNS: { gte: Date, lt: Date } — usable directly as a Prisma date filter.
 */
function dayWindow(daysFromNow) {
  const start = new Date(startOfToday());
  start.setDate(start.getDate() + daysFromNow);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { gte: start, lt: end };
}

/**
 * WHAT: Builds the bounded "already expired" range — from
 *       EXPIRED_LOOKBACK_DAYS ago up to (but not including) the start of
 *       today.
 * WHY: See EXPIRED_LOOKBACK_DAYS's comment above — bounded so this stays a
 *      small indexed range scan instead of an ever-growing one. Ends at
 *      startOfToday (not "now") so a school expiring later TODAY isn't
 *      flagged as expired until tomorrow's run — it was still "current"
 *      for part of today.
 * RETURNS: { gte: Date, lt: Date }
 */
function expiredWindow() {
  const end = startOfToday();
  const start = new Date(end);
  start.setDate(start.getDate() - EXPIRED_LOOKBACK_DAYS);
  return { gte: start, lt: end };
}

// The 4 buckets this job checks, each with its own reminderType + date
// range + human-readable daysLeft for the email (null for EXPIRED).
function buildBuckets() {
  return [
    { reminderType: "DAYS_7", range: dayWindow(7), daysLeft: 7 },
    { reminderType: "DAYS_3", range: dayWindow(3), daysLeft: 3 },
    { reminderType: "DAYS_1", range: dayWindow(1), daysLeft: 1 },
    { reminderType: "EXPIRED", range: expiredWindow(), daysLeft: null },
  ];
}

/**
 * WHAT: Attempts to "claim" one reminder (schoolId + reminderType +
 *       subscriptionExpiryDate) by inserting its SubscriptionReminder row
 *       BEFORE sending anything, then sends the email only if the claim
 *       succeeded.
 * WHY: Insert-before-send makes this safe against the job running twice
 *      concurrently (e.g. two worker processes, or a retry overlapping a
 *      still-running attempt). The row's @@unique([schoolId, reminderType,
 *      subscriptionExpiryDate]) constraint means only ONE caller can ever
 *      successfully insert it — Prisma throws error code "P2002" for
 *      everyone else, which we treat as "already claimed, skip" rather than
 *      a real failure. This guarantees "never double-send" even under a
 *      race, at the accepted trade-off that if sendSubscriptionReminderEmail
 *      itself throws AFTER the insert succeeds, that reminder won't retry
 *      (favoring never-duplicate over guaranteed-delivery, per the spec).
 * RETURNS: Promise<"sent"|"skipped">
 */
async function claimAndSend(school, reminderType, daysLeft) {
  try {
    // This INSERT is the claim — see WHY above for why it happens before
    // the email is sent, not after.
    await prisma.subscriptionReminder.create({
      data: {
        schoolId: school.id,
        reminderType,
        subscriptionExpiryDate: school.subscriptionExpiryDate,
        sentAt: new Date(),
      },
    });
  } catch (err) {
    // "P2002" = Prisma's unique-constraint-violation code — this exact
    // reminder was already sent (a previous run, or a concurrent one that
    // won the race). Anything else is a real, unexpected error and should
    // still bubble up so the job run logs it clearly.
    if (err.code === "P2002") return "skipped";
    throw err;
  }

  // Only the school's ADMIN gets this email — never students/faculty/hod.
  // findFirst (not findMany) — every school in this app has exactly one
  // admin User, so the first match is the only match.
  const admin = await prisma.user.findFirst({
    where: { schoolId: school.id, role: "admin" },
  });

  if (!admin) {
    // Extremely unlikely (every school gets an admin at registration), but
    // if it ever happens there's simply no one to email — the claim row
    // above still stands, so this won't be retried every single day.
    console.warn(`[subscription-reminder] school ${school.id} has no admin User — skipping email`);
    return "skipped";
  }

  await sendSubscriptionReminderEmail({
    email: admin.email,
    name: admin.name,
    schoolName: school.name,
    plan: school.plan,
    expiryDate: school.subscriptionExpiryDate,
    daysLeft,
    renewalUrl: LOGIN_URL,
  });

  return "sent";
}

/**
 * WHAT: Processes one "subscription-reminder" job run — checks all 4
 *       reminder buckets and sends whatever hasn't already gone out.
 * WHY: This is what src/workers/subscription-reminder.worker.js calls on
 *      the recurring schedule (see that file's queue counterpart for the
 *      "how often" and why).
 * RETURNS: Promise<void> (logs a per-run summary)
 */
async function processSubscriptionReminderJob() {
  const buckets = buildBuckets();
  let sent = 0;
  let skipped = 0;

  for (const bucket of buckets) {
    // One indexed range query per bucket — see this file's header comment
    // and dayWindow()/expiredWindow() above for why each is a small, bounded
    // scan rather than "load every school and filter in JS".
    const schools = await prisma.school.findMany({
      where: { subscriptionExpiryDate: bucket.range },
    });

    for (const school of schools) {
      const outcome = await claimAndSend(school, bucket.reminderType, bucket.daysLeft);
      if (outcome === "sent") sent++;
      else skipped++;
    }
  }

  console.log(`[subscription-reminder] sent ${sent} reminder(s), skipped ${skipped} already-sent/unclaimable.`);
}

module.exports = { processSubscriptionReminderJob };
