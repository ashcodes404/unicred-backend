/**
 * INVOICE SERVICE — PHASE 4
 * ==========================
 * Pure helper functions for building an invoice: generating its unique
 * number and rendering its PDF. No Prisma calls live here — this file only
 * knows how to make a number and a PDF file; src/jobs/invoice.processor.js
 * decides WHEN to call these and what to do with the results (same
 * separation of concerns as service/repository elsewhere in the app).
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit"); // PDF generation library — builds a PDF by streaming drawing/text commands to a file

// All generated invoice PDFs are saved here. Created on first use if missing.
const INVOICES_DIR = path.join(process.cwd(), "invoices");

/**
 * WHAT: Generates a unique, human-readable invoice number like
 *       "UNICRED-2026-90002-A7F3K9".
 * WHY: Every Invoice row needs a unique, presentable reference number —
 *      the format bakes in the year and schoolId so a support agent can
 *      recognize which school an invoice belongs to just by reading it,
 *      and the random suffix guarantees uniqueness even if two invoices
 *      were somehow generated for the same school in the same year.
 * RETURNS: string
 */
function generateInvoiceNumber(schoolId) {
  const year = new Date().getFullYear();

  // crypto.randomBytes(n) returns n cryptographically random bytes — we
  // convert to base36 (0-9 + a-z) text, uppercase it, and take 6 characters
  // as a short random suffix. This is NOT meant to be secret, just unique.
  const randomSuffix = crypto
    .randomBytes(6)
    .toString("hex")
    .toUpperCase()
    .slice(0, 6);

  return `UNICRED-${year}-${schoolId}-${randomSuffix}`;
}

/**
 * WHAT: Renders an invoice PDF to disk and returns the file path.
 * WHY: The admin needs a downloadable/emailable proof-of-payment document.
 *      pdfkit builds PDFs programmatically (draw text/lines onto a page,
 *      then stream the result to a file) — there's no template engine
 *      involved, we just write out each line of the invoice by hand.
 *
 * @param {object} invoiceData
 * @param {string} invoiceData.invoiceNumber
 * @param {string} invoiceData.schoolName
 * @param {string} invoiceData.adminName
 * @param {string} invoiceData.plan             - plan name, e.g. "1 Year"
 * @param {number} invoiceData.durationMonths
 * @param {Date}   invoiceData.startDate
 * @param {Date}   invoiceData.expiryDate
 * @param {number} invoiceData.amount           - amount paid, in rupees
 * @param {number} invoiceData.gst
 * @param {number} invoiceData.totalAmount
 * @param {string} invoiceData.razorpayPaymentId
 * @param {string} invoiceData.razorpayOrderId
 * @param {Date}   invoiceData.transactionDate
 * RETURNS: Promise<string> — absolute path to the saved PDF file.
 */
async function buildInvoicePdf(invoiceData) {
  // fs.mkdirSync(path, { recursive: true }) creates the folder (and any
  // missing parent folders) if it doesn't already exist; it's a no-op if
  // the folder is already there, so it's safe to call on every invoice.
  if (!fs.existsSync(INVOICES_DIR)) {
    fs.mkdirSync(INVOICES_DIR, { recursive: true });
  }

  const pdfPath = path.join(INVOICES_DIR, `${invoiceData.invoiceNumber}.pdf`);

  // new PDFDocument() creates a new in-memory PDF we can draw onto.
  const doc = new PDFDocument({ margin: 50 });

  // Pipe the PDF's output stream straight into a file write stream —
  // pdfkit writes pages as it builds them rather than holding the whole
  // PDF in memory at once.
  const writeStream = fs.createWriteStream(pdfPath);
  doc.pipe(writeStream);

  // .fontSize()/.text() draw text at the current cursor position and move
  // the cursor down automatically — this is how pdfkit lays out a page,
  // there's no separate "layout" step.
  doc.fontSize(20).text("UniCred", { align: "center" });
  doc.fontSize(14).text("Payment Invoice", { align: "center" });
  doc.moveDown(2);

  doc.fontSize(11);
  doc.text(`Invoice Number: ${invoiceData.invoiceNumber}`);
  doc.text(`Transaction Date: ${invoiceData.transactionDate.toDateString()}`);
  doc.moveDown();

  doc.text(`School Name: ${invoiceData.schoolName}`);
  doc.text(`Admin Name: ${invoiceData.adminName}`);
  doc.moveDown();

  doc.text(`Plan Purchased: ${invoiceData.plan}`);
  doc.text(`Duration: ${invoiceData.durationMonths} month(s)`);
  doc.text(`Subscription Start: ${invoiceData.startDate.toDateString()}`);
  doc.text(`Subscription Expiry: ${invoiceData.expiryDate.toDateString()}`);
  doc.moveDown();

  doc.text(`Amount Paid: Rs. ${invoiceData.amount.toFixed(2)}`);
  doc.text(`GST: Rs. ${invoiceData.gst.toFixed(2)}`);
  doc.fontSize(12).text(`Total Amount: Rs. ${invoiceData.totalAmount.toFixed(2)}`, { underline: true });
  doc.fontSize(11);
  doc.moveDown();

  doc.text(`Razorpay Payment ID: ${invoiceData.razorpayPaymentId}`);
  doc.text(`Razorpay Order ID: ${invoiceData.razorpayOrderId}`);

  // .end() finalizes the PDF (no more content can be added) and flushes
  // the remaining buffered output through the piped write stream.
  doc.end();

  // The write stream's "finish" event fires once every byte has actually
  // been written to disk — we wait for that before telling the caller the
  // PDF is ready, otherwise a caller could try to email a half-written file.
  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve);
    writeStream.on("error", reject);
  });

  return pdfPath;
}

module.exports = {
  generateInvoiceNumber,
  buildInvoicePdf,
};
