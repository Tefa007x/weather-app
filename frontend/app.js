'use strict';
/*
 * WeatherApp frontend (v7 design, real backend).
 * All API calls are same-origin under /api (nginx proxies them to the backend),
 * so the httpOnly session cookie works without any CORS configuration.
 * Every piece of user/API text is written with textContent, never innerHTML.
 */

const $ = (id) => document.getElementById(id);
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DEFAULT_CITY = 'Cairo';
const WORLD_REFRESH_MS = 10 * 60 * 1000;

const S = {
  user: null,
  unit: 'C',
  signupMode: false,
  weather: null,
  days: [],
  selectedDayIndex: 0,
  favorites: [],
  recent: [],
  world: null,
  worldAt: 0,
  seq: 0,
  retry: null,
  acItems: [],
  acIndex: -1,
  acTimer: null,
  acSeq: 0,
};

const ICON_TEMPLATES = {
  sun: '<div class="wi wi-sun"><div class="sun-rays"></div><div class="sun-diag"></div><div class="sun-core"></div></div>',
  partly: '<div class="wi wi-partly"><div class="pc-sun"></div><div class="pc-cloud"></div></div>',
  rain: '<div class="wi wi-rain"><div class="r-cloud"></div><div class="r-drops"><div class="drop"></div><div class="drop"></div><div class="drop"></div><div class="drop"></div><div class="drop"></div></div></div>',
  nightRain: '<div class="wi wi-night"><div class="moon"></div><div class="n-cloud"></div><div class="r-drops" style="bottom:-2px"><div class="drop"></div><div class="drop"></div><div class="drop"></div></div></div>',
  thunder: '<div class="wi wi-thunder"><div class="t-cloud"></div><div class="bolt"></div></div>',
  snow: '<div class="wi wi-snow"><div class="s-cloud"></div><div class="snowflakes"><span class="flake">❄</span><span class="flake">❄</span><span class="flake">❄</span><span class="flake">❄</span><span class="flake">❄</span></div></div>',
  cloud: '<div class="wi wi-cloud"><div class="c-body"></div></div>',
  moon: '<div class="wi wi-night"><div class="moon"></div></div>',
  nightCloud: '<div class="wi wi-night"><div class="moon"></div><div class="n-cloud"></div></div>',
};
const ICON_EMOJI = {
  sun: '☀️', partly: '⛅', rain: '🌧', nightRain: '🌧', thunder: '⛈',
  snow: '❄️', cloud: '☁️', moon: '🌙', nightCloud: '☁️',
};
const iconHtml = (key) => ICON_TEMPLATES[key] || ICON_TEMPLATES.cloud;
const condText = (c) => `${ICON_EMOJI[c.icon] || '☁️'} ${c.label}`;

// ── API ──
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check your connection and try again.');
  }
  let data = null;
  if (res.status !== 204) {
    try { data = await res.json(); } catch { /* non-JSON error page */ }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) onSessionExpired();
    throw new ApiError(res.status, data?.error || 'error', data?.message || 'Something went wrong. Please try again.');
  }
  return data;
}

// ── FORMATTING ──
function formatRawDegree(celsius) {
  if (!Number.isFinite(celsius)) return '--°';
  return `${Math.round(S.unit === 'F' ? celsius * 9 / 5 + 32 : celsius)}°`;
}
function formatTemp(celsius) {
  return `${formatRawDegree(celsius)}${S.unit}`;
}
const fmtPct = (v) => (Number.isFinite(v) ? `${Math.round(v)}%` : '--%');
function fmtWind(kmh) {
  if (!Number.isFinite(kmh)) return S.unit === 'F' ? '-- mph' : '-- km/h';
  if (S.unit === 'F') return `${Math.round(kmh * 0.621371)} mph`;
  return `${Math.round(kmh)} km/h`;
}
const placeLabel = (p) => (p.country ? `${p.name}, ${p.country}` : p.name);

function formatCoords(lat, lon) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns}, ${Math.abs(lon).toFixed(2)}°${ew}`;
}

function formatLocalTime(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true,
    }).format(new Date());
  } catch { return '--:--'; }
}

function formatHourLabel(isoTime, idx) {
  if (idx === 0) return 'Now';
  const hh = Number(String(isoTime || '').slice(11, 13));
  if (!Number.isFinite(hh)) return '--';
  const period = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12} ${period}`;
}

function uvLevel(uv) {
  if (uv <= 2) return { text: 'Low', cls: 'uv-low' };
  if (uv <= 5) return { text: 'Moderate', cls: 'uv-mod' };
  if (uv <= 7) return { text: 'High', cls: 'uv-high' };
  return { text: 'Very High', cls: 'uv-vhigh' };
}

// ── TOAST & CLOCK ──
function showToast(msg) {
  const banner = $('toast-banner');
  banner.textContent = msg;
  banner.classList.add('show');
  clearTimeout(window._toastTimeout);
  window._toastTimeout = setTimeout(() => banner.classList.remove('show'), 2600);
}

function updateWorldUpdatedBadge() {
  const stamp = $('world-updated-stamp');
  if (!stamp) return;
  const ts = S.world && S.world.updatedAt ? Date.parse(S.world.updatedAt) : NaN;
  if (!Number.isFinite(ts)) {
    stamp.textContent = '⚡ Updates every 10 min';
    return;
  }
  const timeStr = new Date(ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  const ago = mins === 0 ? 'just now' : `${mins} min ago`;
  stamp.textContent = `⚡ Updated ${timeStr} (${ago})`;
}

function updateSystemClock() {
  const now = new Date();
  $('auth-clock-time').textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  $('auth-clock-date').textContent = now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  if (S.weather && S.weather.timezone && $('hero-local-time-val')) {
    $('hero-local-time-val').textContent = formatLocalTime(S.weather.timezone);
  }
  updateWorldUpdatedBadge();
  if ($('view-weather')?.classList.contains('active') && S.world) {
    document.querySelectorAll('.wc-time[data-tz]').forEach((el) => {
      el.textContent = `🕒 ${formatLocalTime(el.dataset.tz)}`;
    });
  }
}

// ── SCREENS & VIEWS ──
function showScreen(name) {
  $('screen-auth').classList.toggle('active', name === 'auth');
  $('screen-app').classList.toggle('active', name === 'app');
}

function switchAppView(viewId) {
  document.querySelectorAll('.sidebar .nav-item').forEach((b) => b.classList.remove('active'));
  const nav = $(`nav-btn-${viewId}`);
  if (nav) nav.classList.add('active');

  document.querySelectorAll('.sub-view').forEach((v) => v.classList.remove('active'));
  const view = $(`view-${viewId}`);
  if (view) view.classList.add('active');

  const wrap = $('main-app-wrap');
  const panel = $('places-panel');
  if (viewId === 'settings') {
    panel.style.display = 'none';
    wrap.classList.add('settings-active');
    updateSettingsSecurityHint();
  } else {
    panel.style.display = 'flex';
    wrap.classList.remove('settings-active');
    if (viewId === 'weather') ensureWorld(false);
  }
}

// ── AUTH ──
function showAuthError(msg) {
  const el = $('auth-error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

function setAuthTab(mode) {
  S.signupMode = mode === 'signup';
  const signup = S.signupMode;
  $('auth-error-msg').style.display = 'none';

  $('tab-btn-login').classList.toggle('on', !signup);
  $('tab-btn-login').setAttribute('aria-selected', String(!signup));
  $('tab-btn-signup').classList.toggle('on', signup);
  $('tab-btn-signup').setAttribute('aria-selected', String(signup));

  $('signup-name-group').style.display = signup ? 'block' : 'none';
  $('auth-username').placeholder = 'Enter your username';

  const identifier = $('auth-identifier');
  $('auth-identifier-label').textContent = signup ? 'Email Address' : 'Username or Email';
  identifier.type = signup ? 'email' : 'text';
  identifier.placeholder = signup ? 'Enter your email address' : 'Enter your username or Email address';
  identifier.setAttribute('autocomplete', signup ? 'email' : 'username');

  const pwd = $('auth-password');
  pwd.placeholder = signup ? 'Create a new password' : 'Enter your password';
  pwd.setAttribute('autocomplete', signup ? 'new-password' : 'current-password');

  if (signup) updatePasswordMeter(pwd.value, 'auth');
  else resetPasswordMeter('auth');

  $('auth-submit-btn').textContent = signup ? 'Create Account & Continue' : 'Sign In to Dashboard';
  $('auth-switch-text').textContent = signup ? 'Already have an account?' : "Don't have an account?";
  $('auth-switch-btn').textContent = signup ? 'Sign In' : 'Sign Up';
}

function togglePasswordVisibility(inputId, buttonId) {
  const input = $(inputId);
  const button = $(buttonId);
  const reveal = input.type === 'password';
  input.type = reveal ? 'text' : 'password';
  button.setAttribute('aria-pressed', String(reveal));
  button.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
  button.style.color = reveal ? 'var(--accent-cyan)' : 'var(--text-secondary)';
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const identifier = $('auth-identifier').value.trim();
  const password = $('auth-password').value;
  const username = $('auth-username').value.trim();
  $('auth-error-msg').style.display = 'none';

  if (!identifier || !password) return showAuthError('Please fill in all required credentials.');
  if (S.signupMode) {
    if (!username) return showAuthError('Please choose a username.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) return showAuthError('Please enter a valid email address.');
    if (password.length < 8) return showAuthError('Password must be at least 8 characters long.');
    if (new TextEncoder().encode(password).length > 72) return showAuthError('Password must be at most 72 bytes long.');
  }

  const btn = $('auth-submit-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Please wait…';
  try {
    const { user } = S.signupMode
      ? await api('POST', '/auth/register', { username, email: identifier, password })
      : await api('POST', '/auth/login', { identifier, password });
    await enterApp(user);
  } catch (err) {
    showAuthError(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

async function enterApp(user, { silent = false } = {}) {
  S.user = user;
  S.unit = user.temperatureUnit === 'F' ? 'F' : 'C';
  applyUnitUi();
  updateUserInterface();
  $('auth-form').reset();
  resetPasswordMeter('auth');
  $('city-search-input').value = '';
  closeAutocomplete();
  showScreen('app');
  switchAppView('dashboard');
  setDashboardState('idle');
  syncFavControls(false, false);
  if (!silent) showToast(`Welcome, ${user.username}!`);
  loadPlaces();
}

function resetClientState() {
  S.seq += 1;
  closeAutocomplete();
  Object.assign(S, { user: null, weather: null, days: [], selectedDayIndex: 0, favorites: [], recent: [], world: null, worldAt: 0 });
  $('settings-form').reset();
  $('settings-error-msg').style.display = 'none';
  resetPasswordMeter('auth');
  resetPasswordMeter('settings');
}

async function signOut() {
  try { await api('POST', '/auth/logout'); } catch { /* cookie is cleared server-side when reachable */ }
  resetClientState();
  showScreen('auth');
  setAuthTab('login');
  $('auth-form').reset();
  showToast('Signed out successfully.');
}

function onSessionExpired() {
  if (!S.user) return;
  resetClientState();
  showScreen('auth');
  setAuthTab('login');
  showToast('Your session expired. Please sign in again.');
}

function updateUserInterface() {
  const name = S.user.username;
  const initial = name.charAt(0).toUpperCase();
  $('sb-avatar-letter').textContent = initial;
  $('sb-username-text').textContent = name;
  $('settings-avatar-letter').textContent = initial;
  $('settings-display-name').textContent = name;
  $('settings-display-email').textContent = S.user.email;
  $('settings-username-input').value = name;
  $('settings-email-input').value = S.user.email;
  updateSettingsSecurityHint();
}

// ── AUTOCOMPLETE SEARCH ──
function closeAutocomplete() {
  const dd = $('ac-dropdown');
  const input = $('city-search-input');
  if (dd) dd.classList.remove('open');
  if (input) input.setAttribute('aria-expanded', 'false');
  S.acItems = [];
  S.acIndex = -1;
}

function renderAutocomplete(items, query) {
  const dd = $('ac-dropdown');
  const input = $('city-search-input');
  if (!dd || !input) return;
  dd.textContent = '';
  S.acItems = items;
  S.acIndex = -1;

  const header = document.createElement('div');
  header.className = 'ac-header';
  const leftSpan = document.createElement('span');
  leftSpan.textContent = items.length ? `Matching Cities (${items.length})` : 'No Matches';
  const rightSpan = document.createElement('span');
  rightSpan.textContent = '↑ ↓ Select • Enter';
  header.append(leftSpan, rightSpan);
  dd.appendChild(header);

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'ac-empty';
    empty.textContent = `No matching cities found for "${query}".`;
    dd.appendChild(empty);
  } else {
    items.forEach((item, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ac-item';
      btn.setAttribute('role', 'option');
      btn.dataset.idx = String(idx);

      const nameWrap = document.createElement('div');
      const nameDiv = document.createElement('div');
      nameDiv.className = 'ac-name';
      nameDiv.textContent = item.name;
      const regionDiv = document.createElement('div');
      regionDiv.className = 'ac-region';
      const parts = [item.admin1, item.country].filter(Boolean);
      regionDiv.textContent = parts.join(', ');
      nameWrap.append(nameDiv, regionDiv);

      const coords = document.createElement('span');
      coords.className = 'ac-coords';
      coords.textContent = formatCoords(Number(item.latitude), Number(item.longitude));

      btn.append(nameWrap, coords);
      btn.addEventListener('click', () => selectAutocompletePlace(item));
      dd.appendChild(btn);
    });
  }

  dd.classList.add('open');
  input.setAttribute('aria-expanded', 'true');
}

function highlightAutocomplete(nextIndex) {
  const dd = $('ac-dropdown');
  if (!dd || !S.acItems.length) return;
  const total = S.acItems.length;
  S.acIndex = ((nextIndex % total) + total) % total;
  dd.querySelectorAll('.ac-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === S.acIndex);
    if (idx === S.acIndex) el.scrollIntoView({ block: 'nearest' });
  });
}

function selectAutocompletePlace(place) {
  closeAutocomplete();
  $('city-search-input').value = place.name;
  loadWeather(new URLSearchParams({ id: String(place.id) }), place.name);
}

async function fetchAutocompleteSuggestions(query) {
  const reqId = ++S.acSeq;
  try {
    const data = await api('GET', `/places/search?${new URLSearchParams({ q: query, limit: '6' })}`);
    if (reqId !== S.acSeq) return;
    if ($('city-search-input').value.trim() !== query) return;
    renderAutocomplete(data.results || [], query);
  } catch {
    if (reqId === S.acSeq) closeAutocomplete();
  }
}

// ── WEATHER: SEARCH, LOADING, ERROR STATES ──
function setDashboardState(state) {
  const isIdle = state === 'idle';
  const isReady = state === 'ready';
  const isLoading = state === 'loading';
  const isError = state === 'error';
  if ($('state-empty')) $('state-empty').style.display = isIdle ? 'block' : 'none';
  $('state-loading').style.display = isLoading ? 'block' : 'none';
  $('state-not-found').style.display = isError ? 'block' : 'none';
  $('hero-weather-card').style.display = isReady ? 'block' : 'none';
  $('forecast-section').style.display = isReady ? 'block' : 'none';
  const hs = $('hourly-section');
  if (hs) hs.style.display = isReady ? 'block' : 'none';
}

function showErrorState({ title, desc, actionLabel, action }) {
  setDashboardState('error');
  $('not-found-city-name').textContent = title;
  $('not-found-desc').textContent = desc;
  $('not-found-action-btn').textContent = actionLabel;
  S.retry = action;
}

function handleSearchSubmit(e) {
  e.preventDefault();
  if (S.acIndex >= 0 && S.acItems[S.acIndex]) {
    selectAutocompletePlace(S.acItems[S.acIndex]);
    return;
  }
  closeAutocomplete();
  const query = $('city-search-input').value.trim();
  if (query) loadCity(query);
}

function loadCity(name, { track = true } = {}) {
  const params = new URLSearchParams({ q: name });
  if (!track) params.set('track', 'false');
  return loadWeather(params, name);
}

async function loadWeather(params, label) {
  const seq = ++S.seq;
  closeAutocomplete();
  setDashboardState('loading');
  try {
    const data = await api('GET', `/weather?${params}`);
    if (seq !== S.seq) return;

    S.weather = data;
    S.selectedDayIndex = 0;
    S.days = data.daily.map((d, i) => {
      const weekday = WEEKDAYS[new Date(`${d.date}T12:00:00Z`).getUTCDay()];
      return { ...d, dayLabel: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : weekday };
    });

    setDashboardState('ready');
    $('city-search-input').value = data.place.name;
    $('forecast-section-title').textContent = `${data.place.name} — 7-Day Weekday Forecast`;
    document.querySelectorAll('.quick-chips .chip').forEach((c) => {
      c.classList.toggle('active', c.dataset.city.toLowerCase() === data.place.name.toLowerCase());
    });
    renderHeroCard();
    renderHourlyTrack();
    renderForecastTrack();
    $('forecast-viewport').scrollTo({ left: 0, behavior: 'smooth' });
    loadPlaces();
  } catch (err) {
    if (seq !== S.seq || err.status === 401) return;
    if (err.code === 'city_not_found' || err.code === 'place_not_found') {
      showErrorState({
        title: `"${label}" Not Found`,
        desc: "We couldn't locate weather coordinates for this search query. Please verify the spelling or select a city from the list.",
        actionLabel: 'Clear Search',
        action: () => {
          $('city-search-input').value = '';
          setDashboardState('idle');
          S.retry = null;
        },
      });
    } else {
      showErrorState({
        title: 'Weather Service Unavailable',
        desc: err.message,
        actionLabel: 'Try Again',
        action: () => loadWeather(params, label),
      });
    }
  }
}

// ── HERO CARD & FAVORITE CONTROLS SYNC ──
function syncFavControls(isFav, hasPlace = true) {
  const heroBtn = $('hero-fav-action-btn');
  if (heroBtn) {
    heroBtn.classList.toggle('saved', isFav);
    $('fav-btn-icon').textContent = isFav ? '★' : '☆';
    $('fav-btn-text').textContent = isFav ? 'Saved in Favorites' : 'Save to Favorites';
  }
  const addBtn = $('add-fav-btn');
  if (addBtn) {
    addBtn.disabled = !hasPlace;
    addBtn.classList.toggle('saved', hasPlace && isFav);
    addBtn.textContent = hasPlace && isFav ? '★' : '＋';
    const label = !hasPlace
      ? 'Search for a city first to bookmark it'
      : isFav
        ? 'Remove current city from favorites'
        : 'Add current city to favorites';
    addBtn.setAttribute('aria-label', label);
    addBtn.title = label;
  }
}

function renderHeroCard() {
  const w = S.weather;
  if (!w) {
    syncFavControls(false, false);
    return;
  }
  $('hero-city-title').textContent = w.place.name;
  const subParts = [w.place.admin1 && w.place.admin1 !== w.place.name ? w.place.admin1 : '', w.place.country].filter(Boolean);
  $('hero-country-subtitle').textContent = subParts.join(', ');

  const localTimeVal = $('hero-local-time-val');
  const timezoneVal = $('hero-timezone-val');
  const localTimeBadge = $('hero-local-time-badge');
  if (w.timezone && localTimeVal) {
    if (localTimeBadge) localTimeBadge.style.display = 'inline-flex';
    localTimeVal.textContent = formatLocalTime(w.timezone);
    if (timezoneVal) timezoneVal.textContent = `(${w.timezone})`;
  } else if (localTimeBadge) {
    localTimeBadge.style.display = 'none';
  }

  let temp, mode, cond, pill, feels, hum, wind, uvData, rainData, sunrise, sunset;
  if (S.selectedDayIndex === 0) {
    const c = w.current;
    const d0 = S.days[0];
    temp = c.temperature; mode = 'Now • Current Condition'; cond = c.condition; pill = 'Today';
    feels = c.feelsLike; hum = c.humidity; wind = c.windSpeed;
    uvData = c.uvIndex ?? (d0 ? d0.uvIndex : null);
    rainData = c.rainChance ?? (d0 ? d0.rainChance : null);
    sunrise = c.sunrise ?? (d0 ? d0.sunrise : null);
    sunset = c.sunset ?? (d0 ? d0.sunset : null);
  } else {
    const d = S.days[S.selectedDayIndex];
    temp = d.high; mode = `Forecast • High ${formatRawDegree(d.high)} / Low ${formatRawDegree(d.low)}`;
    cond = d.condition; pill = d.dayLabel; feels = d.feelsLike; hum = d.humidity; wind = d.windSpeed;
    uvData = d.uvIndex ?? null;
    rainData = d.rainChance ?? null;
    sunrise = d.sunrise ?? null;
    sunset = d.sunset ?? null;
  }
  $('hero-temperature-val').textContent = formatRawDegree(temp);
  $('hero-temp-mode-label').textContent = mode;
  $('hero-condition-text').textContent = condText(cond);
  $('hero-selected-day-pill').textContent = pill;
  $('hero-feels-val').textContent = formatRawDegree(feels);
  $('hero-humidity-val').textContent = fmtPct(hum);
  $('hero-wind-val').textContent = fmtWind(wind);
  $('hero-animated-icon').innerHTML = iconHtml(cond.icon);

  const uvNum = $('hero-uv-num');
  const uvPill = $('hero-uv-pill');
  const uvVal = $('hero-uv-val');
  if (Number.isFinite(uvData) && uvNum && uvPill) {
    if (uvVal && uvVal.closest('.stat')) uvVal.closest('.stat').style.display = '';
    const uvLvl = uvLevel(uvData);
    uvNum.textContent = String(uvData);
    uvPill.textContent = uvLvl.text;
    uvPill.className = `uv-pill ${uvLvl.cls}`;
  } else if (uvVal && uvVal.closest('.stat')) {
    uvVal.closest('.stat').style.display = 'none';
  }

  const rainValEl = $('hero-rain-val');
  if (Number.isFinite(rainData) && rainValEl) {
    if (rainValEl.closest('.stat')) rainValEl.closest('.stat').style.display = '';
    rainValEl.textContent = `${rainData}%`;
  } else if (rainValEl && rainValEl.closest('.stat')) {
    rainValEl.closest('.stat').style.display = 'none';
  }

  const sunValEl = $('hero-sun-val');
  if (sunrise && sunset && sunValEl) {
    if (sunValEl.closest('.stat')) sunValEl.closest('.stat').style.display = '';
    sunValEl.textContent = `${sunrise} / ${sunset}`;
  } else if (sunValEl && sunValEl.closest('.stat')) {
    sunValEl.closest('.stat').style.display = 'none';
  }

  const isFav = S.favorites.some((f) => f.id === w.place.id);
  syncFavControls(isFav, true);
}

// ── 24-HOUR HOURLY STRIP ──
function renderHourlyTrack() {
  const section = $('hourly-section');
  const track = $('hourly-track');
  if (!section || !track) return;
  const items = (S.weather && Array.isArray(S.weather.hourly)) ? S.weather.hourly : [];
  if (!items.length) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'block';
  track.textContent = '';

  items.forEach((slot, idx) => {
    const card = document.createElement('div');
    card.className = `hr-slot ${idx === 0 ? 'now' : ''}`;

    const timeEl = document.createElement('div');
    timeEl.className = 'hr-time';
    timeEl.textContent = formatHourLabel(slot.time, idx);

    const iconEl = document.createElement('div');
    iconEl.className = 'hr-icon';
    iconEl.setAttribute('aria-hidden', 'true');
    iconEl.innerHTML = iconHtml(slot.condition?.icon || 'cloud');

    const tempEl = document.createElement('div');
    tempEl.className = 'hr-temp';
    tempEl.textContent = formatRawDegree(slot.temperature);

    const rainWrap = document.createElement('div');
    rainWrap.className = 'hr-rain-wrap';
    const rainBar = document.createElement('div');
    rainBar.className = 'hr-rain-bar';
    const rainFill = document.createElement('div');
    rainFill.className = 'hr-rain-fill';
    const pct = Number.isFinite(slot.rainChance) ? Math.min(Math.max(slot.rainChance, 0), 100) : 0;
    rainFill.style.width = `${pct}%`;
    rainBar.appendChild(rainFill);

    const rainPct = document.createElement('div');
    rainPct.className = 'hr-rain-pct';
    rainPct.textContent = `💧 ${pct}%`;
    rainWrap.append(rainBar, rainPct);

    card.append(timeEl, iconEl, tempEl, rainWrap);
    track.appendChild(card);
  });
}

// ── FORECAST CAROUSEL ──
function renderForecastTrack() {
  const track = $('forecast-track');
  track.textContent = '';

  S.days.forEach((day, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fc-card ${idx === S.selectedDayIndex ? 'active-day' : ''}`;
    btn.setAttribute('aria-label', `${day.dayLabel}: High ${formatRawDegree(day.high)}, Low ${formatRawDegree(day.low)}, ${day.condition.label}`);

    const dayDiv = document.createElement('div');
    dayDiv.className = 'fc-day';
    dayDiv.textContent = day.dayLabel;

    const iconWrap = document.createElement('div');
    iconWrap.className = 'fc-icon-wrap';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.innerHTML = iconHtml(day.condition.icon);

    const temps = document.createElement('div');
    temps.className = 'fc-temps';
    const high = document.createElement('span');
    high.className = 'fc-high';
    high.textContent = formatRawDegree(day.high);
    const low = document.createElement('span');
    low.className = 'fc-low';
    low.textContent = formatRawDegree(day.low);
    temps.append(high, low);

    btn.append(dayDiv, iconWrap, temps);

    if (Number.isFinite(day.rainChance) && day.rainChance > 0) {
      const badge = document.createElement('span');
      badge.className = 'fc-rain-badge';
      badge.textContent = `💧 ${day.rainChance}%`;
      btn.appendChild(badge);
    }

    btn.addEventListener('click', () => {
      S.selectedDayIndex = idx;
      renderHeroCard();
      renderForecastTrack();
    });
    track.appendChild(btn);
  });
}

function carouselNavigate(dir) {
  const total = S.days.length;
  if (!total) return;
  S.selectedDayIndex = (S.selectedDayIndex + dir + total) % total;
  renderHeroCard();
  renderForecastTrack();
  const active = $('forecast-track').children[S.selectedDayIndex];
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
}

// ── MY PLACES ──
async function loadPlaces() {
  try {
    const data = await api('GET', '/places');
    S.favorites = data.favorites;
    S.recent = data.recent;
  } catch { return; }
  renderPlaces();
  renderHeroCard();
}

function renderPlaces() {
  const favCount = $('fav-count');
  const recentCount = $('recent-count');
  if (favCount) favCount.textContent = String(S.favorites.length);
  if (recentCount) recentCount.textContent = String(S.recent.length);

  renderPlacesList('favorites-list-container', S.favorites, true);
  renderPlacesList('recent-list-container', S.recent, false);
}

function renderPlacesList(containerId, items, removable) {
  const container = $(containerId);
  container.textContent = '';

  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.style.cssText = 'font-size:12.5px;color:var(--text-secondary);padding:6px 0';
    empty.textContent = removable ? 'No favorite cities saved.' : 'No recent searches.';
    container.appendChild(empty);
    return;
  }

  items.forEach((place) => {
    const row = document.createElement('div');
    row.className = 'place-row';
    row.setAttribute('role', 'listitem');

    const cityBtn = document.createElement('button');
    cityBtn.type = 'button';
    cityBtn.className = 'place-btn';
    cityBtn.textContent = placeLabel(place);
    cityBtn.addEventListener('click', () => {
      switchAppView('dashboard');
      loadWeather(new URLSearchParams({ id: String(place.id) }), place.name);
    });
    row.appendChild(cityBtn);

    if (removable) {
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'place-x-btn';
      rm.textContent = '✕';
      rm.setAttribute('aria-label', `Remove ${place.name} from favorites`);
      rm.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        try {
          await api('DELETE', `/favorites/${place.id}`);
          showToast(`Removed ${place.name} from favorites`);
          loadPlaces();
        } catch (err) { showToast(err.message); }
      });
      row.appendChild(rm);
    } else {
      const arrow = document.createElement('span');
      arrow.className = 'place-arr';
      arrow.textContent = '›';
      arrow.setAttribute('aria-hidden', 'true');
      row.appendChild(arrow);
    }
    container.appendChild(row);
  });
}

async function toggleCurrentFavorite() {
  const place = S.weather && S.weather.place;
  if (!place) {
    showToast('Search for a city first to save it to Favorites.');
    return;
  }
  const isFav = S.favorites.some((f) => f.id === place.id);
  try {
    if (isFav) {
      await api('DELETE', `/favorites/${place.id}`);
      showToast(`Removed ${place.name} from Favorites`);
    } else {
      await api('POST', '/favorites', { placeId: place.id });
      showToast(`Added ${place.name} to Favorites ★`);
    }
    await loadPlaces();
  } catch (err) { showToast(err.message); }
}

// ── WORLD WEATHER ──
async function ensureWorld(force) {
  if (S.world && !force && Date.now() - S.worldAt < WORLD_REFRESH_MS) {
    renderWorldWeatherGrid();
    updateWorldUpdatedBadge();
    return;
  }
  if (!S.world) setWorldMessage('Loading global weather stations…');

  const refreshBtn = $('world-refresh-btn');
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.classList.add('spinning');
  }

  try {
    const query = force ? '/world?refresh=true' : '/world';
    S.world = await api('GET', query);
    S.worldAt = Date.now();
    renderWorldWeatherGrid();
    updateWorldUpdatedBadge();
    if (force) showToast('World weather stations refreshed.');
  } catch (err) {
    if (S.world) {
      showToast(err.message);
      return;
    }
    setWorldMessage(err.message, true);
  } finally {
    if (refreshBtn) {
      refreshBtn.disabled = false;
      refreshBtn.classList.remove('spinning');
    }
  }
}

function setWorldMessage(text, withRetry = false) {
  const grid = $('world-stations-grid');
  grid.textContent = '';
  const box = document.createElement('div');
  box.className = 'world-msg';
  const p = document.createElement('p');
  p.textContent = text;
  box.appendChild(p);
  if (withRetry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'show-btn';
    btn.style.cssText = 'margin-top:14px;padding:10px 24px';
    btn.textContent = 'Try Again';
    btn.addEventListener('click', () => ensureWorld(true));
    box.appendChild(btn);
  }
  grid.appendChild(box);
}

function renderWorldWeatherGrid() {
  const grid = $('world-stations-grid');
  grid.textContent = '';
  if (!S.world) return;

  S.world.cities.forEach((city) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'world-card';
    card.setAttribute('aria-label', `Inspect ${city.name}, ${city.country}: ${formatTemp(city.temperature)}, ${city.condition.label}`);

    const left = document.createElement('div');
    left.className = 'wc-left';
    const iconDiv = document.createElement('div');
    iconDiv.className = 'wc-icon';
    iconDiv.setAttribute('aria-hidden', 'true');
    iconDiv.innerHTML = iconHtml(city.condition.icon);

    const info = document.createElement('div');
    info.className = 'wc-info';
    const cityDiv = document.createElement('div');
    cityDiv.className = 'wc-city';
    cityDiv.textContent = city.name;
    const countryDiv = document.createElement('div');
    countryDiv.className = 'wc-country';
    countryDiv.textContent = city.country;

    const subRow = document.createElement('div');
    subRow.className = 'wc-sub-row';
    const condDiv = document.createElement('span');
    condDiv.className = 'wc-cond';
    condDiv.textContent = condText(city.condition);
    subRow.appendChild(condDiv);

    if (city.timezone) {
      const timeEl = document.createElement('span');
      timeEl.className = 'wc-time';
      timeEl.dataset.tz = city.timezone;
      timeEl.textContent = `🕒 ${formatLocalTime(city.timezone)}`;
      subRow.appendChild(timeEl);
    }

    info.append(cityDiv, countryDiv, subRow);
    left.append(iconDiv, info);

    const tempDiv = document.createElement('div');
    tempDiv.className = 'wc-temp';
    tempDiv.textContent = formatTemp(city.temperature);

    card.append(left, tempDiv);
    card.addEventListener('click', () => {
      switchAppView('dashboard');
      loadWeather(new URLSearchParams({ q: city.name, track: 'false' }), city.name);
    });
    grid.appendChild(card);
  });
}

// ── SETTINGS & PASSWORD METERS ──
const PWD_METERS = {
  auth: {
    meter: 'auth-pwd-meter',
    bar: 'auth-pwd-bar-',
    strength: 'auth-pwd-strength',
    bytes: 'auth-pwd-bytes',
  },
  settings: {
    meter: 'pwd-meter',
    bar: 'pwd-bar-',
    strength: 'pwd-strength-text',
    bytes: 'pwd-byte-count',
  },
};

function applyUnitUi() {
  const isC = S.unit === 'C';
  $('unit-btn-c').classList.toggle('active', isC);
  $('unit-btn-c').setAttribute('aria-checked', String(isC));
  $('unit-btn-f').classList.toggle('active', !isC);
  $('unit-btn-f').setAttribute('aria-checked', String(!isC));
  const sbC = $('sb-unit-c');
  const sbF = $('sb-unit-f');
  if (sbC) { sbC.classList.toggle('active', isC); sbC.setAttribute('aria-checked', String(isC)); }
  if (sbF) { sbF.classList.toggle('active', !isC); sbF.setAttribute('aria-checked', String(!isC)); }
  const sbDesc = $('sb-unit-desc');
  if (sbDesc) sbDesc.textContent = isC ? '°C • km/h' : '°F • mph';
}

async function setTemperatureUnit(newUnit) {
  if (S.unit === newUnit) return;
  const previous = S.unit;
  S.unit = newUnit;
  applyUnitUi();
  renderHeroCard();
  renderHourlyTrack();
  renderForecastTrack();
  renderWorldWeatherGrid();
  try {
    await api('PATCH', '/me/preferences', { temperatureUnit: newUnit });
    S.user.temperatureUnit = newUnit;
    showToast(`Units updated to °${newUnit} / ${newUnit === 'F' ? 'mph' : 'km/h'}`);
  } catch (err) {
    S.unit = previous;
    applyUnitUi();
    renderHeroCard();
    renderHourlyTrack();
    renderForecastTrack();
    renderWorldWeatherGrid();
    showToast(err.message);
  }
}

function updateSettingsSecurityHint() {
  if (!S.user) return;
  const emailVal = ($('settings-email-input')?.value || '').trim().toLowerCase();
  const newPwd = $('settings-new-password')?.value || '';
  const confirmPwd = $('settings-confirm-password')?.value || '';
  const needsCurrent = emailVal !== S.user.email.toLowerCase() || Boolean(newPwd || confirmPwd);
  const pill = $('current-pwd-req-pill');
  if (pill) pill.classList.toggle('active', needsCurrent);
  const wrap = $('current-pwd-wrap');
  if (wrap) wrap.classList.toggle('req-active', needsCurrent);
}

function resetPasswordMeter(target = 'settings') {
  const ids = PWD_METERS[target];
  const meter = ids ? $(ids.meter) : null;
  if (meter) meter.classList.remove('visible');
}

function updatePasswordMeter(pwd, target = 'settings') {
  const ids = PWD_METERS[target];
  const meter = ids ? $(ids.meter) : null;
  if (!meter) return;

  if (!pwd) {
    meter.classList.remove('visible');
    return;
  }
  meter.classList.add('visible');

  const bytes = new TextEncoder().encode(pwd).length;
  let score = 0;
  if (pwd.length >= 8) score += 1;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score += 1;
  if (/\d/.test(pwd)) score += 1;
  if (/[^A-Za-z0-9]/.test(pwd) || pwd.length >= 13) score += 1;
  if (bytes > 72) score = 1;

  const levels = [
    { label: 'Too short', color: '#ff6b6b' },
    { label: 'Weak', color: '#ff6b6b' },
    { label: 'Fair', color: '#ffb347' },
    { label: 'Good', color: '#00cfff' },
    { label: 'Strong', color: '#00e5a0' },
  ];
  const lvl = bytes > 72 ? { label: 'Exceeds 72-byte limit', color: '#ff6b6b' } : levels[score];

  for (let i = 1; i <= 4; i += 1) {
    const bar = $(`${ids.bar}${i}`);
    if (bar) bar.style.background = i <= score ? lvl.color : 'rgba(255, 255, 255, 0.1)';
  }

  const strengthText = $(ids.strength);
  if (strengthText) {
    strengthText.textContent = lvl.label;
    strengthText.style.color = lvl.color;
  }

  const byteCount = $(ids.bytes);
  if (byteCount) {
    byteCount.textContent = `${bytes} / 72 bytes${pwd.length < 8 ? ' (min 8 chars)' : ''}`;
    byteCount.style.color = bytes > 72 || pwd.length < 8 ? '#ffb347' : 'var(--accent-mint)';
  }
}

function showSettingsError(msg) {
  const el = $('settings-error-msg');
  el.textContent = msg;
  el.style.display = 'block';
}

async function handleSaveSettings(e) {
  e.preventDefault();
  $('settings-error-msg').style.display = 'none';
  const username = $('settings-username-input').value.trim();
  const email = $('settings-email-input').value.trim();
  const currentPassword = $('settings-current-password').value;
  const newPassword = $('settings-new-password').value;
  const confirmPassword = $('settings-confirm-password').value;

  if (!username || !email) return showSettingsError('Username and email are required.');
  if (newPassword || confirmPassword) {
    if (newPassword !== confirmPassword) return showSettingsError('New password and confirmation do not match. Please verify.');
    if (newPassword.length < 8) return showSettingsError('Password must be at least 8 characters long.');
    if (new TextEncoder().encode(newPassword).length > 72) return showSettingsError('Password must be at most 72 bytes long.');
  }

  const body = { username, email };
  if (currentPassword) body.currentPassword = currentPassword;
  if (newPassword) body.newPassword = newPassword;

  const btn = $('settings-save-btn');
  const prevText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Saving…';
  }

  try {
    const { user } = await api('PATCH', '/me', body);
    S.user = user;
    updateUserInterface();
    ['settings-current-password', 'settings-new-password', 'settings-confirm-password'].forEach((id) => { $(id).value = ''; });
    resetPasswordMeter('settings');
    updateSettingsSecurityHint();
    showToast('Profile settings saved successfully!');
  } catch (err) {
    showSettingsError(err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  }
}

// ── WIRING ──
function bindEvents() {
  $('tab-btn-login').addEventListener('click', () => setAuthTab('login'));
  $('tab-btn-signup').addEventListener('click', () => setAuthTab('signup'));
  $('auth-switch-btn').addEventListener('click', () => setAuthTab(S.signupMode ? 'login' : 'signup'));
  $('auth-eye-btn').addEventListener('click', () => togglePasswordVisibility('auth-password', 'auth-eye-btn'));
  $('auth-password').addEventListener('input', (e) => {
    if (S.signupMode) updatePasswordMeter(e.target.value, 'auth');
  });
  $('auth-form').addEventListener('submit', handleAuthSubmit);

  ['dashboard', 'weather', 'settings'].forEach((v) => $(`nav-btn-${v}`).addEventListener('click', () => switchAppView(v)));
  $('search-form').addEventListener('submit', handleSearchSubmit);
  document.querySelectorAll('.quick-chips .chip').forEach((chip) => chip.addEventListener('click', () => loadCity(chip.dataset.city)));

  const emptyLoadBtn = $('empty-load-cairo-btn');
  if (emptyLoadBtn) emptyLoadBtn.addEventListener('click', () => loadCity(DEFAULT_CITY));

  $('not-found-action-btn').addEventListener('click', () => {
    if (S.retry) {
      S.retry();
    } else {
      $('city-search-input').value = '';
      setDashboardState('idle');
    }
  });

  $('hero-fav-action-btn').addEventListener('click', toggleCurrentFavorite);
  $('add-fav-btn').addEventListener('click', toggleCurrentFavorite);
  document.querySelectorAll('.fc-arrow').forEach((b) => b.addEventListener('click', () => carouselNavigate(Number(b.dataset.dir))));

  const fcViewport = $('forecast-viewport');
  if (fcViewport) {
    fcViewport.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') { e.preventDefault(); carouselNavigate(-1); }
      if (e.key === 'ArrowRight') { e.preventDefault(); carouselNavigate(1); }
    });
  }

  $('unit-btn-c').addEventListener('click', () => setTemperatureUnit('C'));
  $('unit-btn-f').addEventListener('click', () => setTemperatureUnit('F'));
  $('settings-form').addEventListener('submit', handleSaveSettings);
  $('signout-btn').addEventListener('click', signOut);

  const sbUnitC = $('sb-unit-c');
  const sbUnitF = $('sb-unit-f');
  if (sbUnitC) sbUnitC.addEventListener('click', () => setTemperatureUnit('C'));
  if (sbUnitF) sbUnitF.addEventListener('click', () => setTemperatureUnit('F'));

  const worldRefreshBtn = $('world-refresh-btn');
  if (worldRefreshBtn) worldRefreshBtn.addEventListener('click', () => ensureWorld(true));

  const searchInput = $('city-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(S.acTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) {
        closeAutocomplete();
        return;
      }
      S.acTimer = setTimeout(() => fetchAutocompleteSuggestions(q), 220);
    });
    searchInput.addEventListener('search', () => {
      if (!searchInput.value.trim()) closeAutocomplete();
    });
    searchInput.addEventListener('keydown', (e) => {
      const dd = $('ac-dropdown');
      if (!dd || !dd.classList.contains('open')) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); highlightAutocomplete(S.acIndex + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); highlightAutocomplete(S.acIndex - 1); }
      else if (e.key === 'Escape') { e.preventDefault(); closeAutocomplete(); }
    });
  }

  document.addEventListener('click', (e) => {
    const container = $('search-container');
    if (container && !container.contains(e.target)) closeAutocomplete();
  });

  document.querySelectorAll('.eye-toggle[data-eye-target]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.eyeTarget;
      const input = $(targetId);
      if (!input) return;
      const reveal = input.type === 'password';
      input.type = reveal ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(reveal));
      const baseLabel = btn.getAttribute('aria-label').replace('Show ', '').replace('Hide ', '');
      btn.setAttribute('aria-label', reveal ? `Hide ${baseLabel}` : `Show ${baseLabel}`);
      btn.style.color = reveal ? 'var(--accent-cyan)' : 'var(--text-secondary)';
    });
  });

  $('settings-email-input')?.addEventListener('input', updateSettingsSecurityHint);
  $('settings-confirm-password')?.addEventListener('input', updateSettingsSecurityHint);
  $('settings-new-password')?.addEventListener('input', (e) => {
    updatePasswordMeter(e.target.value, 'settings');
    updateSettingsSecurityHint();
  });

  const hero = $('hero-weather-card');
  hero.addEventListener('pointermove', (e) => {
    const rect = hero.getBoundingClientRect();
    hero.style.setProperty('--mx', `${e.clientX - rect.left}px`);
    hero.style.setProperty('--my', `${e.clientY - rect.top}px`);
  });
}

async function init() {
  const bootSplash = $('boot-splash');

  bindEvents();
  updateSystemClock();
  setInterval(updateSystemClock, 15000);

  const minSplash = new Promise((r) => setTimeout(r, 300));
  try {
    const [{ user }] = await Promise.all([api('GET', '/auth/me'), minSplash]);
    await enterApp(user, { silent: true });
  } catch (err) {
    await minSplash;
    showScreen('auth');
    setAuthTab('login');
    if (err.status === 0) showAuthError(err.message);
  } finally {
    if (bootSplash) bootSplash.classList.add('hidden');
  }
}

init();