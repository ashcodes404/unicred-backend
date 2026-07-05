// Entry point for the background worker process. Can run in TWO ways:
//   1. STANDALONE — `npm run worker` / `npm run worker:dev` — its own
//      separate process, exactly like before.
//   2. INSIDE THE API PROCESS — src/index.js requires this file and calls
//      startWorkers() itself when RUN_WORKER_IN_WEB=true (used on Render's
//      free tier, so one web service runs both the API and the worker
//      instead of paying for two).
//
// Either way, the actual "start every worker" logic lives in ONE place
// (startWorkers below) — nothing about the queues/Redis setup is duplicated
// between the two ways this file can be used.

const { startEmailWorker } = require("./workers/email.worker");
const { startResultsPublishWorker } = require("./workers/results-publish.worker");
const { startInvoiceWorker } = require("./workers/invoice.worker");
const { startPendingRegistrationCleanupWorker } = require("./workers/pending-registration-cleanup.worker");
const { schedulePendingRegistrationCleanup } = require("./queues/pending-registration-cleanup.queue");
// PHASE 8D — subscription expiry reminders, same repeatable-schedule pattern as the cleanup job above
const { startSubscriptionReminderWorker } = require("./workers/subscription-reminder.worker");
const { scheduleSubscriptionReminders } = require("./queues/subscription-reminder.queue");

// Filled in by startWorkers(), read by stopWorkers() — module-level so both
// functions (and both ways this file can be used) share the same list.
let workers = [];

/**
 * WHAT: Starts every BullMQ worker this app has, and registers the two
 *       recurring ("repeatable") job schedules.
 * WHY: Pulled out into its own function (instead of just running at the top
 *      of this file) so BOTH entry paths above call this exact same startup
 *      code — one place to add a new worker later, not two.
 * RETURNS: Promise<void>
 */
async function startWorkers() {
  // .filter(Boolean) — a plain JS array method that drops any "falsy" value
  // (like null). Each start*Worker() function returns null instead of a
  // real Worker when REDIS_URL isn't set (see each worker file), so this
  // keeps `workers` free of those nulls.
  workers = [
    startEmailWorker(),
    startResultsPublishWorker(),
    startInvoiceWorker(),
    startPendingRegistrationCleanupWorker(),
    startSubscriptionReminderWorker(),
  ].filter(Boolean);

  // Register the recurring cleanup schedule now that its worker is running.
  // Safe to call every time this runs (including inside the combined
  // process on every Render restart) — BullMQ recognizes the identical
  // repeat config and won't create a duplicate schedule (see the queue
  // file's own comment for how).
  try {
    await schedulePendingRegistrationCleanup();
  } catch (err) {
    console.error("Failed to schedule pending-registration cleanup:", err.message);
  }

  // PHASE 8D — same "safe to call every time" reasoning as the cleanup schedule above.
  try {
    await scheduleSubscriptionReminders();
  } catch (err) {
    console.error("Failed to schedule subscription reminders:", err.message);
  }

  console.log(`Workers started (${workers.length} queue(s) active).`);
}

/**
 * WHAT: Closes every currently-running BullMQ worker.
 * WHY: worker.close() (a BullMQ built-in method) lets a worker finish
 *      whatever job it's in the middle of before shutting down, instead of
 *      killing it mid-run. Called on SIGTERM/SIGINT below when this file
 *      runs standalone, or by src/index.js's own shutdown logic when the
 *      worker was started inside the combined API process.
 * RETURNS: Promise<void>
 */
async function stopWorkers() {
  // Promise.all() — a built-in JS function that waits for every promise in
  // an array to finish, in parallel, instead of closing workers one at a
  // time. .map() turns the `workers` array into an array of "closing"
  // promises for Promise.all() to wait on.
  await Promise.all(workers.map((w) => w.close()));
  workers = [];
}

// require.main === module — Node's built-in way to check "was THIS file the
// one directly run with `node src/worker.js`, or did some OTHER file
// require() it instead?" It's only true when running standalone, so
// everything below (starting workers immediately + listening for OS
// shutdown signals) is skipped when src/index.js requires this file —
// index.js manages its own combined start/shutdown flow instead.
if (require.main === module) {
  startWorkers();

  async function shutdown(signal) {
    console.log(`${signal} received, closing workers...`);
    await stopWorkers();
    process.exit(0);
  }

  // process.on("SIGTERM"/"SIGINT") — Node's built-in way to run code when
  // the OS asks this process to stop. SIGTERM is what most hosting
  // platforms (and `docker stop`) send on a restart/redeploy; SIGINT is
  // Ctrl+C in a local terminal.
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = { startWorkers, stopWorkers };
