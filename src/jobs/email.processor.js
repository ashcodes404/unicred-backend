const {
  sendVerificationOtp,
  sendPasswordResetOtp,
  sendAccountCreatedEmail,
} = require("../utils/email");

// One handler per email.queue job name — shared by the queue's no-Redis
// fallback (runs inline) and the worker (runs via BullMQ), so there is only
// one place that maps a job type to an actual send.
//
// NOTE (PHASE 8D): sendSubscriptionReminderEmail() is deliberately NOT wired
// in here — subscription-reminder.processor.js is already a background
// BullMQ job (not an HTTP request handler racing to respond), so it calls
// that function directly, the same way src/jobs/invoice.processor.js calls
// sendWelcomeInvoiceEmail() directly. Routing it through this second queue
// too would just be an extra hop with no benefit.
const HANDLERS = {
  "verification-otp":  ({ email, otp }) => sendVerificationOtp(email, otp),
  "password-reset-otp": ({ email, otp }) => sendPasswordResetOtp(email, otp),
  "account-created":   (data) => sendAccountCreatedEmail(data),
};

async function processEmailJob(name, data) {
  const handler = HANDLERS[name];
  if (!handler) throw new Error(`Unknown email job type: "${name}"`);
  return handler(data);
}

module.exports = { processEmailJob };
