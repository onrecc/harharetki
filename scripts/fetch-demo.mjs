// Lataa Helsingin keskustan OSM-aineiston valmiiksi (demo + varmuuskopio, jos Overpass on ruuhkainen).
// Käyttö: node scripts/fetch-demo.mjs
import { writeFile } from "node:fs/promises";

const BBOX = [60.138, 24.900, 60.192, 25.000]; // S, W, N, E
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const { buildQuery } = await import("../src/lib/osm/query.ts");
const query = buildQuery(BBOX, 180);

for (const url of ENDPOINTS) {
  try {
    const t = Date.now();
    const res = await fetch(url, {
      method: "POST",
      headers: { "User-Agent": "Harharetki/0.1 (Softamestari 2026)" },
      body: new URLSearchParams({ data: query }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    json.bbox = BBOX;
    await writeFile(process.env.OUT ?? "public/data/helsinki.json", JSON.stringify(json));
    console.log(url, json.elements.length, "elements", Date.now() - t, "ms");
    process.exit(0);
  } catch (e) {
    console.error(url, e.message);
  }
}
process.exit(1);
