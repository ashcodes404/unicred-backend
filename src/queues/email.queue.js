const { Queue } = require("bullmq");
const connection = require("../config/queueConnection");
const { processEmailJob } = require("../jobs/email.processor");

const emailQueue = connection ? new Queue("email", { connection }) : null;

/**
 * Enqueue an email send so the caller's HTTP response doesn't wait on SMTP.
 * Falls back to sending inline if Redis isn't configured, so the app still
 * works (just synchronously) in environments without REDIS_URL.
 */
async function enqueueEmail(name, data) {
  if (!emailQueue) return processEmailJob(name, data);

  return emailQueue.add(name, data, {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  });
}

module.exports = { emailQueue, enqueueEmail };
