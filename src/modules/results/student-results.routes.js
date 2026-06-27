// src/modules/results/student-results.routes.js
// Mount this INSIDE your existing students.routes.js
// by adding: router.use("/", studentResultRoutes);
// OR register it separately in index.js.

const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/auth.middleware");
const requireRole  = require("../../middleware/role.middleware");
const studentContext = require("../../middleware/studentContext.middleware");
const { getStudentResults, getStudentResultsBySession, getStudentCgpa } = require("./results.controller");

router.use(authenticate, requireRole("student"), studentContext);

// GET /api/students/results
router.get("/results", getStudentResults);

// GET /api/students/results/:sessionId
router.get("/results/:sessionId", getStudentResultsBySession);

// GET /api/students/cgpa
router.get("/cgpa", getStudentCgpa);

module.exports = router;
