const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const config = require('./config');
const { pool } = require('./db');
const { AppError, wrap } = require('./errors');
const { requireReady, requireAuth, sameOriginGuard, noStore, requestLog } = require('./middleware');
const limits = require('./limits');

const UPSTREAM_PATHS = ['/places/search', '/weather', '/world'];
const isUpstream = (req) => UPSTREAM_PATHS.some((p) => req.path === p || req.path.startsWith(`${p}/`)) || (req.method === 'POST' && req.path === '/favorites');
const limitUpstream = (req, res, next) => (isUpstream(req) ? limits.upstream(req, res, next) : next());

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.locals.schemaReady = false; // flipped by server.js once migrations finished

  app.use(helmet());
  app.use(requestLog);

  // Liveness (process is up) and readiness (schema applied and MySQL reachable) for Docker / Kubernetes.
  app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
  app.get('/api/ready', wrap(async (req, res) => {
    try {
      if (!app.locals.schemaReady) throw new Error('schema not ready');
      await pool.query('SELECT 1');
      res.json({ status: 'ready' });
    } catch {
      res.status(503).json({ status: 'not_ready' });
    }
  }));

  app.use('/api', noStore, requireReady);
  app.use(express.json({ limit: '10kb' }));
  app.use(cookieParser());
  app.use('/api', sameOriginGuard);

  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/me', requireAuth, require('./routes/me'));
  app.use('/api', requireAuth, limitUpstream, require('./routes/places'), require('./routes/weather'), require('./routes/world'));
  app.use('/api', (req, res) => res.status(404).json({ error: 'not_found', message: 'Not found.' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AppError) return res.status(err.status).json({ error: err.code, message: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'Request body must be valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'Request body is too large.' });
    console.error(JSON.stringify({ level: 'error', msg: err.message, stack: err.stack }));
    return res.status(500).json({ error: 'internal_error', message: 'Something went wrong on our side. Please try again.' });
  });

  return app;
}

module.exports = { createApp };
