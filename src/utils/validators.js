// =============================================================================
// SHARED VALIDATORS
// =============================================================================
//
// Small, reusable validation helpers used across modules.
// Keeping them here avoids copy-pasting the same checks into every service.
// (Roadmap Day 15 requires URL format checks on certificateUrl, offerLetterUrl,
//  proofUrl, etc. — this is the single source of truth for that.)
// =============================================================================

/**
 * Check whether a value is a non-empty string after trimming whitespace.
 *
 * @param {*} value - Anything (we only return true for real text)
 * @returns {boolean}
 *
 * Example: isNonEmptyString("  ")  -> false
 *          isNonEmptyString("hi")  -> true
 */
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Check whether a string is a valid http/https URL.
 *
 * We use the built-in `URL` class (provided by Node.js). When you do
 * `new URL(someString)` and the string is not a valid URL, it THROWS.
 * So we wrap it in try/catch: no throw = valid, throw = invalid.
 *
 * We also force the protocol to be http or https only — this blocks
 * things like "javascript:" or "file:" which could be unsafe.
 *
 * @param {string} value - The URL string to validate
 * @returns {boolean}
 */
function isValidUrl(value) {
  if (!isNonEmptyString(value)) return false;

  try {
    // `new URL(...)` parses the string. Throws if the format is wrong.
    const parsed = new URL(value.trim());

    // Only allow web links.
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (_err) {
    // new URL threw -> not a valid URL.
    return false;
  }
}

module.exports = {
  isNonEmptyString,
  isValidUrl,
};
