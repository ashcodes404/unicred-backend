const { Queue } = require("bullmq"); // BullMQ's job-queue class — add() pushes a job onto Redis for a worker to pick up
const connection = require("../config/queueConnection");
const { processGenerateInvoiceJob } = require("../jobs/invoice.processor");

const invoiceQueue = connection ? new Queue("invoice", { connection }) : null;

/**
 * Enqueue a "generate-invoice" job so verify-payment's HTTP response never
 * waits on PDF generation or email sending. Falls back to running the job
 * inline if Redis isn't configured (REDIS_URL unset), same fallback used by
 * the other queues in this app — the app should keep working (just
 * synchronously) without Redis in local/dev setups that skip it.
 *
 * @param {{ schoolId: number, paymentId: number }} data
 * RETURNS: Promise (resolves once the job is enqueued, or once it's run
 *          inline in the no-Redis fallback case)
 */
async function enqueueGenerateInvoice(data) {
  if (!invoiceQueue) return processGenerateInvoiceJob(data);

  // attempts/backoff — PDF generation + email can fail transiently (disk
  // full for a moment, SMTP hiccup); a few retries with growing delays
  // gives those transient failures a chance to succeed without a human
  // needing to intervene. This never touches the already-created School/User.
  return invoiceQueue.add("generate-invoice", data, {
    attempts: 5,
    backoff: { type: "exponential", delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

module.exports = { invoiceQueue, enqueueGenerateInvoice };
