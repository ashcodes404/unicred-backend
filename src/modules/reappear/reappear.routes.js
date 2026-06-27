// src/modules/reappear/reappear.routes.js

const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/auth.middleware");
const  requireRole = require("../../middleware/role.middleware");
const {facultyContext} = require("../../middleware/facultyContext.middleware");
const studentContext = require("../../middleware/studentContext.middleware"); // see note below
const c = require("./reappear.controller");

router.use(authenticate);

// ─── Student ──────────────────────────────────────────────────────────────────
// NOTE: studentContext middleware attaches req.student (like facultyContext attaches req.faculty)
// If you don't have it yet, see the note in index-additions.js
router.post("/apply",                      requireRole("student"), studentContext, c.apply);
router.get("/my-applications",             requireRole("student"), studentContext, c.myApplications);
router.delete("/applications/:id",         requireRole("student"), studentContext, c.withdraw);

// ─── HOD ──────────────────────────────────────────────────────────────────────
router.get("/department",                  requireRole("hod"), facultyContext, c.deptApplications);
router.patch("/applications/:id/approve",  requireRole("hod"), facultyContext, c.approve);
router.patch("/applications/:id/reject",   requireRole("hod"), facultyContext, c.reject);

// ─── Faculty ──────────────────────────────────────────────────────────────────
router.get("/active-students",             requireRole("faculty", "hod"), facultyContext, c.activeStudents);

module.exports = router;
