// =============================================================================
// TIMETABLES ROUTES  (src/modules/timetables/timetables.routes.js)
// =============================================================================
//
//   POST   /api/timetables                     HOD — create draft
//   GET    /api/timetables                      HOD — list own dept
//   GET    /api/timetables/:id                  All — view one (with slots)
//   PATCH  /api/timetables/:id                  HOD — update (draft/returned)
//   POST   /api/timetables/:id/slots            HOD — add slot
//   PATCH  /api/timetables/:id/slots/:slotId    HOD — edit slot
//   DELETE /api/timetables/:id/slots/:slotId    HOD — remove slot
//   PATCH  /api/timetables/:id/submit           HOD — submit to admin
//   PATCH  /api/timetables/:id/resubmit         HOD — resubmit after return
//
// Middleware chain (runs top to bottom before the controller):
//   verifyToken   → checks the JWT and sets req.user
//   attachTenant  → sets req.schoolId from the token (multi-tenant safety)
//   requireRole   → allows only the listed roles
//   facultyContext→ loads req.faculty = { id, departmentId } for HOD routes
//
// =============================================================================

const express    = require("express");
const router     = express.Router();
const controller = require("./timetables.controller");

const verifyToken   = require("../../middleware/auth.middleware");
const requireRole   = require("../../middleware/role.middleware");
const attachTenant  = require("../../middleware/tenant.middleware");
const { facultyContext } = require("../../middleware/facultyContext.middleware");

// Every route below first requires a valid login and a school context.
router.use(verifyToken, attachTenant);

// ── Read one (any authenticated role in the school) ────────────────────────
// Placed before the write routes; role guard is intentionally open here.

// ── Department timetable DOCUMENTS (uploaded PDFs/images, per audience) ──────
// Declared BEFORE "/:id" so "documents" isn't captured as a timetable id.
//   GET    /documents[?audience]  HOD/faculty/student list own dept documents
//   POST   /documents            HOD adds a new document (faculty|student)
//   PATCH  /documents/:id        HOD edits a document (replace file / retitle)
//   DELETE /documents/:id        HOD deletes a document
router.get("/documents", controller.listTimetableDocuments);
router.post("/documents", requireRole("hod"), facultyContext, controller.addTimetableDocument);
router.patch("/documents/:id", requireRole("hod"), facultyContext, controller.updateTimetableDocument);
router.delete("/documents/:id", requireRole("hod"), facultyContext, controller.deleteTimetableDocument);

router.get("/:id", controller.getTimetableById);

// ── HOD: create + list ─────────────────────────────────────────────────────
router.post("/",  requireRole("hod"), facultyContext, controller.createTimetable);
router.get("/",   requireRole("hod"), facultyContext, controller.getDepartmentTimetables);

// ── HOD: update timetable metadata ─────────────────────────────────────────
router.patch("/:id", requireRole("hod"), facultyContext, controller.updateTimetable);

// ── HOD: slots ─────────────────────────────────────────────────────────────
router.post("/:id/slots",            requireRole("hod"), facultyContext, controller.addSlot);
router.patch("/:id/slots/:slotId",   requireRole("hod"), facultyContext, controller.updateSlot);
router.delete("/:id/slots/:slotId",  requireRole("hod"), facultyContext, controller.deleteSlot);

// ── HOD: submit / resubmit ─────────────────────────────────────────────────
router.patch("/:id/submit",   requireRole("hod"), facultyContext, controller.submitTimetable);
router.patch("/:id/resubmit", requireRole("hod"), facultyContext, controller.resubmitTimetable);

module.exports = router;
