// All configuration comes from environment variables (see ../../.env.example).
const env = process.env;

const int = (value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) => {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
};

const bool = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return fallback;
};

const parseTrustProxy = (value, fallback = 1) => {
  if (value === undefined || value === null) return fallback;
  const trimmed = String(value).trim();
  if (!trimmed) return fallback;
  const lower = trimmed.toLowerCase();
  if (lower === 'false') return false;
  if (lower === 'true') return true;
  const n = Number(trimmed);
  return Number.isInteger(n) && n >= 0 ? n : trimmed;
};

module.exports = {
  port: int(env.PORT, 3000, { min: 1, max: 65535 }),
  db: {
    host: (env.DB_HOST || 'localhost').trim(),
    port: int(env.DB_PORT, 3306, { min: 1, max: 65535 }),
    user: (env.DB_USER || 'weather_user').trim(),
    password: env.DB_PASSWORD || '',
    database: (env.DB_NAME || 'weather_app').trim(),
  },
  cookie: {
    name: 'wa_session',
    secure: bool(env.COOKIE_SECURE, false),
    maxAgeMs: int(env.SESSION_TTL_HOURS, 168, { min: 1, max: 8760 }) * 3600 * 1000,
  },
  openMeteo: {
    geocodingUrl: (env.OPEN_METEO_GEOCODING_URL || 'https://geocoding-api.open-meteo.com/v1/search').trim(),
    forecastUrl: (env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast').trim(),
    timeoutMs: int(env.OPEN_METEO_TIMEOUT_MS, 8000, { min: 500, max: 60000 }),
  },
  cacheTtlMs: int(env.WEATHER_CACHE_TTL_SECONDS, 600, { min: 10, max: 86400 }) * 1000,
  bcryptRounds: int(env.BCRYPT_ROUNDS, 12, { min: 10, max: 14 }),
  authRateLimit: int(env.AUTH_RATE_LIMIT, 30, { min: 1, max: 1000 }),
  loginRateLimit: int(env.LOGIN_RATE_LIMIT, 20, { min: 1, max: 1000 }),
  registerRateLimit: int(env.REGISTER_RATE_LIMIT, 20, { min: 1, max: 1000 }),
  upstreamRateLimit: int(env.UPSTREAM_RATE_LIMIT, 60, { min: 1, max: 1000 }),
  trustProxy: parseTrustProxy(env.TRUST_PROXY, 1),
};
