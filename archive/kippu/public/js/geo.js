/* Maps: Leaflet with OpenStreetMap tiles, and place search through Nominatim (OpenStreetMap).
   Nominatim asks for at most one request per second, so every lookup waits its turn. */

let leaflet = null;
export function loadLeaflet() {
  if (leaflet) return leaflet;
  leaflet = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = "/vendor/leaflet.css";
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = "/vendor/leaflet.js";
    s.onload = () => resolve(window.L);
    s.onerror = () => { leaflet = null; reject(new Error("leaflet")); };
    document.head.appendChild(s);
  });
  return leaflet;
}

export const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

let queue = Promise.resolve();
let last = 0;
function turn(fn) {
  const p = queue.then(async () => {
    const wait = last + 1100 - Date.now();
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    last = Date.now();
    return fn();
  });
  queue = p.catch(() => {});
  return p;
}

const pick = a => (a && (a.city || a.town || a.village || a.municipality || a.city_district || a.county || a.state)) || "";
function place(r) {
  const a = r.address || {};
  return {
    lat: +(+r.lat).toFixed(6),
    lng: +(+r.lon).toFixed(6),
    label: r.name || (r.display_name || "").split(",")[0],
    detail: r.display_name || "",
    city: pick(a),
    country: a.country || "",
    cc: (a.country_code || "").toUpperCase(),
  };
}

/* up to `limit` candidates for a free-text query, best first */
export function searchPlaces(q, limit = 5) {
  const query = String(q || "").trim();
  if (!query) return Promise.resolve([]);
  return turn(async () => {
    const u = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&accept-language=ja&limit=" + limit + "&q=" + encodeURIComponent(query);
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("geocode " + r.status);
    return (await r.json()).map(place);
  });
}

/* city and country for a point the user tapped */
export function whereIs(lat, lng) {
  return turn(async () => {
    const u = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&accept-language=ja&zoom=14&lat=${lat}&lon=${lng}`;
    const r = await fetch(u, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("reverse " + r.status);
    const j = await r.json();
    return j && j.address ? place(Object.assign({}, j, { lat, lon: lng })) : { lat, lng, city: "", country: "", cc: "" };
  });
}
