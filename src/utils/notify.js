// src/utils/notify.js

const prisma = require("../config/db");

/**
 * =====================================================
 * NOTIFICATION UTILITY
 * =====================================================
 *
 * PURPOSE:
 * --------
 * Centralized helper for creating notifications.
 *
 * Instead of writing:
 *
 * await prisma.notification.create(...)
 *
 * inside every service file,
 * use:
 *
 * await notify({...})
 *
 * BENEFITS:
 * ---------
 * 1. Single source of truth.
 * 2. Easier maintenance.
 * 3. Easier migration to BullMQ later.
 * 4. Consistent notification structure.
 *
 * EXAMPLES:
 * ---------
 *
 * Result Published:
 *
 * await notify({
 *   userId: student.userId,
 *   type: "RESULT_PUBLISHED",
 *   message: "Semester 5 result has been published",
 *   link: "/student/results"
 * });
 *
 *
 * Achievement Approved:
 *
 * await notify({
 *   userId: student.userId,
 *   type: "ACHIEVEMENT_APPROVED",
 *   message: "Your achievement has been approved",
 *   link: "/student/achievements"
 * });
 *
 *
 * Reappear Approved:
 *
 * await notify({
 *   userId: student.userId,
 *   type: "REAPPEAR_APPROVED",
 *   message: "Your reappear application has been approved"
 * });
 *
 */

/**
 * Creates a notification for a user.
 *
 * @param {Object} params
 * @param {number} params.userId
 * @param {string} params.type
 * @param {string} params.message
 * @param {string|null} [params.link]
 *
 * @returns {Promise<Notification>}
 */
async function notify({
  userId,
  type,
  message,
  link = null,
}) {
  return prisma.notification.create({
    data: {
      userId,
      type,
      message,
      link,
    },
  });
}

module.exports = notify;