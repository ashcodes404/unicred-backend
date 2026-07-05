// =============================================================================
// ANNOUNCEMENT CONTROLLER  (src/modules/announcements/announcement.controller.js)
// =============================================================================
// Thin HTTP layer — reads req.user/req.faculty/req.body/req.params, calls
// announcement.service.js, and shapes the response with the shared
// success() helper. Same pattern as every other controller in this app
// (see syllabus.controller.js).

const asyncHandler = require("../../utils/asyncHandler");
const service = require("./announcement.service");
const { success } = require("../../utils/apiResponse");

/**
 * POST /api/announcements   (admin, hod, faculty)
 * Body: { title, content, expiresAt? }
 * req.faculty (departmentId/id) is only attached for hod/faculty senders —
 * see announcement.routes.js for exactly when facultyContext runs.
 */
const create = asyncHandler(async (req, res) => {
  const announcement = await service.createAnnouncement(req.user, req.faculty ?? null, req.body);
  return success(res, 201, "Announcement posted.", announcement);
});

/**
 * GET /api/announcements   (admin, hod, faculty, student)
 * Query: ?page=&limit=
 * Sent + received for admin/hod/faculty; received-only for students — the
 * service's single query already handles this without a role check here.
 */
const list = asyncHandler(async (req, res) => {
  const { rows, pagination } = await service.listForUser(req.user, req.query);
  return success(res, 200, "Announcements fetched.", { announcements: rows, pagination });
});

/**
 * GET /api/announcements/:id   (admin, hod, faculty, student)
 */
const getById = asyncHandler(async (req, res) => {
  const announcement = await service.getByIdForUser(req.params.id, req.user);
  return success(res, 200, "Announcement fetched.", announcement);
});

module.exports = { create, list, getById };
