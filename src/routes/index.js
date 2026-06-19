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
 const departmentRoutes = require( "../modules/departments/departments.routes" );
  
/*
|--------------------------------------------------------------------------
| faculty Routes
|--------------------------------------------------------------------------
*/
const facultyRoutes = require("../modules/faculty/faculty.routes") ; 

  
/*
|--------------------------------------------------------------------------
| faculty Routes
|--------------------------------------------------------------------------
*/
const userRoutes = require("../modules/users/users.routes") ;


/*
|--------------------------------------------------------------------------
| Route Registration
|--------------------------------------------------------------------------
*/

router.use("/auth", authRoutes);

router.use("/students", studentRoutes);

router.use( "/departments", departmentRoutes );

router.use("/faculties" , facultyRoutes) ; 

router.use("/users" , userRoutes) ; 
 
module.exports = router;