// COMBINED ENTRY POINT — runs the Express API and (optionally) every BullMQ
// worker in ONE process.
//
// WHY THIS FILE EXISTS:
// Render's free tier only gives you one web service for free — running the
// API and the worker as two separate services would need a second (paid)
// service. This file lets both live in a single process instead: `npm
// start` now runs THIS file, and RUN_WORKER_IN_WEB (an env var, see
// config/env.js) decides whether it ALSO starts the worker.
//
// Nothing about the API (src/app.js) or the worker (src/worker.js) changes
// to make this work — this file just calls both, reusing their existing
// startup/shutdown functions. src/server.js (API-only) and `npm run
// worker:dev` (worker-only) still work exactly as before, for local dev.

const app = require("./app");
app.set("trust proxy", 1);

const { PORT, RUN_WORKER_IN_WEB } = require("./config/env");
const { startWorkers, stopWorkers } = require("./worker");

// The ONE shared ioredis connection every queue and worker in this app
// already reuses (see src/config/queueConnection.js) — required here only
// so shutdown() below can close it cleanly. This does NOT create a second
// Redis connection; requiring an already-loaded file just returns the same
// connection object Node cached the first time it was required.
const queueConnection = require("./config/queueConnection");

// Tracked at module scope so shutdown() (further down) knows what it
// actually needs to close.
let httpServer;
let workersAreRunning = false;

/**
 * WHAT: Starts the Express API, and — only if RUN_WORKER_IN_WEB is turned
 *       on — also starts every BullMQ worker in this same process.
 * WHY: One function that both possible startup shapes (API-only, or
 *      API+worker-combined) share, so there's only one place this app's
 *      "boot up" logic lives.
 * RETURNS: Promise<void>
 */
async function start() {
  // app.listen() — Express's built-in method that starts the actual HTTP
  // server and begins accepting incoming requests on the given port.
  httpServer = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  if (RUN_WORKER_IN_WEB) {
    console.log("RUN_WORKER_IN_WEB=true — starting BullMQ workers in this same process.");
    await startWorkers();
    workersAreRunning = true;
  } else {
    console.log("RUN_WORKER_IN_WEB is off — running the API only (start the worker separately if needed).");
  }
}

/**
 * WHAT: Shuts everything this process started down cleanly, in order: stop
 *       accepting new HTTP requests, stop the workers (if they were
 *       running), close the shared Redis connection, then exit.
 * WHY: Render sends SIGTERM before restarting/redeploying a service. If we
 *      just let the process die immediately, a request could get cut off
 *      mid-response, or a BullMQ job could be killed mid-run instead of
 *      finishing or being cleanly handed back to the queue. Doing this in
 *      order, and waiting for each step, avoids both.
 *
 * @param {string} signal - which signal triggered this ("SIGTERM" or "SIGINT"),
 *        only used for the log line so it's clear what caused the shutdown.
 * RETURNS: never resolves — always ends by calling process.exit(0)
 */
async function shutdown(signal) {
  console.log(`${signal} received, shutting down...`);

  // server.close() (a built-in Node http.Server method, which Express's
  // app.listen() returns) stops accepting NEW connections and calls its
  // callback once every in-flight request has finished — wrapped in a
  // Promise here so we can `await` that instead of using its raw callback.
  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve));
    console.log("HTTP server closed.");
  }

  if (workersAreRunning) {
    await stopWorkers();
    console.log("Workers closed.");
  }

  if (queueConnection) {
    // ioredis' quit() built-in sends Redis a graceful QUIT command and
    // waits for it to confirm before closing the socket — nicer than
    // disconnect(), which just drops the TCP connection immediately and
    // can leave the last command's response unread.
    await queueConnection.quit();
    console.log("Redis connection closed.");
  }

  process.exit(0);
}

// process.on("SIGTERM"/"SIGINT") — Node's built-in way to run code when the
// OS asks this process to stop. SIGTERM is what Render (and most hosting
// platforms) send on a restart/redeploy; SIGINT is Ctrl+C in a local terminal.
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

start();
