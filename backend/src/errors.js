class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Express 4 does not catch rejected promises, so every async route is wrapped.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Turn a MySQL duplicate-key error on users into a friendly 409.
function fromDbError(err) {
  if (err && err.code === 'ER_DUP_ENTRY') {
    const msg = err.sqlMessage || '';
    if (msg.includes('uq_users_email')) return new AppError(409, 'email_taken', 'That email address is already registered.');
    if (msg.includes('uq_users_username')) return new AppError(409, 'username_taken', 'That username is already taken.');
  }
  return err;
}

module.exports = { AppError, wrap, fromDbError };
