// src/jobs/pending-registration-cleanup.processor.js
//
// PHASE 7 — closes the TODO left since Phase 1: expired, abandoned signups
// (someone filled in school-details, maybe admin-details, then never paid)
// pile up in PendingRegistration forever unless something purges them. This
// runs on a recurring schedule (see src/queues/pending-registration-cleanup.queue.js)
// and deletes only the rows that are truly dead — expired AND not completed.

const prisma = require("../config/db");

/**
 * WHAT: Deletes every PendingRegistration row that has passed its expiresAt
 *       AND never became a real school.
 * WHY: Runs on a BullMQ repeatable schedule so this table doesn't grow
 *      forever with abandoned signups. `status: { not: "completed" }` is the
 *      critical safety condition — a "completed" row is the historical
 *      record of a registration that already turned into a real School +
 *      admin User (see registration.repository.js's createSchoolAndAdmin).
 *      Those rows must NEVER be deleted, even after their expiresAt has
 *      long passed, since expiresAt only ever meant "this tempId is dead if
 *      payment hasn't happened yet" — it says nothing once payment already
 *      succeeded.
 * RETURNS: Promise<void> (logs how many rows were purged)
 */
async function processPendingRegistrationCleanupJob() {
  // prisma.pendingRegistration.deleteMany() — deletes every row matching
  // `where` in one query and returns { count: <number deleted> }, instead of
  // us fetching rows one by one and deleting them individually (which would
  // be far slower and do many more round trips to the database).
  const result = await prisma.pendingRegistration.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
      status: { not: "completed" },
    },
  });

  console.log(`[pending-registration-cleanup] purged ${result.count} expired row(s).`);
}

module.exports = { processPendingRegistrationCleanupJob };
