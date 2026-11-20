const router = require('express').Router();
const { pool } = require('../db');
const { AppError, wrap } = require('../errors');
const { searchPlaces, getCachedPlace } = require('../openMeteo');

const COLUMNS = 'place_id AS id, name, admin1, country, latitude, longitude';
const toPlaceId = (v) => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AppError(400, 'validation_error', 'Invalid place id.');
  return n;
};

// Live city autocomplete search
router.get('/places/search', wrap(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim().replace(/\s+/g, ' ') : '';
  if (q.length < 2 || q.length > 100) {
    throw new AppError(400, 'validation_error', 'Enter 2 to 100 characters to search cities.');
  }
  const results = await searchPlaces(q, req.query.limit);
  res.json({ results });
}));

// "My Places" panel: favorites + the 5 most recent searches.
router.get('/places', wrap(async (req, res) => {
  const uid = req.user.id;
  const [[favorites], [recent]] = await Promise.all([
    pool.query(`SELECT ${COLUMNS} FROM favorites WHERE user_id = ? ORDER BY created_at DESC, id DESC`, [uid]),
    pool.query(`SELECT ${COLUMNS} FROM search_history WHERE user_id = ? ORDER BY searched_at DESC, id DESC LIMIT 5`, [uid]),
  ]);
  res.json({ favorites, recent });
}));

// Only a place verified by the server (in search_history or verified place cache) can be saved.
router.post('/favorites', wrap(async (req, res) => {
  const uid = req.user.id;
  const placeId = toPlaceId(req.body && req.body.placeId);

  await pool.query(
    `INSERT IGNORE INTO favorites (user_id, place_id, name, admin1, country, latitude, longitude)
     SELECT user_id, place_id, name, admin1, country, latitude, longitude FROM search_history WHERE user_id = ? AND place_id = ?`,
    [uid, placeId],
  );

  let [rows] = await pool.query('SELECT 1 FROM favorites WHERE user_id = ? AND place_id = ? LIMIT 1', [uid, placeId]);
  if (!rows.length) {
    const verified = getCachedPlace(placeId);
    if (verified) {
      await pool.query(
        'INSERT IGNORE INTO favorites (user_id, place_id, name, admin1, country, latitude, longitude) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [uid, verified.id, verified.name, verified.admin1 || '', verified.country, verified.latitude, verified.longitude],
      );
      [rows] = await pool.query('SELECT 1 FROM favorites WHERE user_id = ? AND place_id = ? LIMIT 1', [uid, placeId]);
    }
  }

  if (!rows.length) throw new AppError(404, 'place_not_found', 'Search for the city first, then save it.');
  res.status(201).json({ placeId });
}));

router.delete('/favorites/:placeId', wrap(async (req, res) => {
  await pool.query('DELETE FROM favorites WHERE user_id = ? AND place_id = ?', [req.user.id, toPlaceId(req.params.placeId)]);
  res.status(204).end();
}));

module.exports = router;