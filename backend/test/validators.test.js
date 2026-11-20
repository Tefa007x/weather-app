const test = require('node:test');
const assert = require('node:assert');
const v = require('../src/validators');

test('usernames: allows spaces and apostrophes, rejects "@" and short names', () => {
  assert.strictEqual(v.validateUsername('Mostafa Tamer'), null);
  assert.strictEqual(v.validateUsername("O'Neil-Smith_1"), null);
  assert.ok(v.validateUsername('ab'));
  assert.ok(v.validateUsername('a@b.com'));
  assert.ok(v.validateUsername('<script>'));
  assert.ok(v.validateUsername(undefined));
});

test('usernames are trimmed and whitespace is collapsed', () => {
  assert.strictEqual(v.normalizeUsername('  Mostafa   Tamer '), 'Mostafa Tamer');
});

test('emails are lower-cased and validated', () => {
  assert.strictEqual(v.normalizeEmail(' Me@Example.COM '), 'me@example.com');
  assert.strictEqual(v.validateEmail('me@example.com'), null);
  assert.ok(v.validateEmail('nope'));
  assert.ok(v.validateEmail('a@b'));
});

test('passwords: 8+ characters and at most 72 bytes (bcrypt limit)', () => {
  assert.strictEqual(v.validatePassword('longenough'), null);
  assert.ok(v.validatePassword('short'));
  assert.ok(v.validatePassword('x'.repeat(73)));
  assert.ok(v.validatePassword(12345678));
});
