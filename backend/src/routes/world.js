const router = require('express').Router();
const { wrap } = require('../errors');
const { getWorld } = require('../openMeteo');

// World Weather page: one cached, batched Open-Meteo request for every station.
router.get('/world', wrap(async (req, res) => {
  const forceRefresh = req.query.refresh === 'true';
  res.json(await getWorld({ forceRefresh }));
}));

module.exports = router;
