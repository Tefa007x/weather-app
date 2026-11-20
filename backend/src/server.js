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

const cleanup = setInterval(() => purgeExpiredSessions().catch(() => {}), 60 * 60 * 1000);
cleanup.unref();

// Graceful shutdown: Docker/Kubernetes send SIGTERM on every stop or rollout.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(JSON.stringify({ level: 'info', msg: `${signal} received, shutting down` }));
    server.close(async () => {
      await pool.end().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
