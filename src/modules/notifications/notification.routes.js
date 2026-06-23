const express = require("express");

const notificationController = require(
  "./notification.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const router = express.Router();

/**
 * =====================================================
 * NOTIFICATION ROUTES
 * =====================================================
 *
 * All notification routes require
 * authentication.
 *
 * User must be logged in.
 *
 * JWT Middleware:
 *
 * verifyToken
 *
 * attaches:
 *
 * req.user = {
 *   userId,
 *   schoolId,
 *   role
 * }
 *
 * =====================================================
 */

/**
 * Apply authentication middleware
 * to every route below.
 */
router.use(verifyToken);

/**
 * =====================================================
 * GET NOTIFICATIONS
 * =====================================================
 *
 * GET /api/notifications
 *
 * Query Params:
 *
 * ?page=1
 * ?limit=20
 */
router.get(
  "/",
  notificationController.getNotifications
);

/**
 * =====================================================
 * GET UNREAD COUNT
 * =====================================================
 *
 * GET /api/notifications/unread-count
 */
router.get(
  "/unread-count",
  notificationController.getUnreadCount
);

/**
 * =====================================================
 * MARK ALL AS READ
 * =====================================================
 *
 * PATCH /api/notifications/read-all
 */
router.patch(
  "/read-all",
  notificationController.markAllNotificationsAsRead
);

/**
 * =====================================================
 * MARK SINGLE NOTIFICATION AS READ
 * =====================================================
 *
 * PATCH /api/notifications/:id/read
 */
router.patch(
  "/:id/read",
  notificationController.markNotificationAsRead
);

module.exports = router;