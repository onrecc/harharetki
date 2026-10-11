import type { LngLat } from "@/lib/routing/geo";
import { distToSegment } from "@/lib/routing/geo";
import { DEMO_BBOX } from "./load";
import { overpass } from "./overpass";

export interface BuildingProps {
  year?: number;
  /** Short map label: the construction year, or "historiallinen". */
  label: string;
  name?: string;
  /** Protected, tagged historic, or built before 1940. */
  historic: boolean;
}

export interface BuildingFeature {
  type: "Feature";
  id: number;
  geometry: { type: "Polygon"; coordinates: number[][][] };
  properties: BuildingProps;
}

/** GeoJSON FeatureCollection of building footprints — pass straight to a MapLibre GeoJSON source. */
export interface BuildingCollection {
  type: "FeatureCollection";
  features: BuildingFeature[];
}

const EMPTY: BuildingCollection = { type: "FeatureCollection", features: [] };

/** Keep every n-th point so the Overpass `around` filter stays small. */
function simplify(coords: LngLat[], max = 120): LngLat[] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

function parseYear(v?: string): number | undefined {
  const m = v?.match(/(1[0-9]{3}|20[0-2][0-9])/);
  return m ? Number(m[1]) : undefined;
}

/** Bundled central-Helsinki buildings (scripts/fetch-buildings.mjs): [id, year, historic, name, flat lng/lat]. */
type BundledRow = [id: number, year: number | null, historic: 0 | 1, name: string | null, flat: number[]];
let bundled: Promise<BuildingFeature[]> | null = null;

function loadBundled(): Promise<BuildingFeature[]> {
  bundled ??= fetch("/data/buildings.json")
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<BundledRow[]>;
    })
    .then((rows) =>
      rows.map(([id, year, historic, name, flat]) => {
        const ring: number[][] = [];
        for (let i = 0; i + 1 < flat.length; i += 2) ring.push([flat[i], flat[i + 1]]);
        const [f, l] = [ring[0], ring[ring.length - 1]];
        if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
        return {
          type: "Feature" as const,
          id,
          geometry: { type: "Polygon" as const, coordinates: [ring] },
          properties: { year: year ?? undefined, label: year ? String(year) : "historiallinen", name: name ?? undefined, historic: !!historic },
        };
      }),
    )
    .catch((e) => {
      bundled = null;
      throw e;
    });
  return bundled;
}

const insideDemo = ([lng, lat]: LngLat) =>
  lat > DEMO_BBOX[0] && lat < DEMO_BBOX[2] && lng > DEMO_BBOX[1] && lng < DEMO_BBOX[3];

/** Buildings with any corner within `radius` m of the route. */
function nearRoute(all: BuildingFeature[], coords: LngLat[], radius: number): BuildingFeature[] {
  const lat0 = coords[0][1];
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110574;
  const xs = coords.map((c) => c[0] * kx);
  const ys = coords.map((c) => c[1] * ky);
  const pad = radius + 10;
  const [x0, x1, y0, y1] = [Math.min(...xs) - pad, Math.max(...xs) + pad, Math.min(...ys) - pad, Math.max(...ys) + pad];
  return all.filter((b) =>
    b.geometry.coordinates[0].some(([lng, lat]) => {
      const x = lng * kx;
      const y = lat * ky;
      if (x < x0 || x > x1 || y < y0 || y > y1) return false;
      for (let i = 0; i + 1 < xs.length; i++) if (distToSegment(x, y, xs[i], ys[i], xs[i + 1], ys[i + 1]) <= radius) return true;
      return false;
    }),
  );
}

interface WayGeom {
  type: string;
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/**
 * Buildings within ~45 m of the route that have a known construction year or are historic.
 * Data: OpenStreetMap `building=*` ways with `start_date`, `historic`, `heritage` or a Wikidata link.
 * Never throws — resolves to an empty collection on failure.
 */
/** Only buildings with a known year, at least 80 years old, get the glow and year label. */
const OLD_BEFORE = new Date().getFullYear() - 80;
const isOld = (f: BuildingFeature) => f.properties.year !== undefined && f.properties.year <= OLD_BEFORE;

export async function fetchRouteBuildings(coords: LngLat[], signal?: AbortSignal): Promise<BuildingCollection> {
  if (coords.length < 2) return EMPTY;
  if (coords.every(insideDemo)) {
    try {
      return { type: "FeatureCollection", features: nearRoute(await loadBundled(), coords, 45).filter(isOld) };
    } catch {
      // Fall through to the live query.
    }
  }
  const line = simplify(coords)
    .map(([lng, lat]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .join(",");
  const around = `(around:45,${line})`;
  const query = `[out:json][timeout:25];
(
  way[building][start_date]${around};
  way[building][construction_date]${around};
  way[building][historic]${around};
  way[building][heritage]${around};
  way[building][wikidata]${around};
);
out geom tags qt;`;
  try {
    const json = (await overpass(query, signal, 20000)) as { elements: WayGeom[] };
    const features: BuildingCollection["features"] = [];
    for (const e of json.elements) {
      if (e.type !== "way" || !e.geometry || e.geometry.length < 4) continue;
      const t = e.tags ?? {};
      const year = parseYear(t.start_date) ?? parseYear(t.construction_date);
      const historic = !!t.historic || !!t.heritage || (year !== undefined && year < 1940);
      if (year === undefined && !historic) continue;
      const ring = e.geometry.map((g) => [g.lon, g.lat]);
      const [f, l] = [ring[0], ring[ring.length - 1]];
      if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
      features.push({
        type: "Feature",
        id: e.id,
        geometry: { type: "Polygon", coordinates: [ring] },
        properties: {
          year,
          label: year ? String(year) : "historiallinen",
          name: t["name:fi"] ?? t.name,
          historic,
        },
      });
    }
    return { type: "FeatureCollection", features: features.filter(isOld) };
  } catch {
    return EMPTY;
  }
}
