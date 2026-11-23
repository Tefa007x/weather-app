const crypto = require('crypto');
const { pool } = require('./db');
const config = require('./config');

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const cookieBase = () => ({ httpOnly: true, sameSite: 'lax', secure: config.cookie.secure, path: '/' });

async function createSession(res, userId, req) {
  const old = req && req.cookies && req.cookies[config.cookie.name];
  if (old) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(old)]);
  const token = crypto.randomBytes(32).toString('base64url');
  await pool.query(
    'INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',
    [userId, hashToken(token), Math.floor(config.cookie.maxAgeMs / 1000)],
  );
  res.cookie(config.cookie.name, token, { ...cookieBase(), maxAge: config.cookie.maxAgeMs });
}

async function destroySession(req, res) {
  const token = req.cookies && req.cookies[config.cookie.name];
  try {
    if (token) await pool.query('DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  } catch (err) {
    console.error(JSON.stringify({ level: 'error', msg: 'could not delete session', code: err.code || err.message }));
  } finally {
    res.clearCookie(config.cookie.name, cookieBase());
  }
}

const purgeExpiredSessions = () => pool.query('DELETE FROM sessions WHERE expires_at <= UTC_TIMESTAMP()');

module.exports = { hashToken, createSession, destroySession, purgeExpiredSessions };
