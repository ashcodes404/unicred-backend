
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
 * auth.service.js
 *
 * Flow:
 * Controller
 *    ↓
 * Service
 *    ↓
 * email.js
 *    ↓
 * Gmail / SMTP
 */

/**
 * Nodemailer is a Node.js package that allows
 * applications to send emails through SMTP servers.
 */
const nodemailer = require("nodemailer");


/**
 
 * EMAIL TRANSPORTER

 *
 * What is a transporter?
 *
 * A transporter is an object created by Nodemailer that is
 * responsible for connecting to an email provider (Gmail,
 * Outlook, SendGrid, etc.) and sending emails.
 *
 * Think of it as a "mail delivery agent".
 *
 * Without a transporter:
 * ❌ We cannot send emails.
 *
 * With a transporter:
 * ✅ We can send OTPs
 * ✅ We can send password reset emails
 * ✅ We can send account creation emails
 *
 
 * Why create it only in production?
 
 *
 * During development:
 * - We don't want to send real emails.
 * - We simply print OTPs in the terminal.
 * - This avoids Gmail limits.
 * - This avoids unnecessary API calls.
 *
 * During production:
 * - Real users need real emails.
 * - Gmail SMTP is used to deliver emails.
 *
 * NODE_ENV values:
 *
 * development
 * production
 * test
 *
 * When NODE_ENV === "production",
 * transporter is created.
 *
 * Otherwise transporter is null.
 *
 * Example:
 *
 * Development:
 * transporter = null
 *
 * Production:
 * transporter = Gmail SMTP connection
 *
 * ------------------------------------------------------------------
 * createTransport()
 * ------------------------------------------------------------------
 *
 * Nodemailer built-in function:
 *
 * nodemailer.createTransport(config)
 *
 * Purpose:
 * Creates an SMTP connection configuration.
 *
 * Parameters:
 * service -> Email provider
 * auth    -> Login credentials
 *
 * Returned value:
 * Transporter Object
 *
 * Example:
 * transporter.sendMail(...)
 *
 * ------------------------------------------------------------------
 * Gmail Authentication
 * ------------------------------------------------------------------
 *
 * user:
 * Gmail account used to send emails.
 *
 * pass:
 * Gmail App Password
 * (NOT your Gmail login password)
 *
 * Example:
 *
 * GMAIL_USER=unicred.team@gmail.com
 * GMAIL_APP_PASSWORD=abcd efgh ijkl mnop
 *
 * ------------------------------------------------------------------
 * Flow
 * ------------------------------------------------------------------
 *
 * Register User
 *      ↓
 * Generate OTP
 *      ↓
 * sendVerificationOtp()
 *      ↓
 * transporter.sendMail()
 *      ↓
 * Gmail SMTP Server
 *      ↓
 * User receives email
 */

const transporter =
process.env.NODE_ENV === "production"
? nodemailer.createTransport({
service: "gmail",
auth: {
user: process.env.GMAIL_USER,
pass: process.env.GMAIL_APP_PASSWORD,
},
})
: null;

async function sendVerificationOtp(email, otp) {
if (process.env.NODE_ENV !== "production") {
console.log("[EMAIL VERIFICATION]");
console.log("Email:", email);
console.log("OTP:", otp);
return;
}

await transporter.sendMail({
from: process.env.EMAIL_FROM,
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

await transporter.sendMail({
from: process.env.EMAIL_FROM,
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

await transporter.sendMail({
from: process.env.EMAIL_FROM,
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
 * other functions in this file, this one needs an attachment — none of the
 * existing functions support that, so this is a new addition rather than a
 * reuse of an existing one.
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
 * transporter.sendMail() same as the others, but with an `attachments`
 * array — Nodemailer reads the file at `path` and attaches it to the email.
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

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: email,
    subject: "Welcome to UniCred",
    text:
      `Hello ${name},\n\n` +
      `Welcome to UniCred! Payment for ${schoolName} has been received and your school is now active.\n\n` +
      `Plan: ${plan}\n` +
      `You can log in here: ${loginUrl}\n\n` +
      `Your invoice is attached to this email.`,
    // `attachments` is a Nodemailer option — give it a local file path and
    // it reads the file and attaches it to the outgoing email for you.
    attachments: [{ path: attachmentPath }],
  });
}

module.exports = {
sendVerificationOtp,
sendPasswordResetOtp,
sendAccountCreatedEmail,
sendWelcomeInvoiceEmail,
};
