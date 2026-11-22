const rateLimit = require('express-rate-limit');
const config = require('./config');
const { AppError } = require('./errors');

// Per signed-in user (requireAuth runs first): one account cannot burn the shared Open-Meteo quota.
const upstream = rateLimit({
  windowMs: 60 * 1000,
  limit: config.upstreamRateLimit,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `user:${req.user.id}`,
  handler: (req, res, next) => next(new AppError(429, 'too_many_requests', 'Too many requests. Please slow down a little.')),
});

module.exports = { upstream };
