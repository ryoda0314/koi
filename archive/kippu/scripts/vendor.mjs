// Copies the browser libraries into public/vendor so the site needs no build step and no CDN.
import fs from "node:fs";
const root = new URL("../", import.meta.url);
const out = new URL("public/vendor/", root);
fs.mkdirSync(out, { recursive: true });
const files = {
  "preact.js": "node_modules/htm/preact/standalone.module.js",
  "supabase.js": "node_modules/@supabase/supabase-js/dist/umd/supabase.js",
  "leaflet.js": "node_modules/leaflet/dist/leaflet.js",
  "leaflet.css": "node_modules/leaflet/dist/leaflet.css",
  "qrcode.mjs": "node_modules/qrcode-generator/dist/qrcode.mjs",
};
for (const [name, from] of Object.entries(files)) {
  fs.copyFileSync(new URL(from, root), new URL(name, out));
  console.log("vendor/" + name);
}
