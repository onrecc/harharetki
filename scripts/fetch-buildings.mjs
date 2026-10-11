// Bundles building outlines with a construction year or heritage status for central Helsinki.
// Usage: node scripts/fetch-buildings.mjs  →  public/data/buildings.json
import { writeFile } from "node:fs/promises";

const B = "60.138,24.900,60.192,25.000";
const query = `[out:json][timeout:90];
(
  way[building][start_date](${B});
  way[building][construction_date](${B});
  way[building][historic](${B});
  way[building][heritage](${B});
);
out geom tags qt;`;
const ENDPOINTS = [
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  "https://overpass-api.de/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];
const year = (v) => {
  const m = v?.match(/(1[0-9]{3}|20[0-2][0-9])/);
  return m ? Number(m[1]) : null;
};
const r5 = (x) => Math.round(x * 1e5) / 1e5;

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
    const out = [];
    for (const e of json.elements) {
      if (!e.geometry || e.geometry.length < 4) continue;
      const t = e.tags ?? {};
      const y = year(t.start_date) ?? year(t.construction_date);
      const historic = t.historic || t.heritage || (y !== null && y < 1940) ? 1 : 0;
      if (y === null && !historic) continue;
      const name = t["name:fi"] ?? t.name ?? null;
      out.push([e.id, y, historic, name, e.geometry.flatMap((g) => [r5(g.lon), r5(g.lat)])]);
    }
    await writeFile("public/data/buildings.json", JSON.stringify(out));
    console.log(url, out.length, "buildings", Date.now() - t, "ms");
    process.exit(0);
  } catch (err) {
    console.error(url, err.message);
  }
}
process.exit(1);
