const mysql = require('mysql2/promise');
const config = require('./config');

// pool.query (client-side escaping) is used everywhere: it is injection-safe for "?" values
// and, unlike execute(), accepts numeric LIMIT values.
const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  connectTimeout: 5000,
  charset: 'utf8mb4',
  timezone: 'Z',
});

module.exports = { pool };
