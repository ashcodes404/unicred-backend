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

const academicSessionRoutes  =  require("../modules/academic-sessions/academic-sessions.routes");
const courseRoutes            = require("../modules/courses/courses.routes");
const facultyAssignmentRoutes = require("../modules/faculty-assignments/faculty-assignments.routes");
const studentRegRoutes        = require("../modules/student-registration/student-registration.routes");
const gradingRoutes        =    require("../modules/grading/grading.routes");
const resultsRoutes        =    require("../modules/results/results.routes");
const reappearRoutes       =    require("../modules/reappear/reappear.routes");
const studentResultRoutes  =    require("../modules/results/student-results.routes");
const achievementRoutes    =    require("../modules/achievements/achievements.routes");
const internshipRoutes     =    require("../modules/internships/internships.routes");
const uploadRoutes         =    require("../modules/uploads/uploads.routes");
const syllabusRoutes       =    require("../modules/syllabus/syllabus.routes");
const timetableRoutes      =    require("../modules/timetables/timetables.routes");
const adminTimetableRoutes =    require("../modules/timetables/timetables.admin.routes");
const scheduleExceptionRoutes = require("../modules/schedule-exceptions/schedule-exceptions.routes");
const facultyAbsenceRoutes    = require("../modules/faculty-absences/faculty-absences.routes");
const registrationRoutes      = require("../modules/registration/registration.routes");
const couponRoutes            = require("../modules/coupons/coupon.routes");
const subscriptionRoutes      = require("../modules/subscription/subscription.routes");
const invoiceRoutes           = require("../modules/invoices/invoice.routes");
const paymentRoutes           = require("../modules/payments/payment.routes");
const announcementRoutes      = require("../modules/announcements/announcement.routes");
/*
|--------------------------------------------------------------------------
| Route Registration
|--------------------------------------------------------------------------
*/

router.use("/auth", authRoutes);

// Student views their results and CGPA (mounts under /students/...)
router.use("/students", studentResultRoutes);

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
 
// Admin manages grading systems for their school
router.use("/grading-systems", gradingRoutes);
 
// HOD creates publications, faculty uploads marks, HOD publishes
router.use("/results", resultsRoutes);
 
// Student applies for reappear, HOD approves/rejects, faculty uploads reappear marks
router.use("/reappear", reappearRoutes);

// Achievements — students upload, any faculty verifies, HOD views dept stats
router.use("/achievements", achievementRoutes);

// Internships — students add (optionally linked to an achievement), HOD views
router.use("/internships", internshipRoutes);

// Uploads — generic Cloudinary file upload (certificates, proofs, offer letters)
router.use("/uploads", uploadRoutes);

// Syllabus — HOD uploads per-subject syllabus files; dept faculty/students view
router.use("/syllabus", syllabusRoutes);

// Timetables — HOD builds the weekly schedule, submits for approval
router.use("/timetables", timetableRoutes);

// Admin timetable review — approve / return submitted timetables
router.use("/admin/timetables", adminTimetableRoutes);

// Schedule exceptions — holidays & half-days (admin school-wide, HOD dept-only)
router.use("/schedule-exceptions", scheduleExceptionRoutes);

// Faculty absences — teacher files leave, HOD approves + assigns substitutes
router.use("/faculty-absences", facultyAbsenceRoutes);

// School registration + payment (Phase 1: plans + temporary registration storage)
// All public — no account exists yet at this point in the flow.
router.use("/registration", registrationRoutes);

// Coupon management (Phase 8B) — admin-only, platform-wide (not per-school)
router.use("/admin/coupons", couponRoutes);

// Subscription renewal (Phase 8C) — admin-only, scoped to the admin's own school
router.use("/admin/subscription", subscriptionRoutes);

// Admin dashboard: invoices + payments (Phase 8E) — admin-only, scoped to the admin's own school
router.use("/admin/invoices", invoiceRoutes);
router.use("/admin/payments", paymentRoutes);

// Announcements — admin (school-wide), HOD (department-wide), faculty (their
// current students); every role including student can view their own list.
router.use("/announcements", announcementRoutes);



module.exports = router;