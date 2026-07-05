const prisma = require("../../config/db");

/**
 * =====================================================
 * NOTIFICATION REPOSITORY
 * =====================================================
 *
 * Responsibilities:
 * - Execute Prisma queries
 * - Return raw database data
 * - NO business logic
 * - NO authorization logic
 * - NO HTTP logic
 *
 * Repository Layer = Database Access Layer
 *
 * Service Layer = Business Logic Layer
 *
 * =====================================================
 */

/**
 * Get paginated notifications for a user.
 *
 * Used By:
 * GET /api/notifications
 *
 * @param {number} userId
 * @param {number} skip
 * @param {number} limit
 *
 * @returns {Promise<Array>}
 */
async function getNotificationsByUser(
  userId,
  skip,
  limit
) {
  return prisma.notification.findMany({
    where: {
      userId,
    },

    orderBy: {
      createdAt: "desc",
    },

    skip,
    take: limit,
  });
}

/**
 * Count total notifications.
 *
 * Used for pagination metadata.
 *
 * @param {number} userId
 *
 * @returns {Promise<number>}
 */
async function countNotificationsByUser(
  userId
) {
  return prisma.notification.count({
    where: {
      userId,
    },
  });
}

/**
 * Find a specific notification
 * belonging to a specific user.
 *
 * SECURITY:
 * userId is included in the query
 * so users cannot access notifications
 * belonging to another account.
 *
 * @param {number} notificationId
 * @param {number} userId
 *
 * @returns {Promise<Object|null>}
 */
async function findNotificationById(
  notificationId,
  userId
) {
  return prisma.notification.findFirst({
    where: {
      id: notificationId,
      userId,
    },
  });
}

/**
 * Mark a single notification as read.
 *
 * IMPORTANT:
 * This function assumes the service layer
 * has already verified that:
 *
 * 1. Notification exists
 * 2. Notification belongs to the user
 *
 * Therefore only notificationId
 * is required here.
 *
 * @param {number} notificationId
 *
 * @returns {Promise<Object>}
 */
async function markNotificationRead(
  notificationId
) {
  return prisma.notification.update({
    where: {
      id: notificationId,
    },

    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

/**
 * Mark all unread notifications
 * as read for a specific user.
 *
 * Used By:
 * PATCH /notifications/read-all
 *
 * Prisma executes a single SQL query,
 * making this very efficient.
 *
 * @param {number} userId
 *
 * @returns {Promise<Object>}
 */
async function markAllNotificationsRead(
  userId
) {
  return prisma.notification.updateMany({
    where: {
      userId,
      isRead: false,
    },

    data: {
      isRead: true,
      readAt: new Date(),
    },
  });
}

/**
 * Get unread notification count.
 *
 * Used for:
 * Notification Bell Badge
 *
 * Example:
 *
 * 🔔 5
 *
 * @param {number} userId
 *
 * @returns {Promise<number>}
 */
async function getUnreadCount(
  userId
) {
  return prisma.notification.count({
    where: {
      userId,
      isRead: false,
    },
  });
}

module.exports = {
  getNotificationsByUser,
  countNotificationsByUser,

  findNotificationById,

  markNotificationRead,
  markAllNotificationsRead,

  getUnreadCount,
};