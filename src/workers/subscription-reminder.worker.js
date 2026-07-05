const { Worker } = require("bullmq"); // BullMQ's job-consumer class — pulls jobs off a queue and runs the given function for each
const connection = require("../config/queueConnection");
const { processSubscriptionReminderJob } = require("../jobs/subscription-reminder.processor");

/**
 * WHAT: Starts the worker that processes "subscription-reminder" queue jobs
 *       — the recurring sweep that emails schools' admins about upcoming/
 *       past expiry.
 * WHY: Runs in the separate worker process (`npm run worker`), same as
 *      every other background job in this app, so it never competes with
 *      the API server for resources.
 * RETURNS: Worker instance, or null if Redis isn't configured.
 */
function startSubscriptionReminderWorker() {
  if (!connection) {
    console.warn("REDIS_URL not set — subscription reminder worker not started.");
    return null;
  }

  // concurrency: 1 — only one reminder sweep should ever run at a time.
  // The @@unique claim guard in subscription-reminder.processor.js already
  // makes concurrent runs SAFE (no double-sends), but there's nothing to
  // gain from parallelizing a single daily sweep, and it keeps the DB load
  // predictable — same reasoning as the cleanup worker's concurrency: 1.
  const worker = new Worker(
    "subscription-reminder",
    () => processSubscriptionReminderJob(),
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.log(`[subscription-reminder worker] job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[subscription-reminder worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}

module.exports = { startSubscriptionReminderWorker };
