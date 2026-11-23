const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const config = require('../config');
const { pool } = require('../db');
const { AppError, wrap, fromDbError } = require('../errors');
const { createSession, destroySession } = require('../sessions');
const { requireAuth } = require('../middleware');
const { toUser } = require('../models');
const { normalizeUsername, normalizeEmail, validateUsername, validateEmail, validatePassword } = require('../validators');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.authRateLimit,
  skipSuccessfulRequests: true, // only failed attempts count
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'too_many_requests', 'Too many attempts. Please wait a few minutes and try again.')),
});

// Sign-ups per IP, counting every attempt (the limiter above only counts failed ones).
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: config.registerRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, next) => next(new AppError(429, 'too_many_requests', 'Too many sign-ups from this network. Please try again later.')),
});

// Compared against when the account does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.bcryptRounds);

router.post('/register', registerLimiter, limiter, wrap(async (req, res) => {
  const body = req.body || {};
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email);
  const problem = validateUsername(username) || validateEmail(email) || validatePassword(body.password);
  if (problem) throw new AppError(400, 'validation_error', problem);

  const passwordHash = await bcrypt.hash(body.password, config.bcryptRounds);
  let insertId;
  try {
    [{ insertId }] = await pool.query('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, passwordHash]);
  } catch (err) {
    throw fromDbError(err);
  }
  await createSession(res, insertId, req);
  res.status(201).json({ user: toUser({ id: insertId, username, email, temperature_unit: 'C' }) });
}));

router.post('/login', limiter, wrap(async (req, res) => {
  const { identifier, password } = req.body || {};
  if (typeof identifier !== 'string' || typeof password !== 'string' || !identifier.trim() || !password) {
    throw new AppError(400, 'validation_error', 'Please fill in all required credentials.');
  }
  const id = identifier.trim();
  const column = id.includes('@') ? 'email' : 'username'; // fixed set, safe to interpolate
  const value = column === 'email' ? id.toLowerCase() : normalizeUsername(id);

  const [rows] = await pool.query(
    `SELECT id, username, email, temperature_unit, password_hash FROM users WHERE ${column} = ? LIMIT 1`,
    [value],
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password.slice(0, 200), user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'invalid_credentials', 'Invalid username/email or password.');

  await createSession(res, user.id, req);
  res.json({ user: toUser(user) });
}));

router.post('/logout', wrap(async (req, res) => {
  await destroySession(req, res);
  res.status(204).end();
}));

router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

module.exports = router;
