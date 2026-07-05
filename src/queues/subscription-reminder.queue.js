const { Queue } = require("bullmq"); // BullMQ's job-queue class — also used here to register a repeating schedule, not just one-off jobs
const connection = require("../config/queueConnection");

// PHASE 8D — reminders are day-granularity (7/3/1 days before + once after
// expiry), so once a day is all that's needed. Running more often would
// cost extra DB queries for zero benefit (the @@unique guard would just
// no-op the extra runs) — same reasoning Phase 7's cleanup job used for
// its own interval, just a longer one since this job cares about days, not minutes.
const REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000; // every 24 hours

const reminderQueue = connection ? new Queue("subscription-reminder", { connection }) : null;

/**
 * WHAT: Registers the recurring "send subscription expiry reminders" job.
 * WHY: Same repeatable-schedule mechanism as
 *      pending-registration-cleanup.queue.js's schedulePendingRegistrationCleanup()
 *      — not triggered by a request, just runs on its own timer forever.
 *      Call this once when the worker process starts (see src/worker.js).
 *
 *      queue.add(name, data, { repeat: { every: ms } }) — BullMQ's
 *      "repeatable job" option; re-enqueues a fresh job every `every`
 *      milliseconds. BullMQ derives a stable key from name + repeat
 *      options, so calling this again on every worker restart doesn't
 *      create a second parallel schedule — it just confirms the existing one.
 * RETURNS: Promise<void>
 */
async function scheduleSubscriptionReminders() {
  if (!reminderQueue) {
    // No REDIS_URL — there's no way to "repeat forever" without BullMQ/Redis,
    // so we skip scheduling rather than trying to run this inline once
    // (same choice Phase 7's cleanup schedule makes, for the same reason).
    console.warn("REDIS_URL not set — subscription reminders not scheduled.");
    return;
  }

  await reminderQueue.add(
    "send-reminders",
    {},
    {
      repeat: { every: REMINDER_INTERVAL_MS },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  console.log(`[subscription-reminder] scheduled every ${REMINDER_INTERVAL_MS / (60 * 60 * 1000)} hour(s).`);
}

module.exports = { reminderQueue, scheduleSubscriptionReminders };
