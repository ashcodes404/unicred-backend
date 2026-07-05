
/**
 * ------------------------------------------------------------------
 * EMAIL UTILITY
 * ------------------------------------------------------------------
 *
 * Purpose:
 * This file is responsible for sending emails.
 *
 * Current email types:
 * 1. Email Verification OTP
 * 2. Password Reset OTP
 * 3. Account Creation Email
 * 4. Welcome + Invoice Email
 * 5. Subscription Reminder Email
 *
 * Why this file exists:
 * Instead of writing email logic inside controllers,
 * we keep all email-related code in one place.
 *
 * Benefits:
 * - Easier maintenance
 * - Reusable
 * - Cleaner controllers
 * - Single source of truth for email logic
 *
 * Used by:
 * auth.service.js, src/jobs/invoice.processor.js,
 * src/jobs/subscription-reminder.processor.js
 *
 * Flow:
 * Controller / Background job
 *    ↓
 * Service
 *    ↓
 * email.js
 *    ↓
 * Resend (email-sending API)
 */

/**
 * fs is Node's built-in file-system module — used here to read an invoice
 * PDF off disk into memory before attaching it to an email (Resend wants
 * the attachment's bytes, not a file path).
 */
const fs = require("fs");

/**
 * "Resend" is the class the `resend` npm package exports — it's a small
 * SDK that wraps Resend's email-sending REST API, so we don't have to
 * hand-write HTTP calls + auth headers ourselves (same reasoning as using
 * the Razorpay/Cloudinary SDKs elsewhere in this app instead of raw fetch()).
 */
const { Resend } = require("resend");
const { RESEND_API_KEY, EMAIL_FROM, EMAIL_TEST_RECIPIENT } = require("../config/env");

/**
 * EMAIL CLIENT
 * ------------------------------------------------------------------
 * Only created in production — during development we never want to spend
 * real API calls (or accidentally email a real person) just from testing
 * locally, so every function below just console.logs instead (see each
 * function's own `if (NODE_ENV !== "production")` branch).
 *
 * `new Resend(apiKey)` just stores the API key in memory — it doesn't open
 * a network connection, so creating one client here and reusing it for
 * every email is both correct and cheap (same pattern as this app's shared
 * Prisma/Razorpay/Cloudinary clients).
 */
const resend =
  process.env.NODE_ENV === "production" ? new Resend(RESEND_API_KEY) : null;

/**
 * WHAT: Sends one email through Resend and throws a clear error if Resend
 *       reports the send failed.
 * WHY: Every function below needs this exact same "call Resend, then check
 *      for an error" step — written once here instead of five times.
 *      Resend's SDK does NOT throw on a failed send by itself; it resolves
 *      with `{ data, error }`, where `error` is set instead of the promise
 *      rejecting. If we didn't check `error` ourselves, a failed send would
 *      look identical to a successful one to the rest of the app — e.g.
 *      the invoice background job (src/jobs/invoice.processor.js) needs a
 *      real thrown error so BullMQ knows to retry it.
 *
 * @param {object} payload - { from, to, subject, text, attachments? } — same
 *        shape Resend's emails.send() expects.
 * RETURNS: Promise<void>
 */
async function sendViaResend(payload) {
  // TEMPORARY SANDBOX OVERRIDE — see EMAIL_TEST_RECIPIENT's comment in
  // config/env.js. While Resend has no verified domain, it rejects sending
  // to any address except the one your Resend account is registered under.
  // If EMAIL_TEST_RECIPIENT is set, every email's real `to` gets swapped
  // for it here — the ONE place all 5 email functions already funnel
  // through, so nothing else in the app needs to change. Logged clearly so
  // it's never a silent surprise which address an email actually went to.
  if (EMAIL_TEST_RECIPIENT) {
    console.log(`[email] sandbox override: redirecting "${payload.to}" -> "${EMAIL_TEST_RECIPIENT}"`);
    payload = { ...payload, to: EMAIL_TEST_RECIPIENT };
  }

  const { data, error } = await resend.emails.send(payload);

  if (error) {
    // error.message comes straight from Resend (e.g. "invalid_from_address",
    // "monthly_quota_exceeded") — surfacing it as-is gives a clear, specific
    // reason instead of a generic "failed to send email".
    throw new Error(`Resend email failed: ${error.message}`);
  }

  return data;
}

async function sendVerificationOtp(email, otp) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[EMAIL VERIFICATION]");
    console.log("Email:", email);
    console.log("OTP:", otp);
    return;
  }

  await sendViaResend({
    from: EMAIL_FROM,
    to: email,
    subject: "Verify Your Account",
    text: `Your verification OTP is ${otp}. It expires in 10 minutes.`,
  });
}

async function sendPasswordResetOtp(email, otp) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[PASSWORD RESET]");
    console.log("Email:", email);
    console.log("OTP:", otp);
    return;
  }

  await sendViaResend({
    from: EMAIL_FROM,
    to: email,
    subject: "Password Reset",
    text: `Your password reset OTP is ${otp}. It expires in 10 minutes.`,
  });
}

/**
 * ---------------------------------------------------
 * sendVerificationOtp()
 * ---------------------------------------------------
 *
 * Purpose:
 * Send OTP for email verification.
 *
 * Called From:
 * auth.service.js → registerUser()
 *
 * Parameters:
 * email -> user's email address
 * otp   -> generated OTP
 *
 * Example:
 * sendVerificationOtp(
 *   "anish@gmail.com",
 *   "582941"
 * );
 *
 * Development:
 * Prints OTP in terminal.
 *
 * Production:
 * Sends actual email.
 *
 * Returns:
 * Promise<void>
 */


async function sendAccountCreatedEmail({
email,
name,
password,
role,
schoolName,
}) {
if (process.env.NODE_ENV !== "production") {
console.log("[ACCOUNT CREATED]");
console.log("Name:", name);
console.log("Email:", email);
console.log("Role:", role);
console.log("Password:", password);
return;
}

await sendViaResend({
from: EMAIL_FROM,
to: email,
subject: "Your Account Has Been Created",
text:
`Hello ${name},\n\n` +
`Your account has been created.\n\n` +
`School: ${schoolName}\n` +
`Role: ${role}\n` +
`Email: ${email}\n` +
`Temporary Password: ${password}\n\n` +
`Please change your password after login.`,
});
}

/**
 * ---------------------------------------------------
 * sendWelcomeInvoiceEmail()  — PHASE 4
 * ---------------------------------------------------
 *
 * Purpose:
 * Sent once to a school's admin right after their payment is verified
 * (Phase 3) and their invoice PDF has been generated (Phase 4). Unlike the
 * other functions in this file, this one needs an attachment.
 *
 * Called From:
 * src/jobs/invoice.processor.js (a BullMQ background job, NOT the HTTP
 * request that verifies payment — so a slow/failed email never blocks or
 * breaks school registration).
 *
 * Parameters:
 * email          -> admin's email address
 * name           -> admin's name
 * schoolName     -> the newly created school's name
 * plan           -> plan name, e.g. "1 Year"
 * loginUrl       -> where the admin logs in (from env, see config/env.js)
 * attachmentPath -> local filesystem path to the invoice PDF
 *
 * Development:
 * Prints the email + attachment path in terminal (same as every other
 * function here) — no real email is sent, no ESP is wired up.
 *
 * Production:
 * Sends via Resend, with the PDF file's bytes attached.
 *
 * Returns:
 * Promise<void>
 */
async function sendWelcomeInvoiceEmail({
  email,
  name,
  schoolName,
  plan,
  loginUrl,
  attachmentPath,
}) {
  if (process.env.NODE_ENV !== "production") {
    console.log("[WELCOME + INVOICE EMAIL]");
    console.log("Name:", name);
    console.log("Email:", email);
    console.log("School:", schoolName);
    console.log("Plan:", plan);
    console.log("Login URL:", loginUrl);
    console.log("Invoice attached:", attachmentPath);
    return;
  }

  await sendViaResend({
    from: EMAIL_FROM,
    to: email,
    subject: "Welcome to UniCred",
    text:
      `Hello ${name},\n\n` +
      `Welcome to UniCred! Payment for ${schoolName} has been received and your school is now active.\n\n` +
      `Plan: ${plan}\n` +
      `You can log in here: ${loginUrl}\n\n` +
      `Your invoice is attached to this email.`,
    // Resend wants the attachment's actual bytes, not a file path — so we
    // read the PDF into memory first. fs.readFileSync() (Node's built-in,
    // synchronous file-read function) is fine here: this only ever runs
    // inside the background invoice worker, never during an HTTP request,
    // so blocking briefly on disk I/O costs nothing user-facing.
    attachments: [
      {
        filename: `${schoolName}-invoice.pdf`,
        content: fs.readFileSync(attachmentPath),
      },
    ],
  });
}

/**
 * ---------------------------------------------------
 * sendSubscriptionReminderEmail()  — PHASE 8D
 * ---------------------------------------------------
 *
 * Purpose:
 * Warns a school's admin that their subscription is about to expire (7/3/1
 * days out) or already has (once, right when it happens) — sent by the
 * subscription-reminder BullMQ job (src/jobs/subscription-reminder.processor.js),
 * never inline during a request, same reasoning as every other background email.
 *
 * Called From:
 * src/jobs/subscription-reminder.processor.js, via the SAME enqueueEmail()
 * queue every other email in this app already goes through (see
 * src/jobs/email.processor.js's HANDLERS map) — no new queue/worker infra
 * needed just for this email.
 *
 * Parameters:
 * email      -> admin's email address
 * name       -> admin's name
 * schoolName -> the school's name
 * plan       -> plan name, e.g. "1 Year"
 * expiryDate -> Date — the subscriptionExpiryDate this reminder is about
 * daysLeft   -> number | null — how many days until expiry, or null when the
 *               reminder is the "already expired" one (reminderType EXPIRED)
 * renewalUrl -> where the admin goes to renew (reuses LOGIN_URL from env —
 *               the admin renews from inside the app after logging in, same
 *               as every other admin action, so there's no separate "renewal
 *               page" URL to configure)
 *
 * Development:
 * Prints the email in terminal (same as every other function here) — no
 * real email is sent, no ESP is wired up.
 *
 * Production:
 * Sends via Resend, same as the others.
 *
 * Returns:
 * Promise<void>
 */
async function sendSubscriptionReminderEmail({
  email,
  name,
  schoolName,
  plan,
  expiryDate,
  daysLeft,
  renewalUrl,
}) {
  // daysLeft === null means this is the "already expired" reminder —
  // otherwise it's one of the 7/3/1-day-before warnings.
  const isExpired = daysLeft === null;

  const subject = isExpired
    ? "Your UniCred subscription has expired"
    : `Your UniCred subscription expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`;

  const urgencyLine = isExpired
    ? "Your subscription has expired and your school's account is now restricted until you renew."
    : `Your subscription expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (on ${expiryDate.toDateString()}).`;

  if (process.env.NODE_ENV !== "production") {
    console.log("[SUBSCRIPTION REMINDER EMAIL]");
    console.log("Name:", name);
    console.log("Email:", email);
    console.log("School:", schoolName);
    console.log("Plan:", plan);
    console.log("Expiry Date:", expiryDate.toDateString());
    console.log("Days Left:", isExpired ? "expired" : daysLeft);
    console.log("Renewal URL:", renewalUrl);
    return;
  }

  await sendViaResend({
    from: EMAIL_FROM,
    to: email,
    subject,
    text:
      `Hello ${name},\n\n` +
      `${urgencyLine}\n\n` +
      `School: ${schoolName}\n` +
      `Plan: ${plan}\n\n` +
      `Please log in and renew to keep ${schoolName}'s account active: ${renewalUrl}`,
  });
}

module.exports = {
sendVerificationOtp,
sendPasswordResetOtp,
sendAccountCreatedEmail,
sendWelcomeInvoiceEmail,
sendSubscriptionReminderEmail,
};
