const config = require('./config');
const { pool } = require('./db');
const { AppError, wrap } = require('./errors');
const { hashToken } = require('./sessions');
const { toUser } = require('./models');

/** Reject API traffic with 503 until startup migrations have completed. */
function requireReady(req, res, next) {
  if (req.app && req.app.locals && req.app.locals.schemaReady === false) {
    return next(new AppError(503, 'service_unavailable', 'Service is starting up. Please try again in a moment.'));
  }
  return next();
}

/** Loads the signed-in user from the session cookie, or answers 401. */
const requireAuth = wrap(async (req, res, next) => {
  const token = req.cookies && req.cookies[config.cookie.name];
  if (!token) throw new AppError(401, 'unauthorized', 'Please sign in to continue.');
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.email, u.temperature_unit, s.id AS session_id
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() LIMIT 1`,
    [hashToken(token)],
  );
  if (!rows.length) throw new AppError(401, 'unauthorized', 'Your session has expired. Please sign in again.');
  req.user = toUser(rows[0]);
  req.sessionId = rows[0].session_id;
  next();
});

/** Defence in depth next to SameSite=Lax cookies: reject browser requests coming from another origin. */
function sameOriginGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next(); // curl and other non-browser clients send no Origin
  let originHost = null;
  try { originHost = new URL(origin).host.toLowerCase(); } catch { /* malformed */ }
  const rawExpected = req.get('x-forwarded-host') || req.get('host') || '';
  const expected = rawExpected.split(',')[0].trim().toLowerCase();
  if (originHost && expected && originHost === expected) return next();
  return next(new AppError(403, 'forbidden_origin', 'Cross-origin requests are not allowed.'));
}

const noStore = (req, res, next) => {
  res.set('Cache-Control', 'no-store'); // responses are per-user
  next();
};

function requestLog(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health') return;
    console.log(JSON.stringify({ level: 'info', method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - start }));
  });
  next();
}

module.exports = { requireReady, requireAuth, sameOriginGuard, noStore, requestLog };