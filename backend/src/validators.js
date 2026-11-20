const USERNAME_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u; // no "@", so a username can never look like an email
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const normalizeUsername = (v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
const normalizeEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

function validateUsername(v) {
  const s = normalizeUsername(v);
  if (s.length < 3 || s.length > 30) return 'Username must be 3 to 30 characters long.';
  if (!USERNAME_RE.test(s)) return "Username may only contain letters, numbers, spaces and . _ ' - characters.";
  return null;
}

function validateEmail(v) {
  const e = normalizeEmail(v);
  if (!e || e.length > 254 || !EMAIL_RE.test(e)) return 'Please enter a valid email address.';
  return null;
}

function validatePassword(v) {
  if (typeof v !== 'string' || v.length < 8) return 'Password must be at least 8 characters long.';
  if (Buffer.byteLength(v, 'utf8') > 72) return 'Password must be at most 72 bytes long.'; // bcrypt limit
  return null;
}

module.exports = { normalizeUsername, normalizeEmail, validateUsername, validateEmail, validatePassword };
