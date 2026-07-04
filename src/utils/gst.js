/**
 * GST CALCULATION UTILITY — PHASE 8A
 * ====================================
 * One shared, pure function for splitting a pre-tax amount into its Indian
 * GST components. Used in TWO places that both need the exact same math:
 *   1. registration.service.js's createOrder() — to charge the customer
 *      base + GST via Razorpay (not just the bare plan price).
 *   2. invoice.processor.js — to store the GST breakdown on the Invoice row
 *      and print it on the PDF.
 * Keeping this in one place means both spots can never drift out of sync
 * on how GST is computed.
 */

const { GST_RATE } = require("../config/env");

/**
 * WHAT: Splits a pre-tax (base) rupee amount into CGST + SGST + total.
 * WHY: Indian GST law requires an "intra-state" sale (buyer and seller in
 *      the same state) to be billed as two equal halves — CGST (Central
 *      GST) and SGST (State GST) — instead of one combined "GST" line, even
 *      though together they add up to the same total tax. We don't do
 *      inter-state IGST here; every school in this app is billed the same
 *      way, so the 50/50 CGST+SGST split is the correct default for now.
 *
 *      GST_RATE is read from env (default 18) so the rate is configurable
 *      without touching code — see src/config/env.js. It is NEVER
 *      hardcoded anywhere else; every caller that needs a rate gets it
 *      from this one function's return value.
 *
 * @param {number} baseAmount - pre-tax amount in rupees, e.g. 8999
 * RETURNS: {
 *   gstRate: number,     — the % rate that was applied, e.g. 18
 *   gstAmount: number,   — total tax (cgstAmount + sgstAmount)
 *   cgstAmount: number,  — half the GST amount (Central GST)
 *   sgstAmount: number,  — half the GST amount (State GST)
 *   totalAmount: number, — baseAmount + gstAmount — what the customer pays
 * }
 */
function calculateGst(baseAmount) {
  const gstRate = GST_RATE;

  // Total GST first, then split it exactly in half for CGST/SGST — splitting
  // the already-rounded total (rather than computing 9% and 9% separately
  // and adding them) guarantees cgstAmount + sgstAmount always exactly
  // equals gstAmount, with no stray rounding difference between the two.
  const gstAmount = baseAmount * (gstRate / 100);
  const cgstAmount = gstAmount / 2;
  const sgstAmount = gstAmount / 2;
  const totalAmount = baseAmount + gstAmount;

  return { gstRate, gstAmount, cgstAmount, sgstAmount, totalAmount };
}

module.exports = { calculateGst };
