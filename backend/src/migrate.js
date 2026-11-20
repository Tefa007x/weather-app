const { pool } = require('./db');

// Idempotent schema. For bigger projects switch to a migration tool (Flyway, Knex, Prisma...).
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(30) NOT NULL,
    email VARCHAR(254) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    temperature_unit ENUM('C','F') NOT NULL DEFAULT 'C',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // Server-side sessions: only a SHA-256 of the cookie token is stored, so logout really revokes access.
  `CREATE TABLE IF NOT EXISTS sessions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    token_hash CHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_sessions_token (token_hash),
    KEY idx_sessions_user (user_id),
    KEY idx_sessions_expires (expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS favorites (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    place_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    admin1 VARCHAR(120) NOT NULL DEFAULT '',
    country VARCHAR(120) NOT NULL DEFAULT '',
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_favorites_user_place (user_id, place_id),
    KEY idx_favorites_user_created (user_id, created_at),
    CONSTRAINT fk_favorites_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS search_history (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id INT UNSIGNED NOT NULL,
    place_id BIGINT UNSIGNED NOT NULL,
    name VARCHAR(120) NOT NULL,
    admin1 VARCHAR(120) NOT NULL DEFAULT '',
    country VARCHAR(120) NOT NULL DEFAULT '',
    latitude DOUBLE NOT NULL,
    longitude DOUBLE NOT NULL,
    searched_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY uq_history_user_place (user_id, place_id),
    KEY idx_history_user_searched (user_id, searched_at),
    CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// MySQL 8.4 does not support "ADD COLUMN IF NOT EXISTS"; run standard ALTER and ignore ER_DUP_FIELDNAME.
const COLUMN_MIGRATIONS = [
  "ALTER TABLE favorites ADD COLUMN admin1 VARCHAR(120) NOT NULL DEFAULT '' AFTER name",
  "ALTER TABLE search_history ADD COLUMN admin1 VARCHAR(120) NOT NULL DEFAULT '' AFTER name",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// MySQL can still be starting when the backend boots (compose / Kubernetes), so retry.
async function runMigrations(retries = 30, delayMs = 2000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      for (const sql of STATEMENTS) await pool.query(sql);
      for (const sql of COLUMN_MIGRATIONS) {
        try {
          await pool.query(sql);
        } catch (colErr) {
          if (colErr.code !== 'ER_DUP_FIELDNAME') throw colErr;
        }
      }
      console.log(JSON.stringify({ level: 'info', msg: 'database schema is ready' }));
      return;
    } catch (err) {
      console.warn(JSON.stringify({
        level: 'warn',
        msg: `database not ready (attempt ${attempt}/${retries})`,
        error: err.code || err.message,
        sqlMessage: err.sqlMessage,
      }));
      if (err.code === 'ER_PARSE_ERROR') throw err;
      await sleep(delayMs);
    }
  }
  throw new Error('Could not connect to the database');
}

module.exports = { runMigrations };