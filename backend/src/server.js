const config = require('./config');
const { pool } = require('./db');
const { createApp } = require('./app');
const { runMigrations } = require('./migrate');
const { purgeExpiredSessions } = require('./sessions');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(JSON.stringify({ level: 'info', msg: `backend listening on :${config.port}` }));
});

// Listen first so /api/health answers while MySQL is still starting; /api/ready stays 503 until the schema exists.
runMigrations()
  .then(() => { app.locals.schemaReady = true; })
  .catch((err) => {
    console.error(err.message);
    process.exit(1);
  });

const cleanup = setInterval(() => {
  purgeExpiredSessions().catch((err) => {
    console.error(JSON.stringify({ level: 'error', msg: 'failed to purge expired sessions', code: err.code || err.message }));
  });
}, 60 * 60 * 1000);
cleanup.unref();

// Graceful shutdown: Docker/Kubernetes send SIGTERM on every stop or rollout.
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.locals.schemaReady = false;
    console.log(JSON.stringify({ level: 'info', msg: `${signal} received, shutting down` }));
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    if (typeof server.closeIdleConnections === 'function') server.closeIdleConnections();
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
