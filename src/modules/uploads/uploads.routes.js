//src/modules/uploads/uploads.routes.js

//=============================================================================
// UPLOADS ROUTES   (mounted at /api/uploads)
// =============================================================================
//
// A small, generic file-upload endpoint used by the student achievement and
// internship forms. The browser POSTs a single file as multipart/form-data;
// we stream it straight to Cloudinary (credentials live in this backend's
// .env, so the secret never touches the client) and hand back the hosted
// secure_url. The frontend then stores that URL in the normal
// certificateUrl / proofUrl / offerLetterUrl fields via the existing
// create/update endpoints.
//
//   POST /api/uploads     field name: "file"   → { url }
// =============================================================================

const express = require("express");
const router  = express.Router();
const multer  = require("multer");

const authenticate = require("../../middleware/auth.middleware");
const cloudinary   = require("../../config/cloudinary");
const asyncHandler = require("../../utils/asyncHandler");
const { success, error } = require("../../utils/apiResponse");

// Keep the file in memory (never written to disk) — we only need the buffer
// long enough to pipe it to Cloudinary. 5 MB cap, images + PDF only.
const ALLOWED = ["image/png", "image/jpeg", "image/jpg", "image/webp", "application/pdf"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (req, file, cb) => {
    if (ALLOWED.includes(file.mimetype)) return cb(null, true);
    cb(new Error("Only PNG, JPG, WEBP, or PDF files are allowed."));
  },
});

// Every upload requires a logged-in user (token attached by the frontend's
// axios interceptor). No role restriction — students are the primary users,
// but faculty/HOD may also attach files, and the stored URL is harmless.
router.use(authenticate);

router.post(
  "/",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) return error(res, 400, "No file provided.");

    // cloudinary's upload_stream is callback-based; wrap it in a Promise so
    // asyncHandler can await it and forward any error to the error middleware.
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder:        "unicred/certificates",
          resource_type: "auto", // let Cloudinary handle both images and PDFs
        },
        (err, uploaded) => (err ? reject(err) : resolve(uploaded))
      );
      stream.end(req.file.buffer);
    });

    return success(res, 201, "File uploaded.", { url: result.secure_url });
  })
);

module.exports = router;