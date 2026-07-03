const { Worker } = require("bullmq");
const connection = require("../config/queueConnection");
const { processEmailJob } = require("../jobs/email.processor");

function startEmailWorker() {
  if (!connection) {
    console.warn("REDIS_URL not set — email worker not started.");
    return null;
  }

  const worker = new Worker(
    "email",
    (job) => processEmailJob(job.name, job.data),
    { connection, concurrency: 5 }
  );

  worker.on("completed", (job) => {
    console.log(`[email worker] job ${job.id} (${job.name}) completed`);
  });
  worker.on("failed", (job, err) => {
    console.error(`[email worker] job ${job?.id} (${job?.name}) failed:`, err.message);
  });

  return worker;
}

module.exports = { startEmailWorker };
