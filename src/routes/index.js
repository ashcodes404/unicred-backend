const express = require("express");
const router = express.Router();

/*
|--------------------------------------------------------------------------
| Auth Routes
|--------------------------------------------------------------------------
*/
const authRoutes = require("../modules/auth/auth.routes");

/*
|--------------------------------------------------------------------------
| Student Routes
|--------------------------------------------------------------------------
*/
const studentRoutes = require("../modules/students/students.routes");

/*
|--------------------------------------------------------------------------
| department Routes
|--------------------------------------------------------------------------
*/
const departmentRoutes = require("../modules/departments/departments.routes");

/*
|--------------------------------------------------------------------------
| faculty Routes
|--------------------------------------------------------------------------
*/
const facultyRoutes = require("../modules/faculty/faculty.routes");

/*
|--------------------------------------------------------------------------
| faculty Routes
|--------------------------------------------------------------------------
*/
const userRoutes = require("../modules/users/users.routes");

/*
|--------------------------------------------------------------------------
| notification Routes
|--------------------------------------------------------------------------
*/
const notificationRoutes = require("../modules/notifications/notification.routes");

const academicSessionRoutes  = require("../modules/academic-sessions/academic-sessions.routes");
const courseRoutes            = require("../modules/courses/courses.routes");
const facultyAssignmentRoutes = require("../modules/faculty-assignments/faculty-assignments.routes");
const studentRegRoutes        = require("../modules/student-registration/student-registration.routes");
/*
|--------------------------------------------------------------------------
| Route Registration
|--------------------------------------------------------------------------
*/

router.use("/auth", authRoutes);

router.use("/students", studentRoutes);

router.use("/departments", departmentRoutes);

router.use("/faculties", facultyRoutes);

router.use("/users", userRoutes);

router.use("/notifications", notificationRoutes);
 
// Academic Sessions — HOD manages session lifecycle
router.use("/academic-sessions", academicSessionRoutes);
 
// Courses — subjects + offerings
router.use("/courses", courseRoutes);
 
// Faculty Assignments — HOD assigns faculty to subjects
router.use("/faculty-assignments", facultyAssignmentRoutes);
 
// Student Session Registration — mounts alongside existing /api/students routes
// Note: if you already have a students router, merge these routes into it
// rather than creating a second router at /api/students.
// The cleanest approach: import studentRegRoutes inside your existing
// students.routes.js file and call:
//   router.use("/", studentRegRoutes);
// Or mount at a sub-path:
router.use("/studentReg", studentRegRoutes);
 

module.exports = router;
