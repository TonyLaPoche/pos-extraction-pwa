const STORAGE_KEY = 'repere.history.v1';
const HISTORY_LIMIT = 30;

const form = document.querySelector('#search-form');
const errorEl = document.querySelector('#form-error');
const placeName = document.querySelector('#place-name');
const placeCoords = document.querySelector('#place-coords');
const routeButton = document.querySelector('#route-button');
const routeStatus = document.querySelector('#route-status');
const travelMode = document.querySelector('#travel-mode');
const shareButton = document.querySelector('#share-button');
const historyList = document.querySelector('#history-list');
const historyEmpty = document.querySelector('#history-empty');
const clearButton = document.querySelector('#clear-history');
const mapEl = document.querySelector('#map');
const mapEmpty = document.querySelector('#map-empty');
const fallbackFrame = document.querySelector('#osm-fallback');
const shareDialog = document.querySelector('#share-dialog');
const sharePlace = document.querySelector('#share-place');
const shareCoords = document.querySelector('#share-coords');
const shareLink = document.querySelector('#share-link');
const shareStatus = document.querySelector('#share-status');
const copyLinkButton = document.querySelector('#copy-link');
const nativeShareButton = document.querySelector('#native-share');
const shareSms = document.querySelector('#share-sms');
const shareWhatsapp = document.querySelector('#share-whatsapp');
const shareTelegram = document.querySelector('#share-telegram');
const shareViber = document.querySelector('#share-viber');

const fields = {
  lat: {
    deg: document.querySelector('#lat-deg'),
    min: document.querySelector('#lat-min'),
    sec: document.querySelector('#lat-sec')
  },
  lng: {
    deg: document.querySelector('#lng-deg'),
    min: document.querySelector('#lng-min'),
    sec: document.querySelector('#lng-sec')
  }
};

let map;
let marker;
let current = null;
let shareTarget = null;

function parseNumber(raw) {
  const value = String(raw ?? '').trim().replace(',', '.');
  if (value === '') return null;
  if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toDmsParts(value) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  let degrees = Math.floor(absolute + 1e-8);
  const minutesFloat = (absolute - degrees) * 60;
  let minutes = Math.floor(minutesFloat + 1e-8);
  let seconds = (minutesFloat - minutes) * 60;
  seconds = Math.round(seconds * 1000) / 1000;
  if (seconds >= 60) {
    seconds = 0;
    minutes += 1;
  }
  if (minutes >= 60) {
    minutes = 0;
    degrees += 1;
  }
  return { sign, degrees, minutes, seconds };
}

function formatSeconds(seconds) {
  return String(Math.round(seconds * 1000) / 1000);
}

function formatDms(value, positive, negative) {
  const parts = toDmsParts(value);
  const hemisphere = parts.sign < 0 ? negative : positive;
  return `${parts.degrees}° ${parts.minutes}′ ${formatSeconds(parts.seconds)}″ ${hemisphere}`;
}

function formatPair(lat, lng) {
  return `${formatDms(lat, 'N', 'S')} · ${formatDms(lng, 'E', 'O')}`;
}

function formatDecimal(value) {
  return Number(value).toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
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
  try {
    const next = [entry, ...readHistory().filter((item) => !samePlace(item, entry))];
    writeHistory(next);
    renderHistory(next);
  } catch {
    /* l’aperçu reste disponible même si le stockage est bloqué */
  }
}

function updateHistoryLabel(lat, lng, label) {
  const next = readHistory().map((item) => (samePlace(item, { lat, lng }) ? { ...item, label } : item));
  writeHistory(next);
  renderHistory(next);
}

function shareIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML =
    '<circle cx="6" cy="12" r="2.2" fill="currentColor"></circle><circle cx="17" cy="6.5" r="2.2" fill="currentColor"></circle><circle cx="17" cy="17.5" r="2.2" fill="currentColor"></circle><path d="M8 11.2 14.8 7.6M8 12.8l6.8 3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>';
  return svg;
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
    open.addEventListener('click', () =>
      selectPlace(item, { scroll: true, lookup: !item.label || item.label === formatPair(item.lat, item.lng) })
    );

    const share = document.createElement('button');
    share.type = 'button';
    share.className = 'history-share';
    share.setAttribute('aria-label', `Partager ${title.textContent}`);
    share.append(shareIcon());
    share.addEventListener('click', () => openShare(item));

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

    li.append(open, share, remove);
    historyList.append(li);
  });
}

function fillAxis(axis, value, positive, negative) {
  const parts = toDmsParts(value);
  fields[axis].deg.value = String(parts.degrees);
  fields[axis].min.value = String(parts.minutes);
  fields[axis].sec.value = formatSeconds(parts.seconds);
  const hemisphere = parts.sign < 0 ? negative : positive;
  const radio = document.querySelector(`input[name="${axis}-hemi"][value="${hemisphere}"]`);
  if (radio) radio.checked = true;
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
  placeCoords.textContent = formatPair(entry.lat, entry.lng);
  routeButton.disabled = false;
  shareButton.disabled = false;
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
  fillAxis('lat', entry.lat, 'N', 'S');
  fillAxis('lng', entry.lng, 'E', 'O');
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

function readAxis(axis, label) {
  const degrees = parseNumber(fields[axis].deg.value);
  const minutesRaw = fields[axis].min.value.trim();
  const secondsRaw = fields[axis].sec.value.trim();
  const minutes = minutesRaw === '' ? 0 : parseNumber(minutesRaw);
  const seconds = secondsRaw === '' ? 0 : parseNumber(secondsRaw);

  if (degrees === null || minutes === null || seconds === null) {
    return { error: `Les ${label} ne sont pas valides. Exemple : 48° 51′ 45,81″.` };
  }
  if (minutes >= 60 || seconds >= 60) {
    return { error: 'Les minutes et les secondes doivent être inférieures à 60.' };
  }

  const max = axis === 'lat' ? 90 : 180;
  if (degrees > max || (degrees === max && (minutes > 0 || seconds > 0))) {
    return {
      error: axis === 'lat' ? 'La latitude doit rester entre 0° et 90°.' : 'La longitude doit rester entre 0° et 180°.'
    };
  }

  const hemisphere = document.querySelector(`input[name="${axis}-hemi"]:checked`)?.value;
  const sign = hemisphere === 'S' || hemisphere === 'O' ? -1 : 1;
  return { value: sign * (degrees + minutes / 60 + seconds / 3600) };
}

function readFormCoordinates() {
  const lat = readAxis('lat', 'valeurs de latitude');
  if (lat.error) return lat;
  const lng = readAxis('lng', 'valeurs de longitude');
  if (lng.error) return lng;
  return { lat: lat.value, lng: lng.value };
}

function positionLink(lat, lng) {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  url.searchParams.set('lat', formatDecimal(lat));
  url.searchParams.set('lng', formatDecimal(lng));
  return url.toString();
}

function sharePayload(entry) {
  const name = entry.label && entry.label !== formatPair(entry.lat, entry.lng) ? entry.label : 'Position GPS';
  const coords = formatPair(entry.lat, entry.lng);
  const link = positionLink(entry.lat, entry.lng);
  return { name, coords, link, text: `${name}\n${coords}\n${link}` };
}

function channelHref(kind, payload) {
  const text = encodeURIComponent(payload.text);
  const link = encodeURIComponent(payload.link);
  const caption = encodeURIComponent(`${payload.name}\n${payload.coords}`);
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (kind === 'sms') return ios ? `sms:&body=${text}` : `sms:?body=${text}`;
  if (kind === 'whatsapp') return `https://wa.me/?text=${text}`;
  if (kind === 'telegram') return `https://t.me/share/url?url=${link}&text=${caption}`;
  return `viber://forward?text=${text}`;
}

function openShare(entry) {
  shareTarget = sharePayload(entry);
  sharePlace.textContent = shareTarget.name;
  shareCoords.textContent = shareTarget.coords;
  shareLink.textContent = shareTarget.link;
  shareLink.href = shareTarget.link;
  shareSms.href = channelHref('sms', shareTarget);
  shareWhatsapp.href = channelHref('whatsapp', shareTarget);
  shareTelegram.href = channelHref('telegram', shareTarget);
  shareViber.href = channelHref('viber', shareTarget);
  shareStatus.textContent = '';
  nativeShareButton.hidden = typeof navigator.share !== 'function';
  if (typeof shareDialog.showModal === 'function') shareDialog.showModal();
  else shareDialog.setAttribute('open', '');
}

const showButton = document.querySelector('#show-place');
let lastSearchAt = 0;

function runSearch() {
  const now = Date.now();
  if (now - lastSearchAt < 400) return;
  lastSearchAt = now;

  try {
    const result = readFormCoordinates();
    if (result.error) {
      errorEl.textContent = result.error;
      errorEl.scrollIntoView({ block: 'nearest' });
      return;
    }
    errorEl.textContent = '';
    showButton.textContent = 'Affichage…';
    const entry = {
      lat: result.lat,
      lng: result.lng,
      label: formatPair(result.lat, result.lng),
      savedAt: Date.now()
    };
    remember(entry);
    selectPlace(entry, { scroll: true, lookup: true });
  } catch {
    errorEl.textContent = 'Impossible d’afficher le lieu. Réessayez.';
  } finally {
    showButton.textContent = 'Afficher le lieu';
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSearch();
});

showButton.addEventListener('pointerup', (event) => {
  if (event.pointerType !== 'touch') return;
  event.preventDefault();
  runSearch();
});

shareButton.addEventListener('click', () => {
  if (current) openShare(current);
});

document.querySelector('#share-close').addEventListener('click', () => {
  shareDialog.close();
});

shareDialog.addEventListener('click', (event) => {
  if (event.target === shareDialog) shareDialog.close();
});

copyLinkButton.addEventListener('click', async () => {
  if (!shareTarget) return;
  try {
    await navigator.clipboard.writeText(shareTarget.link);
    shareStatus.textContent = 'Lien copié.';
  } catch {
    shareStatus.textContent = 'Sélectionnez le lien pour le copier.';
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(shareLink);
    selection.removeAllRanges();
    selection.addRange(range);
  }
});

nativeShareButton.addEventListener('click', async () => {
  if (!shareTarget || typeof navigator.share !== 'function') return;
  try {
    await navigator.share({ title: shareTarget.name, text: `${shareTarget.name}\n${shareTarget.coords}`, url: shareTarget.link });
    shareStatus.textContent = 'Feuille de partage ouverte.';
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    shareStatus.textContent = 'Le partage natif est indisponible. Utilisez un des boutons.';
  }
});

routeButton.addEventListener('click', () => {
  if (!current) return;

  const destination = `${formatDecimal(current.lat)},${formatDecimal(current.lng)}`;
  const mode = encodeURIComponent(travelMode.value || 'driving');
  const fallbackUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=${mode}`;
  routeButton.disabled = true;
  routeStatus.textContent = 'Lecture de la position de l’appareil…';

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
    finish('Position indisponible. Google Maps demandera le départ.', fallbackUrl);
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const origin = `${formatDecimal(position.coords.latitude)},${formatDecimal(position.coords.longitude)}`;
      finish(
        'Itinéraire ouvert dans Google Maps.',
        `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=${mode}`
      );
    },
    () => {
      finish('Position refusée. Google Maps demandera le départ.', fallbackUrl);
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

function placeFromQuery() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has('lat') || !params.has('lng')) return null;
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, label: formatPair(lat, lng), savedAt: Date.now() };
}

renderHistory();
const shared = placeFromQuery();
if (shared) {
  remember(shared);
  selectPlace(shared, { scroll: false, lookup: true });
} else {
  const saved = readHistory();
  if (saved[0]) selectPlace(saved[0], { scroll: false, lookup: false });
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloaded) return;
      reloaded = true;
      try {
        if (sessionStorage.getItem('repere-updated') === '6') return;
        sessionStorage.setItem('repere-updated', '6');
      } catch {
        return;
      }
      window.location.reload();
    });
    navigator.serviceWorker.register('./sw.js?v=6').catch(() => {});
  });
}
