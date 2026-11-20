// All configuration comes from environment variables (see ../../.env.example).
const env = process.env;
const int = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

module.exports = {
  port: int(env.PORT, 3000),
  db: {
    host: env.DB_HOST || 'localhost',
    port: int(env.DB_PORT, 3306),
    user: env.DB_USER || 'weather_user',
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME || 'weather',
  },
  cookie: {
    name: 'wa_session',
    secure: env.COOKIE_SECURE === 'true', // set true once the site is served over HTTPS
    maxAgeMs: int(env.SESSION_TTL_HOURS, 168) * 3600 * 1000,
  },
  openMeteo: {
    geocodingUrl: env.OPEN_METEO_GEOCODING_URL || 'https://geocoding-api.open-meteo.com/v1/search',
    forecastUrl: env.OPEN_METEO_FORECAST_URL || 'https://api.open-meteo.com/v1/forecast',
    timeoutMs: int(env.OPEN_METEO_TIMEOUT_MS, 8000),
  },
  cacheTtlMs: int(env.WEATHER_CACHE_TTL_SECONDS, 600) * 1000, // also drives "Updates every 10 min"
  bcryptRounds: int(env.BCRYPT_ROUNDS, 12),
  authRateLimit: int(env.AUTH_RATE_LIMIT, 30), // failed login/register attempts per IP per 15 min
  trustProxy: env.TRUST_PROXY === 'false' ? false : int(env.TRUST_PROXY, 1), // 1 = behind nginx
};
