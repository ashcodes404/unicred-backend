// src/modules/results/results.routes.js

const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/auth.middleware");
const  requireRole = require("../../middleware/role.middleware");
const {facultyContext} = require("../../middleware/facultyContext.middleware");
const c = require("./results.controller");

router.use(authenticate);

// ─── HOD: Publication Management ─────────────────────────────────────────────
router.post("/publications",                  requireRole("hod"), facultyContext, c.createPublication);
router.get("/publications",                   requireRole("hod"), facultyContext, c.listPublications);
router.get("/publications/:id",               requireRole("hod", "faculty"), c.getPublication);
router.patch("/publications/:id/status",      requireRole("hod"), c.transitionStatus);

// HOD review
router.get("/publications/:id/summary",       requireRole("hod"), c.getSummary);
router.get("/publications/:id/pending",       requireRole("hod"), c.getPending);
router.get("/publications/:id/failures",      requireRole("hod"), c.getFailures);

// ─── Faculty: Mark Upload ─────────────────────────────────────────────────────
router.get("/my-subjects",                    requireRole("faculty", "hod"), facultyContext, c.getMySubjects);
router.post("/submit",                        requireRole("faculty", "hod"), facultyContext, c.submitMarks);
router.get("/submissions/:subjectId",         requireRole("faculty", "hod"), facultyContext, c.getSubmittedMarks);
router.patch("/submissions/:subjectId",       requireRole("faculty", "hod"), facultyContext, c.editMarks);
router.post("/submit-reappear",               requireRole("faculty", "hod"), facultyContext, c.submitReappearMarks);

module.exports = router;
