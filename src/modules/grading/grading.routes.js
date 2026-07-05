// src/modules/grading/grading.routes.js

const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");
const { gradingMethodRateLimiter } = require("../../middleware/rateLimit.middleware");
const controller = require("./grading.controller");

// All grading routes are Admin only
router.use(authenticate, requireRole("admin"));

// Declared BEFORE "/:id" so "method" is never captured as a grading
// system id (Express matches routes top-to-bottom; ":id" matches ANY
// string, "method" included) — same ordering pitfall this app already
// avoids in timetables.routes.js's "/documents" routes.
router.get("/method",   controller.getMethod);
router.patch("/method", gradingMethodRateLimiter, controller.updateMethod);

router.get("/",               controller.list);
router.post("/",              controller.create);
router.patch("/:id",          controller.update);
router.patch("/:id/activate", controller.activate);

module.exports = router;
