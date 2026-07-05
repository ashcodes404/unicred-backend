const cloudinary = require("cloudinary").v2;
// Read through config/env.js (same pattern config/razorpay.js already uses)
// instead of process.env directly — env.js's own top line runs
// require("dotenv").config(), so importing from here GUARANTEES dotenv has
// already populated process.env by the time cloudinary.config() runs below,
// no matter which file happens to require cloudinary.js first. Reading
// process.env directly (the previous code) only worked by coincidence,
// depending on some other module requiring env.js earlier in the chain.
const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = require("./env");

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key: CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

module.exports = cloudinary;