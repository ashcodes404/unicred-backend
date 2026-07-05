// student-results.routes.js
const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/auth.middleware");
const requireRole  = require("../../middleware/role.middleware");
const studentContext = require("../../middleware/studentContext.middleware");
const { getStudentResults, getStudentResultsBySession, getStudentCgpa } = require("./results.controller");

// Shared guard chain for these specific routes (NOT router-wide).
// Applied per-route so it can't intercept requests meant for other
// routers mounted on the same /students path (e.g. /students/profile/me).
const guard = [authenticate, requireRole("student"), studentContext];

// GET /api/students/results
router.get("/results", guard, getStudentResults);

// GET /api/students/results/:sessionId
router.get("/results/:sessionId", guard, getStudentResultsBySession);

// GET /api/students/cgpa
router.get("/cgpa", guard, getStudentCgpa);

module.exports = router;