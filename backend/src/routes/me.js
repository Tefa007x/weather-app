const router = require('express').Router();
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { pool } = require('../db');
const { AppError, wrap, fromDbError } = require('../errors');
const { toUser } = require('../models');
const { normalizeUsername, normalizeEmail, validateUsername, validateEmail, validatePassword } = require('../validators');

const settingsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimit,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'too_many_requests', 'Too many failed attempts. Please wait a few minutes and try again.')),
});

// Settings page: username, email and password.
router.patch('/', settingsLimiter, wrap(async (req, res) => {
  const body = req.body || {};
  const me = req.user;
  const sets = [];
  const values = [];
  let needsCurrentPassword = false;

  if (body.username !== undefined) {
    const username = normalizeUsername(body.username);
    const problem = validateUsername(username);
    if (problem) throw new AppError(400, 'validation_error', problem);
    if (username !== me.username) { sets.push('username = ?'); values.push(username); }
  }
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    const problem = validateEmail(email);
    if (problem) throw new AppError(400, 'validation_error', problem);
    if (email !== me.email) { sets.push('email = ?'); values.push(email); needsCurrentPassword = true; }
  }
  if (body.newPassword) {
    const problem = validatePassword(body.newPassword);
    if (problem) throw new AppError(400, 'validation_error', problem);
    needsCurrentPassword = true;
  }

  if (needsCurrentPassword) {
    if (typeof body.currentPassword !== 'string' || !body.currentPassword) {
      throw new AppError(400, 'current_password_required', 'Enter your current password to change your email or password.');
    }
    const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [me.id]);
    if (!rows.length) throw new AppError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
    // 403, not 401: a wrong password must not look like an expired session to the frontend.
    if (!(await bcrypt.compare(body.currentPassword.slice(0, 200), rows[0].password_hash))) {
      throw new AppError(403, 'wrong_password', 'Your current password is incorrect.');
    }
  }
  if (body.newPassword) {
    sets.push('password_hash = ?');
    values.push(await bcrypt.hash(body.newPassword, config.bcryptRounds));
  }

  if (sets.length) {
    try {
      await pool.query(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...values, me.id]);
    } catch (err) {
      throw fromDbError(err);
    }
  }
  // After a password change every other device is signed out.
  if (body.newPassword) await pool.query('DELETE FROM sessions WHERE user_id = ? AND id <> ?', [me.id, req.sessionId]);

  const [rows] = await pool.query('SELECT id, username, email, temperature_unit FROM users WHERE id = ?', [me.id]);
  if (!rows.length) throw new AppError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
  res.json({ user: toUser(rows[0]) });
}));

// Settings page: °C / °F.
router.patch('/preferences', wrap(async (req, res) => {
  const unit = req.body && req.body.temperatureUnit;
  if (unit !== 'C' && unit !== 'F') throw new AppError(400, 'validation_error', 'Temperature unit must be C or F.');
  await pool.query('UPDATE users SET temperature_unit = ? WHERE id = ?', [unit, req.user.id]);
  res.json({ temperatureUnit: unit });
}));

module.exports = router;