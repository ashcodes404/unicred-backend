const { Queue } = require("bullmq"); // BullMQ's job-queue class — also used here to register a repeating schedule, not just one-off jobs
const connection = require("../config/queueConnection");

const CLEANUP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes

const cleanupQueue = connection ? new Queue("pending-registration-cleanup", { connection }) : null;

/**
 * WHAT: Registers the recurring "purge expired PendingRegistrations" job.
 * WHY: Unlike every other queue in this app (which reacts to something a
 *      user just did — payment created, invoice needed), this one isn't
 *      triggered by a request. It needs to just run on its own, forever, on
 *      a timer. Call this once when the worker process starts
 *      (see src/worker.js).
 *
 *      queue.add(name, data, { repeat: { every: ms } }) — BullMQ's
 *      "repeatable job" option. Instead of running once, BullMQ
 *      automatically re-enqueues a fresh job every `every` milliseconds,
 *      forever, until the repeatable schedule is removed. BullMQ derives a
 *      stable internal key from the job name + repeat options, so calling
 *      `.add()` again with the SAME options (e.g. every time the worker
 *      process restarts) does not create a second parallel schedule — it
 *      just confirms the existing one.
 *
 * RETURNS: Promise<void>
 */
async function schedulePendingRegistrationCleanup() {
  if (!cleanupQueue) {
    // No REDIS_URL configured — there's no way to "repeat forever" without
    // BullMQ/Redis, so we just skip scheduling instead of trying to run this
    // inline (unlike the other queues' request-triggered fallback, running
    // a purge sweep once at random inline wouldn't give the same guarantee).
    console.warn("REDIS_URL not set — pending-registration cleanup not scheduled.");
    return;
  }

  await cleanupQueue.add(
    "cleanup",
    {},
    {
      repeat: { every: CLEANUP_INTERVAL_MS },
      removeOnComplete: 20,
      removeOnFail: 50,
    },
  );

  console.log(`[pending-registration-cleanup] scheduled every ${CLEANUP_INTERVAL_MS / 60000} minute(s).`);
}

module.exports = { cleanupQueue, schedulePendingRegistrationCleanup };
