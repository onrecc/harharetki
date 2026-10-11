// Fetches extra searchable names (squares, districts, stations, cafés…) for the local place index.
// Usage: node scripts/fetch-names.mjs && node scripts/build-places.mjs
import { writeFile } from "node:fs/promises";

const B = "60.138,24.900,60.192,25.000";
const query = `[out:json][timeout:60];
(
  nwr[place][name](${B});
  nwr[railway~"^(station|halt|tram_stop)$"][name](${B});
  nwr[amenity~"^(restaurant|cafe|bar|pub|cinema|university|college|school|library|hospital|theatre|marketplace|ferry_terminal|townhall|arts_centre|concert_hall)$"][name](${B});
  nwr[shop~"^(mall|department_store)$"][name](${B});
  nwr[tourism~"^(hotel|museum|zoo|aquarium|attraction)$"][name](${B});
  nwr[highway=pedestrian][area=yes][name](${B});
  nwr[leisure~"^(park|stadium|sports_centre|marina)$"][name](${B});
);
out center tags qt;`;
const res = await fetch("https://overpass-api.de/api/interpreter", {
  method: "POST",
  headers: { "User-Agent": "Harharetki/0.1 (Softamestari 2026)" },
  body: new URLSearchParams({ data: query }),
});
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const json = await res.json();
const out = json.elements
  .map((e) => {
    const c = e.type === "node" ? [e.lon, e.lat] : e.center ? [e.center.lon, e.center.lat] : null;
    const name = e.tags?.["name:fi"] ?? e.tags?.name;
    return c && name ? [name, Math.round(c[0] * 1e5) / 1e5, Math.round(c[1] * 1e5) / 1e5] : null;
  })
  .filter(Boolean);
await writeFile("scripts/names-extra.json", JSON.stringify(out));
console.log("names", out.length);
