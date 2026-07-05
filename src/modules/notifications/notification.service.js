const notificationRepository = require("./notification.repository");
const AppError = require("../../utils/AppError");
/**
 * =====================================================
 * NOTIFICATION SERVICE
 * =====================================================
 *
 * Responsibilities:
 * - Business Logic
 * - Validation
 * - Authorization Checks
 * - Data Transformation
 *
 * NEVER:
 * - Directly access Prisma here
 * - Handle req/res here
 *
 * Flow:
 *
 * Controller
 *    ↓
 * Service
 *    ↓
 * Repository
 *    ↓
 * Database
 *
 * =====================================================
 */

/**
 * Get paginated notifications for current user.
 *
 * Used By:
 * GET /api/notifications
 *
 * Query Params:
 * page
 * limit
 */
async function getNotifications(
  userId,
  page = 1,
  limit = 20
) {
  /**
   * Convert query params to numbers.
   */
  page = Number(page);
  limit = Number(limit);

  /**
   * Safety defaults.
   */
  if (Number.isNaN(page) || page < 1) {
    page = 1;
  }

  if (Number.isNaN(limit) || limit < 1) {
    limit = 20;
  }

  /**
   * Prevent massive queries.
   */
  if (limit > 100) {
    limit = 100;
  }

  const skip = (page - 1) * limit;

  /**
   * Execute both queries simultaneously.
   *
   * Faster than:
   * await query1
   * await query2
   */
  const [notifications, total] =
    await Promise.all([
      notificationRepository.getNotificationsByUser(
        userId,
        skip,
        limit
      ),

      notificationRepository.countNotificationsByUser(
        userId
      ),
    ]);

  return {
    notifications,

    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}

/**
 * Mark a single notification as read.
 *
 * Used By:
 * PATCH /notifications/:id/read
 */
async function markNotificationAsRead(
  notificationId,
  userId
) {
  /**
   * Step 1:
   * Verify notification exists
   * and belongs to this user.
   */
  const notification =
    await notificationRepository.findNotificationById(
      notificationId,
      userId
    );

  if (!notification) {
    throw new AppError(
  404,
  "Notification not found"
);
  }

  /**
   * Step 2:
   * Already read.
   *
   * No need to update database again.
   */
  if (notification.isRead) {
     return {
    alreadyRead: true,
    notification,
  };
  }

  /**
   * Step 3:
   * Mark as read.
   */
  return notificationRepository.markNotificationRead(
    notificationId
  );
}

/**
 * Mark all notifications as read.
 *
 * Used By:
 * PATCH /notifications/read-all
 */
async function markAllNotificationsAsRead(
  userId
) {
  return notificationRepository.markAllNotificationsRead(
    userId
  );
}

/**
 * Get unread notification count.
 *
 * Used By:
 * GET /notifications/unread-count
 */
async function getUnreadCount(
  userId
) {
  const unreadCount =
    await notificationRepository.getUnreadCount(
      userId
    );

  return {
    unreadCount,
  };
}

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadCount,
};