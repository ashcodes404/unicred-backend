// =============================================================================
// TIME UTILITIES  (src/utils/time.js)
// =============================================================================
//
// Timetable slots store their time as plain text like "09:00" or "14:30".
// Text is easy to store but hard to compare: is "9:5" before "10:00"? To make
// comparisons reliable we turn each "HH:MM" into a single number — the count
// of minutes since midnight — and then simple math tells us if two classes
// clash.
//
// Everything in this file is "pure": it only takes inputs and returns outputs,
// with no database and no side effects. That makes it fast and easy to test.
//
// =============================================================================

// A regular expression ("regex") is a pattern used to check if a string looks
// a certain way. This one accepts only a valid 24-hour clock time, 00:00–23:59:
//   ^              must start here (nothing before)
//   ([01]\d|2[0-3]) hour = 00–19  OR  20–23
//   :              a literal colon
//   [0-5]\d        minute = 00–59
//   $              must end here (nothing after)
const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * isValidTime — checks whether a value is a proper "HH:MM" time string.
 *
 * Built-in used:
 *   RegExp.prototype.test(str) → returns true/false if the pattern matches.
 *
 * @param {string} value  e.g. "09:00"
 * @returns {boolean} true when the format is valid
 */
function isValidTime(value) {
  return typeof value === "string" && TIME_REGEX.test(value);
}

/**
 * toMinutes — converts "HH:MM" into minutes since midnight.
 *   "00:00" → 0,  "09:30" → 570,  "23:59" → 1439
 *
 * Built-ins used:
 *   String.prototype.split(":") → "09:30" becomes the array ["09", "30"].
 *   Array.prototype.map(Number) → converts each piece ["09","30"] to [9, 30].
 *
 * @param {string} value  "HH:MM"
 * @returns {number} minutes since midnight
 */
function toMinutes(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * timesOverlap — do two time ranges collide?
 *
 * Two ranges [aStart, aEnd) and [bStart, bEnd) overlap only when
 * aStart is before bEnd AND bStart is before aEnd. Ranges that merely touch
 * (09:00–10:00 and 10:00–11:00) do NOT overlap, so back-to-back classes are
 * allowed while 09:00–10:00 vs 09:30–10:30 correctly clash.
 *
 * @param {string} aStart  "HH:MM"
 * @param {string} aEnd    "HH:MM"
 * @param {string} bStart  "HH:MM"
 * @param {string} bEnd    "HH:MM"
 * @returns {boolean} true when the two ranges overlap
 */
function timesOverlap(aStart, aEnd, bStart, bEnd) {
  const a1 = toMinutes(aStart);
  const a2 = toMinutes(aEnd);
  const b1 = toMinutes(bStart);
  const b2 = toMinutes(bEnd);
  return a1 < b2 && b1 < a2;
}

/**
 * isEndAfterStart — makes sure a slot's end time is later than its start time.
 * A class from 10:00 to 09:00 makes no sense, so we reject it.
 *
 * @param {string} start  "HH:MM"
 * @param {string} end    "HH:MM"
 * @returns {boolean}
 */
function isEndAfterStart(start, end) {
  return toMinutes(end) > toMinutes(start);
}

// Export the helpers so other files can `require` and use them.
module.exports = {
  isValidTime,
  toMinutes,
  timesOverlap,
  isEndAfterStart,
};
