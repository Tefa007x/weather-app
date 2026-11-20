const router = require('express').Router();
const { pool } = require('../db');
const { AppError, wrap } = require('../errors');
const { geocode, getPlaceById, rememberPlace, getForecast } = require('../openMeteo');

async function recordSearch(userId, place) {
  try {
    await pool.query(
      `INSERT INTO search_history (user_id, place_id, name, admin1, country, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE name = VALUES(name), admin1 = VALUES(admin1), country = VALUES(country),
         latitude = VALUES(latitude), longitude = VALUES(longitude), searched_at = CURRENT_TIMESTAMP(3)`,
      [userId, place.id, place.name, place.admin1 || '', place.country, place.latitude, place.longitude],
    );
    // Keep only the 20 newest searches per user.
    await pool.query(
      `DELETE FROM search_history WHERE user_id = ? AND id NOT IN (
         SELECT id FROM (SELECT id FROM search_history WHERE user_id = ? ORDER BY searched_at DESC, id DESC LIMIT 20) keep)`,
      [userId, userId],
    );
  } catch (err) {
    if (err && err.code === 'ER_LOCK_DEADLOCK') return; // non-fatal on concurrent tab requests
    throw err;
  }
}

/**
 * GET /api/weather?q=Cairo   -> geocode a city name
 * GET /api/weather?id=360630 -> a saved, recent, or autocomplete-verified place
 * Optional: &track=false skips recording in search_history
 */
router.get('/weather', wrap(async (req, res) => {
  const uid = req.user.id;
  const shouldTrack = req.query.track !== 'false';
  let place;

  if (req.query.id !== undefined) {
    const id = Number(req.query.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'validation_error', 'Invalid place id.');
    const cols = 'place_id AS id, name, admin1, country, latitude, longitude';
    const [rows] = await pool.query(
      `(SELECT ${cols} FROM favorites WHERE user_id = ? AND place_id = ?)
       UNION ALL (SELECT ${cols} FROM search_history WHERE user_id = ? AND place_id = ?) LIMIT 1`,
      [uid, id, uid, id],
    );
    place = rows[0] || await getPlaceById(id);
    if (!place) throw new AppError(404, 'place_not_found', 'That place could not be found.');
    rememberPlace(place);
  } else {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\s+/g, ' ') : '';
    if (!q || q.length > 100) throw new AppError(400, 'validation_error', 'Enter a city name (up to 100 characters).');
    place = await geocode(q);
    if (!place) throw new AppError(404, 'city_not_found', `No city found for "${q}".`);
  }

  const forecast = await getForecast(place);
  if (shouldTrack) await recordSearch(uid, place);
  const [fav] = await pool.query('SELECT 1 FROM favorites WHERE user_id = ? AND place_id = ? LIMIT 1', [uid, place.id]);

  res.json({
    place: { id: place.id, name: place.name, admin1: place.admin1 || '', country: place.country, latitude: place.latitude, longitude: place.longitude },
    timezone: forecast.timezone,
    utcOffsetSeconds: forecast.utcOffsetSeconds,
    current: forecast.current,
    hourly: forecast.hourly,
    daily: forecast.daily,
    isFavorite: fav.length > 0,
  });
}));

module.exports = router;