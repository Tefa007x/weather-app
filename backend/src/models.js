// Row -> API shape helpers.
const toUser = (row) => ({
  id: row.id,
  username: row.username,
  email: row.email,
  temperatureUnit: row.temperature_unit,
});

module.exports = { toUser };
