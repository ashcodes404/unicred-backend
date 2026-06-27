// src/modules/grading/grading.routes.js

const express = require("express");
const router = express.Router();
const authenticate = require("../../middleware/auth.middleware");
const requireRole = require("../../middleware/role.middleware");
const controller = require("./grading.controller");

// All grading routes are Admin only
router.use(authenticate, requireRole("admin"));

router.get("/",               controller.list);
router.post("/",              controller.create);
router.patch("/:id",          controller.update);
router.patch("/:id/activate", controller.activate);

module.exports = router;
