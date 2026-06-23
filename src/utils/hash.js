const bcrypt = require("bcrypt");
const crypto = require("crypto");

// Higher = more secure but slower. 12 is a good balance for production.
const BCRYPT_SALT_ROUNDS = 12;

/**
 * PASSWORD HASHING (bcrypt)
 * Used when a user registers or changes their password.
 */

/**
 * Hashes a plain-text password before storing it in the database.
 * @param {string} plainPassword
 * @returns {Promise<string>} hashed password
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);
}

/**
 * Compares a plain-text password against the stored hash during login.
 * @param {string} plainPassword
 * @param {string} hashedPassword
 * @returns {Promise<boolean>} true if they match
 */
async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(plainPassword, hashedPassword);
}

/**
 * ==========================================================
 * OTP HASHING
 * ==========================================================
 *
 * WHY HASH OTPs?
 *
 * Imagine database gets leaked.
 *
 * If OTP stored as:
 *
 * 123456
 *
 * Hacker can immediately use it.
 *
 * If OTP stored as:
 *
 * $2b$12$kjasdjkashd...
 *
 * Hacker cannot recover original OTP.
 *
 * Same concept as password hashing.
 *
 * We use bcrypt because OTP verification
 * works exactly like password verification.
 */

/**
 * Hash OTP before storing in database.
 *
 * @param {string} otp
 * @returns {Promise<string>}
 */
async function hashOtp(otp) {
  return bcrypt.hash(otp, BCRYPT_SALT_ROUNDS);
}

/**
 * Compare entered OTP with stored hash.
 *
 * @param {string} otp
 * @param {string} hashedOtp
 * @returns {Promise<boolean>}
 */
async function compareOtp(otp, hashedOtp) {
  return bcrypt.compare(otp, hashedOtp);
}

/**
 * REFRESH TOKEN HASHING (SHA-256)
 *
 * We never store the raw refresh token in the database.
 * Instead:
 *  1. Generate a random raw token -> send it to the client (httpOnly cookie)
 *  2. Hash it with SHA-256 -> store ONLY the hash in the database
 *  3. On refresh, hash the incoming token and compare with the stored hash
 *
 * This way, even if the database is leaked, attackers can't use the
 * stored hashes to log in (SHA-256 is one-way).
 *
 * Note: bcrypt is NOT used here because refresh tokens are already
 * long random strings (high entropy) — SHA-256 is faster and sufficient.
 */

/**
 * Generates a new random refresh token (raw, unhashed).
 * @returns {string} 128-character hex string
 */
function generateRefreshToken() {
  return crypto.randomBytes(64).toString("hex");
}

/**
 * Hashes a refresh token for safe storage in the database.
 * @param {string} rawToken
 * @returns {string} SHA-256 hash (hex)
 */
function hashRefreshToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

module.exports = {
  hashPassword,
  comparePassword,
  hashOtp, 
  compareOtp,
  generateRefreshToken,
  hashRefreshToken,
};
