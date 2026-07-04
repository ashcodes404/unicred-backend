/**
 * INVOICE CONTROLLER (admin dashboard) — PHASE 8E
 * ==================================================
 * Thin HTTP layer for admin-facing invoice viewing. Reads req.query/
 * req.params/req.user, calls invoice.service.js, and shapes the response
 * with the shared success()/error() helpers — same pattern as every other
 * controller. schoolId ALWAYS comes from req.user.schoolId (the admin's
 * own JWT), never from the request — an admin can only ever see their own
 * school's invoices.
 */

const invoiceService = require("./invoice.service");
const { success, error } = require("../../utils/apiResponse");

/**
 * WHAT: GET /api/admin/invoices?page=&limit=
 * RETURNS: 200 + { invoices, pagination }.
 */
async function listInvoicesHandler(req, res, next) {
  try {
    const data = await invoiceService.listInvoices(req.user.schoolId, req.query);
    return success(res, 200, "Invoices fetched successfully", data);
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: GET /api/admin/invoices/:id
 * RETURNS: 200 + invoice detail, or 404 if it doesn't belong to this school.
 */
async function getInvoiceHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const invoice = await invoiceService.getInvoiceById(req.user.schoolId, id);
    return success(res, 200, "Invoice fetched successfully", { invoice });
  } catch (err) {
    next(err);
  }
}

/**
 * WHAT: GET /api/admin/invoices/:id/download
 * WHY: Streams the invoice's PDF file back to the admin.
 *
 * FILE-STREAMING APPROACH: res.download(path, filename) is an Express
 * built-in — it sets the Content-Disposition header to "attachment" (so
 * the browser downloads it instead of trying to render it inline) with
 * the given filename, then internally streams the file from disk with
 * fs.createReadStream() rather than reading the whole PDF into memory
 * first. `filePath` here is always the server's own already-verified
 * absolute path (from invoice.service.js, only after confirming this
 * invoice belongs to the requesting admin's school) — never anything
 * derived from user input, so there's no path-traversal risk.
 *
 * RETURNS: the PDF file stream, or a JSON 404 if unavailable.
 */
async function downloadInvoiceHandler(req, res, next) {
  try {
    const id = Number(req.params.id);
    const { filePath, downloadName } = await invoiceService.getInvoiceFileForDownload(req.user.schoolId, id);

    // res.download()'s callback fires once the transfer finishes OR fails.
    // If it fails AFTER the response has already started streaming, we
    // can't send a fresh JSON error anymore (headers are already sent) —
    // just log it. If it fails before anything was sent, fall through to
    // a clean error response instead of leaving the request hanging.
    res.download(filePath, downloadName, (err) => {
      if (err && !res.headersSent) {
        return error(res, 500, "Failed to download invoice.");
      }
      if (err) {
        console.error(`Invoice download stream error for invoice ${id}:`, err.message);
      }
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listInvoicesHandler,
  getInvoiceHandler,
  downloadInvoiceHandler,
};
