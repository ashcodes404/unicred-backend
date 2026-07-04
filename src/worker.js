// Entry point for the background worker process. Runs separately from the
// API server (`npm run worker` vs `npm start`) so a slow or crashing job
// never affects request handling.

const { startEmailWorker } = require("./workers/email.worker");
const { startResultsPublishWorker } = require("./workers/results-publish.worker");
const { startInvoiceWorker } = require("./workers/invoice.worker");
const { startPendingRegistrationCleanupWorker } = require("./workers/pending-registration-cleanup.worker");
const { schedulePendingRegistrationCleanup } = require("./queues/pending-registration-cleanup.queue");
// PHASE 8D — subscription expiry reminders, same repeatable-schedule pattern as the cleanup job above
const { startSubscriptionReminderWorker } = require("./workers/subscription-reminder.worker");
const { scheduleSubscriptionReminders } = require("./queues/subscription-reminder.queue");

const workers = [
  startEmailWorker(),
  startResultsPublishWorker(),
  startInvoiceWorker(),
  startPendingRegistrationCleanupWorker(),
  startSubscriptionReminderWorker(),
].filter(Boolean);

// Register the recurring cleanup schedule now that its worker is running.
// Safe to call on every worker restart — BullMQ recognizes the identical
// repeat config and won't create a duplicate schedule (see the queue file's comment).
schedulePendingRegistrationCleanup().catch((err) => {
  console.error("Failed to schedule pending-registration cleanup:", err.message);
});

// PHASE 8D — same "safe to call on every restart" reasoning as the cleanup schedule above.
scheduleSubscriptionReminders().catch((err) => {
  console.error("Failed to schedule subscription reminders:", err.message);
});

console.log(`Worker process started (${workers.length} queue(s) active).`);

async function shutdown(signal) {
  console.log(`${signal} received, closing workers...`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
