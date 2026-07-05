const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");

const routes = require("./routes/index");
const { FRONTEND_URL } = require("./config/env");
const errorMiddleware = require("./middleware/error.middleware");
const { webhookHandler } = require("./modules/registration/registration.controller");
const subscriptionGate = require("./middleware/subscriptionGate.middleware"); // PHASE 8C — see that file for why this is global instead of per-route

const app = express();

// helmet() sets a standard set of security-related HTTP response headers
// (X-Content-Type-Options, X-Frame-Options, a conservative default
// Content-Security-Policy, etc.) — a baseline every production Express app
// should have. Applied globally, before everything else, so every response
// gets these headers regardless of which route handled it.
app.use(helmet());

app.use(
  cors({
    // FRONTEND_URL comes from config/env.js — defaults to the local Vite
    // dev server, but MUST be set to the real deployed frontend's origin in
    // production, or the browser will reject every request from it.
    origin: FRONTEND_URL,
    credentials: true,
  })
);

// ── RAZORPAY WEBHOOK (Phase 5) — MUST be registered BEFORE express.json() ──
// Razorpay signs the webhook's exact raw request bytes, so we need those
// bytes untouched (a Buffer), not JSON.parse()'d. express.json() below is
// global and runs for every request BEFORE it reaches any /api route, so if
// this route were defined inside registration.routes.js (mounted under
// /api), the body would already be consumed and parsed by the time it gets
// there — there would be nothing left for a route-local express.raw() to read.
//
// Registering this exact path + express.raw() here, before express.json(),
// means Express matches and fully handles this one route first; webhookHandler
// sends its own response and never calls next(), so express.json() below
// never runs for this path. Every other route is completely unaffected —
// express.json() itself is untouched.
//
// express.raw({ type: "application/json" }) — body-parser middleware that
// reads the request body into a raw Buffer (instead of parsing it as JSON),
// as long as the Content-Type header matches "application/json" (which is
// what Razorpay sends).
app.post("/api/registration/webhook", express.raw({ type: "application/json" }), webhookHandler);

app.use(express.json());
app.use(cookieParser());

// PHASE 8C — restricts an admin of an expired-subscription school to only
// the renewal/status/logout routes. Placed after the webhook (which never
// carries an admin Bearer token, so it's unaffected) and before every /api
// route. See subscriptionGate.middleware.js for the full reasoning.
app.use(subscriptionGate);

app.get("/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Server is running",
  });
});

// Mount all API routes under /api
app.use("/api", routes);

// Global error handler — must be LAST
app.use(errorMiddleware);

module.exports = app;