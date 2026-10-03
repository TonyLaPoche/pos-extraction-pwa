const STORAGE_KEY = 'repere.history.v1';
const HISTORY_LIMIT = 30;

const form = document.querySelector('#search-form');
const latInput = document.querySelector('#latitude');
const lngInput = document.querySelector('#longitude');
const errorEl = document.querySelector('#form-error');
const placeName = document.querySelector('#place-name');
const placeCoords = document.querySelector('#place-coords');
const routeButton = document.querySelector('#route-button');
const routeStatus = document.querySelector('#route-status');
const travelMode = document.querySelector('#travel-mode');
const historyList = document.querySelector('#history-list');
const historyEmpty = document.querySelector('#history-empty');
const clearButton = document.querySelector('#clear-history');
const mapEl = document.querySelector('#map');
const mapEmpty = document.querySelector('#map-empty');
const fallbackFrame = document.querySelector('#osm-fallback');

let map;
let marker;
let current = null;

function parseCoord(raw) {
  const value = String(raw ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function splitPair(raw) {
  const match = String(raw ?? '')
    .trim()
    .match(/^([+-]?\d+(?:[.,]\d+)?)(?:\s*[,;]\s*|\s+)([+-]?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  return [match[1], match[2]];
}

function formatPair(lat, lng) {
  return `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`;
}

function formatPretty(lat, lng) {
  const northSouth = lat >= 0 ? 'N' : 'S';
  const eastWest = lng >= 0 ? 'E' : 'O';
  return `${Math.abs(lat).toFixed(5)}° ${northSouth} · ${Math.abs(lng).toFixed(5)}° ${eastWest}`;
}

function samePlace(a, b) {
  return Number(a.lat).toFixed(5) === Number(b.lat).toFixed(5) && Number(a.lng).toFixed(5) === Number(b.lng).toFixed(5);
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
  } catch {
    return [];
  }
}

function writeHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));
}

function remember(entry) {
  const next = [entry, ...readHistory().filter((item) => !samePlace(item, entry))];
  writeHistory(next);
  renderHistory(next);
}

function updateHistoryLabel(lat, lng, label) {
  const next = readHistory().map((item) => (samePlace(item, { lat, lng }) ? { ...item, label } : item));
  writeHistory(next);
  renderHistory(next);
}

function renderHistory(items = readHistory()) {
  historyList.replaceChildren();
  historyEmpty.hidden = items.length > 0;
  clearButton.hidden = items.length === 0;

  items.forEach((item) => {
    const li = document.createElement('li');
    li.className = 'history-item';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'history-open';

    const title = document.createElement('strong');
    title.textContent = item.label || formatPair(item.lat, item.lng);

    const coords = document.createElement('span');
    coords.textContent = formatPair(item.lat, item.lng);

    const time = document.createElement('time');
    const savedAt = new Date(item.savedAt || Date.now());
    time.dateTime = savedAt.toISOString();
    time.textContent = savedAt.toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });

    open.append(title, coords, time);
    open.addEventListener('click', () => selectPlace(item, { scroll: true, lookup: !item.label || item.label === formatPair(item.lat, item.lng) }));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'history-delete';
    remove.setAttribute('aria-label', `Retirer ${title.textContent}`);
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      const next = readHistory().filter((entry) => !(samePlace(entry, item) && entry.savedAt === item.savedAt));
      writeHistory(next);
      renderHistory(next);
    });

    li.append(open, remove);
    historyList.append(li);
  });
}

function handlePairPaste(event) {
  const text = event.clipboardData?.getData('text') ?? '';
  const pair = splitPair(text);
  if (!pair) return;
  event.preventDefault();
  latInput.value = pair[0];
  lngInput.value = pair[1];
}

function showOnMap(lat, lng) {
  mapEmpty.hidden = true;

  if (!window.L) {
    const pad = 0.01;
    const bbox = [lng - pad, lat - pad * 0.7, lng + pad, lat + pad * 0.7].join(',');
    fallbackFrame.src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${lat},${lng}`)}`;
    fallbackFrame.hidden = false;
    mapEl.hidden = true;
    return;
  }

  fallbackFrame.hidden = true;
  mapEl.hidden = false;

  if (!map) {
    map = L.map(mapEl, { zoomControl: true, scrollWheelZoom: true }).setView([lat, lng], 16);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);
  } else {
    map.setView([lat, lng], 16);
  }

  const icon = L.divIcon({
    className: 'marker-icon',
    html: '<div class="marker-dot"></div>',
    iconSize: [18, 18],
    iconAnchor: [9, 9]
  });

  if (marker) marker.setLatLng([lat, lng]);
  else marker = L.marker([lat, lng], { icon }).addTo(map);

  requestAnimationFrame(() => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 200);
}

function showPlace(entry, { scroll = true } = {}) {
  current = entry;
  placeName.textContent = entry.label && entry.label !== formatPair(entry.lat, entry.lng) ? entry.label : 'Recherche du lieu…';
  placeCoords.textContent = formatPretty(entry.lat, entry.lng);
  routeButton.disabled = false;
  routeStatus.textContent = '';
  showOnMap(entry.lat, entry.lng);

  if (scroll) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.querySelector('#preview').scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function labelFromNominatim(data) {
  if (!data) return null;
  const address = data.address || {};
  const place =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.hamlet ||
    address.suburb ||
    address.county;
  if (place && address.country) return `${place}, ${address.country}`;
  if (typeof data.display_name === 'string' && data.display_name) {
    return data.display_name.split(',').slice(0, 2).join(',').trim();
  }
  return null;
}

async function reverseLabel(lat, lng) {
  const nominatim = new URL('https://nominatim.openstreetmap.org/reverse');
  nominatim.searchParams.set('format', 'jsonv2');
  nominatim.searchParams.set('lat', String(lat));
  nominatim.searchParams.set('lon', String(lng));
  nominatim.searchParams.set('accept-language', 'fr');
  const primary = labelFromNominatim(await fetchJson(nominatim));
  if (primary) return primary;

  const backup = new URL('https://api.bigdatacloud.net/data/reverse-geocode-client');
  backup.searchParams.set('latitude', String(lat));
  backup.searchParams.set('longitude', String(lng));
  backup.searchParams.set('localityLanguage', 'fr');
  const data = await fetchJson(backup);
  const place = data && (data.city || data.locality || data.principalSubdivision);
  if (place && data.countryName) return `${place}, ${data.countryName}`;
  return null;
}

function selectPlace(entry, { scroll = true, lookup = false } = {}) {
  latInput.value = String(entry.lat);
  lngInput.value = String(entry.lng);
  errorEl.textContent = '';
  showPlace(entry, { scroll });
  if (!lookup) return;

  reverseLabel(entry.lat, entry.lng).then((label) => {
    const stillCurrent = current && samePlace(current, entry);
    if (!label) {
      if (stillCurrent && placeName.textContent === 'Recherche du lieu…') {
        placeName.textContent = 'Lieu aux coordonnées saisies';
      }
      return;
    }
    updateHistoryLabel(entry.lat, entry.lng, label);
    if (!stillCurrent) return;
    current = { ...current, label };
    placeName.textContent = label;
  });
}

function readFormCoordinates() {
  const lat = parseCoord(latInput.value);
  const lng = parseCoord(lngInput.value);
  if (lat === null || lng === null) {
    return { error: 'Entrez une latitude et une longitude valides. Exemple : 48,8566 et 2,3522.' };
  }
  if (lat < -90 || lat > 90) return { error: 'La latitude doit être comprise entre −90 et 90.' };
  if (lng < -180 || lng > 180) return { error: 'La longitude doit être comprise entre −180 et 180.' };
  return { lat, lng };
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const result = readFormCoordinates();
  if (result.error) {
    errorEl.textContent = result.error;
    return;
  }
  errorEl.textContent = '';
  const entry = {
    lat: result.lat,
    lng: result.lng,
    label: formatPair(result.lat, result.lng),
    savedAt: Date.now()
  };
  remember(entry);
  selectPlace(entry, { scroll: true, lookup: true });
});

latInput.addEventListener('paste', handlePairPaste);
lngInput.addEventListener('paste', handlePairPaste);

routeButton.addEventListener('click', () => {
  if (!current) return;

  const destination = `${current.lat},${current.lng}`;
  const mode = encodeURIComponent(travelMode.value || 'driving');
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=${mode}`;
  routeButton.disabled = true;
  routeStatus.textContent = 'Lecture de votre position…';

  const popup = window.open('', '_blank');
  if (popup) {
    try {
      popup.opener = null;
      popup.document.write(
        '<!DOCTYPE html><title>Itinéraire</title><p style="font-family:Georgia,serif;padding:32px">Préparation de l’itinéraire…</p>'
      );
      popup.document.close();
    } catch {
      /* la fenêtre reste utilisable */
    }
  }

  const openUrl = (url) => {
    if (popup && !popup.closed) popup.location.replace(url);
    else window.location.assign(url);
  };

  const finish = (message, url) => {
    routeStatus.textContent = message;
    openUrl(url);
    routeButton.disabled = false;
  };

  if (!navigator.geolocation) {
    finish('Itinéraire ouvert dans Google Maps.', fallbackUrl);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const origin = `${position.coords.latitude},${position.coords.longitude}`;
      finish(
        'Itinéraire ouvert dans Google Maps.',
        `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${mode}`
      );
    },
    () => {
      finish('Position indisponible. Google Maps demandera le départ.', fallbackUrl);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
});

clearButton.addEventListener('click', () => {
  if (!window.confirm('Effacer tout l’historique des recherches sur cet appareil ?')) return;
  localStorage.removeItem(STORAGE_KEY);
  renderHistory([]);
});

window.addEventListener('resize', () => {
  if (map) map.invalidateSize();
});

renderHistory();
const saved = readHistory();
if (saved[0]) selectPlace(saved[0], { scroll: false, lookup: false });

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
