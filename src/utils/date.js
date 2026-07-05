// =============================================================================
// DATE UTILITIES  (src/utils/date.js)
// =============================================================================
//
// Holidays and leave are stored as calendar dates. We only care about the DAY,
// not the exact hour, so these helpers normalise a date to the very start of
// the day (00:00:00) and let us check whether a day falls inside a range.
//
// Everything here is "pure" (inputs → outputs, no database), so it is easy to
// reuse and test. It is used by System B (holidays) and System C (absences).
//
// =============================================================================

/**
 * isValidDateString — is this a value JavaScript can turn into a real date?
 *
 * Built-ins used:
 *   new Date(value) → tries to build a Date from a string like "2026-07-10".
 *   date.getTime()  → the date as a number (milliseconds). For an INVALID date
 *                     this is NaN, and Number.isNaN(NaN) is true.
 *
 * @param {string} value  e.g. "2026-07-10"
 * @returns {boolean} true when it is a real, parseable date
 */
function isValidDateString(value) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time);
}

/**
 * startOfDay — returns a new Date set to 00:00:00.000 of the given day.
 * Storing dates at the day's start makes "same day" comparisons reliable
 * (otherwise 2026-07-10T09:00 and 2026-07-10T15:00 would look different).
 *
 * Built-ins used:
 *   new Date(value)          → parse the incoming date.
 *   date.setHours(0,0,0,0)   → zero out hours, minutes, seconds, milliseconds.
 *
 * @param {string|Date} value
 * @returns {Date} same day at midnight
 */
function startOfDay(value) {
  const d = new Date(value);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * endOfDay — returns a new Date set to 23:59:59.999 of the given day.
 * Useful as the inclusive end of a range.
 *
 * @param {string|Date} value
 * @returns {Date} same day at the last millisecond
 */
function endOfDay(value) {
  const d = new Date(value);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * isStartBeforeOrSameDay — is `start` on the same day as, or before, `end`?
 * Used to reject a range where the end is earlier than the start.
 *
 * @param {string|Date} start
 * @param {string|Date} end
 * @returns {boolean}
 */
function isStartBeforeOrSameDay(start, end) {
  return startOfDay(start).getTime() <= startOfDay(end).getTime();
}

/**
 * isDateInRange — does `day` fall on or between `rangeStart` and `rangeEnd`
 * (inclusive)? Compared at day granularity, so the time of day is ignored.
 *
 * @param {string|Date} day
 * @param {string|Date} rangeStart
 * @param {string|Date} rangeEnd
 * @returns {boolean}
 */
function isDateInRange(day, rangeStart, rangeEnd) {
  const t = startOfDay(day).getTime();
  return t >= startOfDay(rangeStart).getTime() && t <= startOfDay(rangeEnd).getTime();
}

/**
 * getIsoWeekday — returns the ISO weekday number for a date.
 * ISO numbering is 1 = Monday ... 7 = Sunday (the same scheme our timetable
 * slots use in dayOfWeek).
 *
 * Built-in used:
 *   date.getDay() → JavaScript's own weekday, but it uses 0 = Sunday ... 6 =
 *   Saturday. We convert Sunday (0) to 7 and leave the rest unchanged so it
 *   matches ISO.
 *
 * @param {string|Date} value
 * @returns {number} 1 (Mon) … 7 (Sun)
 */
function getIsoWeekday(value) {
  const jsDay = new Date(value).getDay(); // 0..6, Sunday = 0
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * eachDateInRange — expands a start/end range into an array of Date objects,
 * one per day (each at 00:00), inclusive of both ends.
 *
 * Example: ("2026-07-06", "2026-07-08") → [Jul 6, Jul 7, Jul 8].
 *
 * Built-in used:
 *   date.setDate(date.getDate() + 1) → moves a Date forward by one calendar
 *   day. getDate() reads the day-of-month; setDate() writes it back, and it
 *   correctly rolls over into the next month/year.
 *
 * @param {string|Date} start
 * @param {string|Date} end
 * @returns {Date[]} list of days from start to end (inclusive)
 */
function eachDateInRange(start, end) {
  const days = [];
  const cursor = startOfDay(start);
  const last = startOfDay(end);

  while (cursor.getTime() <= last.getTime()) {
    // Push a COPY (new Date) so later mutations of `cursor` don't change it.
    days.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

module.exports = {
  isValidDateString,
  startOfDay,
  endOfDay,
  isStartBeforeOrSameDay,
  isDateInRange,
  getIsoWeekday,
  eachDateInRange,
};