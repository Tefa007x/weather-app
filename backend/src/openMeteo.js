const config = require('./config');
const { TtlCache } = require('./cache');
const { AppError } = require('./errors');
const { describe } = require('./weatherCodes');

const cache = new TtlCache(500);
const inFlight = new Map();
const HOUR = 3600 * 1000;
const WORLD_REFRESH_COOLDOWN_MS = 60 * 1000;

// The "World Weather" page: one batched request for all of these (Open-Meteo accepts many coordinates).
const WORLD_CITIES = [
  { name: 'New York', country: 'United States', latitude: 40.7128, longitude: -74.006, timezone: 'America/New_York' },
  { name: 'London', country: 'United Kingdom', latitude: 51.5074, longitude: -0.1278, timezone: 'Europe/London' },
  { name: 'Tokyo', country: 'Japan', latitude: 35.6762, longitude: 139.6503, timezone: 'Asia/Tokyo' },
  { name: 'Dubai', country: 'UAE', latitude: 25.2048, longitude: 55.2708, timezone: 'Asia/Dubai' },
  { name: 'Moscow', country: 'Russia', latitude: 55.7558, longitude: 37.6173, timezone: 'Europe/Moscow' },
  { name: 'Mumbai', country: 'India', latitude: 19.076, longitude: 72.8777, timezone: 'Asia/Kolkata' },
  { name: 'Paris', country: 'France', latitude: 48.8566, longitude: 2.3522, timezone: 'Europe/Paris' },
  { name: 'Sydney', country: 'Australia', latitude: -33.8688, longitude: 151.2093, timezone: 'Australia/Sydney' },
  { name: "Xi'an", country: 'China', latitude: 34.3416, longitude: 108.9398, timezone: 'Asia/Shanghai' },
];

const unavailable = (detail) => new AppError(502, 'weather_unavailable', `The weather service is unavailable right now (${detail}). Please try again in a moment.`);

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.openMeteo.timeoutMs), headers: { accept: 'application/json' } });
  } catch {
    throw unavailable('no response');
  }
  if (!res.ok) throw unavailable(`HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw unavailable('bad response');
  }
}

function coalesce(key, fn) {
  if (inFlight.has(key)) return inFlight.get(key);
  const p = Promise.resolve()
    .then(fn)
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

const round1 = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const roundInt = (n) => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : null);

function toPlace(r) {
  return {
    id: r.id,
    name: r.name,
    admin1: r.admin1 || '',
    country: r.country || '',
    countryCode: r.country_code || '',
    latitude: r.latitude,
    longitude: r.longitude,
  };
}

function rememberPlace(place) {
  if (place && Number.isSafeInteger(place.id)) {
    cache.set(`place:${place.id}`, place, 24 * HOUR);
  }
}

function getCachedPlace(id) {
  return cache.get(`place:${id}`) || null;
}

/** Multi-result city autocomplete search (cached + stores each verified place by id). */
async function searchPlaces(query, limit = 6) {
  const count = Math.min(Math.max(Number(limit) || 6, 1), 10);
  const key = `search:${count}:${query.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  return coalesce(key, async () => {
    const again = cache.get(key);
    if (again !== undefined) return again;

    const params = new URLSearchParams({ name: query, count: String(count), language: 'en', format: 'json' });
    const data = await fetchJson(`${config.openMeteo.geocodingUrl}?${params}`);
    const results = Array.isArray(data && data.results) ? data.results.map(toPlace) : [];
    results.forEach(rememberPlace);
    cache.set(key, results, results.length ? 24 * HOUR : 10 * 60 * 1000);
    return results;
  });
}

/** City name -> top matching place { id, name, admin1, country, latitude, longitude }. */
async function geocode(query) {
  const key = `geo:${query.toLowerCase()}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  return coalesce(key, async () => {
    const again = cache.get(key);
    if (again !== undefined) return again;

    const params = new URLSearchParams({ name: query, count: '1', language: 'en', format: 'json' });
    const data = await fetchJson(`${config.openMeteo.geocodingUrl}?${params}`);
    const r = data && data.results && data.results[0];
    const place = r ? toPlace(r) : null;
    if (place) rememberPlace(place);
    cache.set(key, place, place ? 24 * HOUR : 10 * 60 * 1000);
    return place;
  });
}

/** Resolve a verified place by Open-Meteo numeric ID (cache first, then Geocoding /get). */
async function getPlaceById(id) {
  const cached = getCachedPlace(id);
  if (cached) return cached;
  if (cache.get(`place-missing:${id}`)) return null;

  const key = `place-lookup:${id}`;
  return coalesce(key, async () => {
    const again = getCachedPlace(id);
    if (again) return again;

    const getUrl = config.openMeteo.geocodingUrl.replace(/\/search\/?$/, '/get');
    const params = new URLSearchParams({ id: String(id), language: 'en' });
    let data;
    try {
      data = await fetchJson(`${getUrl}?${params}`);
    } catch (err) {
      if (err instanceof AppError && (err.message.includes('HTTP 400') || err.message.includes('HTTP 404'))) {
        cache.set(`place-missing:${id}`, true, 10 * 60 * 1000);
        return null;
      }
      throw err;
    }
    if (!data || data.error || !Number.isSafeInteger(data.id) || !data.name) {
      cache.set(`place-missing:${id}`, true, 10 * 60 * 1000);
      return null;
    }
    const place = toPlace(data);
    rememberPlace(place);
    return place;
  });
}

/** Raw Open-Meteo forecast -> the shape the frontend needs (temperatures in Celsius, wind in km/h). */
function normalizeForecast(data) {
  if (!data || !data.current || !data.daily || !Array.isArray(data.daily.time)) throw unavailable('unexpected data');
  const c = data.current;
  const d = data.daily;

  // Group hourly slots and daily mean humidity by the city's local date (all 7 days).
  const humidityByDate = new Map();
  const hourlyByDate = new Map();
  const h = data.hourly || {};
  const hourlyTimes = Array.isArray(h.time) ? h.time : [];
  hourlyTimes.forEach((t, i) => {
    const date = t.slice(0, 10);
    const v = (h.relative_humidity_2m || [])[i];
    if (typeof v === 'number') {
      const acc = humidityByDate.get(date) || { sum: 0, n: 0 };
      acc.sum += v;
      acc.n += 1;
      humidityByDate.set(date, acc);
    }
    const temp = round1((h.temperature_2m || [])[i]);
    if (temp !== null) {
      const code = (h.weather_code || [])[i] ?? c.weather_code;
      const isDay = (h.is_day || [])[i] !== undefined ? (h.is_day || [])[i] === 1 : c.is_day === 1;
      const list = hourlyByDate.get(date) || [];
      list.push({
        time: t,
        temperature: temp,
        humidity: roundInt(v),
        rainChance: roundInt((h.precipitation_probability || [])[i]) ?? 0,
        weatherCode: code,
        isDay,
        condition: describe(code, isDay),
      });
      hourlyByDate.set(date, list);
    }
  });

  // Next 24 hours starting from current local hour (used for Today)
  const curHourPrefix = typeof c.time === 'string' && c.time.length >= 13 ? c.time.slice(0, 13) : '';
  let startIdx = curHourPrefix ? hourlyTimes.findIndex((t) => t.slice(0, 13) >= curHourPrefix) : 0;
  if (startIdx < 0) startIdx = 0;

  const hourly = [];
  for (let i = startIdx; i < hourlyTimes.length && hourly.length < 24; i += 1) {
    const temp = round1((h.temperature_2m || [])[i]);
    if (temp === null) continue;
    const code = (h.weather_code || [])[i] ?? c.weather_code;
    const isDay = (h.is_day || [])[i] !== undefined ? (h.is_day || [])[i] === 1 : c.is_day === 1;
    hourly.push({
      time: hourlyTimes[i],
      temperature: temp,
      humidity: roundInt((h.relative_humidity_2m || [])[i]),
      rainChance: roundInt((h.precipitation_probability || [])[i]) ?? 0,
      weatherCode: code,
      isDay,
      condition: describe(code, isDay),
    });
  }

  const daily = d.time
    .map((date, i) => {
      const acc = humidityByDate.get(date);
      const code = d.weather_code?.[i];
      return {
        date,
        high: round1(d.temperature_2m_max?.[i]),
        low: round1(d.temperature_2m_min?.[i]),
        feelsLike: round1(d.apparent_temperature_max?.[i]),
        humidity: acc ? Math.round(acc.sum / acc.n) : null,
        windSpeed: roundInt(d.wind_speed_10m_max?.[i]),
        weatherCode: code,
        condition: describe(code, true),
        rainChance: roundInt(d.precipitation_probability_max?.[i]) ?? null,
        uvIndex: round1(d.uv_index_max?.[i]) ?? null,
        sunrise: d.sunrise?.[i] ? d.sunrise[i].slice(11, 16) : null,
        sunset: d.sunset?.[i] ? d.sunset[i].slice(11, 16) : null,
        hourly: hourlyByDate.get(date) || [],
      };
    })
    .filter((day) => day.high !== null && day.low !== null);

  return {
    timezone: data.timezone || null,
    utcOffsetSeconds: typeof data.utc_offset_seconds === 'number' ? data.utc_offset_seconds : null,
    current: {
      time: c.time,
      temperature: round1(c.temperature_2m),
      feelsLike: round1(c.apparent_temperature),
      humidity: roundInt(c.relative_humidity_2m),
      windSpeed: roundInt(c.wind_speed_10m),
      isDay: c.is_day === 1,
      weatherCode: c.weather_code,
      condition: describe(c.weather_code, c.is_day === 1),
      uvIndex: round1(c.uv_index) ?? null,
      rainChance: roundInt(c.precipitation_probability) ?? (daily.length ? (daily[0].rainChance ?? null) : null),
      sunrise: daily.length ? (daily[0].sunrise ?? null) : null,
      sunset: daily.length ? (daily[0].sunset ?? null) : null,
    },
    hourly,
    daily,
  };
}

/** 7-day forecast + 24h hourly + current conditions for one place (cached). */
async function getForecast(place) {
  const lat = Number(place.latitude);
  const lon = Number(place.longitude);
  const key = `fc:${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  return coalesce(key, async () => {
    const again = cache.get(key);
    if (again) return again;

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m,uv_index,precipitation_probability',
      hourly: 'temperature_2m,relative_humidity_2m,weather_code,precipitation_probability,is_day',
      daily: 'weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,wind_speed_10m_max,precipitation_probability_max,uv_index_max,sunrise,sunset',
      timezone: 'auto',
      forecast_days: '7',
    });
    const result = normalizeForecast(await fetchJson(`${config.openMeteo.forecastUrl}?${params}`));
    cache.set(key, result, config.cacheTtlMs);
    return result;
  });
}

/** Current conditions for all world cities in a single upstream request (cached, with cooldown refresh). */
async function getWorld({ forceRefresh = false } = {}) {
  const cached = cache.get('world');
  if (cached) {
    if (!forceRefresh) return cached;
    const ageMs = Date.now() - Date.parse(cached.updatedAt);
    if (Number.isFinite(ageMs) && ageMs < WORLD_REFRESH_COOLDOWN_MS) return cached;
  }

  return coalesce('world', async () => {
    const params = new URLSearchParams({
      latitude: WORLD_CITIES.map((c) => c.latitude).join(','),
      longitude: WORLD_CITIES.map((c) => c.longitude).join(','),
      current: 'temperature_2m,weather_code,is_day',
      timezone: 'auto',
    });
    const data = await fetchJson(`${config.openMeteo.forecastUrl}?${params}`);
    const list = Array.isArray(data) ? data : [data];

    const cities = WORLD_CITIES.map((city, i) => {
      const item = list[i];
      const cur = item && item.current;
      if (!cur) return null;
      return {
        name: city.name,
        country: city.country,
        latitude: city.latitude,
        longitude: city.longitude,
        timezone: (item && item.timezone) || city.timezone,
        temperature: round1(cur.temperature_2m),
        weatherCode: cur.weather_code,
        condition: describe(cur.weather_code, cur.is_day === 1),
      };
    }).filter(Boolean);
    if (!cities.length) throw unavailable('unexpected data');

    const result = { updatedAt: new Date().toISOString(), cities };
    cache.set('world', result, config.cacheTtlMs);
    return result;
  });
}

module.exports = {
  searchPlaces,
  geocode,
  getPlaceById,
  getCachedPlace,
  rememberPlace,
  getForecast,
  getWorld,
  normalizeForecast,
  WORLD_CITIES,
};