const test = require('node:test');
const assert = require('node:assert');
const { TtlCache } = require('../src/cache');

test('returns values until they expire', async () => {
  const c = new TtlCache();
  c.set('a', 1, 30);
  assert.strictEqual(c.get('a'), 1);
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(c.get('a'), undefined);
});

test('evicts the oldest entry when full', () => {
  const c = new TtlCache(2);
  c.set('a', 1, 1000); c.set('b', 2, 1000); c.set('c', 3, 1000);
  assert.strictEqual(c.get('a'), undefined);
  assert.strictEqual(c.get('c'), 3);
});
