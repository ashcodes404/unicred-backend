// Entry point for the background worker process. Runs separately from the
// API server (`npm run worker` vs `npm start`) so a slow or crashing job
// never affects request handling.

const { startEmailWorker } = require("./workers/email.worker");
const { startResultsPublishWorker } = require("./workers/results-publish.worker");

const workers = [startEmailWorker(), startResultsPublishWorker()].filter(Boolean);

console.log(`Worker process started (${workers.length} queue(s) active).`);

async function shutdown(signal) {
  console.log(`${signal} received, closing workers...`);
  await Promise.all(workers.map((w) => w.close()));
  process.exit(0);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
