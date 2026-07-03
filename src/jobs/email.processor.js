const {
  sendVerificationOtp,
  sendPasswordResetOtp,
  sendAccountCreatedEmail,
} = require("../utils/email");

// One handler per email.queue job name — shared by the queue's no-Redis
// fallback (runs inline) and the worker (runs via BullMQ), so there is only
// one place that maps a job type to an actual send.
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
