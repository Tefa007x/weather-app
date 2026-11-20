const test = require('node:test');
const assert = require('node:assert');
const { describe } = require('../src/weatherCodes');

test('day and night variants', () => {
  assert.deepStrictEqual(describe(0, true), { label: 'Clear Sky', icon: 'sun' });
  assert.strictEqual(describe(0, false).icon, 'moon');
  assert.strictEqual(describe(2, false).icon, 'nightCloud');
  assert.strictEqual(describe(61, false).icon, 'nightRain');
  assert.strictEqual(describe(61, true).icon, 'rain');
});

test('snow, thunder, fog and unknown codes', () => {
  assert.strictEqual(describe(73).icon, 'snow');
  assert.strictEqual(describe(95).icon, 'thunder');
  assert.strictEqual(describe(99).icon, 'thunder');
  assert.strictEqual(describe(45).icon, 'cloud');
  assert.deepStrictEqual(describe(12345), { label: 'Unknown', icon: 'cloud' });
});
