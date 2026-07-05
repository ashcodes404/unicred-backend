const notificationService = require("./notification.service");

const { success } = require("../../utils/apiResponse");

const asyncHandler = require("../../utils/asyncHandler");

/**
 * =====================================================
 * NOTIFICATION CONTROLLER
 * =====================================================
 *
 * Responsibilities:
 * - Read data from request
 * - Call service layer
 * - Return standardized responses
 *
 * NO:
 * - Prisma queries
 * - Business logic
 * - Authorization logic
 *
 * =====================================================
 */

/**
 * =====================================================
 * GET ALL NOTIFICATIONS
 * =====================================================
 *
 * Route:
 * GET /api/notifications
 *
 * Query Params:
 * ?page=1
 * ?limit=20
 */
const getNotifications = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const { page, limit } = req.query;

  const data = await notificationService.getNotifications(userId, page, limit);

  return success(res, 200, "Notifications fetched successfully", data);
});

/**
 * =====================================================
 * MARK SINGLE NOTIFICATION AS READ
 * =====================================================
 *
 * Route:
 * PATCH /api/notifications/:id/read
 */
const markNotificationAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const notificationId = Number(req.params.id);

  const data = await notificationService.markNotificationAsRead(
    notificationId,
    userId,
  );

  const message = data.alreadyRead
    ? "Notification already read"
    : "Notification marked as read";

  return success(res, 200, message, data);
});

/**
 * =====================================================
 * MARK ALL NOTIFICATIONS AS READ
 * =====================================================
 *
 * Route:
 * PATCH /api/notifications/read-all
 */
const markAllNotificationsAsRead = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const data = await notificationService.markAllNotificationsAsRead(userId);

  return success(res, 200, "All notifications marked as read", data);
});

/**
 * =====================================================
 * GET UNREAD NOTIFICATION COUNT
 * =====================================================
 *
 * Route:
 * GET /api/notifications/unread-count
 *
 * Used By:
 * Notification Bell Badge
 *
 * Example:
 * 🔔 7
 */
const getUnreadCount = asyncHandler(async (req, res) => {
  const userId = req.user.userId;

  const data = await notificationService.getUnreadCount(userId);

  return success(
    res,
    200,
    "Unread notification count fetched successfully",
    data,
  );
});

module.exports = {
  getNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  getUnreadCount,
};
