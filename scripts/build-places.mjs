// Builds a compact name index (streets + named places) from the bundled OSM data, for instant search and reverse geocoding.
// Usage: node scripts/build-places.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const data = JSON.parse(readFileSync("public/data/helsinki.json", "utf8"));
const coord = new Map();
for (const e of data.elements) if (e.type === "node" && e.lat !== undefined) coord.set(e.id, [e.lon, e.lat]);

const r5 = (x) => Math.round(x * 1e5) / 1e5;
// Finnish first; bilingual "Fi / Sv" names keep their Finnish part.
const fi = (n) => (n?.includes(" / ") ? n.split(" / ")[0].trim() : n);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * 55600, (a[1] - b[1]) * 111000);

// Streets: sample a point every ~40 m along each named way.
const streets = new Map();
for (const e of data.elements) {
  if (e.type !== "way" || !e.nodes || !e.tags?.highway || !e.tags.name) continue;
  if (/^(footway|path|steps|corridor|cycleway)$/.test(e.tags.highway) && e.tags.footway === "sidewalk") continue;
  const sname = fi(e.tags["name:fi"] ?? e.tags.name);
  const pts = streets.get(sname) ?? [];
  let last = null;
  for (const id of e.nodes) {
    const c = coord.get(id);
    if (!c) continue;
    if (!last || dist(last, c) > 40) {
      pts.push(r5(c[0]), r5(c[1]));
      last = c;
    }
  }
  streets.set(sname, pts);
}

// Named places: POIs, parks and other named features with a position.
const places = [];
const seen = new Set();
for (const e of data.elements) {
  const t = e.tags;
  if (!t?.name || t.highway) continue;
  const c = e.type === "node" ? (e.lat !== undefined ? [e.lon, e.lat] : null) : e.center ? [e.center.lon, e.center.lat] : null;
  if (!c) continue;
  const name = fi(t["name:fi"] ?? t.name);
  const key = `${name}|${Math.round(c[0] * 500)}|${Math.round(c[1] * 500)}`;
  if (seen.has(key)) continue;
  seen.add(key);
  places.push([name, r5(c[0]), r5(c[1])]);
}

// Extra searchable names (squares, districts, stations, cafés…) from scripts/fetch-names.mjs.
if (existsSync("scripts/names-extra.json")) {
  for (const [rawName, lng, lat] of JSON.parse(readFileSync("scripts/names-extra.json", "utf8"))) {
    const name = fi(rawName);
    const key = `${name}|${Math.round(lng * 500)}|${Math.round(lat * 500)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    places.push([name, lng, lat]);
  }
}

const out = { streets: [...streets.entries()], places };
writeFileSync("public/data/places.json", JSON.stringify(out));
console.log("streets", streets.size, "places", places.length, "bytes", JSON.stringify(out).length);
