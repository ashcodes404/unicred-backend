const { Queue } = require("bullmq");
const connection = require("../config/queueConnection");
const { processResultsPublishJob } = require("../jobs/results-publish.processor");

const resultsQueue = connection ? new Queue("results-publish", { connection }) : null;

/**
 * Enqueue the SGPA/CGPA + notification fan-out for a publication going
 * "published". Falls back to running inline if Redis isn't configured.
 */
async function enqueueResultsPublish(data) {
  if (!resultsQueue) return processResultsPublishJob(data);

  return resultsQueue.add("publish", data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 200,
  });
}

module.exports = { resultsQueue, enqueueResultsPublish };
