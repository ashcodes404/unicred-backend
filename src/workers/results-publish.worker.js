const { Worker } = require("bullmq");
const connection = require("../config/queueConnection");
const { processResultsPublishJob } = require("../jobs/results-publish.processor");

function startResultsPublishWorker() {
  if (!connection) {
    console.warn("REDIS_URL not set — results-publish worker not started.");
    return null;
  }

  // Low concurrency — each job fans out per-student DB work for an entire
  // batch, so running many of these at once would just contend on the DB.
  const worker = new Worker(
    "results-publish",
    (job) => processResultsPublishJob(job.data),
    { connection, concurrency: 2 }
  );

  worker.on("completed", (job) => {
    console.log(`[results-publish worker] publication ${job.data.publicationId} published`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[results-publish worker] publication ${job?.data?.publicationId} failed:`, err.message);
  });

  return worker;
}

module.exports = { startResultsPublishWorker };
