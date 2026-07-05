const { Worker } = require("bullmq"); // BullMQ's job-consumer class — pulls jobs off a queue and runs the given function for each
const connection = require("../config/queueConnection");
const { processPendingRegistrationCleanupJob } = require("../jobs/pending-registration-cleanup.processor");

/**
 * WHAT: Starts the worker that processes "pending-registration-cleanup"
 *       queue jobs — the recurring sweep that deletes expired, abandoned
 *       PendingRegistration rows.
 * WHY: Runs in the separate worker process (`npm run worker`), same as
 *      every other background job in this app, so it never competes with
 *      the API server for resources.
 * RETURNS: Worker instance, or null if Redis isn't configured.
 */
function startPendingRegistrationCleanupWorker() {
  if (!connection) {
    console.warn("REDIS_URL not set — pending-registration cleanup worker not started.");
    return null;
  }

  // concurrency: 1 — only one cleanup sweep should ever run at a time; there
  // is nothing to parallelize (it's a single deleteMany() call) and running
  // two sweeps concurrently would just have them race over the same rows.
  const worker = new Worker(
    "pending-registration-cleanup",
    () => processPendingRegistrationCleanupJob(),
    { connection, concurrency: 1 }
  );

  worker.on("completed", (job) => {
    console.log(`[pending-registration-cleanup worker] job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[pending-registration-cleanup worker] job ${job?.id} failed:`, err.message);
  });

  return worker;
}

module.exports = { startPendingRegistrationCleanupWorker };
