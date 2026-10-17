// ---------- 1. Map (OpenStreetMap tiles drawn by Leaflet) ----------
const map = L.map("map").setView([33.6200, 73.0600], 13);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

const listEl = document.getElementById("list");
const statusEl = document.getElementById("status");
const countEl = document.getElementById("count");
const searchEl = document.getElementById("search");

let stations = [];
let userLatLng = null, userMarker = null, stationMarker = null, routeLine = null, routeLabel = null;
let locationMessage = "⏳ Waiting for your location…";

const FALLBACK = { lat: 33.5973, lng: 73.0479, label: "Saddar, Rawalpindi (default)" };

// Petrol pumps on Murree Road (always shown, so there are at least 10).
// Coordinates are approximate: check each one on openstreetmap.org and correct it before submitting.
const MANUAL_STATIONS = [
  { name: "Shell, Liaquat Bagh",              lat: 33.6075, lng: 73.0672 },
  { name: "PSO, Committee Chowk",             lat: 33.6128, lng: 73.0644 },
  { name: "Shell, Asghar Mall",               lat: 33.6160, lng: 73.0650 },
  { name: "Total Parco, Jamia Masjid Road",   lat: 33.6190, lng: 73.0655 },
  { name: "Attock Petroleum, Chandni Chowk",  lat: 33.6240, lng: 73.0680 },
  { name: "PSO, Waris Khan",                  lat: 33.6310, lng: 73.0700 },
  { name: "Hascol, Rehmanabad",               lat: 33.6360, lng: 73.0715 },
  { name: "Attock Petroleum, Sixth Road",     lat: 33.6385, lng: 73.0725 },
  { name: "Shell, Shamsabad",                 lat: 33.6445, lng: 73.0750 },
  { name: "Caltex, Faizabad",                 lat: 33.6560, lng: 73.0790 }
].map(s => ({ ...s, area: "Murree Road" }));

// ---------- Emoji map icons ----------
function emojiIcon(cls, emoji, size) {
  return L.divIcon({ className: cls, html: `<span>${emoji}</span>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
}
const pumpIcon   = emojiIcon("pump-icon", "⛽", 30);
const targetIcon = emojiIcon("target-icon", "⛽", 42);
const userIcon   = emojiIcon("me-icon", "🧍", 34);

// ---------- 2. Route card in the middle panel (top centre of the map) ----------
map._controlCorners.topcenter = L.DomUtil.create("div", "leaflet-top leaflet-center", map._controlContainer);
const routeControl = L.control({ position: "topcenter" });
let cardEl = null;
routeControl.onAdd = () => {
  cardEl = L.DomUtil.create("div", "route-card");
  L.DomEvent.disableClickPropagation(cardEl);
  return cardEl;
};
routeControl.addTo(map);

function showHint(text) { cardEl.innerHTML = `<span class="route-hint">${text}</span>`; }
showHint("👈 Select a petrol pump to see the route, distance and time");

// ---------- 3. Load petrol pumps on Murree Road from OpenStreetMap (Overpass API) ----------
const BBOX = "33.58,73.03,33.66,73.10"; // south, west, north, east
const QUERY = `
[out:json][timeout:25];
way["highway"]["name"~"Murree Road",i](${BBOX})->.road;
nwr["amenity"="fuel"](around.road:100)(${BBOX});
out center tags;`;
const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter"
];

async function fetchOsmStations() {
  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, { method: "POST", body: "data=" + encodeURIComponent(QUERY) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      return data.elements.map(el => ({
        name: el.tags.name || el.tags.brand || "Petrol Pump (unnamed)",
        area: "Murree Road",
        lat: el.lat ?? el.center.lat,
        lng: el.lon ?? el.center.lon
      }));
    } catch (err) {
      console.warn("Overpass failed:", url, err);
    }
  }
  return null;
}

async function loadStations() {
  setStatus("🛰️ Loading petrol pumps from OpenStreetMap…");
  const osm = await fetchOsmStations();

  // OSM pumps first, then add manual pumps that are not already there (within 80 m)
  stations = osm ? [...osm] : [];
  MANUAL_STATIONS.forEach(m => {
    const duplicate = stations.some(s => L.latLng(s.lat, s.lng).distanceTo([m.lat, m.lng]) < 80);
    if (!duplicate) stations.push(m);
  });
  stations.sort((a, b) => a.name.localeCompare(b.name));

  renderList();
  showAllOnMap();
  const source = osm ? `${osm.length} from OpenStreetMap` : "OpenStreetMap unavailable, manual list used";
  setStatus(`✅ ${stations.length} petrol pumps on Murree Road (${source}). ${locationMessage}`);
}

function setStatus(text) { statusEl.textContent = text; }

// ---------- 4. Sidebar list, search and overview markers ----------
function renderList() {
  listEl.innerHTML = "";
  countEl.textContent = stations.length;
  stations.forEach((s, i) => {
    const btn = document.createElement("button");
    btn.className = "loc";
    btn.dataset.name = s.name.toLowerCase();
    const title = document.createElement("b");
    title.textContent = "⛽ " + s.name;
    const sub = document.createElement("span");
    sub.textContent = "🛣️ " + s.area;
    btn.append(title, sub);
    btn.addEventListener("click", () => selectStation(i, btn));
    listEl.appendChild(btn);
  });
}

searchEl.addEventListener("input", () => {
  const q = searchEl.value.trim().toLowerCase();
  let visible = 0;
  document.querySelectorAll(".loc").forEach(b => {
    const show = b.dataset.name.includes(q);
    b.classList.toggle("hidden", !show);
    if (show) visible++;
  });
  countEl.textContent = visible;
});

let overview = null;
function showAllOnMap() {
  if (overview) map.removeLayer(overview);
  overview = L.layerGroup(stations.map(s => L.marker([s.lat, s.lng], { icon: pumpIcon }).bindTooltip(s.name))).addTo(map);
  map.fitBounds(L.latLngBounds(stations.map(s => [s.lat, s.lng])), { padding: [40, 40] });
}

// ---------- 5. Current location (browser Geolocation API) ----------
function setUser(lat, lng, text) {
  userLatLng = L.latLng(lat, lng);
  locationMessage = text;
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker(userLatLng, { icon: userIcon, zIndexOffset: 1000 }).addTo(map).bindPopup("📍 You are here");
  setStatus(stations.length ? `✅ ${stations.length} petrol pumps on Murree Road. ${text}` : text);
}

if ("geolocation" in navigator) {
  navigator.geolocation.getCurrentPosition(
    pos => setUser(pos.coords.latitude, pos.coords.longitude, "📍 Your location found. Choose a petrol pump."),
    () => setUser(FALLBACK.lat, FALLBACK.lng, `🚫 Location blocked, so ${FALLBACK.label} is the start. Allow location access to use your real position.`),
    { enableHighAccuracy: true, timeout: 10000 }
  );
} else {
  setUser(FALLBACK.lat, FALLBACK.lng, `🚫 Geolocation not supported. Using ${FALLBACK.label}.`);
}

// ---------- 6. Select a station: marker + multiple routes (OSRM routing API) ----------
let routeLayers = [];     // one Leaflet layer per route
let routesData = [];      // route info returned by OSRM
let activeRoute = 0;
let currentStation = null;

function clearRoutes() {
  routeLayers.forEach(l => map.removeLayer(l));
  routeLayers = [];
  routesData = [];
  if (routeLabel) { map.removeLayer(routeLabel); routeLabel = null; }
}

function fmtTime(sec) {
  const mins = Math.round(sec / 60);
  return mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
}

async function selectStation(i, btn) {
  document.querySelectorAll(".loc").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  const s = stations[i];
  currentStation = s;
  if (stationMarker) map.removeLayer(stationMarker);
  clearRoutes();

  stationMarker = L.marker([s.lat, s.lng], { icon: targetIcon, zIndexOffset: 900 }).addTo(map);
  stationMarker.bindPopup(`⛽ <b>${escapeHtml(s.name)}</b><br>🛣️ ${s.area}`).openPopup();

  if (!userLatLng) { showHint("⏳ Your location is not available yet. Try again in a moment."); return; }
  showHint("🧮 Calculating routes…");

  // alternatives=true asks OSRM for more than one route
  const url = "https://router.project-osrm.org/route/v1/driving/" +
              `${userLatLng.lng},${userLatLng.lat};${s.lng},${s.lat}` +
              "?overview=full&geometries=geojson&alternatives=true";
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.code !== "Ok") throw new Error(data.code);

    routesData = data.routes;
    routeLayers = routesData.map((r, idx) =>
      L.geoJSON(r.geometry).addTo(map).on("click", () => selectRoute(idx))
    );
    const all = L.featureGroup(routeLayers);
    map.fitBounds(all.getBounds(), { padding: [110, 60] });
    selectRoute(0);
  } catch (err) {
    showHint("❌ Could not get the routes. Check your internet connection and try again.");
    console.error(err);
  }
}

// Highlight one route, grey out the others, and update the card + distance label
function selectRoute(idx) {
  activeRoute = idx;
  routeLayers.forEach((layer, k) => {
    const active = k === idx;
    layer.setStyle(active
      ? { color: "#ff8a1f", weight: 7, opacity: 1 }
      : { color: "#5b7f95", weight: 5, opacity: .8 });
    layer.eachLayer(p => { const el = p.getElement(); if (el) el.classList.toggle("route-line", active); });
    if (active) layer.bringToFront();
  });

  const r = routesData[idx];
  if (routeLabel) map.removeLayer(routeLabel);
  const mid = r.geometry.coordinates[Math.floor(r.geometry.coordinates.length / 2)];
  routeLabel = L.tooltip({ permanent: true, direction: "top", className: "route-label" })
    .setLatLng([mid[1], mid[0]]).setContent(`📏 ${(r.distance / 1000).toFixed(1)} km`).addTo(map);

  renderRouteCard();
}

function renderRouteCard() {
  const fastest  = routesData.reduce((m, r, k) => r.duration < routesData[m].duration ? k : m, 0);
  const shortest = routesData.reduce((m, r, k) => r.distance < routesData[m].distance ? k : m, 0);

  const tiles = routesData.map((r, k) => {
    const tags = [k === fastest ? "⚡ Fastest" : "", k === shortest ? "📏 Shortest" : ""].filter(Boolean).join(" · ");
    return `<button class="rc-route ${k === activeRoute ? "on" : ""}" data-i="${k}">
      <small>🛣️ Route ${k + 1}${tags ? " · " + tags : ""}</small>
      <strong>${(r.distance / 1000).toFixed(1)} km</strong>
      <span>🕒 ${fmtTime(r.duration)} 🚗</span>
    </button>`;
  }).join("");

  const arrive = new Date(Date.now() + routesData[activeRoute].duration * 1000)
    .toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  cardEl.innerHTML = `
    <div class="rc-dest"><small>🎯 Destination</small><b>${escapeHtml(currentStation.name)}</b>
      <small>🏁 Arrive about ${arrive}</small></div>
    <div class="rc-routes">${tiles}</div>
    ${routesData.length === 1 ? '<div class="rc-note">Only one route found for this trip</div>' : ""}`;

  cardEl.querySelectorAll(".rc-route").forEach(b =>
    b.addEventListener("click", () => selectRoute(Number(b.dataset.i))));
}

function escapeHtml(t) {
  return t.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

loadStations();