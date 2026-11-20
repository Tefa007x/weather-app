const test = require('node:test');
const assert = require('node:assert');
const { normalizeForecast } = require('../src/openMeteo');

const hours = (date, hum, temp = 20, rain = 15) =>
  Array.from({ length: 24 }, (_, h) => ({
    time: `${date}T${String(h).padStart(2, '0')}:00`,
    hum,
    temp,
    rain,
    code: h >= 6 && h <= 18 ? 0 : 61,
    isDay: h >= 6 && h <= 18 ? 1 : 0,
  }));

test('normalizeForecast maps Open-Meteo output to the frontend shape', () => {
  const dates = ['2026-11-12', '2026-11-13'];
  const hourly = [...hours(dates[0], 60, 19.4, 20), ...hours(dates[1], 80, 22.1, 40)];
  const data = {
    timezone: 'Africa/Cairo',
    utc_offset_seconds: 7200,
    current: { time: '2026-11-12T22:00', temperature_2m: 18.46, apparent_temperature: 17.2, relative_humidity_2m: 62, wind_speed_10m: 11.6, is_day: 0, weather_code: 61 },
    hourly: {
      time: hourly.map((h) => h.time),
      temperature_2m: hourly.map((h) => h.temp),
      relative_humidity_2m: hourly.map((h) => h.hum),
      precipitation_probability: hourly.map((h) => h.rain),
      weather_code: hourly.map((h) => h.code),
      is_day: hourly.map((h) => h.isDay),
    },
    daily: {
      time: dates, weather_code: [61, 0],
      temperature_2m_max: [24.04, 27], temperature_2m_min: [16, 17.5],
      apparent_temperature_max: [22, 26], wind_speed_10m_max: [14.2, 9],
      precipitation_probability_max: [65, 10],
      uv_index_max: [5.4, 7.2],
      sunrise: ['2026-11-12T06:21', '2026-11-13T06:22'],
      sunset: ['2026-11-12T17:01', '2026-11-13T17:00'],
    },
  };
  const out = normalizeForecast(data);
  assert.strictEqual(out.timezone, 'Africa/Cairo');
  assert.strictEqual(out.utcOffsetSeconds, 7200);
  assert.strictEqual(out.current.temperature, 18.5);
  assert.deepStrictEqual(out.current.condition, { label: 'Light Rain', icon: 'nightRain' });
  assert.strictEqual(out.hourly.length, 24);
  assert.strictEqual(out.hourly[0].time, '2026-11-12T22:00');
  assert.strictEqual(out.daily.length, 2);
  assert.strictEqual(out.daily[0].humidity, 60);
  assert.strictEqual(out.daily[1].humidity, 80);
  assert.strictEqual(out.daily[0].high, 24);
  assert.strictEqual(out.daily[0].windSpeed, 14);
  assert.strictEqual(out.daily[0].rainChance, 65);
  assert.strictEqual(out.daily[0].uvIndex, 5.4);
  assert.strictEqual(out.daily[0].sunrise, '06:21');
  assert.strictEqual(out.daily[0].sunset, '17:01');
  assert.deepStrictEqual(out.daily[1].condition, { label: 'Clear Sky', icon: 'sun' });
});

test('days without temperatures are dropped and bad payloads rejected', () => {
  const base = { current: { temperature_2m: 1, is_day: 1, weather_code: 0 }, hourly: { time: [], relative_humidity_2m: [] } };
  const out = normalizeForecast({
    ...base,
    daily: { time: ['2026-11-12', '2026-11-13'], weather_code: [0, 0], temperature_2m_max: [5, null], temperature_2m_min: [1, null], apparent_temperature_max: [4, null], wind_speed_10m_max: [3, null] },
  });
  assert.strictEqual(out.daily.length, 1);
  assert.throws(() => normalizeForecast({}), (e) => e.status === 502);
});