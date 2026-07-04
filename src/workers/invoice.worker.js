const { Worker } = require("bullmq"); // BullMQ's job-consumer class — pulls jobs off a queue and runs the given function for each
const connection = require("../config/queueConnection");
const { processGenerateInvoiceJob } = require("../jobs/invoice.processor");

/**
 * WHAT: Starts the worker that processes "invoice" queue jobs (PDF +
 *       welcome email after a school's payment is verified).
 * WHY: Runs in the separate worker process (`npm run worker`), never inside
 *      the API server — so a slow PDF render or flaky SMTP send can't add
 *      latency to any HTTP request.
 * RETURNS: Worker instance, or null if Redis isn't configured.
 */
function startInvoiceWorker() {
  if (!connection) {
    console.warn("REDIS_URL not set — invoice worker not started.");
    return null;
  }

  // concurrency: 2 — invoice generation involves disk I/O (writing the PDF)
  // and an outbound email per job; keeping this low avoids many jobs
  // fighting over disk/SMTP at once for what is a low-volume queue
  // (one job per new school registration).
  const worker = new Worker(
    "invoice",
    (job) => processGenerateInvoiceJob(job.data),
    { connection, concurrency: 2 }
  );

  worker.on("completed", (job) => {
    console.log(`[invoice worker] job ${job.id} (school ${job.data.schoolId}) completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[invoice worker] job ${job?.id} (school ${job?.data?.schoolId}) failed:`, err.message);
  });

  return worker;
}

module.exports = { startInvoiceWorker };
